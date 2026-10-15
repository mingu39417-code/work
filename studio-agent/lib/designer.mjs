// 디자인팀 — 실제 시안 파일(SVG/HTML)을 만듭니다.
// 1) 아트 디렉터: 시안 수만큼 서로 다른 크리에이티브 방향을 정합니다(수정 라운드는 고객이 고른 안을 다듬음).
// 2) 카피라이터: 방향마다 시안에 들어갈 문구를 씁니다(카피라이터가 없거나 꺼져 있으면 건너뜀).
// 3) 디자이너: 방향과 카피로 완성된 파일을 코드로 그립니다.
// 4) 아트 디렉터 검수: 기준(8점) 미달이면 구체적인 피드백과 함께 반려 → 디자이너가 다시 (최대 N회).
// 오가는 대화는 사내 채널(대표만 보임)에 남고, 끝나면 AM에게 designs_ready를 넘겨 고객에게 보여 줍니다.

import fs from 'node:fs';
import path from 'node:path';
import { enqueueAgent, short, postMessage } from './actions.mjs';
import { lead, pickDesigner, modelFor, staffBlock } from './staff.mjs';
import { completeMilestones } from './pm.mjs';
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

const COPY_SCHEMA = {
  type: 'object',
  properties: {
    copies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          headline: { type: 'string' },
          subhead: { type: 'string' },
          body: { type: 'string' },
          cta: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['headline', 'subhead', 'body', 'cta', 'notes'],
        additionalProperties: false,
      },
    },
  },
  required: ['copies'],
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
    decision: { type: 'string', enum: ['approve', 'rework'] },
  },
  required: ['score', 'summary', 'issues', 'decision'],
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
  const ad = lead(store, 'ad');
  const designer = pickDesigner(store, project);
  if (designer && project.designerId !== designer.id) store.update('projects', project.id, { designerId: designer.id });
  const lessons = store.all('lessons');
  const sys = (st) => [{ type: 'text', text: designerSystem(s, lessons) + staffBlock(st, s), cache_control: { type: 'ephemeral' } }];
  const cw = s.design.copywriting !== false ? lead(store, 'copywriter') : null;
  const brief = briefText(store, project, job);
  const images = imageBlocks(store, project);
  const base = baseDesignsText(store, job.baseDesignIds ?? []);
  const effort = { effort: s.designEffort };
  const say = (st, text) => postMessage(ctx, store.get('projects', project.id), { from: 'staff', staffId: st?.id ?? null, internal: true, text });

  store.log('design', `${ad?.name ?? 'AD'}: 디자인 ${round}차 방향 설정 (${job.concepts}안, 담당 ${designer?.name ?? '-'}) — ${project.title}`, { projectId: project.id });

  // 1) 아트 디렉터 — 크리에이티브 방향
  const dirMsg = await llm.stream({
    model: modelFor(store, ad),
    system: sys(ad),
    max_tokens: 16000,
    output_config: { ...effort, format: { type: 'json_schema', schema: DIRECTIONS_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        ...images,
        { type: 'text', text: `${brief}\n\n${base ? `${base}\n\n` : ''}As art director, plan exactly ${job.concepts} design direction(s) for this round for ${designer?.name ?? 'the designer'} to execute. ${base ? 'This is a revision: directions must evolve the base design(s) as instructed, not start over.' : 'Make them meaningfully different from each other.'} Pick "svg" or "html" for each based on the deliverable.` },
      ],
    }],
  }, 'design_direction', { projectId: project.id, staffId: ad?.id });
  const directions = jsonOf(dirMsg).directions.slice(0, job.concepts);
  await say(ad, `[${round}차 크리에이티브 방향] ${designer?.name ?? '디자이너'}님 부탁해요.\n${directions.map((d, i) => `${i + 1}. ${d.name} — ${d.idea}`).join('\n')}`);

  // 2) 카피라이터 — 방향마다 들어갈 문구
  let copies = [];
  if (cw) {
    const cwMsg = await llm.stream({
      model: modelFor(store, cw),
      system: sys(cw),
      max_tokens: 8000,
      output_config: { ...effort, format: { type: 'json_schema', schema: COPY_SCHEMA } },
      messages: [{
        role: 'user',
        content: `${brief}\n\n${base ? `${base}\n\n` : ''}# Directions from the art director\n${JSON.stringify(directions, null, 1)}\n\nAs copywriter, write the text that will appear in each design, in the client's language — exactly one entry per direction, same order. Match each direction's tone and the deliverable's real space (a logo has only the wordmark/tagline; an SNS card has a short headline; a detail page has sections). Use only facts given by the client (names, prices, dates, contact); where a needed fact is missing, put a clear placeholder like [연락처] instead of inventing it. No unsupported superlatives (최고 · 최초 · 1위). ${base ? 'This is a revision: keep the existing copy unless the instructions ask for text changes.' : ''} Leave a field empty if the format does not need it. "notes" tells the designer about emphasis and line breaks.`,
      }],
    }, 'design_copy', { projectId: project.id, staffId: cw.id });
    copies = jsonOf(cwMsg).copies ?? [];
    await say(cw, `[카피] ${designer?.name ?? '디자이너'}님, 방향별 문구 드려요.\n${directions.map((d, i) => `${i + 1}. ${d.name} — ${copies[i]?.headline || '(문구 없음)'}`).join('\n')}`);
  }

  const created = [];
  for (const [i, dir] of directions.entries()) {
    const copy = copies[i] ?? null;
    const copyText = copy ? `\n\n# Copy from the copywriter (use it verbatim; only adjust line breaks to fit)\n${JSON.stringify(copy, null, 1)}` : '';
    let feedback = '';
    let best = null;
    const maxReworks = s.design.selfReview ? Math.max(0, Number(s.design.maxReworks ?? 2)) : 0;
    for (let attempt = 0; attempt <= maxReworks; attempt++) {
      store.log('design', `${designer?.name ?? '디자이너'}: ${round}차 시안 ${i + 1}/${directions.length} 「${dir.name}」 ${attempt ? `재작업 ${attempt}회차` : '제작'}`, { projectId: project.id });

      // 2) 디자이너 — 제작 (반려되면 AD 피드백을 반영해 다시)
      const makeMsg = await llm.stream({
        model: modelFor(store, designer),
        system: sys(designer),
        max_tokens: 64000,
        output_config: { ...effort, format: { type: 'json_schema', schema: DESIGN_SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            ...images,
            { type: 'text', text: `${brief}\n\n${base ? `${base}\n\n` : ''}# Direction from the art director\n${JSON.stringify(dir, null, 1)}${copyText}${feedback ? `\n\n# The art director sent your previous version back. Fix every point:\n${feedback}\n\n# Your previous version\n\`\`\`\n${best.code.slice(0, MAX_CODE_IN_CONTEXT)}\n\`\`\`` : ''}\n\nProduce the finished design file now. "code" is the complete ${dir.format.toUpperCase()} document. "rationale" is 2-3 sentences in the client's language explaining the idea. "title" is a short concept name in the client's language.` },
          ],
        }],
      }, 'design_make', { projectId: project.id, staffId: designer?.id });
      const design = jsonOf(makeMsg);
      if (!looksValid(design.format, design.code)) throw new Error(`시안 "${dir.name}"의 ${design.format} 코드가 올바르지 않습니다`);

      if (!s.design.selfReview) {
        best = { ...design, review: null, reworks: attempt };
        break;
      }

      // 3) 아트 디렉터 — 내부 검수 (승인 또는 반려)
      const revMsg = await llm.stream({
        model: modelFor(store, ad),
        system: sys(ad),
        max_tokens: 8000,
        output_config: { ...effort, format: { type: 'json_schema', schema: REVIEW_SCHEMA } },
        messages: [{
          role: 'user',
          content: `As art director, review ${designer?.name ?? 'the designer'}'s file before the client sees it.\n\n${brief}\n\n# Direction\n${JSON.stringify(dir)}${copyText}\n\n# File (${design.format})\n\`\`\`\n${design.code}\n\`\`\`\n\nCheck: brief fit, hierarchy, typography, spacing/alignment, color, legibility, text overflow/clipping, correct copy and spelling, technical validity (well-formed, self-contained, viewBox/size). Score 1-10. "decision" is "approve" if it is good enough to show the client (score 8+), otherwise "rework". "issues" are specific, actionable fixes for the designer (Korean). "summary" is one Korean sentence for the owner.`,
        }],
      }, 'design_review', { projectId: project.id, staffId: ad?.id });
      const r = jsonOf(revMsg);
      const candidate = { ...design, review: { score: r.score, summary: r.summary, issues: r.issues }, reworks: attempt };
      if (!best || (best.review?.score ?? 0) <= r.score) best = candidate;
      if (r.decision === 'approve') {
        await say(ad, `[검수 통과] 「${design.title}」 ${r.score}/10 — ${r.summary}`);
        break;
      }
      feedback = r.issues.map((x) => `- ${x}`).join('\n');
      if (attempt < maxReworks) await say(ad, `[반려] 「${design.title}」 ${r.score}/10 — ${designer?.name ?? '디자이너'}님 수정 부탁해요:\n${feedback}`);
      else await say(ad, `[검수] 재작업 ${maxReworks}회 후에도 기준 미달(${r.score}/10). 가장 나은 버전으로 진행합니다 — 대표님 확인 권장.`);
    }

    const row = store.insert('designs', {
      projectId: project.id,
      round,
      title: best.title,
      rationale: best.rationale,
      format: best.format,
      code: best.code,
      direction: dir,
      review: best.review,
      reworks: best.reworks,
      copy,
      designerId: designer?.id ?? null,
      copywriterId: copy ? cw?.id ?? null : null,
      reviewerId: ad?.id ?? null,
      shared: false,
      approved: false,
      baseDesignIds: job.baseDesignIds ?? [],
    });
    created.push(row.id);
    store.log('design', `시안 완성: ${best.title}${best.review ? ` (AD 검수 ${best.review.score}/10, 재작업 ${best.reworks}회)` : ''} — ${short(project.title, 40)}`, { projectId: project.id });
  }

  store.update('projects', project.id, { designRounds: round });
  completeMilestones(store, store.get('projects', project.id), ['designer', 'ad', ...(copies.length ? ['copywriter'] : [])]);
  enqueueAgent(store, project.id, { kind: 'designs_ready', designIds: created });
}
