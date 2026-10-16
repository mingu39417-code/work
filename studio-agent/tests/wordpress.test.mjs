// WordPress.com 완전 자동 발행 — 가짜 WordPress.com 서버로 연결 · 이미지 업로드 · 발행 · 일정 · 연결 끊김을 검사합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, msg, text, SVG } from './helpers.mjs';
import { authorizeUrl, finishOAuth, publishToWordPress, wpDue, wpHtml } from '../lib/wordpress.mjs';
import { maintenance } from '../lib/pm.mjs';

function fakeWp({ expire = false } = {}) {
  const calls = [];
  let n = 100;
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, method: init.method ?? 'GET', auth: init.headers?.Authorization ?? null, body: init.body });
    const ok = (j, status = 200) => ({ ok: status < 400, status, json: async () => j });
    if (u.pathname === '/oauth2/token') return ok({ access_token: 'WPTOKEN', blog_id: 777, blog_url: 'https://ongyeol.wordpress.com', token_type: 'bearer' });
    if (expire) return ok({ error: 'invalid_token', message: 'The OAuth2 token is invalid.' }, 403);
    if (u.pathname.endsWith('/media/new')) return ok({ media: [{ ID: ++n, URL: `https://ongyeol.files.wordpress.com/img${n}.png` }] });
    if (u.pathname.endsWith('/posts/new')) return ok({ ID: 9001, URL: 'https://ongyeol.wordpress.com/2026/10/16/post/' });
    return ok({ error: 'unknown' }, 404);
  };
  return { fetch, calls };
}

function setup(meta = fakeWp()) {
  const { ctx } = makeCtx(() => msg([text('x')]));
  ctx.fetch = meta.fetch;
  const { store } = ctx;
  store.updateSettings({ wp: { clientId: '12345', clientSecret: store.vault.encrypt('S'.repeat(64)) } });
  return { ctx, store, meta };
}

test('연결: state가 맞아야 하고, 토큰은 암호화 저장, 사이트 주소를 기억합니다', async () => {
  const { ctx, store, meta } = setup();
  const url = new URL(authorizeUrl(store));
  assert.equal(url.origin + url.pathname, 'https://public-api.wordpress.com/oauth2/authorize');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:4300/oauth/wpcom/callback');
  await assert.rejects(finishOAuth(ctx, { code: 'c', state: 'wrong' }), /만료됐거나 올바르지/);
  await finishOAuth(ctx, { code: 'c', state: url.searchParams.get('state') });
  const wp = store.settings.wp;
  assert.equal(wp.siteId, '777');
  assert.equal(wp.siteUrl, 'https://ongyeol.wordpress.com');
  assert.ok(!JSON.stringify(store.settings).includes('WPTOKEN'), '토큰 평문 저장 안 함');
  assert.equal(store.vault.decrypt(wp.token), 'WPTOKEN');
  const tokenCall = meta.calls.find((c) => c.path === '/oauth2/token');
  assert.equal(new URLSearchParams(tokenCall.body).get('client_secret'), 'S'.repeat(64));
});

test('발행: 이미지를 먼저 올리고, 본문 · 태그 · 대표 이미지로 공개 발행합니다', async () => {
  const { ctx, store, meta } = setup();
  const url = new URL(authorizeUrl(store));
  await finishOAuth(ctx, { code: 'c', state: url.searchParams.get('state') });
  const d = store.insert('designs', { format: 'svg', code: SVG, title: 'D' });
  const post = store.insert('blog_posts', { title: '로고 비용 기준', tags: ['로고디자인', '브랜딩'], status: 'ready', blocks: [
    { type: 'img', source: 'cover' }, { type: 'p', text: '첫 문단\n\n둘째 문단' }, { type: 'h', text: '소제목' }, { type: 'img', source: 'design', designId: d.id }, { type: 'p', text: '※ AI 표시' },
  ] });
  await publishToWordPress(ctx, { postId: post.id });
  const media = meta.calls.filter((c) => c.path.endsWith('/sites/777/media/new'));
  assert.equal(media.length, 2, '이미지 2장 업로드');
  assert.ok(media[0].body instanceof FormData);
  assert.ok(meta.calls.every((c) => c.path === '/oauth2/token' || c.auth === 'Bearer WPTOKEN'));
  const created = new URLSearchParams(meta.calls.find((c) => c.path.endsWith('/posts/new')).body);
  assert.equal(created.get('status'), 'publish');
  assert.equal(created.get('tags'), '로고디자인,브랜딩');
  assert.equal(created.get('featured_image'), '101', '표지가 대표 이미지');
  assert.match(created.get('content'), /<h2>소제목<\/h2>/);
  assert.match(created.get('content'), /img102\.png/);
  assert.match(created.get('content'), /<p>첫 문단<\/p><p>둘째 문단<\/p>/);
  assert.equal(store.get('blog_posts', post.id).wp.url, 'https://ongyeol.wordpress.com/2026/10/16/post/');
  // 다시 실행해도 두 번 올리지 않음
  await publishToWordPress(ctx, { postId: post.id });
  assert.equal(meta.calls.filter((c) => c.path.endsWith('/posts/new')).length, 1);
  assert.match(wpHtml({ title: 't', blocks: [{ type: 'p', text: '<b>' }] }, []), /&lt;b&gt;/);
});

test('일정: 주 N회 간격 · 정한 시각 이후에만 다음 글을 예약하고, 연결이 끊기면 멈추고 알립니다', async () => {
  const { ctx, store } = setup();
  const url = new URL(authorizeUrl(store));
  await finishOAuth(ctx, { code: 'c', state: url.searchParams.get('state') });
  const p1 = store.insert('blog_posts', { title: 'A', tags: [], status: 'ready', blocks: [{ type: 'p', text: 'a' }] });
  store.insert('blog_posts', { title: 'B', tags: [], status: 'ready', blocks: [{ type: 'p', text: 'b' }] });
  const kst = (h) => Date.parse(`2026-10-16T${String(h - 9).padStart(2, '0')}:30:00Z`); // KST h시 30분
  assert.equal(wpDue(store, kst(9)), null, '10시 전에는 안 함');
  assert.equal(wpDue(store, kst(11)).id, p1.id, '오래된 글부터');
  store.updateSettings({ wp: { lastPublishedAt: new Date(kst(11) - 864e5).toISOString() } });
  assert.equal(wpDue(store, kst(11)), null, '주 3회면 하루 만에 또 올리지 않음');
  store.updateSettings({ wp: { lastPublishedAt: new Date(kst(11) - 3 * 864e5).toISOString() } });
  assert.ok(wpDue(store, kst(11)));
  maintenance(store, kst(11));
  assert.ok(store.findOne('jobs', (j) => j.kind === 'wp_publish' && j.status === 'queued'));

  // 연결 끊김
  const dead = fakeWp({ expire: true });
  ctx.fetch = dead.fetch;
  await assert.rejects(publishToWordPress(ctx, { postId: p1.id }), /다시 연결/);
  assert.equal(store.settings.wp.status, 'expired');
  assert.ok(store.all('alerts').some((a) => /WordPress\.com 연결이 끊겨/.test(a.text)));
  assert.equal(wpDue(store, kst(11) + 7 * 864e5), null, '끊긴 동안은 예약하지 않음');
});