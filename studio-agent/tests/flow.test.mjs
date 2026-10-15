// 문의 → 견적 → 계약금 → 디자인 → 시안 공유 → 최종 확정 → 잔금 → 원본 공개까지 전체 흐름
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, msg, toolUse, text, json, SVG } from './helpers.mjs';
import { nextJob, runJob } from '../lib/scheduler.mjs';
import {
  createInquiry, acceptQuoteByClient, signContractByClient, workAllowed, approveDesignByClient, markInvoicePaid, canDownload, postMessage, enqueueAgent,
} from '../lib/actions.mjs';

async function drain(ctx) {
  const { store } = ctx;
  for (let i = 0; i < 30; i++) {
    // 후속 조치 예약은 건너뛰고, 고객 메시지 모으기용 지연은 무시합니다.
    for (const j of store.find('jobs', (j) => j.status === 'queued' && !j.payload.followup)) j.runAt = new Date(0).toISOString();
    const job = nextJob(store);
    if (!job) return;
    await runJob(ctx, job);
  }
  throw new Error('작업이 끝나지 않습니다');
}

function account(body) {
  const c = body.messages[0].content;
  if (body.messages.length > 1) return msg([text('처리 완료')]);
  if (c.includes('A new inquiry arrived')) {
    return msg([
      toolUse('update_project', { brief: '동네 카페 로고. 따뜻하고 미니멀하게.', service_id: 'logo', deadline: '2026-11-30' }),
      toolUse('send_quote', { line_items: [{ name: '로고 디자인', service_id: 'logo', price: 500000 }], total: 500000, timeline_days: 7, revisions_included: 2, message: '안녕하세요! 견적 보내 드립니다.' }),
    ]);
  }
  if (c.includes('accepted the quote')) {
    // 계약서 서명 전에는 청구할 수 없음 — 코드가 막는지 확인
    return msg([toolUse('send_invoice', { kind: 'deposit', amount: 250000, description: '계약금 50%', due_days: 3, message: '계약금' }), toolUse('reply_to_client', { message: '계약서 확인 부탁드립니다.' })]);
  }
  if (c.includes('signed the service contract')) {
    return msg([toolUse('send_invoice', { kind: 'deposit', amount: 250000, description: '계약금 50%', due_days: 3, message: '계약금 청구서입니다.' })]);
  }
  if (c.includes('confirmed payment') && c.includes('(deposit')) {
    return msg([toolUse('start_design_round', { instructions: '카페 로고 2안', concepts: 2 })]);
  }
  if (c.includes('design round finished')) {
    const ids = /New design ids: ([\w, ]+)\./.exec(c)[1].split(', ');
    return msg([toolUse('share_designs', { design_ids: ids, message: '시안 두 가지입니다.' })]);
  }
  if (c.includes('final approval')) {
    return msg([
      toolUse('send_invoice', { kind: 'final', amount: 250000, description: '잔금', due_days: 7, message: '잔금 청구서입니다.' }),
      toolUse('update_project', { status: 'delivered' }),
    ]);
  }
  return msg([toolUse('reply_to_client', { message: '감사합니다!' })]);
}

function respond(body, kind, i) {
  if (kind === 'account') return account(body);
  if (kind === 'directions') {
    return json({ directions: [
      { name: '따뜻한 원형', idea: '커피잔 원형', palette: ['#6b3e26'], typography: '둥근 산세리프', layout: '중앙', format: 'svg' },
      { name: '라인 아트', idea: '단선 일러스트', palette: ['#222'], typography: '세리프', layout: '좌측', format: 'svg' },
    ] });
  }
  // 시안 1은 바로 통과, 시안 2는 AD가 한 번 반려 → 디자이너가 고쳐서 통과
  if (kind === 'make') return json({ title: `시안 ${Math.min(i, 1) + 1}`, rationale: '설명', format: 'svg', code: i === 2 ? SVG.replace('Logo', 'Logo v2') : SVG });
  if (kind === 'review') return json([{ score: 9, summary: '좋음', issues: [], decision: 'approve' }, { score: 6, summary: '글자 작음', issues: ['글자를 키울 것'], decision: 'rework' }, { score: 8, summary: '좋아짐', issues: [], decision: 'approve' }][i]);
  if (kind === 'kickoff') return json({ milestones: [{ title: '1차 시안', owner: 'designer', due: '2099-01-10' }, { title: '시안 공유', owner: 'am', due: '2099-01-11' }, { title: '잔금', owner: 'finance', due: '2099-01-20' }], risks: ['피드백 지연'], kickoff_note: '시작합니다' });
  if (kind === 'retro') return json({ went_well: ['빠른 응대'], to_improve: ['일정 공유'], proposed_rules: [{ text: '킥오프 일정은 첫 답장에 같이 안내', scope: 'account' }] });
  throw new Error(`예상치 못한 호출: ${kind}`);
}

test('문의부터 정산까지 전체 흐름', async () => {
  const { ctx, calls } = makeCtx(respond);
  const { store } = ctx;

  const project = await createInquiry(ctx, { name: '김사장', email: 'Owner@Cafe.kr', company: '모모카페', serviceId: 'logo', description: '카페 로고가 필요해요' });
  await drain(ctx);

  let p = store.get('projects', project.id);
  assert.equal(p.status, 'quoted');
  assert.equal(p.serviceId, 'logo');
  assert.match(p.brief, /카페 로고/);
  const quote = store.findOne('quotes', (q) => q.projectId === p.id);
  assert.equal(quote.total, 500000);
  assert.equal(store.get('clients', p.clientId).email, 'owner@cafe.kr');

  // 시스템 프롬프트는 캐시되도록 표시되어 있어야 합니다
  const first = calls.find((c) => c.kind === 'account').body;
  assert.equal(first.system[0].cache_control.type, 'ephemeral');
  assert.equal(first.fallbacks, 'default');
  assert.ok(first.betas.includes('server-side-fallback-2026-07-01'));
  assert.equal(first.thinking, undefined);

  await acceptQuoteByClient(ctx, p, quote.id);
  await drain(ctx);
  assert.equal(store.find('invoices', () => true).length, 0, '계약서 서명 전 청구 차단');
  const contract = store.findOne('contracts', (c) => c.projectId === p.id);
  assert.equal(contract.status, 'sent');
  assert.match(contract.body, /디자인 용역 계약서/);
  assert.match(contract.body, /₩500,000/);
  assert.equal(workAllowed(store, store.get('projects', p.id)) !== null, true);
  assert.equal(await signContractByClient(ctx, p, contract.id, ''), false, '이름 없이는 서명 불가');
  assert.equal(await signContractByClient(ctx, p, contract.id, '김사장'), true);
  await drain(ctx);
  const deposit = store.findOne('invoices', (i) => i.projectId === p.id && i.kind === 'deposit');
  assert.equal(deposit.amount, 250000);
  assert.equal(store.get('projects', p.id).status, 'accepted');

  await markInvoicePaid(ctx, deposit.id);
  await drain(ctx);

  p = store.get('projects', p.id);
  const designs = store.find('designs', (d) => d.projectId === p.id);
  assert.equal(designs.length, 2);
  assert.equal(p.designRounds, 1);
  assert.ok(designs.every((d) => d.shared));
  assert.equal(p.status, 'review');
  // 킥오프: 일정 · 담당 디자이너
  assert.equal(p.plan.milestones.length, 3);
  assert.ok(p.designerId);
  assert.equal(designs[0].designerId, p.designerId);
  // AD가 반려한 두 번째 시안은 재작업본으로 바뀝니다
  assert.match(designs[1].code, /Logo v2/);
  assert.equal(designs[1].reworks, 1);
  assert.equal(designs[0].reworks, 0);
  const staffMsgs = store.find('messages', (m) => m.projectId === p.id && m.from === 'staff');
  assert.ok(staffMsgs.some((m) => /\[킥오프\]/.test(m.text)));
  assert.ok(staffMsgs.some((m) => /\[반려\]/.test(m.text)));
  assert.ok(p.plan.milestones[0].done, '디자인 라운드 후 마일스톤 완료');

  await approveDesignByClient(ctx, p, designs[0].id);
  await drain(ctx);
  p = store.get('projects', p.id);
  assert.equal(p.status, 'delivered');
  const final = store.findOne('invoices', (i) => i.projectId === p.id && i.kind === 'final');
  assert.equal(final.amount, 250000);
  assert.equal(canDownload(store, p), false, '잔금 전에는 원본을 받을 수 없음');

  await markInvoicePaid(ctx, final.id);
  await drain(ctx);
  p = store.get('projects', p.id);
  assert.equal(p.status, 'completed');
  assert.equal(canDownload(store, p), true);

  // 정산 후 PM 회고 → 학습 노트 제안
  const retro = store.findOne('reports', (r) => r.kind === 'retro');
  assert.equal(retro.proposals[0].status, 'pending');

  // 비용이 직원별로 기록됩니다
  assert.ok(store.all('usage').length > 5);
  assert.ok(store.all('usage').every((u) => u.staffId));
  assert.ok(ctx.llm.spentToday() > 0);
});

test('연달아 온 사건은 한 번의 에이전트 실행으로 모읍니다', async () => {
  const { ctx } = makeCtx((body, kind) => account(body));
  const { store } = ctx;
  const project = await createInquiry(ctx, { name: 'A', email: 'a@a.kr', description: '배너 문의입니다' });
  await postMessage(ctx, project, { from: 'client', text: '추가로 사이즈는 1080x1080' });
  enqueueAgent(store, project.id, { kind: 'client_message' }, { delayMs: 20e3 });
  const jobs = store.find('jobs', (j) => j.status === 'queued');
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].payload.events.map((e) => e.kind), ['new_inquiry', 'client_message']);
});
