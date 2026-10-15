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
  for (const role of ['am', 'sales', 'pm', 'ad', 'designer', 'copywriter', 'finance']) assert.ok(staffOf(ctx.store, role).length, role);
  assert.equal(staffOf(ctx.store, 'designer').length, 3);
  assert.equal(ctx.store.all('staff').length, 11);
  // 모든 기본 직원에게 경력 · 스킬 · 업무 원칙 프로필이 있음
  for (const st of ctx.store.all('staff')) assert.ok(st.career && st.skills.length && st.principles, st.name);
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
  assert.equal(list.filter((x) => x.role === 'designer').length, 4);
  assert.ok(list[0].stats);
  assert.equal((await api('/api/staff/stf_fin', 'PATCH', { active: false })).status, 409, '재무가 한 명뿐이라 휴직 불가');
  assert.equal((await api('/api/staff/stf_cw', 'PATCH', { active: false })).status, 200, '카피라이터는 없어도 회사가 돌아감');
  assert.equal((await api('/api/staff/stf_ds3', 'PATCH', { skills: '패키지, 레터링', specialties: ['logo', 'nope'], capacity: 4, principles: '규칙 하나' })).status, 200);
  const ds3 = app.ctx.store.get('staff', 'stf_ds3');
  assert.deepEqual(ds3.skills, ['패키지', '레터링']);
  assert.deepEqual(ds3.specialties, ['logo'], '없는 서비스 id는 버림');
  assert.equal(ds3.capacity, 4);
  assert.equal((await api('/api/staff/stf_ds3', 'PATCH', { capacity: 99 })).status, 400);
  assert.equal((await api('/api/staff/stf_ds1', 'PATCH', { active: false, name: '정다온2' })).status, 200);
  assert.equal(app.ctx.store.get('staff', 'stf_ds1').active, false);

  const r = app.ctx.store.insert('reports', { kind: 'retro', title: '회고', body: '...', proposals: [{ text: '킥오프 일정 먼저 공유', scope: 'account', status: 'pending' }] });
  assert.equal((await api(`/api/reports/${r.id}/proposals/0/adopt`, 'POST', {})).status, 200);
  assert.ok(app.ctx.store.findOne('lessons', (l) => l.text === '킥오프 일정 먼저 공유' && l.source === 'retro'));
  assert.equal((await api(`/api/reports/${r.id}/proposals/0/adopt`, 'POST', {})).status, 409);
  const fin = await (await api('/api/finance')).json();
  assert.equal(typeof fin.revenue, 'number');
});

test('부서 · 직책: 기본 배치, 직책이 높은 사람이 대표로 맡음, 작업 중 표시', async () => {
  const { ctx } = makeCtx(() => msg([text('x')]));
  const { store } = ctx;
  const { lead, busyStaff } = await import('../lib/staff.mjs');
  const byId = (id) => store.get('staff', id);
  assert.equal(byId('stf_am').dept, 'sales');
  assert.equal(byId('stf_ad').position, '실장');
  assert.equal(byId('stf_ds1').position, '선임');
  assert.equal(byId('stf_fin').dept, 'admin');
  // 같은 직무에 팀장이 새로 오면 그 사람이 대표 담당
  const newLead = store.insert('staff', { name: '새팀장', role: 'am', dept: 'sales', position: '실장', active: true });
  assert.equal(lead(store, 'am').id, newLead.id);
  const p = await createInquiry(ctx, { name: 'A', email: 'a@x.kr', description: '문의' });
  store.update('projects', p.id, { designerId: 'stf_ds2' });
  const busy = busyStaff(store, { kind: 'design', payload: { projectId: p.id } });
  assert.ok(busy.stf_ds2 && busy.stf_ad);
});

test('배정: 전문 서비스 우선, 한도가 차면 다른 사람, AM은 문의 때 · PM은 킥오프 때 배정', async () => {
  const { assign, projectStaff, loadOf } = await import('../lib/staff.mjs');
  const { ctx } = makeCtx(() => msg([text('x')]));
  const { store } = ctx;
  // 상세페이지 문의 → 상세페이지 전문 디자이너(강민재)
  const p = await createInquiry(ctx, { name: 'A', email: 'a@x.kr', description: '문의', serviceId: 'detail' });
  assert.equal(pickDesigner(store, store.get('projects', p.id)).id, 'stf_ds3');
  // 강민재 한도(2) 가득 → 다음 상세페이지는 다른 사람
  for (const n of [1, 2]) { const q = await createInquiry(ctx, { name: 'B' + n, email: `b${n}@x.kr`, description: '문의', serviceId: 'detail' }); store.update('projects', q.id, { designerId: 'stf_ds3', status: 'in_progress' }); }
  assert.equal(loadOf(store, store.get('staff', 'stf_ds3')), 2);
  assert.notEqual(pickDesigner(store, store.get('projects', p.id)).id, 'stf_ds3');
  // 로고 문의 → 로고 전문 AM(김지원), SNS 문의 → 오세린
  const logo = await createInquiry(ctx, { name: 'C', email: 'c@x.kr', description: '문의', serviceId: 'logo' });
  const sns = await createInquiry(ctx, { name: 'D', email: 'd@x.kr', description: '문의', serviceId: 'sns' });
  assert.equal(store.get('projects', logo.id).amId, 'stf_am');
  assert.equal(store.get('projects', sns.id).amId, 'stf_am2');
  // 고객 응대 메시지는 배정된 AM 이름으로, 휴직하면 팀장이 대신
  const m = await (await import('../lib/actions.mjs')).postMessage(ctx, store.get('projects', sns.id), { from: 'agent', text: '안녕하세요' });
  assert.equal(m.staffId, 'stf_am2');
  store.update('staff', 'stf_am2', { active: false });
  assert.equal(projectStaff(store, store.get('projects', sns.id), 'am').id, 'stf_am');
  assert.equal(assign(store, 'pm', store.get('projects', sns.id)).id, 'stf_pm');
});

test('직원 프로필과 업무 원칙이 그 직원의 프롬프트에 들어갑니다', async () => {
  const { staffBlock } = await import('../lib/staff.mjs');
  const { ctx } = makeCtx(() => msg([text('x')]));
  const b = staffBlock(ctx.store.get('staff', 'stf_ds3'), ctx.store.settings);
  assert.match(b, /상세페이지/);
  assert.match(b, /personal work rules/);
  assert.match(b, /never claim real-world experience/);
});

test('기존 6명 회사를 열면 새 직원이 합류하고, 대표가 고친 값은 그대로', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { Store } = await import('../lib/store.mjs');
  const dir = tmpDir();
  const old = ['stf_am', 'stf_pm', 'stf_ad', 'stf_ds1', 'stf_ds2', 'stf_fin'].map((id) => ({ id, name: id === 'stf_ds1' ? '내가바꾼이름' : id, role: { stf_am: 'am', stf_pm: 'pm', stf_ad: 'ad', stf_ds1: 'designer', stf_ds2: 'designer', stf_fin: 'finance' }[id], persona: id === 'stf_ds1' ? '내 설명' : 'x', active: true }));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ settings: {}, staff: old }));
  const store = new Store(dir);
  assert.equal(store.all('staff').length, 11);
  const ds1 = store.get('staff', 'stf_ds1');
  assert.equal(ds1.name, '내가바꾼이름');
  assert.equal(ds1.persona, '내 설명');
  assert.ok(ds1.skills.length, '빈 프로필은 채움');
  // 한 번만: 다시 열어도 그대로
  store.remove('staff', 'stf_cw');
  assert.equal(new Store(dir).all('staff').length, 10, '대표가 내보낸 직원은 다시 생기지 않음');
});
