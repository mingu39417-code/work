// 글 자동 작성 — 카피라이터가 정해진 수만큼 글(제목 · 소제목 · 본문 · 표지 · 태그)을 미리 써 두고,
// 인스타그램 카드뉴스로 정한 일정에 올립니다(lib/social.mjs · lib/igcards.mjs). 고객이 동의한 작업은 사례 글로 먼저 씁니다.

import { renderPng } from './finals.mjs';
import { enqueue, short, studioName } from './actions.mjs';
import { lead, modelFor, staffBlock } from './staff.mjs';
import { jsonOf } from './claude.mjs';
import { canPostProject } from './social.mjs';

export function blogAiLine(settings) {
  return `※ 이 글은 생성형 AI를 활용해 작성했고, ${studioName(settings)}가 검수했습니다.`;
}

const COMPOSE_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    title: { type: 'string' },
    intro: { type: 'string' },
    sections: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, body: { type: 'string' } }, required: ['heading', 'body'], additionalProperties: false } },
    outro: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['topic', 'title', 'intro', 'sections', 'outro', 'tags'],
  additionalProperties: false,
};

// ── 표지 이미지 (스튜디오 색으로 만든 제목 카드, 코드로 그려 비용 없음) ─────
const escXml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function wrapLines(text, max) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}
export function coverSvg(settings, title, label = '') {
  const lines = wrapLines(title, 14);
  const y0 = 400 - (lines.length - 1) * 42;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 810" width="1080" height="810">
  <rect width="1080" height="810" fill="#F5EFE6"/>
  <circle cx="930" cy="150" r="190" fill="#E9B79A" opacity="0.55"/>
  <circle cx="140" cy="700" r="120" fill="#D8C7B2" opacity="0.6"/>
  <text x="90" y="150" font-family="Pretendard, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif" font-size="30" fill="#8A6A55" letter-spacing="2">${escXml(label || studioName(settings))}</text>
  ${lines.map((l, i) => `<text x="90" y="${y0 + i * 84}" font-family="Pretendard, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif" font-size="64" font-weight="700" fill="#3B2A20">${escXml(l)}</text>`).join('\n  ')}
  <rect x="90" y="${y0 + lines.length * 84 - 30}" width="120" height="8" rx="4" fill="#C9805F"/>
  <text x="90" y="740" font-family="Pretendard, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif" font-size="26" fill="#8A6A55">${escXml(studioName(settings))} · 브랜드 디자인</text>
</svg>`;
}

// 글 블록 → 이미지 PNG(확장 프로그램이 네이버에 올림)
export function blogImagePng(store, post, n) {
  const img = (post.blocks ?? []).filter((b) => b.type === 'img')[n];
  if (!img) return null;
  if (img.source === 'cover') return renderPng(coverSvg(store.settings, post.title), 1080).png;
  const d = store.get('designs', img.designId);
  return d && d.format === 'svg' ? renderPng(d.code, 1080).png : null;
}

// ── 글 쓰기 ───────────────────────────────────────────────────────────
export async function composeBlogPost(ctx, { projectId = null, topic = '' } = {}) {
  const { store, llm } = ctx;
  const s = store.settings;
  let project = projectId ? store.get('projects', projectId) : null;
  // 주제를 정하지 않았으면: 아직 글로 안 쓴 동의 작업 → 없으면 직원이 주제를 고름
  if (!project && !String(topic).trim()) {
    project = store.find('projects', (p) => !canPostProject(store, p) && !store.findOne('blog_posts', (x) => x.projectId === p.id && x.status !== 'archived'))[0] ?? null;
  }
  if (project) {
    const why = canPostProject(store, project);
    if (why) { store.log('blog', `블로그 글 건너뜀: ${why}`, { projectId: project.id }); return null; }
  }
  const design = project ? store.find('designs', (d) => d.projectId === project.id && d.approved && d.format === 'svg').at(-1) ?? null : null;
  const client = project ? store.get('clients', project.clientId) : null;
  const named = Boolean(project?.portfolioNamed);
  const past = store.all('blog_posts').filter((x) => x.status !== 'archived').map((x) => x.title).slice(-40);
  const writer = lead(store, 'copywriter') ?? lead(store, 'am');
  const facts = project
    ? `# Case study of a finished client project
Service: ${s.services.find((x) => x.id === project.serviceId)?.name ?? '-'}
Brief: ${short(project.brief || project.title, 1200)}
Final design: ${design ? `${design.title} — ${design.rationale}` : '(no image)'}
Client brand: ${named ? (client?.company || '(none)') : 'NOT ALLOWED — describe the business generically (e.g. "망원동의 작은 카페"). Never write the brand, person or exact address.'}`
    : String(topic).trim()
      ? `# Topic chosen by the owner\n${short(topic, 600)}`
      : `# Choose a topic yourself
Pick one useful topic that a small business owner in Korea would search on Naver before hiring a designer for these services: ${s.services.map((x) => x.name).join(', ')}. Prefer practical guides (what to prepare, how pricing works, how revisions work, how to brief a designer, file formats for signs and print). Do not repeat these past titles: ${past.join(' / ') || '(none)'}.`;
  const msg = await llm.create({
    model: modelFor(store, writer),
    max_tokens: 16000,
    system: [{ type: 'text', text: `You write Naver blog posts for ${studioName(s)}, a design studio (specialties: ${s.profile.specialties}). Voice: ${s.profile.tone}. Studio facts (only these): ${short(s.profile.bio || '(none)', 600)}. List prices: ${s.services.map((x) => `${x.name} ${x.basePrice}원부터`).join(', ')}.${staffBlock(writer, s)}`, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: s.agentEffort, format: { type: 'json_schema', schema: COMPOSE_SCHEMA } },
    messages: [{
      role: 'user',
      content: `${facts}

Write one Naver blog post in Korean (about 1,500-2,200 characters in total).
- "topic": the topic in a few words.
- "title": under 40 characters; put the main search phrase near the front, natural (no keyword stuffing, no clickbait).
- "intro": 2-3 sentences that answer what the reader will get; include the main phrase once.
- "sections": 3-5 sections; "heading" short, "body" 2-4 short paragraphs separated by blank lines. Concrete, practical, specific to small businesses.
- "outro": a short closing with a soft invitation to ask ${studioName(s)} (by blog comment or message). No pressure.
- "tags": 8-15 Naver tags without '#', mixing service, local and industry words.
Rules: only facts given above; no invented clients, numbers, reviews or awards; no superlatives (최고 · 최초 · 1위 · 유일); do not claim a person drew it by hand; do not mention AI (the system adds the notice).`,
    }],
  }, 'blog_compose', { projectId: project?.id ?? null, staffId: writer?.id });
  const out = jsonOf(msg);

  // 코드로 지키는 규칙: 동의 없는 업체명 제거 · AI 표시
  const scrub = (t) => {
    let x = String(t ?? '').trim();
    if (project && !named) for (const n of [client?.company, client?.name].filter((v) => v && v.length >= 2)) x = x.split(n).join('고객사');
    return x;
  };
  const blocks = [{ type: 'img', source: 'cover' }, { type: 'p', text: scrub(out.intro) }];
  out.sections.slice(0, 6).forEach((sec, i) => {
    blocks.push({ type: 'h', text: scrub(sec.heading).slice(0, 60) }, { type: 'p', text: scrub(sec.body) });
    if (i === 0 && design) blocks.push({ type: 'img', source: 'design', designId: design.id });
  });
  blocks.push({ type: 'p', text: scrub(out.outro) }, { type: 'p', text: blogAiLine(s) });
  const tags = [...new Set(out.tags.map((t) => String(t).replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean))].slice(0, 20);
  const post = store.insert('blog_posts', {
    kind: project ? 'case' : 'topic', projectId: project?.id ?? null, topic: short(scrub(out.topic), 80),
    title: scrub(out.title).slice(0, 60), blocks, tags, status: 'ready', writerId: writer?.id ?? null,
  });
  store.log('blog', `블로그 글 준비: ${post.title}`, { projectId: post.projectId });
  return post;
}

// 발행 대기 글을 늘 몇 개 준비해 둡니다(정기 점검에서 호출).
export function keepBlogQueue(store) {
  const b = store.settings.blog ?? {};
  const ig = store.settings.social?.enabled && store.findOne('accounts', (a) => a.kind === 'instagram' && a.enabled !== false);
  if (b.enabled === false || !ig) return;
  const ready = store.find('blog_posts', (x) => x.status === 'ready').length;
  const busy = store.findOne('jobs', (j) => j.kind === 'blog_compose' && ['queued', 'running'].includes(j.status));
  if (!busy && ready < Math.max(1, Number(b.keepReady) || 3)) enqueue(store, 'blog_compose', {});
}
