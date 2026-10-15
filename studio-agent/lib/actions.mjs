// 업무 동작 — 에이전트 도구, 승인 대기열, 고객 포털, 대시보드가 모두 이 함수들로 같은 일을 합니다.
// 가격 하한 · 계약금 · 수정 횟수 같은 규칙은 Claude가 아니라 이 코드가 강제합니다.

import { mailer } from './mailer.mjs';
import crypto from 'node:crypto';
import { renderContract } from './contract.mjs';
import { assign, projectStaff } from './staff.mjs';

export const STATUSES = {
  inquiry: '문의',
  quoted: '견적 발송',
  accepted: '견적 수락',
  in_progress: '작업 중',
  review: '시안 검토 중',
  revision: '수정 중',
  delivered: '납품 완료',
  completed: '정산 완료',
  lost: '무산',
  on_hold: '보류',
};

export const ACTIVE_STATUSES = ['inquiry', 'quoted', 'accepted', 'in_progress', 'review', 'revision', 'delivered', 'on_hold'];

export const AUTONOMY_LABELS = {
  client_reply: '고객 답장',
  quote: '견적 발송',
  delivery: '시안 · 결과물 공유',
  invoice: '청구서 발송',
  outreach: '영업 메일 (신규 고객 발굴)',
};

export function studioName(settings) {
  const p = settings.profile;
  return p.studioName || p.ownerName || '디자인 스튜디오';
}

export function portalUrl(settings, project) {
  return `${settings.publicUrl.replace(/\/$/, '')}/p/${project.portalToken}`;
}

export function money(settings, n) {
  const cur = settings.policy.currency || 'KRW';
  try {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: cur, maximumFractionDigits: cur === 'KRW' ? 0 : 2 }).format(n);
  } catch {
    return `${n} ${cur}`;
  }
}

// ── 작업 대기열 ────────────────────────────────────────────────
// dedupe가 있으면 같은 키의 대기 작업이 이미 있을 때 새로 만들지 않습니다
// (고객이 메시지를 연달아 보내도 답장은 한 번에 모아서 하도록).
export function enqueue(store, kind, payload = {}, { delayMs = 0, dedupe = null } = {}) {
  if (dedupe) {
    const existing = store.findOne('jobs', (j) => j.status === 'queued' && j.dedupe === dedupe);
    if (existing) return existing;
  }
  return store.insert('jobs', {
    kind,
    payload,
    dedupe,
    status: 'queued',
    attempts: 0,
    runAt: new Date(Date.now() + delayMs).toISOString(),
  });
}

// 에이전트 작업은 프로젝트당 하나로 모읍니다. 대기 중인 작업이 있으면 사건만 덧붙입니다.
export function enqueueAgent(store, projectId, event, { delayMs = 0 } = {}) {
  const existing = store.findOne('jobs', (j) => j.status === 'queued' && j.kind === 'agent' && j.payload.projectId === projectId);
  if (existing) {
    const events = [...existing.payload.events, event];
    return store.update('jobs', existing.id, { payload: { ...existing.payload, events } });
  }
  return enqueue(store, 'agent', { projectId, events: [event] }, { delayMs });
}

// ── 메시지 ────────────────────────────────────────────────────
// 인공지능기본법(투명성 의무)에 따라 고객에게 생성형 AI 사용을 알립니다.
export function aiNotice(settings) {
  const who = settings.profile.ownerName || studioName(settings);
  return `※ ${studioName(settings)}는 고객 응대와 디자인 시안 제작에 생성형 AI(Anthropic Claude)를 사용하며, ${who}가 운영 · 검수합니다.`;
}

export function emailSubject(settings, project, suffix) {
  return `[${studioName(settings)}] ${project.title || '프로젝트'} — ${suffix} [${project.ref}]`;
}

// 이 프로젝트에서 주고받은 마지막 메일 — 답장이 같은 메일 스레드로 이어지게 합니다.
function threadHeaders(store, project) {
  const ids = store.find('messages', (m) => m.projectId === project.id && m.emailId).map((m) => m.emailId);
  return ids.length ? { inReplyTo: ids.at(-1), references: ids.slice(-10) } : {};
}

export async function emailClient(ctx, project, { subject, text, attachments }) {
  const { store } = ctx;
  if (project.simulation) return { sent: false, reason: '연습 프로젝트' };
  const client = store.get('clients', project.clientId);
  const s = store.settings;
  const body = `${text}\n\n— ${studioName(s)}\n\n대화 · 시안 · 견적 확인: ${portalUrl(s, project)}\n이 메일에 바로 답장하셔도 됩니다.\n\n${aiNotice(s)}`;
  return mailer.send(store, { to: client?.email, subject, text: body, attachments, ...threadHeaders(store, project) });
}

export async function postMessage(ctx, project, { from, text, internal = false, designIds, quoteId, invoiceId, attachments, emailId, staffId }) {
  const { store } = ctx;
  const msg = store.insert('messages', {
    projectId: project.id,
    from,
    text: String(text ?? ''),
    internal,
    designIds: designIds ?? [],
    quoteId: quoteId ?? null,
    invoiceId: invoiceId ?? null,
    attachments: attachments ?? [],
    emailId: emailId ?? null,
    // 고객 응대 메시지는 담당 AM 이름으로 기록됩니다.
    staffId: staffId ?? (from === 'agent' ? projectStaff(store, store.get('projects', project.id) ?? project, 'am')?.id ?? null : null),
  });
  store.update('projects', project.id, { lastMessageAt: msg.createdAt });

  // 고객에게 보이는 스튜디오 쪽 메시지는 이메일로도 보냅니다(Gmail 등록 시, 연습 프로젝트 제외).
  if (!internal && (from === 'agent' || from === 'owner')) {
    try {
      const r = await emailClient(ctx, project, { subject: emailSubject(store.settings, project, '새 메시지'), text });
      if (r.sent) store.update('messages', msg.id, { emailed: true, emailId: r.messageId ?? null });
    } catch (err) {
      store.log('error', `이메일 발송 실패: ${err.message}`, { projectId: project.id });
    }
  }
  return msg;
}

// ── 문의 접수 ──────────────────────────────────────────────────
export async function createInquiry(ctx, input) {
  const { store } = ctx;
  const email = String(input.email ?? '').trim().toLowerCase();
  const sim = Boolean(input.simulation);
  // 연습 고객은 실제 고객과 섞이지 않게 따로 만듭니다.
  let client = email && !sim ? store.findOne('clients', (c) => c.email === email && !c.simulation) : null;
  if (!client) {
    client = store.insert('clients', {
      name: String(input.name ?? '').trim() || '이름 미상',
      email: sim ? '' : email,
      company: String(input.company ?? '').trim(),
      phone: String(input.phone ?? '').trim(),
      notes: [],
      source: input.source ?? 'website',
      simulation: sim,
    });
  }
  const now = new Date().toISOString();
  if (input.privacyConsent) store.update('clients', client.id, { privacyConsentAt: now });
  if (input.marketingConsent) store.update('clients', client.id, { marketingConsent: { at: now, source: input.source ?? 'website' }, marketingOptOut: false });
  const service = store.settings.services.find((s) => s.id === input.serviceId);
  const project = store.insert('projects', {
    clientId: client.id,
    title: String(input.title ?? '').trim() || `${client.company || client.name} — ${service?.name ?? '디자인 문의'}`,
    serviceId: service?.id ?? null,
    status: 'inquiry',
    brief: '',
    budget: String(input.budget ?? '').trim(),
    deadline: String(input.deadline ?? '').trim(),
    autopilot: true,
    designRounds: 0,
    extraRounds: 0,
    portalToken: crypto.randomBytes(16).toString('base64url'),
    ref: `P-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    source: input.source ?? 'website',
    simulation: sim,
  });
  // 담당 AM 배정 (전문 서비스 · 업무량 기준)
  const am = assign(store, 'am', project);
  if (am) store.update('projects', project.id, { amId: am.id });
  const lines = [
    input.description && String(input.description).trim(),
    service && `희망 서비스: ${service.name}`,
    project.budget && `예산: ${project.budget}`,
    project.deadline && `희망 일정: ${project.deadline}`,
  ].filter(Boolean);
  await postMessage(ctx, project, { from: 'client', text: lines.join('\n') || '(내용 없음)', attachments: input.attachments });
  store.log('inquiry', `새 문의: ${project.title}`, { projectId: project.id });
  enqueueAgent(store, project.id, { kind: 'new_inquiry' });
  return project;
}

// ── 규칙 검사 ──────────────────────────────────────────────────
export function validateQuote(settings, input) {
  const items = Array.isArray(input.line_items) ? input.line_items : [];
  if (!items.length) return '견적 항목(line_items)이 비어 있습니다.';
  for (const it of items) {
    const price = Number(it.price);
    if (!Number.isFinite(price) || price < 0) return `잘못된 금액: ${it.name}`;
    if (it.service_id) {
      const svc = settings.services.find((s) => s.id === it.service_id);
      if (!svc) return `없는 서비스 id: ${it.service_id}. 사용 가능: ${settings.services.map((s) => s.id).join(', ')}`;
      if (price < svc.minPrice) {
        return `'${svc.name}' 금액 ${price}은 최저가 ${svc.minPrice}보다 낮아 보낼 수 없습니다. 최저가 이상으로 다시 제안하거나, 더 낮춰야 한다면 escalate_to_owner로 대표에게 넘기세요.`;
      }
    }
  }
  const sum = items.reduce((s, it) => s + Number(it.price), 0);
  if (Math.abs(sum - Number(input.total)) > 1) return `total(${input.total})이 항목 합계(${sum})와 다릅니다.`;
  if (sum <= 0) return '견적 합계가 0입니다.';
  return null;
}

export function acceptedQuote(store, project) {
  return store.find('quotes', (q) => q.projectId === project.id && q.status === 'accepted').at(-1) ?? null;
}

export function depositPaid(store, project) {
  return store.find('invoices', (i) => i.projectId === project.id && i.kind === 'deposit' && i.status === 'paid').length > 0;
}

export function workAllowed(store, project) {
  // 연습 프로젝트는 디자인 연습에 집중하도록 견적 · 계약금 없이도 작업할 수 있습니다.
  if (project.simulation) return null;
  if (!acceptedQuote(store, project)) return '고객이 아직 견적을 수락하지 않았습니다.';
  if (contractPending(store, project)) return '고객이 아직 계약서에 서명하지 않았습니다.';
  if (store.settings.policy.requireDeposit && !depositPaid(store, project)) {
    return '계약금 입금이 확인되지 않았습니다. 계약금 청구서를 보내고 대표가 입금을 확인하면 작업을 시작할 수 있습니다.';
  }
  return null;
}

// ── 계약서 ────────────────────────────────────────────────────
export function contractOf(store, project) {
  return store.find('contracts', (c) => c.projectId === project.id && c.status !== 'void').at(-1) ?? null;
}

// 계약서가 필요한데 아직 서명되지 않았으면 true
export function contractPending(store, project) {
  if (project.simulation || !store.settings.company.requireContract) return false;
  return contractOf(store, project)?.status !== 'signed';
}

export async function signContractByClient(ctx, project, contractId, signerName) {
  const { store } = ctx;
  const c = store.get('contracts', contractId);
  const name = String(signerName ?? '').trim();
  if (!c || c.projectId !== project.id || c.status !== 'sent' || name.length < 2) return false;
  store.update('contracts', c.id, { status: 'signed', signerName: name.slice(0, 60), signedAt: new Date().toISOString() });
  await postMessage(ctx, project, { from: 'system', text: `고객(${name})이 계약서에 동의 · 서명했습니다.` });
  store.log('deal', `계약 체결 — ${project.title}`, { projectId: project.id });
  enqueueAgent(store, project.id, { kind: 'contract_signed', contractId: c.id });
  return true;
}

export function roundLimit(store, project) {
  const q = acceptedQuote(store, project);
  const revisions = q?.revisions ?? 2;
  return 1 + revisions + (project.extraRounds ?? 0);
}

// 견적 밖에서 따로 받는 비용(추가 작업, 추가 수정)
export const EXTRA_KINDS = ['extra', 'extra_revision'];

export function invoiceRemaining(store, project) {
  const q = acceptedQuote(store, project);
  if (!q) return 0;
  const billed = store
    .find('invoices', (i) => i.projectId === project.id && i.status !== 'cancelled' && !EXTRA_KINDS.includes(i.kind))
    .reduce((s, i) => s + i.amount, 0);
  return q.total - billed;
}

export function validateInvoice(store, project, input) {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return '청구 금액이 올바르지 않습니다.';
  if (EXTRA_KINDS.includes(input.kind)) return null;
  if (contractPending(store, project)) return '계약서 서명이 끝난 뒤에 청구할 수 있습니다.';
  const q = acceptedQuote(store, project);
  if (!q) return '수락된 견적이 없어 청구할 수 없습니다. 견적 밖 추가 비용이면 kind를 extra 또는 extra_revision으로 하세요.';
  const remaining = invoiceRemaining(store, project);
  if (amount > remaining + 1) return `남은 청구 가능 금액(${remaining})보다 큽니다.`;
  return null;
}

export function canDownload(store, project) {
  // 정산 완료(견적 전액 청구 + 모두 입금)된 프로젝트만 원본을 받을 수 있습니다.
  return project.status === 'completed';
}

// ── 승인이 필요할 수 있는 동작 실행 ─────────────────────────────
// action = { type, projectId?, leadId?, ...내용 }
export async function executeAction(ctx, action) {
  const { store } = ctx;
  const s = store.settings;
  const project = action.projectId ? store.get('projects', action.projectId) : null;

  switch (action.type) {
    case 'client_message': {
      const m = await postMessage(ctx, project, { from: 'agent', text: action.message });
      store.log('message', `고객에게 답장: ${short(action.message)}`, { projectId: project.id });
      return `보냈습니다 (메시지 ${m.id}).`;
    }

    case 'quote': {
      const err = validateQuote(s, action);
      if (err) return `실패: ${err}`;
      // 이전에 보낸 견적은 새 견적으로 대체됩니다.
      for (const old of store.find('quotes', (q) => q.projectId === project.id && q.status === 'sent')) {
        store.update('quotes', old.id, { status: 'superseded' });
      }
      const quote = store.insert('quotes', {
        projectId: project.id,
        items: action.line_items.map((it) => ({ name: it.name, serviceId: it.service_id ?? null, price: Number(it.price), description: it.description ?? '' })),
        total: Number(action.total),
        timelineDays: Number(action.timeline_days) || null,
        revisions: Number.isFinite(Number(action.revisions_included)) ? Number(action.revisions_included) : 2,
        terms: action.terms ?? '',
        status: 'sent',
      });
      store.update('projects', project.id, { status: 'quoted' });
      await postMessage(ctx, project, { from: 'agent', text: action.message, quoteId: quote.id });
      store.log('quote', `견적 발송 ${money(s, quote.total)} — ${project.title}`, { projectId: project.id });
      return `견적 ${quote.id}을 보냈습니다. 고객이 포털에서 '견적 수락'을 누르면 알려 드립니다.`;
    }

    case 'share_designs': {
      const ids = (action.design_ids ?? []).filter((id) => store.get('designs', id)?.projectId === project.id);
      if (!ids.length) return '실패: 공유할 시안 id가 이 프로젝트에 없습니다.';
      for (const id of ids) store.update('designs', id, { shared: true, sharedAt: new Date().toISOString() });
      if (['in_progress', 'revision'].includes(project.status)) store.update('projects', project.id, { status: 'review' });
      await postMessage(ctx, project, { from: 'agent', text: action.message, designIds: ids });
      store.log('delivery', `시안 ${ids.length}개 공유 — ${project.title}`, { projectId: project.id });
      return `시안 ${ids.length}개를 공유했습니다.`;
    }

    case 'invoice': {
      const err = validateInvoice(store, project, action);
      if (err) return `실패: ${err}`;
      const inv = store.insert('invoices', {
        projectId: project.id,
        kind: action.kind ?? 'final',
        amount: Number(action.amount),
        description: action.description ?? '',
        dueDate: new Date(Date.now() + (Number(action.due_days) || 7) * 864e5).toISOString().slice(0, 10),
        status: 'sent',
      });
      const pay = s.policy.paymentInfo ? `\n\n입금 안내: ${s.policy.paymentInfo}` : '';
      await postMessage(ctx, project, { from: 'agent', text: `${action.message}${pay}`, invoiceId: inv.id });
      store.log('invoice', `청구서 발송 ${money(s, inv.amount)} (${inv.kind}) — ${project.title}`, { projectId: project.id });
      return `청구서 ${inv.id}을 보냈습니다. 입금 확인은 대표가 대시보드에서 합니다.`;
    }

    case 'outreach': {
      const lead = store.get('leads', action.leadId);
      if (!lead) return '실패: 리드를 찾을 수 없습니다.';
      const blocked = outreachBlocked(store, lead);
      if (blocked) return `실패: ${blocked}`;
      const today = new Date().toISOString().slice(0, 10);
      const sentToday = store.find('leads', (l) => l.lastOutreach?.emailed && l.lastOutreach.at.startsWith(today)).length;
      if (sentToday >= (Number(s.policy.outreachDailyLimit) || 20)) return '실패: 오늘 영업 메일 한도를 다 썼습니다. 내일 다시 승인해 주세요.';
      const ad = adMessage(s, lead, action);
      let sent = false;
      try {
        const r = await mailer.send(store, { to: lead.email, subject: ad.subject, text: ad.body, headers: { 'List-Unsubscribe': `<${ad.unsubscribeUrl}>` } });
        sent = r.sent;
      } catch (err) {
        store.log('error', `영업 메일 발송 실패: ${err.message}`, { leadId: lead.id });
      }
      store.update('leads', lead.id, {
        status: 'contacted',
        lastOutreach: { subject: ad.subject, body: ad.body, at: new Date().toISOString(), emailed: sent },
      });
      store.log('outreach', `${sent ? '영업 메일 발송' : '영업 메시지 준비(직접 보내기)'}: ${lead.company || lead.name}`, { leadId: lead.id });
      return sent ? '이메일로 보냈습니다.' : 'Gmail이 등록되지 않아 직접 보낼 수 있도록 대시보드에 저장했습니다.';
    }

    default:
      return `알 수 없는 동작: ${action.type}`;
  }
}

// ── 영업 메일의 법적 요건 (정보통신망법 제50조) ───────────────────────
// 광고성 이메일은 ① 수신자의 사전 동의가 있거나 ② 최근 6개월 안에 거래한 고객에게
// 같은 종류의 서비스를 알리는 경우에만 보낼 수 있습니다. 보낼 때는 제목에 (광고),
// 본문에 보낸 사람 이름 · 연락처와 수신거부 방법을 넣어야 하고, 거부하면 다시 보내면 안 됩니다.
export const OUTREACH_BASIS = {
  consent: '수신 동의를 받음',
  customer: '최근 6개월 안에 거래한 고객',
};

export function isOptedOut(store, email) {
  const e = String(email ?? '').toLowerCase();
  if (!e) return false;
  return store.all('leads').some((l) => l.email === e && l.optOut) || store.all('clients').some((c) => c.email === e && c.marketingOptOut);
}

export function outreachBlocked(store, lead) {
  if (!lead.email) return '이메일 주소가 없습니다.';
  if (isOptedOut(store, lead.email)) return '수신거부한 주소입니다. 다시 보낼 수 없습니다.';
  if (lead.basis === 'consent') {
    const client = store.findOne('clients', (c) => c.email === lead.email && c.marketingConsent && !c.marketingOptOut);
    if (!client && String(lead.basisNote ?? '').trim().length < 5) return '수신 동의를 받은 근거(언제 · 어떻게)를 리드 메모의 "동의 근거"에 적어야 보낼 수 있습니다.';
    return null;
  }
  if (lead.basis === 'customer') {
    const since = Date.now() - 183 * 864e5;
    const client = store.findOne('clients', (c) => c.email === lead.email && !c.simulation);
    const recent = client && store.find('projects', (p) => p.clientId === client.id && ['completed', 'delivered'].includes(p.status) && Date.parse(p.updatedAt) >= since).length;
    if (!recent) return '최근 6개월 안에 거래(납품 완료)한 기록이 이 주소에 없습니다. 수신 동의를 받은 경우에만 보낼 수 있습니다.';
    return null;
  }
  return '광고성 메일을 보낼 법적 근거(수신 동의 또는 최근 6개월 거래)가 없습니다. 동의 없는 영업 메일은 정보통신망법 위반이라 보내지 않습니다.';
}

export function adMessage(settings, lead, { subject, body }) {
  const p = settings.profile;
  const unsubscribeUrl = `${settings.publicUrl.replace(/\/$/, '')}/u/${lead.unsubToken}`;
  const contact = [p.ownerEmail, settings.policy.businessInfo].filter(Boolean).join(' · ');
  const subj = String(subject).replace(/^\s*\(광고\)\s*/, '');
  return {
    subject: `(광고) ${subj}`,
    unsubscribeUrl,
    body: `${body}

—
보낸 사람: ${studioName(settings)}${p.ownerName ? ` (${p.ownerName})` : ''}${contact ? `\n연락처: ${contact}` : ''}
이 메일은 ${OUTREACH_BASIS[lead.basis] ?? '수신 동의'}에 따라 보내 드렸습니다.
수신거부: ${unsubscribeUrl}  (또는 이 메일에 '수신거부'라고 답장해 주세요)
${aiNotice(settings)}`,
  };
}

// 자율 설정에 따라 바로 실행하거나 승인 대기열에 넣습니다.
export async function gated(ctx, category, action, summary) {
  const { store } = ctx;
  const mode = store.settings.autonomy[category] ?? 'approve';
  if (mode === 'auto') return executeAction(ctx, action);
  const ap = store.insert('approvals', {
    category,
    action,
    summary,
    status: 'pending',
    projectId: action.projectId ?? null,
    leadId: action.leadId ?? null,
  });
  store.log('approval', `승인 대기: ${AUTONOMY_LABELS[category]} — ${summary}`, { projectId: ap.projectId, leadId: ap.leadId });
  return `대표 승인 대기열에 올렸습니다(${ap.id}). 같은 내용을 다시 보내지 마세요. 승인되면 그대로 발송됩니다.`;
}

// ── 고객 · 대표 이벤트 ───────────────────────────────────────────
export async function acceptQuoteByClient(ctx, project, quoteId) {
  const { store } = ctx;
  const q = store.get('quotes', quoteId);
  if (!q || q.projectId !== project.id || q.status !== 'sent') return false;
  store.update('quotes', q.id, { status: 'accepted', acceptedAt: new Date().toISOString() });
  store.update('projects', project.id, { status: 'accepted' });
  await postMessage(ctx, project, { from: 'system', text: `고객이 견적(${money(store.settings, q.total)})을 수락했습니다.` });
  if (!project.simulation && store.settings.company.requireContract) {
    for (const old of store.find('contracts', (c) => c.projectId === project.id && c.status === 'sent')) store.update('contracts', old.id, { status: 'void' });
    const client = store.get('clients', project.clientId);
    const contract = store.insert('contracts', { projectId: project.id, quoteId: q.id, body: renderContract(store.settings, { project: store.get('projects', project.id), client, quote: store.get('quotes', q.id) }), status: 'sent' });
    await postMessage(ctx, project, { from: 'system', text: '용역 계약서가 준비되었습니다. 프로젝트 페이지에서 내용을 확인하고 서명해 주세요.' });
    store.log('deal', `계약서 발송 — ${project.title}`, { projectId: project.id, contractId: contract.id });
  }
  store.log('deal', `견적 수락! ${money(store.settings, q.total)} — ${project.title}`, { projectId: project.id });
  enqueueAgent(store, project.id, { kind: 'quote_accepted', quoteId: q.id });
  return true;
}

export async function approveDesignByClient(ctx, project, designId) {
  const { store } = ctx;
  const d = store.get('designs', designId);
  if (!d || d.projectId !== project.id || !d.shared) return false;
  store.update('designs', d.id, { approved: true });
  await postMessage(ctx, project, { from: 'system', text: `고객이 시안 「${d.title}」을 최종 선택했습니다.` });
  store.log('deal', `시안 최종 선택: ${d.title} — ${project.title}`, { projectId: project.id });
  enqueueAgent(store, project.id, { kind: 'final_approved', designId: d.id });
  return true;
}

export async function markInvoicePaid(ctx, invoiceId) {
  const { store } = ctx;
  const inv = store.get('invoices', invoiceId);
  if (!inv || inv.status === 'paid') return null;
  store.update('invoices', inv.id, { status: 'paid', paidAt: new Date().toISOString() });
  const project = store.get('projects', inv.projectId);
  const s = store.settings;
  if (inv.kind === 'extra_revision') store.update('projects', project.id, { extraRounds: (project.extraRounds ?? 0) + 1 });
  if (inv.kind === 'deposit' && project.status === 'accepted') {
    store.update('projects', project.id, { status: 'in_progress' });
    // 계약금이 들어오면 PM이 킥오프(일정 수립 · 담당 배정)를 합니다.
    enqueue(store, 'kickoff', { projectId: project.id }, { dedupe: `kickoff:${project.id}` });
  }
  const unpaid = store.find('invoices', (i) => i.projectId === project.id && i.status === 'sent').length;
  await postMessage(ctx, project, { from: 'system', text: `입금 확인: ${money(s, inv.amount)} (${inv.description || inv.kind})` });
  store.log('payment', `입금 확인 ${money(s, inv.amount)} — ${project.title}`, { projectId: project.id });
  if (project.status === 'delivered' && !unpaid) await completeProject(ctx, project);
  enqueueAgent(store, project.id, { kind: 'payment_received', invoiceId: inv.id });
  return inv;
}

// 납품 완료 + 미수금 0 → 정산 완료로 바꾸고, 확정 시안 원본을 납품 메일로 보냅니다.
export async function completeProject(ctx, project) {
  const { store } = ctx;
  // 견적 금액을 모두 청구했고, 보낸 청구서가 모두 입금된 경우에만 원본을 넘깁니다.
  if (!acceptedQuote(store, project) || invoiceRemaining(store, project) > 0) return false;
  if (store.find('invoices', (i) => i.projectId === project.id && i.status === 'sent').length) return false;
  store.update('projects', project.id, { status: 'completed' });
  enqueue(store, 'retro', { projectId: project.id }, { dedupe: `retro:${project.id}` });
  const designs = store.find('designs', (d) => d.projectId === project.id && d.shared);
  const finals = designs.filter((d) => d.approved);
  const files = (finals.length ? finals : designs.filter((d) => d.round === Math.max(...designs.map((x) => x.round)))).map((d) => ({
    filename: `${d.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'design'}.${d.format}`,
    content: d.code,
    contentType: d.format === 'svg' ? 'image/svg+xml' : 'text/html',
  }));
  await postMessage(ctx, project, { from: 'system', text: '정산이 끝나 원본 파일을 받을 수 있습니다.' });
  try {
    const r = await emailClient(ctx, project, {
      subject: emailSubject(store.settings, project, '최종 파일 납품'),
      text: `작업이 모두 마무리되었습니다. 감사합니다!\n최종 파일 ${files.length}개를 첨부했습니다. 프로젝트 페이지에서도 언제든 받으실 수 있습니다.\n(첨부 파일은 생성형 AI를 활용해 제작되었습니다.)`,
      attachments: files,
    });
    store.log('delivery', `${r.sent ? '납품 메일 발송' : '정산 완료 (메일 미발송)'} — 파일 ${files.length}개 — ${project.title}`, { projectId: project.id });
  } catch (err) {
    store.log('error', `납품 메일 발송 실패: ${err.message}`, { projectId: project.id });
  }
  return true;
}

export function short(text, n = 80) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
