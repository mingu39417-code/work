// 업무 동작 — 에이전트 도구, 승인 대기열, 고객 포털, 대시보드가 모두 이 함수들로 같은 일을 합니다.
// 가격 하한 · 계약금 · 수정 횟수 같은 규칙은 Claude가 아니라 이 코드가 강제합니다.

import { mailer } from './mailer.mjs';
import crypto from 'node:crypto';

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
export async function postMessage(ctx, project, { from, text, internal = false, designIds, quoteId, invoiceId, attachments }) {
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
  });
  store.update('projects', project.id, { lastMessageAt: msg.createdAt });

  // 고객에게 보이는 스튜디오 쪽 메시지는 이메일로도 알립니다(SMTP 설정 시).
  if (!internal && (from === 'agent' || from === 'owner')) {
    const client = store.get('clients', project.clientId);
    const s = store.settings;
    try {
      const r = await mailer.send(s, {
        to: client?.email,
        subject: `[${studioName(s)}] ${project.title || '프로젝트'} — 새 메시지`,
        text: `${text}\n\n— ${studioName(s)}\n\n대화 · 시안 · 견적 확인: ${portalUrl(s, project)}`,
      });
      if (r.sent) store.update('messages', msg.id, { emailed: true });
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
  let client = email ? store.findOne('clients', (c) => c.email === email) : null;
  if (!client) {
    client = store.insert('clients', {
      name: String(input.name ?? '').trim() || '이름 미상',
      email,
      company: String(input.company ?? '').trim(),
      phone: String(input.phone ?? '').trim(),
      notes: [],
      source: input.source ?? 'website',
    });
  }
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
    source: input.source ?? 'website',
  });
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
  if (!acceptedQuote(store, project)) return '고객이 아직 견적을 수락하지 않았습니다.';
  if (store.settings.policy.requireDeposit && !depositPaid(store, project)) {
    return '계약금 입금이 확인되지 않았습니다. 계약금 청구서를 보내고 대표가 입금을 확인하면 작업을 시작할 수 있습니다.';
  }
  return null;
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
  const q = acceptedQuote(store, project);
  if (!q) return '수락된 견적이 없어 청구할 수 없습니다. 견적 밖 추가 비용이면 kind를 extra 또는 extra_revision으로 하세요.';
  const remaining = invoiceRemaining(store, project);
  if (amount > remaining + 1) return `남은 청구 가능 금액(${remaining})보다 큽니다.`;
  return null;
}

export function canDownload(store, project) {
  if (!['delivered', 'completed'].includes(project.status)) return false;
  return !store.find('invoices', (i) => i.projectId === project.id && i.status === 'sent').length;
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
      let sent = false;
      try {
        const r = await mailer.send(s, { to: lead.email, subject: action.subject, text: action.body });
        sent = r.sent;
      } catch (err) {
        store.log('error', `영업 메일 발송 실패: ${err.message}`, { leadId: lead.id });
      }
      store.update('leads', lead.id, {
        status: 'contacted',
        lastOutreach: { subject: action.subject, body: action.body, at: new Date().toISOString(), emailed: sent },
      });
      store.log('outreach', `${sent ? '영업 메일 발송' : '영업 메시지 준비(직접 보내기)'}: ${lead.company || lead.name}`, { leadId: lead.id });
      return sent ? '이메일로 보냈습니다.' : 'SMTP가 없어 직접 보낼 수 있도록 대시보드에 저장했습니다.';
    }

    default:
      return `알 수 없는 동작: ${action.type}`;
  }
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
  if (inv.kind === 'deposit' && project.status === 'accepted') store.update('projects', project.id, { status: 'in_progress' });
  const unpaid = store.find('invoices', (i) => i.projectId === project.id && i.status === 'sent').length;
  if (project.status === 'delivered' && !unpaid) store.update('projects', project.id, { status: 'completed' });
  await postMessage(ctx, project, { from: 'system', text: `입금 확인: ${money(s, inv.amount)} (${inv.description || inv.kind})` });
  store.log('payment', `입금 확인 ${money(s, inv.amount)} — ${project.title}`, { projectId: project.id });
  enqueueAgent(store, project.id, { kind: 'payment_received', invoiceId: inv.id });
  return inv;
}

export function short(text, n = 80) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
