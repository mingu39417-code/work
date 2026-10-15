// 날짜 · 요일 확인 — 언어 모델의 요일 계산 실수가 고객에게 나가지 않게 막습니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWeekdays, weekdayProblems, calendarLine } from '../lib/calendar.mjs';
import { makeCtx, json, msg, text, toolUse, SVG } from './helpers.mjs';
import { createInquiry } from '../lib/actions.mjs';

const NOW = Date.parse('2026-10-15T09:00:00Z'); // 목요일

test('요일 검사: 틀린 요일만 찾고, 월이 생략된 날짜는 앞의 월을 따릅니다', () => {
  const w = checkWeekdays('11월 8일(금)~10일(일) 3일간', NOW);
  assert.deepEqual(w.map((x) => [x.month, x.day, x.given, x.real]), [[11, 8, '금', '일'], [11, 10, '일', '화']]);
  assert.equal(weekdayProblems('11월 8일(일)~10일(화), 10/21 (수요일), 11.3(화)', NOW), null);
  assert.equal(checkWeekdays('1월 5일(화)', NOW)[0], undefined, '지난 달은 내년으로 계산(2027-01-05는 화요일)');
  assert.match(calendarLine(3, NOW), /^10\/15목 10\/16금 10\/17토$/);
});

test('AM이 틀린 요일로 디자인을 지시하거나 고객에게 쓰면 도구가 거절하고 고치게 합니다', async () => {
  let step = 0;
  const { ctx, calls } = makeCtx((body, kind) => {
    if (kind !== 'account') return msg([text('x')]);
    step++;
    if (step === 1) return msg([toolUse('start_design_round', { instructions: '11월 8일(금)~10일(일) 행사 포스터', concepts: 1 })]);
    if (step === 2) return msg([toolUse('reply_to_client', { message: '행사는 11월 8일(금)부터예요' })]);
    return msg([text('끝')]);
  }, { now: NOW });
  const { store } = ctx;
  const p = await createInquiry(ctx, { name: 'A', email: 'a@a.kr', description: '포스터' });
  store.update('projects', p.id, { simulation: true, autopilot: true });
  const { runAccountManager } = await import('../lib/agent.mjs');
  await runAccountManager(ctx, { projectId: p.id, events: [{ kind: 'client_message' }] });
  const results = JSON.stringify(calls.filter((c) => c.kind === 'account').map((c) => c.body.messages));
  assert.match(results, /시작하지 않았습니다 — 지시문의 날짜 요일이 달력과 다릅니다/);
  assert.match(results, /보내지 않았습니다 — 날짜 요일이 달력과 다릅니다/);
  assert.ok(!store.findOne('jobs', (j) => j.kind === 'design'), '디자인 작업이 시작되지 않음');
  assert.ok(!store.find('messages', (m) => m.projectId === p.id && m.from === 'agent' && !m.internal).length, '고객에게 나가지 않음');
  assert.match(results, /Calendar \(KST/, 'AM 상태 정보에 달력이 들어감');
});

test('시안 속 요일이 틀리면 AD 검수 전에 자동으로 돌려보내고, 고쳐지면 그때 검수합니다', async () => {
  const wrong = SVG.replace('Logo', '11월 8일(금)');
  const right = SVG.replace('Logo', '11월 8일(일)');
  const { ctx, calls } = makeCtx((body, kind, i) => {
    if (kind === 'directions') return json({ directions: [{ name: '포스터', idea: 'x', palette: ['#000'], typography: 'x', layout: 'x', format: 'svg' }] });
    if (kind === 'make') return json({ title: '포스터', rationale: 'x', format: 'svg', code: i === 0 ? wrong : right });
    if (kind === 'review') return json({ score: 9, summary: '좋음', issues: [], decision: 'approve' });
    return msg([text('x')]);
  }, { design: { copywriting: false } });
  const { store } = ctx;
  const p = await createInquiry(ctx, { name: 'A', email: 'a@a.kr', description: '포스터' });
  const { runDesignJob } = await import('../lib/designer.mjs');
  await runDesignJob(ctx, { projectId: p.id, instructions: '포스터', concepts: 1, baseDesignIds: [] });
  const makes = calls.filter((c) => c.kind === 'make');
  assert.equal(makes.length, 2);
  assert.match(JSON.stringify(makes[1].body.messages), /사실 오류/);
  assert.equal(calls.filter((c) => c.kind === 'review').length, 1, '틀린 시안은 AD 검수 비용을 쓰지 않음');
  const d = store.findOne('designs', (x) => x.projectId === p.id);
  assert.equal(d.passedReview, true);
  assert.ok(d.code.includes('8일(일)'));
});
