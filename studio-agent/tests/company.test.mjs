// 회사 운영: 직원 · 정기 점검(스탠드업 · 일정 지연 · 연체) · 재무 집계 · 회고 채택 · 직원 API
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, msg, text, tmpDir, fakeFactory } from './helpers.mjs';
import { maintenance, financeSummary, runStandup } from '../lib/pm.mjs';
import { createInquiry } from '../lib/actions.mjs';
import { pickDesigner, staffOf } from '../lib/staff.mjs';
import { createApp } from '../server.mjs';

test('처음 실행하면 직무별 직원이 채용되어 있습니다', () => {
  const { ctx } = makeCtx(() => msg([text('x')]));
  for (const role of ['am', 'pm', 'ad', 'designer', 'finance']) assert.ok(staffOf(ctx.store, role).length, role);
  assert.equal(staffOf(ctx.store, 'designer').length, 2);
});

test('일이 적은 디자이너에게 배정합니다', async () => {
  const { ctx } = makeCtx(() => msg([text('x')]));
  const { store } = ctx;
  const [d1, d2] = staffOf(store, 'designer');
  const a = await createInquiry(ctx, { name: 'A', email: 'a@x.kr', description: '문의' });
  store.update('projects', a.id, { designerId: d1.id, status: 'in_progress' });
  const b = await createInquiry(ctx, { name: 'B', email: 'b@x.kr', description: '문의' });
  assert.equal(pickDesigner(store, store.get('projects', b.id)).id, d2.id);
  assert.equal(pickDesigner(store, store.get('projects', a.id)).id, d1.id, '이미 맡은 프로젝트는 그대로');
});

test('정기 점검: 아침 스탠드업 예약, 지연 마일스톤 · 연체 청구서를 AM에게 넘김', async () => {
  const { ctx } = makeCtx(() => msg([text('x')]), { company: { standupHour: 0 } });
  const { store } = ctx;
  const p = await createInquiry(ctx, { name: 'A', email: 'a@x.kr', description: '문의' });
  for (const j of store.find('jobs', () => true)) store.update('jobs', j.id, { status: 'done' });
  store.update('projects', p.id, { status: 'in_progress', plan: { milestones: [{ title: '1차 시안', owner: 'designer', due: '2020-01-01', done: false }] } });
  const inv = store.insert('invoices', { projectId: p.id, kind: 'deposit', amount: 100000, status: 'sent', dueDate: '2020-01-01' });

  maintenance(store);
  assert.ok(store.findOne('jobs', (j) => j.kind === 'standup' && j.status === 'queued'));
  const job = store.findOne('jobs', (j) => j.kind === 'agent' && j.status === 'queued');
  assert.deepEqual(job.payload.events.map((e) => e.kind).sort(), ['invoice_overdue', 'milestone_overdue']);
  assert.equal(store.get('invoices', inv.id).reminders, 1);

  // 같은 날 다시 점검해도 중복 알림 없음
  maintenance(store);
  assert.equal(store.get('jobs', job.id).payload.events.length, 2);
  assert.equal(store.find('jobs', (j) => j.kind === 'standup').length, 1);

  // 세 번째 독촉 시점에는 대표에게 직접 알림
  store.update('invoices', inv.id, { reminders: 2, lastReminderAt: '2020-01-01T00:00:00Z' });
  maintenance(store);
  assert.ok(store.findOne('alerts', (a) => /독촉 2회/.test(a.text)));
});

test('스탠드업 보고서가 PM 이름으로 저장됩니다', async () => {
  const { ctx, calls } = makeCtx(() => msg([text('오늘의 보고: 모모카페 1차 시안 진행')]));
  const p = await createInquiry(ctx, { name: 'A', email: 'a@x.kr', description: '문의' });
  ctx.store.update('projects', p.id, { status: 'in_progress' });
  await runStandup(ctx);
  const r = ctx.store.findOne('reports', (x) => x.kind === 'standup');
  assert.match(r.body, /모모카페/);
  assert.equal(ctx.store.get('staff', r.staffId).role, 'pm');
  assert.equal(calls[0].kind, 'standup');
});

test('재무: 매출 · 미수금 · 직원별 비용, 연습은 매출에서 빠짐', async () => {
  const { ctx } = makeCtx(() => msg([text('x')]));
  const { store } = ctx;
  const p = await createInquiry(ctx, { name: 'A', email: 'a@x.kr', description: '문의' });
  const sim = await createInquiry(ctx, { name: 'S', description: '연습', simulation: true });
  const month = new Date().toISOString().slice(0, 7);
  store.insert('invoices', { projectId: p.id, kind: 'deposit', amount: 300000, status: 'paid', paidAt: new Date().toISOString() });
  store.insert('invoices', { projectId: p.id, kind: 'final', amount: 300000, status: 'sent', dueDate: '2020-01-01' });
  store.insert('invoices', { projectId: sim.id, kind: 'deposit', amount: 999999, status: 'paid', paidAt: new Date().toISOString() });
  store.insert('usage', { day: new Date().toISOString().slice(0, 10), cost: 0.5, staffId: 'stf_ds1', projectId: p.id });
  store.insert('usage', { day: new Date().toISOString().slice(0, 10), cost: 0.2, staffId: 'stf_am', projectId: sim.id });
  const f = financeSummary(store, month);
  assert.equal(f.revenue, 300000);
  assert.equal(f.receivables, 300000);
  assert.equal(f.overdue, 300000);
  assert.equal(f.byStaff.find((x) => x.id === 'stf_ds1').costUsd, 0.5);
  assert.equal(f.practiceUsd, 0.2);
});

test('직원 API: 채용 · 수정, 직무에 마지막 한 명은 휴직 불가, 회고 제안 채택 → 학습 노트', async (t) => {
  const fake = fakeFactory(() => msg([text('ok')]));
  const app = createApp({ dataDir: tmpDir(), llmFactory: fake.factory, startWorker: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const res = await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'long password' }) });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const api = (p, method = 'GET', body) => fetch(base + p, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });

  const hired = await (await api('/api/staff', 'POST', { name: '윤슬', role: 'designer', persona: '레트로 포스터' })).json();
  assert.equal(hired.role, 'designer');
  const list = await (await api('/api/staff')).json();
  assert.equal(list.filter((x) => x.role === 'designer').length, 3);
  assert.ok(list[0].stats);
  assert.equal((await api('/api/staff/stf_pm', 'PATCH', { active: false })).status, 409, 'PM이 한 명뿐이라 휴직 불가');
  assert.equal((await api('/api/staff/stf_ds1', 'PATCH', { active: false, name: '정다온2' })).status, 200);
  assert.equal(app.ctx.store.get('staff', 'stf_ds1').active, false);

  const r = app.ctx.store.insert('reports', { kind: 'retro', title: '회고', body: '...', proposals: [{ text: '킥오프 일정 먼저 공유', scope: 'account', status: 'pending' }] });
  assert.equal((await api(`/api/reports/${r.id}/proposals/0/adopt`, 'POST', {})).status, 200);
  assert.ok(app.ctx.store.findOne('lessons', (l) => l.text === '킥오프 일정 먼저 공유' && l.source === 'retro'));
  assert.equal((await api(`/api/reports/${r.id}/proposals/0/adopt`, 'POST', {})).status, 409);
  const fin = await (await api('/api/finance')).json();
  assert.equal(typeof fin.revenue, 'number');
});
