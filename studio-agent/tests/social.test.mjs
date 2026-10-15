// SNS 영업(인스타그램 · Threads) — 가짜 Meta 서버로 동의 · 게시 · 댓글 응대 · 토큰 갱신을 검사합니다(실제 계정에 닿지 않음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, json, msg, text, SVG } from './helpers.mjs';
import { runJob } from '../lib/scheduler.mjs';
import { createInquiry, acceptQuoteByClient, executeAction, markInvoicePaid, approveDesignByClient } from '../lib/actions.mjs';
import { connectAccount, composeSocialPost, publishSocialPost, syncSocial, refreshTokens, aiLine, isPublicUrl, designJpeg } from '../lib/social.mjs';

const TOKEN = 'T'.repeat(60);

// 가짜 Meta Graph API
function fakeMeta({ comments = {}, conversation = {}, threadsPosts = [], igMedia = [] } = {}) {
  const calls = [];
  let n = 0;
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const params = Object.fromEntries(init.body ? new URLSearchParams(init.body) : u.searchParams);
    calls.push({ host: u.host, path: u.pathname, method: init.method ?? 'GET', params });
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    const p = u.pathname.replace(/^\/v1\.0/, '');
    if (p === '/me') return ok(u.host.includes('threads') ? { id: '111', username: 'ongyeol.studio' } : { user_id: '222', username: 'ongyeol.studio' });
    if (p.endsWith('/threads') && init.method === 'POST') return ok({ id: `tc${++n}` });
    if (p.endsWith('/threads_publish')) return ok({ id: `tp${++n}` });
    if (p.endsWith('/media') && init.method === 'POST') return ok({ id: `ic${++n}` });
    if (p.endsWith('/media_publish')) return ok({ id: `ip${++n}` });
    if (/^\/(tc|ic)\d+$/.test(p)) return ok({ status: 'FINISHED', status_code: 'FINISHED' });
    if (/^\/(tp|ip)\d+$/.test(p)) return ok({ permalink: `https://example.com${p}` });
    if (p === '/me/threads') return ok({ data: threadsPosts });
    if (/^\/\w+\/conversation$/.test(p)) return ok({ data: conversation[p.split('/')[1]] ?? [] });
    if (p === '/222/media' && (init.method ?? 'GET') === 'GET') return ok({ data: igMedia });
    if (/^\/\w+\/comments$/.test(p)) return ok({ data: comments[p.split('/')[1]] ?? [] });
    if (/^\/\w+\/replies$/.test(p) && init.method === 'POST') return ok({ id: `ir${++n}` });
    if (p === '/refresh_access_token') return ok({ access_token: 'R'.repeat(60), expires_in: 5184000 });
    return { ok: false, status: 404, json: async () => ({ error: { message: `unknown ${p}`, code: 100 } }) };
  };
  return { fetch, calls };
}

const writer = (body, kind) => {
  if (kind === 'social') return json({ threads: '모모카페 로고는 복숭아의 둥근 곡선을 그대로 살렸어요. 비슷한 작업 문의 주세요.', instagram: '모모카페의 첫 로고 작업입니다.\n\n둥근 형태와 크림 · 브라운 색으로 동네 카페의 따뜻함을 담았습니다.', hashtags: ['로고디자인', '카페로고', '#브랜딩'] });
  if (kind === 'triage') {
    // 실제 AM처럼 댓글 내용을 보고 판단: 환불 · 불만은 대표에게, 질문에는 답
    const content = body.messages[0].content;
    const list = JSON.parse(content.slice(content.indexOf('['), content.indexOf('\n\nFor each')));
    return json({ items: list.map((c) => (/환불/.test(c.text) ? { id: c.id, action: 'escalate', reply: '', note: '환불 요구' } : { id: c.id, action: 'reply', reply: '감사합니다! 로고 디자인은 50만 원부터예요.', note: '' })) });
  }
  return msg([text('완료')]);
};

async function setup({ publicUrl = 'https://studio.example', consent = { portfolio: true, named: false }, meta } = {}) {
  const { ctx, calls } = makeCtx(writer, { publicUrl, policy: { requireDeposit: false } });
  const fake = meta ?? fakeMeta();
  ctx.fetch = fake.fetch;
  ctx.sleep = async () => {};
  const { store } = ctx;
  await connectAccount(ctx, 'threads', TOKEN);
  await connectAccount(ctx, 'instagram', TOKEN);
  const p = await createInquiry(ctx, { name: '김사장', email: 'kim@x.kr', company: '모모카페', description: '로고' });
  const q = store.insert('quotes', { projectId: p.id, items: [], total: 500000, revisions: 2, status: 'sent' });
  await acceptQuoteByClient(ctx, p, q.id, consent);
  const d = store.insert('designs', { projectId: p.id, round: 1, title: '모모 피치', rationale: '복숭아', format: 'svg', code: SVG, shared: true });
  await approveDesignByClient(ctx, store.get('projects', p.id), d.id);
  store.update('projects', p.id, { status: 'delivered' });
  const inv = store.insert('invoices', { projectId: p.id, kind: 'final', amount: 500000, status: 'sent' });
  await markInvoicePaid(ctx, inv.id);
  return { ctx, store, calls, fake, project: store.get('projects', p.id), design: d };
}

test('고객이 동의하지 않았거나 연습 프로젝트면 SNS 글을 만들지 않습니다', async () => {
  const { ctx, store, project } = await setup({ consent: {} });
  assert.equal(store.get('projects', project.id).portfolioConsent, false);
  assert.ok(!store.findOne('jobs', (j) => j.kind === 'social_compose'), '정산돼도 동의 없으면 예약 안 함');
  assert.equal(await composeSocialPost(ctx, { projectId: project.id }), null);
  store.update('projects', project.id, { portfolioConsent: true, simulation: true });
  assert.equal(await composeSocialPost(ctx, { projectId: project.id }), null);
  assert.equal(store.all('social_posts').length, 0);
});

test('동의한 작업이 정산되면 글을 쓰고, 승인 후 Threads · 인스타그램에 이미지와 함께 올립니다', async () => {
  const { ctx, store, project, fake } = await setup();
  const compose = store.findOne('jobs', (j) => j.kind === 'social_compose' && j.status === 'queued');
  assert.ok(compose, '정산 때 글 쓰기 예약');
  await runJob(ctx, compose);
  const post = store.findOne('social_posts', (x) => x.projectId === project.id);
  assert.equal(post.status, 'pending');
  assert.ok(post.threadsText.endsWith(aiLine(store.settings)) && post.igCaption.endsWith(aiLine(store.settings)), 'AI 활용 표시');
  assert.ok(post.threadsText.length <= 500);
  assert.ok(!post.threadsText.includes('모모카페') && !post.igCaption.includes('모모카페'), '업체명 비공개 동의면 이름을 지움');
  assert.match(post.igCaption, /#로고디자인 #카페로고 #브랜딩/);
  const ap = store.findOne('approvals', (a) => a.status === 'pending' && a.category === 'social_post');
  assert.ok(ap, '기본은 대표 승인 후 게시');

  // 대표가 문구를 고쳐 승인(AI 표시를 지워도 다시 붙음)
  const r = await executeAction(ctx, { ...ap.action, threadsText: '고친 문구입니다' });
  assert.match(r, /게시를 시작/);
  assert.ok(store.get('social_posts', post.id).threadsText.startsWith('고친 문구입니다') && store.get('social_posts', post.id).threadsText.endsWith(aiLine(store.settings)));
  await runJob(ctx, store.findOne('jobs', (j) => j.kind === 'social_publish' && j.status === 'queued'));
  const done = store.get('social_posts', post.id);
  assert.equal(done.status, 'published');
  assert.ok(done.results.threads.permalink && done.results.instagram.permalink);
  const tCreate = fake.calls.find((c) => c.path.endsWith('/111/threads') && c.method === 'POST');
  assert.equal(tCreate.params.media_type, 'IMAGE');
  assert.equal(tCreate.params.image_url, `https://studio.example/m/${post.mediaToken}.jpg`);
  const iCreate = fake.calls.find((c) => c.path.endsWith('/222/media') && c.method === 'POST');
  assert.equal(iCreate.params.image_url, tCreate.params.image_url);
  assert.ok(fake.calls.every((c) => c.params.access_token === TOKEN), '저장한 토큰으로 호출');

  // 다시 실행해도 두 번 올리지 않음
  await publishSocialPost(ctx, { postId: post.id });
  assert.equal(fake.calls.filter((c) => c.path.endsWith('_publish')).length, 2);
});

test('외부 접속 주소가 없으면 Threads는 글만, 인스타그램은 건너뜁니다', async () => {
  const { ctx, store, project, fake } = await setup({ publicUrl: 'http://localhost:4300' });
  await runJob(ctx, store.findOne('jobs', (j) => j.kind === 'social_compose'));
  const post = store.findOne('social_posts', (x) => x.projectId === project.id);
  store.updateSettings({ autonomy: { social_post: 'auto' } });
  await executeAction(ctx, { type: 'social_publish', postId: post.id });
  await runJob(ctx, store.findOne('jobs', (j) => j.kind === 'social_publish' && j.status === 'queued'));
  const done = store.get('social_posts', post.id);
  assert.equal(done.status, 'published');
  assert.equal(fake.calls.find((c) => c.path.endsWith('/111/threads')).params.media_type, 'TEXT');
  assert.match(done.results.instagram.skipped, /외부 접속 주소/);
  assert.ok(!fake.calls.some((c) => c.path.endsWith('/222/media') && c.method === 'POST'));
});

test('서버: 반려하면 글만 취소(에이전트에 재작성 지시 없음), 게시용 이미지는 토큰 주소로만 JPEG 제공', async (t) => {
  const { createApp } = await import('../server.mjs');
  const { tmpDir, fakeFactory } = await import('./helpers.mjs');
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
  const post = store.insert('social_posts', { projectId: p.id, designId: d.id, platforms: ['threads'], threadsText: 'x', igCaption: 'y', mediaToken: 'abcdefghijklmnopqrstuvwx', status: 'pending', results: {} });
  const ap = store.insert('approvals', { category: 'social_post', action: { type: 'social_publish', postId: post.id, projectId: p.id }, summary: 's', status: 'pending', projectId: p.id });

  const img = await fetch(`${base}/m/abcdefghijklmnopqrstuvwx.jpg`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(`${base}/m/wrongtokenwrongtoken1234.jpg`)).status, 404, '토큰이 틀리면 없음');

  assert.equal((await call(`/api/approvals/${ap.id}/reject`, 'POST', { feedback: '사진이 별로' })).status, 200);
  assert.equal(store.get('social_posts', post.id).status, 'cancelled');
  assert.ok(!store.findOne('jobs', (j) => j.kind === 'agent' && j.status === 'queued'), 'AM에게 재작성 지시를 보내지 않음');
  assert.equal((await fetch(`${base}/m/abcdefghijklmnopqrstuvwx.jpg`)).status, 404, '취소된 글의 이미지는 더 이상 공개하지 않음');
  const sp = await (await call('/api/social')).json();
  assert.equal(sp.publicUrlOk, false);
  assert.equal((await call('/api/social/connect', 'POST', { platform: 'threads', token: 'short' })).status, 400);
});

test('내 게시물 댓글: 연결 전 댓글은 넘기고, 질문에는 AI임을 밝혀 답하고, 불만은 대표에게 넘깁니다', async () => {
  const later = new Date(Date.now() + 60e3).toISOString();
  const meta = fakeMeta({
    threadsPosts: [{ id: 'tpost', timestamp: new Date().toISOString(), text: '모모 로고' }],
    conversation: { tpost: [
      { id: 'r-own', text: '내 답글', username: 'ongyeol.studio', timestamp: later, is_reply_owned_by_me: true },
      { id: 'r-old', text: '예전 댓글', username: 'old', timestamp: '2020-01-01T00:00:00Z' },
      { id: 'r-q', text: '로고 가격이 얼마예요?', username: 'cafe_owner', timestamp: later },
    ] },
    igMedia: [{ id: 'imedia', timestamp: new Date().toISOString(), caption: '모모' }],
    comments: { imedia: [{ id: 'c-bad', text: '환불해 주세요', username: 'angry', timestamp: later }] },
  });
  const { ctx, store } = await setup({ meta });
  await syncSocial(ctx);
  const byRemote = (id) => store.findOne('social_comments', (c) => c.remoteId === id);
  assert.equal(byRemote('r-own'), null, '내 답글은 무시');
  assert.equal(byRemote('r-old').status, 'ignored');
  assert.equal(byRemote('r-q').status, 'replied');
  assert.match(byRemote('r-q').reply, /AI 답변$/);
  const reply = meta.calls.find((c) => c.path.endsWith('/111/threads') && c.params.reply_to_id === 'r-q');
  assert.ok(reply, 'Threads 답글은 reply_to_id로');
  assert.equal(byRemote('c-bad').status, 'escalated');
  assert.ok(store.all('alerts').some((a) => /댓글 확인 필요/.test(a.text)));
  // 다음 확인 때 같은 댓글에 또 답하지 않음
  const before = meta.calls.length;
  await syncSocial(ctx);
  assert.ok(!meta.calls.slice(before).some((c) => c.params.reply_to_id === 'r-q'));
});

test('토큰은 만료 30일 전부터 자동으로 새로 받고, 이미지는 JPEG로 만듭니다', async () => {
  const { ctx, store, fake } = await setup();
  const acct = store.findOne('accounts', (a) => a.kind === 'threads');
  store.update('accounts', acct.id, { tokenAt: new Date(Date.now() - 40 * 864e5).toISOString(), tokenExpiresAt: new Date(Date.now() + 20 * 864e5).toISOString() });
  await refreshTokens(ctx);
  const after = store.get('accounts', acct.id);
  assert.equal(store.vault.decrypt(after.secret), 'R'.repeat(60));
  assert.ok(Date.parse(after.tokenExpiresAt) > Date.now() + 50 * 864e5);
  assert.ok(fake.calls.some((c) => c.path === '/refresh_access_token' && c.params.grant_type === 'th_refresh_token'));
  assert.ok(isPublicUrl('https://studio.example') && !isPublicUrl('http://localhost:4300') && !isPublicUrl('https://192.168.0.2'));
  const jpg = designJpeg(SVG, 400);
  assert.equal(jpg[0], 0xff); assert.equal(jpg[1], 0xd8, 'JPEG 파일');
  await assert.rejects(connectAccount(ctx, 'threads', 'mypassword123'), /액세스 토큰/);
});