// 디자이너 — 실제 시안 파일(SVG/HTML)을 만듭니다.
// 1) 방향 잡기: 시안 수만큼 서로 다른 콘셉트를 정합니다(수정 라운드는 고객이 고른 안을 다듬음).
// 2) 제작: 콘셉트마다 완성된 파일을 코드로 그립니다.
// 3) 아트디렉터 검토: 브리프와 대조해 점수를 매기고, 부족하면 고친 버전으로 바꿉니다.
// 끝나면 계정 관리자에게 designs_ready 이벤트를 넘겨 고객에게 보여 주게 합니다.

import fs from 'node:fs';
import path from 'node:path';
import { enqueueAgent, short } from './actions.mjs';
import { designerSystem } from './prompts.mjs';
import { jsonOf } from './claude.mjs';

const MAX_CODE_IN_CONTEXT = 60000;

const DIRECTIONS_SCHEMA = {
  type: 'object',
  properties: {
    directions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          idea: { type: 'string' },
          palette: { type: 'array', items: { type: 'string' } },
          typography: { type: 'string' },
          layout: { type: 'string' },
          format: { type: 'string', enum: ['svg', 'html'] },
        },
        required: ['name', 'idea', 'palette', 'typography', 'layout', 'format'],
        additionalProperties: false,
      },
    },
  },
  required: ['directions'],
  additionalProperties: false,
};

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    rationale: { type: 'string' },
    format: { type: 'string', enum: ['svg', 'html'] },
    code: { type: 'string' },
  },
  required: ['title', 'rationale', 'format', 'code'],
  additionalProperties: false,
};

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer' },
    summary: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' } },
    revised_code: { type: 'string' },
  },
  required: ['score', 'summary', 'issues', 'revised_code'],
  additionalProperties: false,
};

function looksValid(format, code) {
  if (typeof code !== 'string' || code.length < 40) return false;
  if (format === 'svg') return /<svg[\s>]/i.test(code) && /<\/svg>/i.test(code);
  return /<html|<body|<div|<main|<section/i.test(code);
}

function imageBlocks(store, project) {
  // 고객이 올린 참고 이미지(최근 4장)를 Claude가 직접 봅니다.
  const files = store
    .find('messages', (m) => m.projectId === project.id && m.from === 'client')
    .flatMap((m) => m.attachments ?? [])
    .slice(-4);
  const blocks = [];
  for (const a of files) {
    const p = path.join(store.uploadsDir, a.file);
    if (!fs.existsSync(p)) continue;
    blocks.push({ type: 'image', source: { type: 'base64', media_type: a.type, data: fs.readFileSync(p).toString('base64') } });
  }
  return blocks;
}

function briefText(store, project, job) {
  const s = store.settings;
  const service = s.services.find((x) => x.id === project.serviceId);
  const client = store.get('clients', project.clientId);
  const feedback = store
    .find('messages', (m) => m.projectId === project.id && m.from === 'client' && !m.internal)
    .slice(-12)
    .map((m) => `- ${m.text}`)
    .join('\n');
  return `# Project: ${project.title}
Client: ${client.name}${client.company ? ` / ${client.company}` : ''}
Service: ${service?.name ?? '(unspecified)'}
Client notes: ${(client.notes ?? []).map((n) => n.text).join(' | ') || '(none)'}

## Brief
${project.brief || '(no written brief — rely on the instructions and client messages)'}

## This round's instructions (from the account manager)
${job.instructions}

## Recent client messages (for tone and details)
${feedback || '(none)'}`;
}

function baseDesignsText(store, ids) {
  return ids
    .map((id) => store.get('designs', id))
    .filter(Boolean)
    .map((d) => `## Base design ${d.id} "${d.title}" (${d.format})\n${d.rationale}\n\`\`\`\n${d.code.slice(0, MAX_CODE_IN_CONTEXT)}\n\`\`\``)
    .join('\n\n');
}

export async function runDesignJob(ctx, job) {
  const { store, llm } = ctx;
  const s = store.settings;
  const project = store.get('projects', job.projectId);
  if (!project) return;
  const round = (project.designRounds ?? 0) + 1;
  const meta = { projectId: project.id };
  const system = [{ type: 'text', text: designerSystem(s, store.all('lessons')), cache_control: { type: 'ephemeral' } }];
  const brief = briefText(store, project, job);
  const images = imageBlocks(store, project);
  const base = baseDesignsText(store, job.baseDesignIds ?? []);
  const common = { model: s.model, system, output_config: { effort: s.designEffort } };

  store.log('design', `디자인 ${round}차 시작 — 방향 설정 (${job.concepts}안) — ${project.title}`, meta);

  // 1) 방향
  const dirMsg = await llm.stream({
    ...common,
    max_tokens: 16000,
    output_config: { ...common.output_config, format: { type: 'json_schema', schema: DIRECTIONS_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        ...images,
        { type: 'text', text: `${brief}\n\n${base ? `${base}\n\n` : ''}Plan exactly ${job.concepts} design direction(s) for this round. ${base ? 'This is a revision: directions must evolve the base design(s) as instructed, not start over.' : 'Make them meaningfully different from each other.'} Pick "svg" or "html" for each based on the deliverable.` },
      ],
    }],
  }, 'design_direction', meta);
  const directions = jsonOf(dirMsg).directions.slice(0, job.concepts);

  const created = [];
  for (const [i, dir] of directions.entries()) {
    store.log('design', `${round}차 시안 ${i + 1}/${directions.length} 제작 중: ${dir.name}`, meta);

    // 2) 제작
    const makeMsg = await llm.stream({
      ...common,
      max_tokens: 64000,
      output_config: { ...common.output_config, format: { type: 'json_schema', schema: DESIGN_SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          ...images,
          { type: 'text', text: `${brief}\n\n${base ? `${base}\n\n` : ''}# Direction to execute\n${JSON.stringify(dir, null, 1)}\n\nProduce the finished design file now. "code" is the complete ${dir.format.toUpperCase()} document. "rationale" is 2-3 sentences in the client's language explaining the idea. "title" is a short concept name in the client's language.` },
        ],
      }],
    }, 'design_make', meta);
    let design = jsonOf(makeMsg);
    if (!looksValid(design.format, design.code)) throw new Error(`시안 "${dir.name}"의 ${design.format} 코드가 올바르지 않습니다`);

    // 3) 검토
    let review = null;
    if (s.design.selfReview) {
      const revMsg = await llm.stream({
        ...common,
        max_tokens: 64000,
        output_config: { ...common.output_config, format: { type: 'json_schema', schema: REVIEW_SCHEMA } },
        messages: [{
          role: 'user',
          content: `You are now the studio's art director reviewing a designer's file before the client sees it.\n\n${brief}\n\n# Direction\n${JSON.stringify(dir)}\n\n# File (${design.format})\n\`\`\`\n${design.code}\n\`\`\`\n\nCheck: brief fit, hierarchy, typography, spacing/alignment, color, legibility, text overflow/clipping, correct copy and spelling, technical validity (well-formed, self-contained, viewBox/size). Score 1-10. "summary" is one sentence in Korean for the owner. If the score is below 8, put a fully corrected complete file in "revised_code"; otherwise set "revised_code" to an empty string.`,
        }],
      }, 'design_review', meta);
      const r = jsonOf(revMsg);
      review = { score: r.score, summary: r.summary, issues: r.issues };
      if (r.revised_code && looksValid(design.format, r.revised_code)) {
        design = { ...design, code: r.revised_code };
        review.revised = true;
      }
    }

    const row = store.insert('designs', {
      projectId: project.id,
      round,
      title: design.title,
      rationale: design.rationale,
      format: design.format,
      code: design.code,
      direction: dir,
      review,
      shared: false,
      approved: false,
      baseDesignIds: job.baseDesignIds ?? [],
    });
    created.push(row.id);
    store.log('design', `시안 완성: ${design.title}${review ? ` (검토 ${review.score}/10${review.revised ? ', 수정 반영' : ''})` : ''} — ${short(project.title, 40)}`, meta);
  }

  store.update('projects', project.id, { designRounds: round });
  enqueueAgent(store, project.id, { kind: 'designs_ready', designIds: created });
}
