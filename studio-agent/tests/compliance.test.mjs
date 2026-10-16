// 법적 안전장치 · Gmail 자동화 · 계정 보관함 · 연습(시뮬레이션) 모드
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeCtx, msg, toolUse, text, json, tmpDir, fakeFactory, SVG, LOGO } from './helpers.mjs';
import { mailer } from '../lib/mailer.mjs';
import { handleInbound, stripQuoted } from '../lib/inbox.mjs';
import { runSales } from '../lib/agent.mjs';
import { nextJob, runJob } from '../lib/scheduler.mjs';
import {
  createInquiry, executeAction, outreachBlocked, postMessage, markInvoicePaid, canDownload, acceptQuoteByClient, approveDesignByClient,
} from '../lib/actions.mjs';
import { createApp } from '../server.mjs';

// 실제로 보내지 않고 보낸 메일을 모읍니다.
function captureMail(t) {
  const sent = [];
  const orig = mailer.deliver;
  mailer.deliver = async (store, acct, m) => { sent.push(m); return `<m${sent.length}@test>`; };
  t.after(() => { mailer.deliver = orig; });
  return sent;
}

function addGmail(store) {
  return store.insert('accounts', { kind: 'gmail', address: 'studio@gmail.com', secret: store.vault.encrypt('abcd efgh ijkl mnop'), enabled: true, inbox: true, status: 'ok' });
}

function lead(store, extra = {}) {
  return store.insert('leads', { name: '', company: '소소베이커리', email: 'soso@bakery.kr', notes: '신규 오픈', status: 'new', agentNotes: [], basis: '', basisNote: '', optOut: false, unsubToken: 'tok123', ...extra });
}

test('동의 · 거래 근거가 없으면 영업 메일을 쓰지도 보내지도 않습니다', async (t) => {
  const sent = captureMail(t);
  const { ctx, calls } = makeCtx(() => msg([text('x')]));
  addGmail(ctx.store);
  const l = lead(ctx.store);
  assert.match(outreachBlocked(ctx.store, l), /법적 근거/);
  await runSales(ctx, { leadId: l.id });
  assert.equal(calls.length, 0, 'Claude를 부르지 않음');
  assert.equal(ctx.store.get('leads', l.id).status, 'needs_info');
  const r = await executeAction(ctx, { type: 'outreach', leadId: l.id, subject: '제안', body: '본문' });
  assert.match(r, /^실패/);
  assert.equal(sent.length, 0);

  // 기존 거래 근거도 최근 6개월 납품 기록이 있어야 인정
  ctx.store.update('leads', l.id, { basis: 'customer' });
  assert.match(outreachBlocked(ctx.store, ctx.store.get('leads', l.id)), /6개월/);
});

test('동의한 사람에게는 (광고) · 보낸 사람 · 수신거부 · AI 고지를 붙여 보내고, 거부하면 다시 못 보냅니다', async (t) => {
  const sent = captureMail(t);
  const { ctx } = makeCtx(() => msg([text('x')]), { profile: { ownerName: '임민규', studioName: 'TONECRAFT', ownerEmail: 'me@tonecraft.kr' }, publicUrl: 'https://studio.example' });
  const { store } = ctx;
  addGmail(store);
  const l = lead(store, { basis: 'consent', basisNote: '2026-10-01 행사 부스에서 서면 동의' });
  assert.equal(outreachBlocked(store, l), null);
  const r = await executeAction(ctx, { type: 'outreach', leadId: l.id, subject: '메뉴판 리뉴얼 제안', body: '안녕하세요!' });
  assert.match(r, /보냈습니다/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, '(광고) 메뉴판 리뉴얼 제안');
  assert.match(sent[0].text, /보낸 사람: TONECRAFT \(임민규\)/);
  assert.match(sent[0].text, /me@tonecraft\.kr/);
  assert.match(sent[0].text, /수신거부: https:\/\/studio\.example\/u\/tok123/);
  assert.match(sent[0].text, /생성형 AI/);
  assert.equal(sent[0].headers['List-Unsubscribe'], '<https://studio.example/u/tok123>');

  // '수신거부' 답장 → 영구 차단
  await handleInbound(ctx, { from: { value: [{ address: 'soso@bakery.kr', name: '소소' }] }, subject: 'Re: (광고) 메뉴판', text: '수신거부합니다', headers: new Map() });
  assert.equal(store.get('leads', l.id).optOut, true);
  assert.match(outreachBlocked(store, store.get('leads', l.id)), /수신거부/);
  assert.match(await executeAction(ctx, { type: 'outreach', leadId: l.id, subject: 'a', body: 'b' }), /^실패/);
});

test('문의 양식에서 마케팅 수신에 동의한 고객은 동의 근거로 인정됩니다', async () => {
  const { ctx } = makeCtx(() => msg([text('x')]));
  await createInquiry(ctx, { name: 'A', email: 'yes@x.kr', description: '문의', privacyConsent: true, marketingConsent: true });
  const l = lead(ctx.store, { email: 'yes@x.kr', basis: 'consent' });
  assert.equal(outreachBlocked(ctx.store, l), null);
});

test('Gmail: 고객 답장은 같은 프로젝트로, 처음 보는 메일은 새 문의로, 자동 메일은 무시', async (t) => {
  const sent = captureMail(t);
  const { ctx } = makeCtx(() => msg([text('x')]));
  const { store } = ctx;
  addGmail(store);
  const p = await createInquiry(ctx, { name: '김', email: 'kim@x.kr', description: '로고 문의' });
  await postMessage(ctx, p, { from: 'agent', text: '안녕하세요' });
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, new RegExp(`\\[${p.ref}\\]`));
  assert.match(sent[0].text, /생성형 AI/);
  const out = store.find('messages', (m) => m.projectId === p.id && m.from === 'agent').at(-1);
  assert.equal(out.emailId, '<m1@test>');

  // 답장 (인용문은 잘라 냄)
  const r1 = await handleInbound(ctx, { from: { value: [{ address: 'KIM@x.kr' }] }, subject: 'Re: 새 메시지', inReplyTo: '<m1@test>', messageId: '<r1@x>', text: '좋아요 진행해 주세요\n\n2026년 10월 14일 (화) 오후 3:00, 스튜디오 작성:\n> 안녕하세요', headers: new Map() });
  assert.equal(r1, 'reply');
  const last = store.find('messages', (m) => m.projectId === p.id).at(-1);
  assert.equal(last.text, '좋아요 진행해 주세요');
  // 다음 발송은 같은 스레드로
  await postMessage(ctx, p, { from: 'agent', text: '네!' });
  assert.equal(sent[1].inReplyTo, '<r1@x>');

  assert.equal(await handleInbound(ctx, { from: { value: [{ address: 'new@y.kr', name: '새고객' }] }, subject: '배너 문의', text: '배너 만들어 주세요', headers: new Map() }), 'inquiry');
  assert.ok(store.findOne('clients', (c) => c.email === 'new@y.kr'));
  assert.equal(await handleInbound(ctx, { from: { value: [{ address: 'noreply@bank.com' }] }, subject: '알림', text: 'x', headers: new Map() }), 'ignored');
  assert.equal(await handleInbound(ctx, { from: { value: [{ address: 'x@news.com' }] }, subject: '뉴스', text: 'x', headers: new Map([['list-id', 'news']]) }), 'ignored');
  assert.equal(await handleInbound(ctx, { from: { value: [{ address: 'studio@gmail.com' }] }, subject: '내가 보낸 것', text: 'x', headers: new Map() }), 'own');
  assert.equal(stripQuoted('네\nOn Tue, Oct 14 wrote:\n> old'), '네');
});

test('정산이 끝나야 원본을 받을 수 있고, 납품 파일(SVG · PNG ZIP)이 준비되면 메일로 갑니다', async (t) => {
  const sent = captureMail(t);
  const { ctx, calls } = makeCtx((body, kind) => kind === 'final'
    ? json({ files: [
      { name: 'momo-symbol', purpose: '심볼 단독', svg: LOGO },
      { name: 'broken', purpose: '깨진 파일', svg: '<svg>' },
      { name: 'empty', purpose: '빈 파일', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"></svg>' },
    ], notes: '간판에는 SVG를 쓰세요.' })
    : msg([text('x')]), { policy: { requireDeposit: false } });
  const { store } = ctx;
  addGmail(store);
  const p = await createInquiry(ctx, { name: '김', email: 'kim@x.kr', description: '로고' });
  const q = store.insert('quotes', { projectId: p.id, items: [], total: 500000, revisions: 2, status: 'sent' });
  await acceptQuoteByClient(ctx, p, q.id);
  const d = store.insert('designs', { projectId: p.id, round: 1, title: '시안 A', rationale: '', format: 'svg', code: SVG, shared: true, review: { score: 8, issues: ['칩 간격 맞추기'] } });
  await approveDesignByClient(ctx, store.get('projects', p.id), d.id);
  const job = store.findOne('jobs', (j) => j.kind === 'final_files' && j.status === 'queued');
  assert.ok(job, '확정과 동시에 납품 파일 작업이 예약됨');
  store.update('projects', p.id, { status: 'delivered' });
  assert.equal(canDownload(store, store.get('projects', p.id)), false, '청구 전에는 불가');

  // 잔금이 먼저 들어와도 파일이 준비되기 전에는 메일을 보내지 않습니다
  const inv = store.insert('invoices', { projectId: p.id, kind: 'final', amount: 500000, status: 'sent' });
  await markInvoicePaid(ctx, inv.id);
  assert.equal(store.get('projects', p.id).status, 'completed');
  assert.equal(canDownload(store, store.get('projects', p.id)), true);
  assert.equal(sent.filter((m) => /최종 파일 납품/.test(m.subject)).length, 0);

  // 디자이너가 납품 파일을 만들면 — 깨진 파일 · 빈 파일은 걸러지고, 고객에게 알림 + ZIP 메일
  await runJob(ctx, job);
  const final = calls.find((c) => c.kind === 'final');
  assert.match(JSON.stringify(final.body.messages), /칩 간격 맞추기/, 'AD 마감 지적을 함께 전달');
  const ready = store.get('designs', d.id);
  assert.equal(ready.finalStatus, 'ready');
  assert.deepEqual(ready.finalFiles.map((x) => x.name), ['momo-symbol']);
  assert.equal(ready.finalRejected.length, 2);
  const delivery = sent.find((m) => /최종 파일 납품/.test(m.subject));
  assert.equal(delivery.attachments.length, 1);
  assert.equal(delivery.attachments[0].filename, '시안_A.zip');
  const z = delivery.attachments[0].content;
  assert.equal(z.readUInt32LE(0), 0x04034b50, 'ZIP 파일');
  for (const name of ['SVG/momo-symbol.svg', 'PNG/momo-symbol_512px.png', 'PNG/momo-symbol_2048px.png', 'README.txt', 'presentation/시안_A.svg']) {
    assert.ok(z.includes(Buffer.from(name)), `ZIP에 ${name}`);
  }
  assert.ok(store.find('messages', (m) => m.projectId === p.id && /납품 파일이 준비되었습니다/.test(m.text)).length);
  // 한 번만 보냅니다
  const { emailDelivery } = await import('../lib/finals.mjs');
  assert.equal((await emailDelivery(ctx, store.get('projects', p.id))).sent, false);
});

test('납품 파일 검사: 렌더링 · 빈 파일 · 외부 자원 · PNG 변환', async () => {
  const { checkFinalSvg, renderPng, zip } = await import('../lib/finals.mjs');
  assert.equal(checkFinalSvg(LOGO), null);
  assert.match(checkFinalSvg('<svg></svg>'), /viewBox/);
  assert.match(checkFinalSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"></svg>'), /빈 파일/);
  assert.match(checkFinalSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="https://x.com/a.png" width="10" height="10"/></svg>'), /외부/);
  const { png, width } = renderPng(LOGO, 512);
  assert.equal(width, 512);
  assert.equal(png.readUInt32BE(0), 0x89504e47, 'PNG 파일');
  const z = zip([{ name: '한글.txt', data: Buffer.from('안녕') }]);
  assert.equal(z.readUInt32LE(z.length - 22), 0x06054b50, 'ZIP 끝 레코드');
});

test('계정 비밀번호는 암호화되어 저장되고 화면에 다시 나오지 않습니다', async (t) => {
  const fake = fakeFactory(() => msg([text('ok')]));
  const dir = tmpDir();
  const app = createApp({ dataDir: dir, llmFactory: fake.factory, startWorker: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const res = await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'long password' }) });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const api = (p, method = 'GET', body) => fetch(base + p, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });

  const created = await (await api('/api/accounts', 'POST', { kind: 'gmail', address: 'Studio@Gmail.com', password: 'abcd efgh ijkl mnop' })).json();
  assert.equal(created.address, 'studio@gmail.com');
  assert.equal(created.secret, undefined);
  assert.equal(created.hasSecret, true);
  const list = await (await api('/api/accounts')).json();
  assert.ok(!JSON.stringify(list).includes('abcd'));
  const db = fs.readFileSync(path.join(dir, 'db.json'), 'utf8');
  assert.ok(!db.includes('abcd efgh') && !db.includes('abcdefgh'), 'db.json에 평문 없음');
  assert.equal(app.ctx.store.vault.decrypt(app.ctx.store.all('accounts')[0].secret), 'abcdefghijklmnop');
  assert.equal((await api('/api/accounts', 'POST', { kind: 'instagram', address: 'x', password: 'yyyyyyyy' })).status, 400);
  // Google 계정 비밀번호처럼 보이는 값은 등록 단계에서 거절하고 앱 비밀번호 안내를 보여 줍니다
  const wrong = await api('/api/accounts', 'POST', { kind: 'gmail', address: 'other@gmail.com', password: 'MyGoogle!Pass123' });
  assert.equal(wrong.status, 400);
  assert.match((await wrong.json()).error, /앱 비밀번호/);
  const id = app.ctx.store.all('accounts')[0].id;
  assert.equal((await api(`/api/accounts/${id}`, 'PATCH', { password: 'not-an-app-password' })).status, 400);
  assert.equal((await api(`/api/accounts/${id}`, 'PATCH', { password: 'WXYZ wxyz WXYZ wxyz' })).status, 200);
  assert.equal(app.ctx.store.vault.decrypt(app.ctx.store.get('accounts', id).secret), 'wxyzwxyzwxyzwxyz');

  // 수신거부 링크
  const l = app.ctx.store.insert('leads', { email: 'a@b.kr', unsubToken: 'zzz', basis: 'consent', basisNote: '서면 동의 받음', optOut: false });
  assert.equal((await fetch(`${base}/u/zzz`)).status, 200);
  assert.equal((await fetch(`${base}/api/public/unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'zzz' }) })).status, 200);
  assert.equal(app.ctx.store.get('leads', l.id).optOut, true);
  assert.equal((await fetch(`${base}/privacy`)).status, 200);
});

test('연습: 메일 없이 실제처럼 진행되고, 코칭 피드백은 학습 노트로 저장되어 이후 지시문에 들어갑니다', async (t) => {
  const sent = captureMail(t);
  const prompts = [];
  const fake = fakeFactory((body, kind) => {
    prompts.push(body.system[0].text);
    if (body.messages.length > 1) return msg([text('완료')]);
    return msg([toolUse('reply_to_client', { message: '안녕하세요, 연습 응답입니다' })]);
  });
  const app = createApp({ dataDir: tmpDir(), llmFactory: fake.factory, startWorker: false });
  t.after(() => app.close());
  const { ctx } = app;
  const { store } = ctx;
  store.updateSettings({ apiKey: 'sk-test' });
  addGmail(store);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const res = await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'long password' }) });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const api = (p, method = 'GET', body) => fetch(base + p, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });

  const sim = await (await api('/api/sim', 'POST', { name: '연습 카페', description: '카페 로고 만들어 주세요', serviceId: 'logo' })).json();
  const run = async () => { for (const j of store.find('jobs', (j) => j.status === 'queued')) j.runAt = new Date(0).toISOString(); const j = nextJob(store); if (j) await runJob(ctx, j); };
  await run();
  const p = store.get('projects', sim.id);
  assert.equal(p.simulation, true);
  assert.match(p.title, /^\[연습\]/);
  assert.equal(sent.length, 0, '연습은 메일을 보내지 않음');
  assert.match(prompts[0], /SIMULATION/);
  assert.ok(store.find('messages', (m) => m.projectId === p.id && m.from === 'agent' && !m.internal).length);

  // 실제 목록 · 매출에서 빠짐
  assert.equal((await (await api('/api/projects')).json()).length, 0);
  assert.equal((await (await api('/api/projects?sim=1')).json()).length, 1);

  // 코칭
  const lesson = await (await api(`/api/projects/${p.id}/coach`, 'POST', { text: '첫 답장에서 예산을 먼저 묻지 말고 용도부터 물어볼 것', scope: 'account', target: '마지막 답장' })).json();
  assert.equal(lesson.active, true);
  const job = store.findOne('jobs', (j) => j.status === 'queued' && j.payload.projectId === p.id);
  assert.equal(job.payload.events[0].kind, 'coaching');
  await run();
  assert.match(prompts.at(-1), /용도부터 물어볼 것/);
  assert.match(prompts.at(-1), /Owner's coaching/);

  // 끄면 지시문에서 빠짐
  await api(`/api/lessons/${lesson.id}`, 'PATCH', { active: false });
  await api(`/api/projects/${p.id}/instruct`, 'POST', { text: '다시' });
  await run();
  assert.doesNotMatch(prompts.at(-1), /용도부터 물어볼 것/);
});

test('Gmail 로그인 거부를 알아보고 한국어로 안내합니다(이때 받은편지함 자동 확인은 멈춤)', async () => {
  const { isAuthError, explainMailError, checkAppPassword } = await import('../lib/mailer.mjs');
  const smtp = new Error('Invalid login: 535-5.7.8 Username and Password not accepted.');
  const imap = Object.assign(new Error('Command failed'), { authenticationFailed: true });
  assert.ok(isAuthError(smtp) && isAuthError(imap));
  assert.ok(!isAuthError(new Error('getaddrinfo ENOTFOUND imap.gmail.com')));
  assert.match(explainMailError(imap), /앱 비밀번호/);
  assert.match(explainMailError(new Error('getaddrinfo ENOTFOUND imap.gmail.com')), /인터넷 연결/);
  assert.equal(checkAppPassword('abcd efgh ijkl mnop'), null);
  assert.match(checkAppPassword('MyGoogle!Pass123'), /앱 비밀번호/);
});

test('Gmail 연결이 시간 초과돼도 프로그램이 꺼지지 않습니다', async () => {
  const { imapClient } = await import('../lib/mailer.mjs');
  const { ImapFlow } = await import('imapflow');
  const { ctx } = makeCtx(() => msg([text('x')]));
  const { store } = ctx;
  addGmail(store);
  const c = imapClient(store, store.all('accounts')[0], ImapFlow);
  // 예전에는 이 'error' 이벤트를 받는 곳이 없어 Node가 프로세스를 종료했습니다
  assert.doesNotThrow(() => c.emit('error', Object.assign(new Error('Socket timeout'), { code: 'ETIMEOUT' })));
  assert.ok(store.all('activity').some((a) => /Socket timeout/.test(a.text)));
});

test('인스타그램 · 뉴스레터 같은 자동 알림 메일은 새 문의로 만들지 않고, 사람 고객 메일은 그대로 받습니다', async () => {
  const { ctx } = makeCtx(() => msg([text('x')]));
  const { store } = ctx;
  addGmail(store);
  const mail = (address, extra = new Map()) => ({ from: { value: [{ address, name: 'x' }] }, subject: '안녕하세요', text: '내용', headers: extra });
  assert.equal(await handleInbound(ctx, mail('stories-recap@mail.instagram.com')), 'ignored');
  assert.equal(await handleInbound(ctx, mail('security@facebookmail.com')), 'ignored');
  assert.equal(await handleInbound(ctx, mail('shop@brand.kr', new Map([['list-unsubscribe', '<mailto:u@brand.kr>']]))), 'ignored');
  assert.equal(await handleInbound(ctx, mail('donotreply@bank.co.kr')), 'ignored');
  assert.equal(await handleInbound(ctx, mail('info@cafe-momo.kr')), 'inquiry', 'info@ 같은 실제 가게 주소는 문의로 받음');
  assert.equal(store.find('projects', () => true).length, 1);
});
