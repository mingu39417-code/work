// Claude가 무엇을 하든 코드가 지키는 규칙: 최저가, 계약금, 수정 횟수, 승인 대기, 예산
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, msg, toolUse, text } from './helpers.mjs';
import { nextJob, runJob } from '../lib/scheduler.mjs';
import { createInquiry, executeAction, acceptQuoteByClient, markInvoicePaid } from '../lib/actions.mjs';

// 첫 단계에서 주어진 도구를 부르고, 도구 결과를 기록한 뒤 끝냅니다.
function scripted(firstStep) {
  const results = [];
  const respond = (body, kind) => {
    if (body.messages.length > 1) {
      const last = body.messages.at(-1).content;
      results.push(...last.filter((b) => b.type === 'tool_result').map((b) => b.content));
      return msg([text('끝')]);
    }
    return msg(firstStep);
  };
  return { respond, results };
}

async function runOnce(ctx) {
  for (const j of ctx.store.find('jobs', (j) => j.status === 'queued')) j.runAt = new Date(0).toISOString();
  const job = nextJob(ctx.store);
  if (job) await runJob(ctx, job);
}

test('최저가보다 낮은 견적은 거절됩니다', async () => {
  const s = scripted([toolUse('send_quote', { line_items: [{ name: '로고', service_id: 'logo', price: 100000 }], total: 100000, timeline_days: 5, revisions_included: 2, message: '싸게 해 드릴게요' })]);
  const { ctx } = makeCtx(s.respond);
  const p = await createInquiry(ctx, { name: 'A', email: 'a@x.kr', description: '로고 싸게 해 주세요' });
  await runOnce(ctx);
  assert.match(s.results[0], /최저가/);
  assert.equal(ctx.store.find('quotes', (q) => q.projectId === p.id).length, 0);
});

test('합계가 항목과 다르면 거절됩니다', async () => {
  const s = scripted([toolUse('send_quote', { line_items: [{ name: '로고', service_id: 'logo', price: 500000 }], total: 300000, timeline_days: 5, revisions_included: 2, message: '견적' })]);
  const { ctx } = makeCtx(s.respond);
  await createInquiry(ctx, { name: 'A', email: 'a@x.kr', description: '로고 문의' });
  await runOnce(ctx);
  assert.match(s.results[0], /합계/);
});

test('계약금 확인 전에는 디자인을 시작할 수 없습니다', async () => {
  const s = scripted([toolUse('start_design_round', { instructions: '시작', concepts: 2 })]);
  const { ctx } = makeCtx(s.respond);
  await createInquiry(ctx, { name: 'A', email: 'a@x.kr', description: '로고 문의' });
  await runOnce(ctx);
  assert.match(s.results[0], /견적을 수락하지 않았습니다/);
  assert.equal(ctx.store.find('jobs', (j) => j.kind === 'design').length, 0);
});

test('수정 횟수를 다 쓰면 추가 수정 청구를 안내합니다', async () => {
  const s = scripted([toolUse('start_design_round', { instructions: '또 수정', concepts: 1 })]);
  const { ctx } = makeCtx(s.respond, { policy: { requireDeposit: false }, company: { requireContract: false } });
  const { store } = ctx;
  const p = await createInquiry(ctx, { name: 'A', email: 'a@x.kr', description: '로고 문의' });
  const q = store.insert('quotes', { projectId: p.id, items: [], total: 500000, revisions: 1, status: 'sent' });
  await acceptQuoteByClient(ctx, p, q.id);
  store.update('projects', p.id, { designRounds: 2 });
  for (const j of store.find('jobs', () => true)) store.update('jobs', j.id, { status: 'done' });
  store.insert('jobs', { kind: 'agent', payload: { projectId: p.id, events: [{ kind: 'client_message' }] }, status: 'queued', attempts: 0, runAt: new Date(0).toISOString() });
  await runOnce(ctx);
  assert.match(s.results[0], /추가 수정/);

  // 추가 수정 청구서가 입금되면 한 번 더 할 수 있습니다
  const inv = store.insert('invoices', { projectId: p.id, kind: 'extra_revision', amount: 50000, status: 'sent' });
  await markInvoicePaid(ctx, inv.id);
  assert.equal(store.get('projects', p.id).extraRounds, 1);
});

test('승인 후 실행으로 두면 메시지가 대기열에 올라가고, 승인해야 나갑니다', async () => {
  const s = scripted([toolUse('reply_to_client', { message: '안녕하세요' })]);
  const { ctx } = makeCtx(s.respond, { autonomy: { client_reply: 'approve' } });
  const { store } = ctx;
  const p = await createInquiry(ctx, { name: 'A', email: 'a@x.kr', description: '문의합니다' });
  await runOnce(ctx);
  assert.match(s.results[0], /승인 대기열/);
  const sent = () => store.find('messages', (m) => m.projectId === p.id && m.from === 'agent' && !m.internal);
  assert.equal(sent().length, 0);
  const ap = store.findOne('approvals', (a) => a.status === 'pending');
  assert.equal(ap.category, 'client_reply');
  await executeAction(ctx, ap.action);
  assert.equal(sent().length, 1);
});

test('하루 예산을 넘으면 작업을 미루고 알립니다', async () => {
  const { ctx, calls } = makeCtx(() => msg([text('x')]), { dailyBudgetUsd: 1 });
  const { store } = ctx;
  store.insert('usage', { day: new Date().toISOString().slice(0, 10), cost: 1.5, purpose: 'x' });
  await createInquiry(ctx, { name: 'A', email: 'a@x.kr', description: '문의합니다' });
  await runOnce(ctx);
  assert.equal(calls.length, 0);
  const job = store.findOne('jobs', (j) => j.kind === 'agent');
  assert.equal(job.status, 'queued');
  assert.ok(Date.parse(job.runAt) > Date.now());
  assert.ok(store.findOne('alerts', (a) => a.code === 'BudgetError'));
});

test('자동 응대를 끄면 에이전트가 고객 메시지에 답하지 않습니다', async () => {
  const { ctx, calls } = makeCtx(() => msg([text('x')]));
  const p = await createInquiry(ctx, { name: 'A', email: 'a@x.kr', description: '문의합니다' });
  ctx.store.update('projects', p.id, { autopilot: false });
  await runOnce(ctx);
  assert.equal(calls.length, 0);
});

test('거절(refusal)은 재시도하지 않고 대표에게 알립니다', async () => {
  const { ctx } = makeCtx(() => ({ ...msg([]), stop_reason: 'refusal', stop_details: { category: 'cyber' } }));
  await createInquiry(ctx, { name: 'A', email: 'a@x.kr', description: '문의합니다' });
  await runOnce(ctx);
  const job = ctx.store.findOne('jobs', (j) => j.kind === 'agent');
  assert.equal(job.status, 'failed');
  assert.ok(ctx.store.findOne('alerts', (a) => /거절/.test(a.text)));
});
