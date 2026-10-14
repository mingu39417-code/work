// HTTP: 대시보드 인증, 공개 문의, 고객 포털, 시안 샌드박스, 외부 채널 연동
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { tmpDir, fakeFactory, msg, text, SVG } from './helpers.mjs';

async function boot() {
  const fake = fakeFactory(() => msg([text('ok')]));
  const app = createApp({ dataDir: tmpDir(), llmFactory: fake.factory, startWorker: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = '';
  const call = async (path, { method = 'GET', body, auth = true } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth && cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return res;
  };
  return { app, call, base };
}

test('대시보드는 비밀번호가 필요하고, 설정 조회 때 API 키를 가립니다', async (t) => {
  const { app, call } = await boot();
  t.after(() => app.close());
  assert.equal((await call('/api/overview')).status, 401);
  assert.deepEqual(await (await call('/api/auth/status')).json(), { setup: true, authed: false });
  assert.equal((await call('/api/auth/setup', { method: 'POST', body: { password: 'short' } })).status, 400);
  assert.equal((await call('/api/auth/setup', { method: 'POST', body: { password: 'correct horse' } })).status, 200);
  assert.equal((await call('/api/overview')).status, 200);
  assert.equal((await call('/api/auth/setup', { method: 'POST', body: { password: 'another one' } })).status, 409);

  await call('/api/settings', { method: 'PUT', body: { apiKey: 'sk-ant-api03-SECRETSECRET-abcd', profile: { ownerName: '임민규' } } });
  const s = await (await call('/api/settings')).json();
  assert.ok(!JSON.stringify(s).includes('SECRETSECRET'));
  assert.equal(s.hasApiKey, true);
  assert.equal(s.auth, undefined);
  assert.equal(s.profile.ownerName, '임민규');
  // 가려진 값을 그대로 저장해도 원래 키가 유지됩니다
  await call('/api/settings', { method: 'PUT', body: { apiKey: s.apiKey } });
  assert.equal(app.ctx.store.settings.apiKey, 'sk-ant-api03-SECRETSECRET-abcd');

  await call('/api/auth/logout', { method: 'POST', body: {} });
  assert.equal((await call('/api/overview')).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { password: 'wrong pass' } })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { password: 'correct horse' } })).status, 200);
});

test('공개 문의 → 고객 포털 → 시안은 샌드박스로만 열립니다', async (t) => {
  const { app, call } = await boot();
  t.after(() => app.close());
  const { store } = app.ctx;

  assert.equal((await call('/api/public/inquiry', { method: 'POST', body: { email: 'bad', description: '내용입니다' } })).status, 400);
  const png = `data:image/png;base64,${Buffer.from('fakepng').toString('base64')}`;
  const body = { name: '고객', email: 'c@x.kr', description: '포스터 문의합니다', serviceId: 'poster', images: [{ name: 'ref.png', dataUrl: png }], marketingConsent: true };
  assert.equal((await call('/api/public/inquiry', { method: 'POST', body })).status, 400, '개인정보 동의 없이는 접수 불가');
  const r = await (await call('/api/public/inquiry', { method: 'POST', body: { ...body, privacyConsent: true } })).json();
  const cl = store.findOne('clients', (c) => c.email === 'c@x.kr');
  assert.ok(cl.privacyConsentAt);
  assert.ok(cl.marketingConsent.at);
  assert.match(r.portalUrl, /^\/p\/[\w-]+$/);
  const token = r.portalUrl.split('/').pop();
  assert.equal(store.find('jobs', (j) => j.kind === 'agent').length, 1);

  const view = await (await call(`/api/portal/${token}`)).json();
  assert.equal(view.project.status, 'inquiry');
  assert.equal(view.messages.length, 1);
  assert.equal(view.messages[0].attachments.length, 1);
  assert.equal((await call(`/api/portal/${token}/uploads/${view.messages[0].attachments[0].file}`)).status, 200);
  assert.equal((await call('/api/portal/nope')).status, 404);

  // 내부 메모는 고객에게 보이지 않습니다
  const project = store.findOne('projects', (p) => p.portalToken === token);
  store.insert('messages', { projectId: project.id, from: 'agent', internal: true, text: '내부 메모', designIds: [], attachments: [] });
  const d = store.insert('designs', { projectId: project.id, round: 1, title: '시안 A', rationale: '', format: 'svg', code: SVG, shared: false });
  let v2 = await (await call(`/api/portal/${token}`)).json();
  assert.ok(!v2.messages.some((m) => m.text === '내부 메모'));
  assert.equal(v2.designs.length, 0, '공유 전 시안은 안 보임');
  assert.equal((await call(`/api/portal/${token}/designs/${d.id}/raw`)).status, 404);

  store.update('designs', d.id, { shared: true });
  const raw = await call(`/api/portal/${token}/designs/${d.id}/raw`);
  assert.equal(raw.status, 200);
  assert.match(raw.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await call(`/api/portal/${token}/designs/${d.id}/download`)).status, 403, '납품 전 다운로드 불가');

  // 고객 메시지 → 에이전트 작업 하나로 모임
  await call(`/api/portal/${token}/messages`, { method: 'POST', body: { text: 'A4 사이즈로요' } });
  const jobs = store.find('jobs', (j) => j.kind === 'agent' && j.status === 'queued');
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].payload.events.map((e) => e.kind), ['new_inquiry', 'client_message']);
});

test('외부 채널 연동은 토큰이 맞아야 하고, 기존 고객이면 진행 중 프로젝트로 이어집니다', async (t) => {
  const { app, call } = await boot();
  t.after(() => app.close());
  const { store } = app.ctx;
  const send = (token, body) => fetch(`http://127.0.0.1:${app.server.address().port}/api/inbound`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-inbound-token': token }, body: JSON.stringify(body),
  });
  assert.equal((await send('wrong', { email: 'k@x.kr', text: '안녕' })).status, 401);
  const tok = store.settings.inboundToken;
  const a = await (await send(tok, { email: 'k@x.kr', name: '카톡고객', text: '로고 문의요' })).json();
  const b = await (await send(tok, { email: 'K@x.kr', text: '추가 질문' })).json();
  assert.equal(a.projectId, b.projectId);
  assert.equal(store.find('messages', (m) => m.projectId === a.projectId && m.from === 'client').length, 2);
  void call;
});
