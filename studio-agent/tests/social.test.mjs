// 인스타그램 영업 — 가짜 Meta 서버로 동의 · 게시 · 카드뉴스 · 댓글 응대 · 토큰 갱신을 검사합니다(실제 계정에 닿지 않음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, json, msg, text, SVG, tmpDir, fakeFactory } from './helpers.mjs';
import { runJob } from '../lib/scheduler.mjs';
import { createInquiry, acceptQuoteByClient, executeAction, markInvoicePaid, approveDesignByClient } from '../lib/actions.mjs';
import { connectAccount, composeSocialPost, publishSocialPost, syncSocial, refreshTokens, aiLine, isPublicUrl, designJpeg, igDue, composeCarousel, mediaJpeg } from '../lib/social.mjs';
import { maintenance } from '../lib/pm.mjs';

const TOKEN = 'IGAA' + 'T'.repeat(60);
const TUNNEL = 'https://abc-def.trycloudflare.com';

function fakeMeta({ comments = {}, igMedia = [] } = {}) {
  const calls = [];
  let n = 0;
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const params = Object.fromEntries(init.body ? new URLSearchParams(init.body) : u.searchParams);
    calls.push({ path: u.pathname, method: init.method ?? 'GET', params });
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    const p = u.pathname;
    if (p === '/me') return ok({ user_id: '222', username: 'ongyeol.studio' });
    if (p === '/222/media' && init.method === 'POST') return ok({ id: `ic${++n}` });
    if (p === '/222/media_publish') return ok({ id: `ip${++n}` });
    if (/^\/ic\d+$/.test(p)) return ok({ status_code: 'FINISHED' });
    if (/^\/ip\d+$/.test(p)) return ok({ permalink: `https://instagram.com${p}` });
    if (p === '/222/media') return ok({ data: igMedia });
    if (/^\/[\w-]+\/comments$/.test(p)) return ok({ data: comments[p.split('/')[1]] ?? [] });
    if (/^\/[\w-]+\/replies$/.test(p) && init.method === 'POST') return ok({ id: `ir${++n}` });
    if (p === '/refresh_access_token') return ok({ access_token: 'IGAA' + 'R'.repeat(60), expires_in: 5184000 });
    return { ok: false, status: 404, json: async () => ({ error: { message: `unknown ${p}`, code: 100 } }) };
  };
  return { fetch, calls };
}

const writer = (body, kind) => {
  if (kind === 'social') return json({ instagram: '모모카페의 첫 로고 작업입니다.\n\n둥근 형태와 크림 · 브라운 색으로 동네 카페의 따뜻함을 담았습니다.', hashtags: ['로고디자인', '카페로고', '#브랜딩'] });
  if (kind === 'triage') {
    const content = body.messages[0].content;
    const list = JSON.parse(content.slice(content.indexOf('['), content.indexOf('\n\nFor each')));
    return json({ items: list.map((c) => (/환불/.test(c.text) ? { id: c.id, action: 'escalate', reply: '', note: '환불 요구' } : { id: c.id, action: 'reply', reply: '감사합니다! 로고 디자인은 50만 원부터예요.', note: '' })) });
  }
  return msg([text('완료')]);
};

async function setup({ publicUrl = 'https://studio.example', consent = { portfolio: true, named: false }, meta } = {}) {
  const { ctx } = makeCtx(writer, { publicUrl, policy: { requireDeposit: false }, social: { enabled: true } });
  const fake = meta ?? fakeMeta();
  ctx.fetch = fake.fetch;
  ctx.sleep = async () => {};
  ctx.openTunnel = async () => { throw new Error('테스트에서는 실제 터널을 열지 않음'); };
  const { store } = ctx;
  await connectAccount(ctx, 'instagram', TOKEN);
  const p = await createInquiry(ctx, { name: '김사장', email: 'kim@x.kr', company: '모모카페', description: '로고' });
  const q = store.insert('quotes', { projectId: p.id, items: [], total: 500000, revisions: 2, status: 'sent' });
  await acceptQuoteByClient(ctx, p, q.id, consent);
  const d = store.insert('designs', { projectId: p.id, round: 1, title: '모모 피치', rationale: '복숭아', format: 'svg', code: SVG, shared: true });
  await approveDesignByClient(ctx, store.get('projects', p.id), d.id);
  store.update('projects', p.id, { status: 'delivered' });
  const inv = store.insert('invoices', { projectId: p.id, kind: 'final', amount: 500000, status: 'sent' });
  await markInvoicePaid(ctx, inv.id);
  return { ctx, store, fake, project: store.get('projects', p.id) };
}

test('고객이 동의하지 않았거나 연습 프로젝트면 포트폴리오 글을 만들지 않습니다', async () => {
  const { ctx, store, project } = await setup({ consent: {} });
  assert.equal(store.get('projects', project.id).portfolioConsent, false);
  assert.ok(!store.findOne('jobs', (j) => j.kind === 'social_compose'));
  assert.equal(await composeSocialPost(ctx, { projectId: project.id }), null);
  store.update('projects', project.id, { portfolioConsent: true, simulation: true });
  assert.equal(await composeSocialPost(ctx, { projectId: project.id }), null);
  assert.equal(store.all('social_posts').length, 0);
});

test('동의한 작업이 정산되면 글을 쓰고, 승인 후 시안 이미지와 함께 올립니다', async () => {
  const { ctx, store, project, fake } = await setup();
  await runJob(ctx, store.findOne('jobs', (j) => j.kind === 'social_compose' && j.status === 'queued'));
  const post = store.findOne('social_posts', (x) => x.projectId === project.id);
  assert.equal(post.status, 'pending');
  assert.ok(post.igCaption.endsWith(aiLine(store.settings)), 'AI 활용 표시');
  assert.ok(!post.igCaption.includes('모모카페'), '업체명 비공개');
  assert.match(post.igCaption, /#로고디자인 #카페로고 #브랜딩/);
  const ap = store.findOne('approvals', (a) => a.status === 'pending' && a.category === 'social_post');
  assert.ok(ap, '기본은 대표 승인 후 게시');
  await executeAction(ctx, { ...ap.action, igCaption: '고친 캡션입니다' });
  assert.ok(store.get('social_posts', post.id).igCaption.startsWith('고친 캡션입니다') && store.get('social_posts', post.id).igCaption.endsWith(aiLine(store.settings)), 'AI 표시는 다시 붙음');
  await runJob(ctx, store.findOne('jobs', (j) => j.kind === 'social_publish' && j.status === 'queued'));
  const done = store.get('social_posts', post.id);
  assert.equal(done.status, 'published');
  assert.ok(done.results.instagram.permalink);
  const create = fake.calls.find((c) => c.path === '/222/media' && c.method === 'POST');
  assert.equal(create.params.image_url, `https://studio.example/m/${post.mediaToken}.jpg`);
  assert.ok(fake.calls.every((c) => c.params.access_token === TOKEN));
  await publishSocialPost(ctx, { postId: post.id });
  assert.equal(fake.calls.filter((c) => c.path.endsWith('_publish')).length, 1, '두 번 올리지 않음');
});

test('공개 주소도 임시 주소도 없으면 이미지 게시는 실패로 남고 대표에게 알립니다', async () => {
  const { ctx, store, project } = await setup({ publicUrl: 'http://localhost:4300' });
  await runJob(ctx, store.findOne('jobs', (j) => j.kind === 'social_compose'));
  const post = store.findOne('social_posts', (x) => x.projectId === project.id);
  await executeAction(ctx, { type: 'social_publish', postId: post.id });
  await runJob(ctx, store.findOne('jobs', (j) => j.kind === 'social_publish' && j.status === 'queued'));
  const done = store.get('social_posts', post.id);
  assert.equal(done.status, 'failed');
  assert.match(done.results.instagram.skipped, /임시 공개 주소/);
});

test('써 둔 글 → 카드뉴스: 일정이 되면 카드를 만들고, 임시 주소를 열어 묶음으로 게시한 뒤 닫습니다', async () => {
  const meta = fakeMeta();
  const { ctx } = makeCtx(writer, { publicUrl: 'http://localhost:4300', social: { enabled: true }, autonomy: { social_post: 'auto' } });
  ctx.fetch = meta.fetch;
  ctx.sleep = async () => {};
  const { store } = ctx;
  await connectAccount(ctx, 'instagram', TOKEN);
  const bp = store.insert('blog_posts', { title: '로고 비용 기준', tags: ['로고디자인'], status: 'ready', blocks: [
    { type: 'img', source: 'cover' }, { type: 'p', text: '소개 문단입니다.' }, { type: 'h', text: '첫째' }, { type: 'p', text: '내용 하나.' }, { type: 'h', text: '둘째' }, { type: 'p', text: '내용 둘.' },
  ] });
  const kst = (h) => Date.parse(`2026-10-16T${String(h - 9).padStart(2, '0')}:30:00Z`);
  assert.equal(igDue(store, kst(9)), null, '11시 전에는 안 올림');
  assert.equal(igDue(store, kst(12)).id, bp.id);
  maintenance(store, kst(12));
  const job = store.findOne('jobs', (j) => j.kind === 'ig_post' && j.status === 'queued');
  assert.ok(job);
  assert.equal(igDue(store, kst(13)), null, '간격 전엔 또 안 함');
  let opened = 0;
  let closed = 0;
  ctx.openTunnel = async () => { opened++; return { url: TUNNEL, close: async () => { closed++; } }; };
  await runJob(ctx, job);
  const post = store.findOne('social_posts', (x) => x.blogPostId === bp.id);
  assert.equal(post.cards.length, 4, '표지 + 소제목 2장 + 마무리');
  assert.ok(post.igCaption.endsWith(aiLine(store.settings)));
  assert.equal(mediaJpeg(store, post.cards[0].token)[0], 0xff, '카드 JPEG');
  await runJob(ctx, store.findOne('jobs', (j) => j.kind === 'social_publish' && j.status === 'queued'));
  assert.equal(store.get('social_posts', post.id).status, 'published');
  const items = meta.calls.filter((c) => c.path === '/222/media' && c.method === 'POST' && c.params.is_carousel_item === 'true');
  assert.equal(items.length, 4);
  assert.ok(items.every((c, i) => c.params.image_url === `${TUNNEL}/m/${post.cards[i].token}.jpg`));
  assert.equal(meta.calls.find((c) => c.params.media_type === 'CAROUSEL').params.children.split(',').length, 4);
  assert.equal(opened, 1);
  assert.equal(closed, 1, '게시 후 임시 주소를 닫음');
  assert.equal(await composeCarousel(ctx, { blogPostId: bp.id }), null, '같은 글은 다시 올리지 않음');
});

test('서버: 반려하면 글만 취소(에이전트에 재작성 지시 없음), 게시용 이미지는 토큰 주소로만 JPEG 제공', async (t) => {
  const { createApp } = await import('../server.mjs');
  const fake = fakeFactory(writer);
  const app = createApp({ dataDir: tmpDir(), llmFactory: fake.factory, startWorker: false });
  t.after(() => app.close());
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = '';
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return res;
  };
  await call('/api/auth/setup', 'POST', { password: 'correct horse' });
  const { store } = app.ctx;
  const p = store.insert('projects', { title: 'P', status: 'completed', portfolioConsent: true });
  const d = store.insert('designs', { projectId: p.id, format: 'svg', code: SVG, title: 'D', approved: true });
  const post = store.insert('social_posts', { projectId: p.id, designId: d.id, platforms: ['instagram'], igCaption: 'y', mediaToken: 'abcdefghijklmnopqrstuvwx', status: 'pending', results: {} });
  const ap = store.insert('approvals', { category: 'social_post', action: { type: 'social_publish', postId: post.id, projectId: p.id }, summary: 's', status: 'pending', projectId: p.id });
  const img = await fetch(`${base}/m/abcdefghijklmnopqrstuvwx.jpg`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(`${base}/m/wrongtokenwrongtoken1234.jpg`)).status, 404);
  assert.equal((await call(`/api/approvals/${ap.id}/reject`, 'POST', { feedback: '사진이 별로' })).status, 200);
  assert.equal(store.get('social_posts', post.id).status, 'cancelled');
  assert.ok(!store.findOne('jobs', (j) => j.kind === 'agent' && j.status === 'queued'));
  assert.equal((await fetch(`${base}/m/abcdefghijklmnopqrstuvwx.jpg`)).status, 404, '취소된 글의 이미지는 공개하지 않음');
  assert.equal((await call('/api/social/connect', 'POST', { platform: 'instagram', token: 'short' })).status, 400);
  assert.equal((await call('/api/social/connect', 'POST', { platform: 'threads', token: TOKEN })).status, 400, 'Threads는 지원하지 않음');
  assert.deepEqual((await (await call('/api/meta')).json()).features, { social: false, blog: true });
});

test('내 게시물 댓글: 연결 전 댓글은 넘기고, 질문에는 AI임을 밝혀 답하고, 불만은 대표에게 넘깁니다', async () => {
  const later = new Date(Date.now() + 60e3).toISOString();
  const meta = fakeMeta({
    igMedia: [{ id: 'imedia', timestamp: new Date().toISOString(), caption: '모모' }],
    comments: { imedia: [
      { id: 'c-own', text: '내 답글', username: 'ongyeol.studio', timestamp: later },
      { id: 'c-old', text: '예전 댓글', username: 'old', timestamp: '2020-01-01T00:00:00Z' },
      { id: 'c-q', text: '로고 가격이 얼마예요?', username: 'cafe_owner', timestamp: later },
      { id: 'c-bad', text: '환불해 주세요', username: 'angry', timestamp: later },
    ] },
  });
  const { ctx, store } = await setup({ meta });
  await syncSocial(ctx);
  const by = (id) => store.findOne('social_comments', (c) => c.remoteId === id);
  assert.equal(by('c-own'), null, '내 답글은 무시');
  assert.equal(by('c-old').status, 'ignored');
  assert.equal(by('c-q').status, 'replied');
  assert.match(by('c-q').reply, /AI 답변$/);
  assert.ok(meta.calls.find((c) => c.path === '/c-q/replies'));
  assert.equal(by('c-bad').status, 'escalated');
  assert.ok(store.all('alerts').some((a) => /댓글 확인 필요/.test(a.text)));
  const before = meta.calls.length;
  await syncSocial(ctx);
  assert.ok(!meta.calls.slice(before).some((c) => c.path === '/c-q/replies'), '같은 댓글에 또 답하지 않음');
});

test('토큰은 만료 30일 전부터 자동으로 새로 받고, 이미지는 JPEG로 만들며, 잘못된 토큰은 알려 줍니다', async () => {
  const { ctx, store, fake } = await setup();
  const acct = store.findOne('accounts', (a) => a.kind === 'instagram');
  store.update('accounts', acct.id, { tokenAt: new Date(Date.now() - 40 * 864e5).toISOString(), tokenExpiresAt: new Date(Date.now() + 20 * 864e5).toISOString() });
  await refreshTokens(ctx);
  const after = store.get('accounts', acct.id);
  assert.equal(store.vault.decrypt(after.secret), 'IGAA' + 'R'.repeat(60));
  assert.ok(fake.calls.some((c) => c.path === '/refresh_access_token' && c.params.grant_type === 'ig_refresh_token'));
  assert.ok(isPublicUrl('https://studio.example') && !isPublicUrl('http://localhost:4300') && !isPublicUrl('https://192.168.0.2'));
  const jpg = designJpeg(SVG, 400);
  assert.equal(jpg[0], 0xff); assert.equal(jpg[1], 0xd8);
  await assert.rejects(connectAccount(ctx, 'instagram', 'mypassword123'), /액세스 토큰/);
  await assert.rejects(connectAccount(ctx, 'instagram', 'EAA' + 'x'.repeat(60)), /IG로 시작하는 토큰/);
});