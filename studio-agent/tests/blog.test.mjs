// 네이버 블로그 — 글 자동 작성 · 확장 프로그램용 주소 · 발행 확인(RSS)을 가짜 Claude와 가짜 RSS로 검사합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, json, msg, text, SVG, tmpDir, fakeFactory } from './helpers.mjs';
import { composeBlogPost, keepBlogQueue, checkPublished, parseRss, coverSvg, blogImagePng, blogAiLine, blockHtml } from '../lib/blog.mjs';
import { maintenance } from '../lib/pm.mjs';

const writer = (body, kind) => {
  const props = Object.keys(body.output_config?.format?.schema?.properties ?? {});
  if (props.includes('sections')) {
    return json({ topic: '카페 로고 준비', title: '카페 로고 디자인 맡기기 전 준비할 5가지', intro: '카페 로고를 맡기기 전에 준비하면 좋은 것을 정리했어요.', sections: [
      { heading: '어디에 쓸지 먼저 정하기', body: '간판, 컵, 인스타그램 프로필처럼 쓰는 곳을 정하면 형태가 정해집니다.\n\n모모카페처럼 작은 공간은 간판 크기를 먼저 재 보세요.' },
      { heading: '색 고르기', body: '따뜻한 색 두 가지면 충분합니다.' },
      { heading: '예산과 수정 횟수', body: '로고는 50만 원부터, 수정 2회가 포함됩니다.' },
    ], outro: '궁금한 점은 댓글로 남겨 주세요.', tags: ['로고디자인', '카페로고', '#망원동', '브랜딩'] });
  }
  return msg([text('완료')]);
};

function rss(items) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title><![CDATA[블로그]]></title>${items.map((i) => `<item><title><![CDATA[${i.title}]]></title><link><![CDATA[${i.link}?fromRss=true]]></link><pubDate>Thu, 15 Oct 2026 17:59:02 +0900</pubDate></item>`).join('')}</channel></rss>`;
}

test('블로그 글: 동의한 작업은 사례 글로, 업체명은 동의 없으면 지우고, AI 표시와 표지 · 시안 이미지를 넣습니다', async () => {
  const { ctx } = makeCtx(writer);
  const { store } = ctx;
  const c = store.insert('clients', { name: '김사장', email: 'k@x.kr', company: '모모카페' });
  const p = store.insert('projects', { clientId: c.id, title: '모모카페 로고', serviceId: 'logo', status: 'completed', portfolioConsent: true, portfolioNamed: false, brief: '카페 로고' });
  const d = store.insert('designs', { projectId: p.id, title: '모모 피치', rationale: '복숭아', format: 'svg', code: SVG, approved: true });
  const post = await composeBlogPost(ctx, {});
  assert.equal(post.kind, 'case');
  assert.equal(post.projectId, p.id);
  const all = JSON.stringify(post);
  assert.ok(!all.includes('모모카페'), '업체명 비공개');
  assert.equal(post.blocks[0].type, 'img');
  assert.equal(post.blocks[0].source, 'cover');
  assert.ok(post.blocks.some((b) => b.type === 'img' && b.designId === d.id), '확정 시안 이미지');
  assert.equal(post.blocks.at(-1).text, blogAiLine(store.settings));
  assert.deepEqual(post.tags, ['로고디자인', '카페로고', '망원동', '브랜딩']);
  assert.equal(blogImagePng(store, post, 0).readUInt32BE(0), 0x89504e47, '표지 PNG');
  assert.equal(blogImagePng(store, post, 1).readUInt32BE(0), 0x89504e47, '시안 PNG');
  assert.match(blockHtml({ type: 'p', text: '첫 줄\n\n둘째 <줄>' }), /<p>첫 줄<\/p><p>둘째 &lt;줄&gt;<\/p>/);
  // 같은 작업으로는 다시 쓰지 않고 주제 글로 넘어갑니다
  const next = await composeBlogPost(ctx, {});
  assert.equal(next.kind, 'topic');
  // 연습 프로젝트 · 동의 없는 작업은 사례 글로 쓰지 않습니다
  store.update('projects', p.id, { simulation: true });
  assert.equal(await composeBlogPost(ctx, { projectId: p.id }), null);
});

test('블로그 아이디를 넣으면 발행 대기 글을 정한 수만큼 미리 써 둡니다(SNS는 기본으로 꺼짐)', async () => {
  const { ctx } = makeCtx(writer);
  const { store } = ctx;
  keepBlogQueue(store);
  assert.ok(!store.findOne('jobs', (j) => j.kind === 'blog_compose'), '아이디 없으면 쓰지 않음');
  store.updateSettings({ blog: { blogId: 'ongyeol_studio', keepReady: 2 } });
  maintenance(store);
  assert.ok(store.findOne('jobs', (j) => j.kind === 'blog_compose' && j.status === 'queued'));
  maintenance(store);
  assert.equal(store.find('jobs', (j) => j.kind === 'blog_compose').length, 1, '중복 예약 없음');
  assert.equal(store.settings.social.enabled, false);
  assert.ok(coverSvg(store.settings, '아주 긴 제목이 여러 줄로 나뉘어 들어가는지 확인하는 테스트 제목').includes('<text'));
});

test('발행 확인: 네이버 공개 RSS에서 같은 제목을 찾으면 발행됨으로 바꿉니다', async () => {
  const { ctx } = makeCtx(writer);
  const { store } = ctx;
  store.updateSettings({ blog: { blogId: 'ongyeol_studio' } });
  const a = store.insert('blog_posts', { title: '카페 로고 디자인 맡기기 전 준비할 5가지', blocks: [], tags: [], status: 'filled' });
  const b = store.insert('blog_posts', { title: '아직 안 올린 글', blocks: [], tags: [], status: 'ready' });
  let asked = '';
  ctx.fetch = async (url) => { asked = String(url); return { ok: true, text: async () => rss([{ title: '카페 로고 디자인 맡기기 전 준비할 5가지 ', link: 'https://blog.naver.com/ongyeol_studio/224000000001' }]) }; };
  assert.equal(await checkPublished(ctx), 1);
  assert.equal(asked, 'https://rss.blog.naver.com/ongyeol_studio.xml');
  assert.equal(store.get('blog_posts', a.id).status, 'published');
  assert.equal(store.get('blog_posts', a.id).publishedUrl, 'https://blog.naver.com/ongyeol_studio/224000000001');
  assert.equal(store.get('blog_posts', b.id).status, 'ready');
  assert.equal(parseRss(rss([{ title: 'A &amp; B', link: 'x' }]))[0].title, 'A &amp; B');
});

test('서버: 확장 프로그램 주소는 대기 중인 글만 넘기고, 다른 웹사이트의 요청은 거절합니다', async (t) => {
  const { createApp } = await import('../server.mjs');
  const fake = fakeFactory(writer);
  const app = createApp({ dataDir: tmpDir(), llmFactory: fake.factory, startWorker: false });
  t.after(() => app.close());
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = '';
  const call = async (path, method = 'GET', body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return res;
  };
  await call('/api/auth/setup', 'POST', { password: 'correct horse' });
  const { store } = app.ctx;
  const post = store.insert('blog_posts', { title: '제목', blocks: [{ type: 'img', source: 'cover' }, { type: 'p', text: '본문입니다' }], tags: ['로고'], status: 'ready' });

  assert.equal((await (await fetch(`${base}/helper/blog/pending`)).json()).post, null, '대시보드에서 누르기 전엔 없음');
  assert.equal((await call(`/api/blog/${post.id}/arm`, 'POST', {})).status, 409, '블로그 아이디 먼저');
  assert.equal((await call('/api/blog/settings', 'PUT', { blogId: 'https://blog.naver.com/ongyeol_studio' })).status, 200);
  assert.equal(store.settings.blog.blogId, 'ongyeol_studio', '주소를 넣어도 아이디만');
  const arm = await (await call(`/api/blog/${post.id}/arm`, 'POST', {})).json();
  assert.equal(arm.url, 'https://blog.naver.com/ongyeol_studio?Redirect=Write');
  const pend = (await (await fetch(`${base}/helper/blog/pending`)).json()).post;
  assert.equal(pend.id, post.id);
  assert.equal(pend.imageCount, 1);
  assert.match(pend.blocks[1].html, /<p>본문입니다<\/p>/);
  assert.match(pend.plain, /#로고/);
  const img = await fetch(`${base}/helper/blog/${post.id}/images/0.png`);
  assert.equal(img.headers.get('content-type'), 'image/png');
  // 다른 웹사이트(Origin)가 보내는 요청은 거절
  assert.equal((await fetch(`${base}/helper/blog/pending`, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(`${base}/helper/blog/${post.id}/filled`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  // 확장 프로그램이 다 채웠다고 알리면
  const r = await fetch(`${base}/helper/blog/${post.id}/filled`, { method: 'POST', headers: { Origin: 'chrome-extension://abc', 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, report: ['title:ok', 'body:ok'] }) });
  assert.equal(r.status, 200);
  assert.equal(store.get('blog_posts', post.id).status, 'filled');
  assert.equal((await (await fetch(`${base}/helper/blog/pending`)).json()).post, null, '한 번 채우면 대기 해제');
  const meta = await (await call('/api/meta')).json();
  assert.deepEqual(meta.features, { social: false, threads: false, wp: false, blog: true });
});