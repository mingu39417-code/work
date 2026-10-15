// 네이버 블로그 — 글은 직원이 전부 쓰고, 대표는 네이버에서 '발행'만 누릅니다.
// 네이버는 블로그 글쓰기 API를 2020년에 종료했고, 아이디 · 비밀번호 자동 로그인은 약관 위반(저품질 · 정지 위험)이라 쓰지 않습니다.
// 1) 카피라이터가 발행 대기 글을 미리 몇 개 써 둡니다(고객이 동의한 작업 사례 → 없으면 디자인 팁 · 스튜디오 소개 주제).
// 2) 대시보드 '발행하러 가기' → 네이버 글쓰기 창이 열리면 크롬 확장(naver-helper)이 제목 · 본문 · 이미지 · 태그를 채웁니다.
// 3) 대표가 '발행'을 누르면, 공개 RSS에서 그 글을 찾아 발행 완료로 표시합니다.

import { renderPng } from './finals.mjs';
import { enqueue, short, studioName } from './actions.mjs';
import { lead, modelFor, staffBlock } from './staff.mjs';
import { jsonOf } from './claude.mjs';
import { canPostProject } from './social.mjs';

export const ARM_MINUTES = 15;

export function blogAiLine(settings) {
  return `※ 이 글은 생성형 AI를 활용해 작성했고, ${studioName(settings)}가 검수했습니다.`;
}

export function writeUrl(blogId) {
  return `https://blog.naver.com/${encodeURIComponent(blogId)}?Redirect=Write`;
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

// 네이버 편집기에 붙여 넣을 HTML(이미지는 확장이 파일로 따로 넣음)
export function blockHtml(b) {
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const paras = (t) => String(t).split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  if (b.type === 'h') return `<p><b>${esc(b.text)}</b></p>`;
  if (b.type === 'p') return paras(b.text);
  return '';
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
  if (b.enabled === false || !b.blogId) return;
  const ready = store.find('blog_posts', (x) => x.status === 'ready').length;
  const busy = store.findOne('jobs', (j) => j.kind === 'blog_compose' && ['queued', 'running'].includes(j.status));
  if (!busy && ready < Math.max(1, Number(b.keepReady) || 3)) enqueue(store, 'blog_compose', {});
}

// ── 발행 확인(네이버 공개 RSS) ─────────────────────────────────────────
const norm = (t) => String(t).replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, '').toLowerCase();
export function parseRss(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const pick = (tag) => (m[1].match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) ?? [])[1] ?? '';
    items.push({ title: pick('title').replace(/<!\[CDATA\[|\]\]>/g, '').trim(), link: pick('link').replace(/<!\[CDATA\[|\]\]>/g, '').trim().split('?')[0], pubDate: pick('pubDate').trim() });
  }
  return items;
}

export async function checkPublished(ctx) {
  const { store } = ctx;
  const b = store.settings.blog ?? {};
  const waiting = store.find('blog_posts', (x) => x.status === 'filled' || x.status === 'ready');
  if (!b.blogId || !waiting.length) return 0;
  const res = await (ctx.fetch ?? globalThis.fetch)(`https://rss.blog.naver.com/${encodeURIComponent(b.blogId)}.xml`);
  if (!res.ok) throw new Error(`네이버 블로그 RSS를 읽지 못했습니다(HTTP ${res.status}). 블로그 아이디와 '외부 보내기 허용' 설정을 확인하세요.`);
  const items = parseRss(await res.text());
  let n = 0;
  for (const post of waiting) {
    const hit = items.find((i) => norm(i.title) === norm(post.title));
    if (!hit) continue;
    store.update('blog_posts', post.id, { status: 'published', publishedUrl: hit.link, publishedAt: new Date(Date.parse(hit.pubDate) || Date.now()).toISOString() });
    store.log('blog', `블로그 발행 확인: ${post.title} — ${hit.link}`, { projectId: post.projectId });
    n++;
  }
  store.updateSettings({ blog: { lastRssCheckAt: new Date().toISOString() } });
  return n;
}