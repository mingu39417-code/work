// 에이전트 — 고객 응대 · 견적 · 청구 · 작업 지시(계정 관리자)와 영업(신규 고객 발굴)을 맡습니다.
// 한 번의 실행 = 사건 하나(새 문의, 고객 메시지, 견적 수락, 입금 확인, 시안 완성 …)에 대한 대응입니다.
// 매번 저장소에서 프로젝트 상태 전체를 읽어 새 대화로 시작하므로, 서버가 꺼졌다 켜져도 이어서 일합니다.

import {
  STATUSES, money, gated, enqueue, postMessage, validateQuote, validateInvoice,
  workAllowed, roundLimit, acceptedQuote, invoiceRemaining, short, studioName,
  completeProject, outreachBlocked, OUTREACH_BASIS, contractOf,
} from './actions.mjs';
import { accountManagerSystem, salesSystem } from './prompts.mjs';
import { textOf } from './claude.mjs';
import { lead as leadStaff, modelFor, staffBlock, staffLabel } from './staff.mjs';

const MAX_STEPS = 12;

// ── 도구 정의 ──────────────────────────────────────────────────
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });

export const ACCOUNT_TOOLS = [
  {
    name: 'reply_to_client',
    description: 'Send a message to the client in the project thread (also emailed if email is configured). Use for answers, questions, updates and holding replies.',
    input_schema: { type: 'object', properties: { message: str('The full message text, in the client\'s language and the studio\'s voice.') }, required: ['message'] },
  },
  {
    name: 'update_project',
    description: 'Update internal project fields. Use to record the brief as you learn it, set the deadline, choose the service, or move the status.',
    input_schema: {
      type: 'object',
      properties: {
        title: str('Short project title'),
        service_id: str('Service id from the price list'),
        brief: str('Complete, current design brief (replaces the old one): goals, deliverables, sizes/formats, audience, style direction, references, must-haves, things to avoid.'),
        deadline: str('Deadline as YYYY-MM-DD or free text'),
        status: { type: 'string', enum: Object.keys(STATUSES).filter((k) => k !== 'completed') },
      },
    },
  },
  {
    name: 'send_quote',
    description: 'Send a formal quote. The client sees the items and an Accept button. Prices below a service\'s minimum are rejected.',
    input_schema: {
      type: 'object',
      properties: {
        line_items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: str('Item name'), service_id: str('Service id if this item is a listed service'), price: num('Price in the studio currency'), description: str('What is included') },
            required: ['name', 'price'],
          },
        },
        total: num('Sum of the item prices'),
        timeline_days: num('Working days to final delivery after work starts'),
        revisions_included: num('Revision rounds included'),
        terms: str('Payment terms and scope notes shown with the quote'),
        message: str('Message to the client that accompanies the quote'),
      },
      required: ['line_items', 'total', 'timeline_days', 'revisions_included', 'message'],
    },
  },
  {
    name: 'send_invoice',
    description: 'Send an invoice. kind: deposit (before work), final (balance after approval), extra_revision (paid extra round), extra (other out-of-quote work).',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['deposit', 'final', 'extra_revision', 'extra'] },
        amount: num('Amount in the studio currency'),
        description: str('Invoice line description'),
        due_days: num('Days until due'),
        message: str('Message to the client that accompanies the invoice'),
      },
      required: ['kind', 'amount', 'description', 'message'],
    },
  },
  {
    name: 'start_design_round',
    description: 'Start a design round: the designer produces concepts (first round) or refined versions (later rounds) from your instructions. Runs in the background; you will get a designs_ready event when done. Only allowed when work is allowed and the round limit is not exceeded.',
    input_schema: {
      type: 'object',
      properties: {
        instructions: str('Precise design instructions for this round: deliverable, size/format, content/copy, style, and for revisions exactly what to keep and change (reference design ids).'),
        concepts: num('How many separate concepts/variations to produce (1-3).'),
        base_design_ids: { type: 'array', items: { type: 'string' }, description: 'Designs to revise from, if this is a revision.' },
      },
      required: ['instructions', 'concepts'],
    },
  },
  {
    name: 'share_designs',
    description: 'Present finished designs to the client in their portal with a message.',
    input_schema: {
      type: 'object',
      properties: { design_ids: { type: 'array', items: { type: 'string' } }, message: str('Presentation message: one or two lines per concept, then a clear question.') },
      required: ['design_ids', 'message'],
    },
  },
  {
    name: 'schedule_followup',
    description: 'Wake yourself up later for this project (e.g. nudge a client who has not replied to a quote). Replaces any earlier pending follow-up.',
    input_schema: { type: 'object', properties: { hours: num('Hours from now (1-336)'), purpose: str('What to check or do then') }, required: ['hours', 'purpose'] },
  },
  {
    name: 'save_client_note',
    description: 'Save a durable fact about the client for future projects (preferences, decision makers, communication style).',
    input_schema: { type: 'object', properties: { note: str('The note') }, required: ['note'] },
  },
  {
    name: 'escalate_to_owner',
    description: 'Flag something for the owner to decide (price below minimum, disputes, refunds, legal, unclear requests). Shows as an alert on the dashboard.',
    input_schema: { type: 'object', properties: { reason: str('What the owner needs to decide and your recommendation'), urgent: { type: 'boolean' } }, required: ['reason'] },
  },
];

export const SALES_TOOLS = [
  {
    name: 'draft_outreach',
    description: 'Write the first-contact message to the prospect. Depending on settings it is sent right away or waits for the owner\'s approval.',
    input_schema: { type: 'object', properties: { subject: str('Email subject'), body: str('Message body') }, required: ['subject', 'body'] },
  },
  {
    name: 'update_lead',
    description: 'Update the prospect record.',
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['new', 'needs_info', 'contacted', 'replied', 'won', 'lost'] }, note: str('Short internal note') },
      required: ['note'],
    },
  },
];

// 입력 검사 — 필수 항목과 기본 형식만 확인합니다.
function checkInput(tool, input) {
  if (input === null || typeof input !== 'object') return '입력이 객체가 아닙니다.';
  for (const key of tool.input_schema.required ?? []) {
    if (input[key] === undefined || input[key] === null || input[key] === '') return `필수 항목 누락: ${key}`;
  }
  for (const [key, spec] of Object.entries(tool.input_schema.properties)) {
    const v = input[key];
    if (v === undefined) continue;
    if (spec.type === 'string' && typeof v !== 'string') return `${key}는 문자열이어야 합니다.`;
    if (spec.type === 'number' && !Number.isFinite(Number(v))) return `${key}는 숫자여야 합니다.`;
    if (spec.type === 'array' && !Array.isArray(v)) return `${key}는 배열이어야 합니다.`;
    if (spec.enum && !spec.enum.includes(v)) return `${key}는 ${spec.enum.join('/')} 중 하나여야 합니다.`;
  }
  return null;
}

// ── 계정 관리자 도구 실행 ─────────────────────────────────────────
async function runAccountTool(ctx, project, name, input) {
  const { store } = ctx;
  const s = store.settings;
  const p = () => store.get('projects', project.id);

  switch (name) {
    case 'reply_to_client':
      return gated(ctx, 'client_reply', { type: 'client_message', projectId: project.id, message: input.message }, short(input.message));

    case 'update_project': {
      const patch = {};
      for (const k of ['title', 'brief', 'deadline']) if (typeof input[k] === 'string') patch[k] = input[k];
      if (input.service_id) {
        if (!s.services.some((x) => x.id === input.service_id)) return `없는 서비스 id: ${input.service_id}`;
        patch.serviceId = input.service_id;
      }
      if (input.status) {
        if (input.status === 'in_progress') {
          const why = workAllowed(store, p());
          if (why) return `상태를 작업 중으로 바꿀 수 없습니다: ${why}`;
        }
        patch.status = input.status;
      }
      store.update('projects', project.id, patch);
      store.log('project', `프로젝트 정보 갱신 (${Object.keys(patch).join(', ')}) — ${p().title}`, { projectId: project.id });
      if (patch.status === 'delivered' && (await completeProject(ctx, p()))) return '저장했습니다. 미수금이 없어 정산 완료 처리하고 원본 파일을 납품했습니다.';
      return '저장했습니다.';
    }

    case 'send_quote': {
      const action = { type: 'quote', projectId: project.id, ...input };
      const err = validateQuote(s, action);
      if (err) return `거절됨: ${err}`;
      return gated(ctx, 'quote', action, `${money(s, Number(input.total))} 견적`);
    }

    case 'send_invoice': {
      const action = { type: 'invoice', projectId: project.id, ...input };
      const err = validateInvoice(store, p(), action);
      if (err) return `거절됨: ${err}`;
      return gated(ctx, 'invoice', action, `${money(s, Number(input.amount))} 청구 (${input.kind})`);
    }

    case 'start_design_round': {
      const cur = p();
      const why = workAllowed(store, cur);
      if (why) return `시작할 수 없습니다: ${why}`;
      const limit = roundLimit(store, cur);
      if (!cur.simulation && (cur.designRounds ?? 0) >= limit) {
        return `포함된 수정 횟수를 모두 썼습니다(${cur.designRounds}/${limit}회). 추가 수정은 ${money(s, s.policy.extraRevisionPrice)}의 extra_revision 청구서를 보내고, 입금이 확인되면 진행하세요.`;
      }
      const running = store.findOne('jobs', (j) => j.kind === 'design' && j.payload.projectId === cur.id && ['queued', 'running'].includes(j.status));
      if (running) return '이미 진행 중인 디자인 작업이 있습니다. designs_ready를 기다리세요.';
      const concepts = Math.min(3, Math.max(1, Math.round(Number(input.concepts) || 1)));
      // 킥오프 전이면 PM이 먼저 일정을 잡고 디자이너를 배정합니다(디자인 작업은 그다음에 실행).
      if (!cur.plan && !cur.simulation) enqueue(store, 'kickoff', { projectId: cur.id }, { dedupe: `kickoff:${cur.id}` });
      enqueue(store, 'design', { projectId: cur.id, instructions: input.instructions, concepts, baseDesignIds: input.base_design_ids ?? [] }, { delayMs: 1000 });
      if (cur.status !== 'in_progress' && cur.status !== 'revision') {
        store.update('projects', cur.id, { status: cur.designRounds > 0 ? 'revision' : 'in_progress' });
      }
      store.log('design', `디자인 ${cur.designRounds + 1}차 작업 지시 (${concepts}안) — ${cur.title}`, { projectId: cur.id });
      return `디자인 ${cur.designRounds + 1}차 작업을 시작했습니다. 완성되면 designs_ready 이벤트로 알려 드립니다.`;
    }

    case 'share_designs':
      return gated(ctx, 'delivery', { type: 'share_designs', projectId: project.id, ...input }, `시안 ${input.design_ids.length}개 공유`);

    case 'schedule_followup': {
      const hours = Math.min(336, Math.max(1, Number(input.hours)));
      for (const j of store.find('jobs', (j) => j.status === 'queued' && j.kind === 'agent' && j.payload.projectId === project.id && j.payload.followup)) {
        store.update('jobs', j.id, { status: 'cancelled' });
      }
      enqueue(store, 'agent', { projectId: project.id, followup: true, events: [{ kind: 'followup', purpose: input.purpose }] }, { delayMs: hours * 3600e3 });
      store.log('followup', `${hours}시간 뒤 후속 조치 예약: ${short(input.purpose)}`, { projectId: project.id });
      return `${hours}시간 뒤에 다시 확인합니다.`;
    }

    case 'save_client_note': {
      const client = store.get('clients', project.clientId);
      store.update('clients', client.id, { notes: [...(client.notes ?? []), { at: new Date().toISOString(), text: input.note }] });
      return '메모했습니다.';
    }

    case 'escalate_to_owner':
      store.alert(input.urgent ? 'urgent' : 'info', `[${p().title}] ${input.reason}`, { projectId: project.id });
      return '대표에게 알렸습니다. 대표가 지시를 남기면 다시 깨워 드립니다.';

    default:
      return `알 수 없는 도구: ${name}`;
  }
}

// ── 상태 요약(사용자 메시지) ─────────────────────────────────────
function describeEvent(store, e) {
  switch (e.kind) {
    case 'new_inquiry': return 'A new inquiry arrived. Reply (clarify or quote) and record the brief.';
    case 'client_message': return 'The client sent new message(s). Respond.';
    case 'quote_accepted': return store.settings.company.requireContract ? 'The client accepted the quote. The system sent them the service contract to sign in their portal. Thank them briefly and tell them to review and sign the contract; the deposit invoice comes after signing. Do not send an invoice yet.' : 'The client accepted the quote. Next step per policy (deposit invoice, or start work).';
    case 'contract_signed': return 'The client signed the service contract. Next step per policy: send the deposit invoice (or, if no deposit is required, start work).';
    case 'kickoff_done': return `The PM finished the kickoff and the schedule below is set. Share the key milestones and the expected first-concept date with the client in a short message.`;
    case 'invoice_overdue': return `Finance flagged invoice ${e.invoiceId} as overdue (due ${e.dueDate}). Send a short, polite payment reminder. Do not threaten; offer help if there is a problem.`;
    case 'milestone_overdue': return `The PM flagged milestone "${e.title}" as overdue (due ${e.due}). Decide what to do: if it is waiting on the client, gently ask them; if on the studio, apologize briefly with a new date and tell the owner via escalate_to_owner.`;
    case 'payment_received': {
      const inv = store.get('invoices', e.invoiceId);
      return `The owner confirmed payment of invoice ${e.invoiceId} (${inv?.kind}, ${inv?.amount}). Thank the client briefly and continue (e.g. start the design round after a deposit).`;
    }
    case 'designs_ready': return `The design round finished. New design ids: ${e.designIds.join(', ')}. Review notes are in the designs list. Present them to the client.`;
    case 'design_failed': return `The design round failed: ${e.error}. Decide whether to retry (start_design_round) or tell the owner.`;
    case 'final_approved': return `The client gave final approval to design ${e.designId}. Wrap up: final invoice for the remaining balance and status delivered.`;
    case 'client_paid_notice': return `The client says they paid invoice ${e.invoiceId}. Thank them and say the studio will confirm shortly (the owner confirms payments). Do not mark anything paid yourself.`;
    case 'followup': return `Scheduled follow-up: ${e.purpose}. Check whether it is still needed (the client may have replied) and act accordingly.`;
    case 'owner_instruction': return `The owner gave you an instruction: "${e.text}". Carry it out.`;
    case 'coaching': return `The owner (your trainer) gave coaching feedback on this practice session${e.target ? ` about ${e.target}` : ''}: "${e.text}". It is now saved as a permanent rule for all future work. Apply it right away: redo what it refers to (rewrite your last message to the client, or start a new design round that applies it). Do not mention the coaching to the client.`;
    case 'approval_rejected': return `The owner rejected your pending action (${e.summary}). Owner feedback: "${e.feedback || '(none)'}". Redo it accordingly.`;
    default: return JSON.stringify(e);
  }
}

export function buildProjectContext(store, project, events) {
  const s = store.settings;
  const client = store.get('clients', project.clientId);
  const service = s.services.find((x) => x.id === project.serviceId);
  const msgs = store.find('messages', (m) => m.projectId === project.id);
  const quotes = store.find('quotes', (q) => q.projectId === project.id);
  const invoices = store.find('invoices', (i) => i.projectId === project.id);
  const designs = store.find('designs', (d) => d.projectId === project.id);
  const pending = store.find('approvals', (a) => a.projectId === project.id && a.status === 'pending');
  const others = store.find('projects', (x) => x.clientId === client.id && x.id !== project.id);
  const aq = acceptedQuote(store, project);

  const who = { client: 'CLIENT', agent: 'YOU', owner: 'OWNER', system: 'SYSTEM', staff: 'STAFF' };
  const thread = msgs.map((m) => {
    const sender = m.from === 'staff' ? staffLabel(store.get('staff', m.staffId)) : who[m.from];
    const tag = m.internal ? `${sender} (internal, client cannot see)` : sender;
    const extra = [
      m.quoteId && `[quote ${m.quoteId}]`,
      m.invoiceId && `[invoice ${m.invoiceId}]`,
      m.designIds?.length && `[designs ${m.designIds.join(', ')}]`,
      m.attachments?.length && `[${m.attachments.length} image(s) attached]`,
    ].filter(Boolean).join(' ');
    return `[${m.createdAt.slice(0, 16).replace('T', ' ')}] ${tag}: ${m.text}${extra ? ` ${extra}` : ''}`;
  }).join('\n');

  return `Now: ${new Date().toISOString()} (owner works ${s.profile.workingHours})

# Event(s) to handle
${events.map((e) => `- ${describeEvent(store, e)}`).join('\n')}

# Project ${project.id}${project.simulation ? ' — SIMULATION (practice run; the owner plays the client)' : ''}
- Title: ${project.title}
- Status: ${project.status} (${STATUSES[project.status]})
- Service: ${service ? `${service.name} [${service.id}]` : '(not set)'}
- Client budget: ${project.budget || '(unknown)'} / deadline: ${project.deadline || '(unknown)'}
- Brief: ${project.brief || '(not written yet)'}
- Design rounds used: ${project.designRounds ?? 0} of ${roundLimit(store, project)} allowed
- Work allowed now: ${workAllowed(store, project) ?? 'yes'}
- Accepted quote: ${aq ? `${aq.id} total ${aq.total}, ${aq.revisions} revisions, ${aq.timelineDays} days. Remaining billable: ${invoiceRemaining(store, project)}` : 'none'}
- Contract: ${(() => { const c = contractOf(store, project); return c ? `${c.status}${c.signedAt ? ` (signed ${c.signedAt.slice(0, 10)} by ${c.signerName})` : ''}` : (store.settings.company.requireContract && !project.simulation ? 'not created yet (created automatically when the client accepts a quote)' : 'not required'); })()}
- Team: AM ${staffLabel(leadStaff(store, 'am'))}; designer ${project.designerId ? staffLabel(store.get('staff', project.designerId)) : '(assigned at kickoff)'}

# Schedule (set by the PM)
${(project.plan?.milestones ?? []).map((m) => `- ${m.due} ${m.title} [${m.owner}] ${m.done ? 'DONE' : ''}`).join('\n') || '(no schedule yet)'}

# Client
- ${client.name}${client.company ? ` (${client.company})` : ''}, ${client.email || 'no email'}
- Notes: ${(client.notes ?? []).map((n) => n.text).join(' | ') || '(none)'}
- Other projects: ${others.map((o) => `${o.title} [${o.status}]`).join(', ') || 'none'}

# Quotes
${quotes.map((q) => `- ${q.id} [${q.status}] total ${q.total}: ${q.items.map((i) => `${i.name} ${i.price}`).join(', ')}`).join('\n') || '(none)'}

# Invoices
${invoices.map((i) => `- ${i.id} [${i.status}] ${i.kind} ${i.amount} due ${i.dueDate}`).join('\n') || '(none)'}

# Designs
${designs.map((d) => `- ${d.id} round ${d.round} "${d.title}" (${d.format}) ${d.shared ? 'SHARED' : 'not shared yet'}${d.approved ? ' FINAL-APPROVED' : ''}. Rationale: ${d.rationale}${d.review ? ` | Art-director review: score ${d.review.score}/10. ${d.review.summary}` : ''}`).join('\n') || '(none)'}

# Pending owner approvals (do not repeat these)
${pending.map((a) => `- ${a.category}: ${a.summary}`).join('\n') || '(none)'}

# Conversation (oldest first)
${thread || '(empty)'}`;
}

// ── 실행 루프 ──────────────────────────────────────────────────
async function loop(ctx, { system, tools, context, purpose, meta, runTool, model }) {
  const { store, llm } = ctx;
  const s = store.settings;
  const messages = [{ role: 'user', content: context }];
  let note = '';
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await llm.create({
      model: model || s.model,
      max_tokens: 16000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
      output_config: { effort: s.agentEffort },
      cache_control: { type: 'ephemeral' },
    }, purpose, meta);
    // 응답 전체를 그대로 이어 붙입니다(생각 블록 포함 — 앞부분을 고치면 안 됩니다).
    messages.push({ role: 'assistant', content: res.content });
    const t = textOf(res);
    if (t) note = t;
    if (res.stop_reason !== 'tool_use') {
      if (res.stop_reason === 'max_tokens') store.log('error', '응답이 길이 한도에 걸려 중단됐습니다', meta);
      break;
    }
    const results = [];
    for (const block of res.content) {
      if (block.type !== 'tool_use') continue;
      const tool = tools.find((x) => x.name === block.name);
      const bad = tool ? checkInput(tool, block.input) : `없는 도구: ${block.name}`;
      let out;
      if (bad) out = { content: `입력 오류: ${bad}`, is_error: true };
      else {
        try {
          out = { content: String(await runTool(block.name, block.input)) };
        } catch (err) {
          out = { content: `오류: ${err.message}`, is_error: true };
        }
      }
      results.push({ type: 'tool_result', tool_use_id: block.id, ...out });
    }
    messages.push({ role: 'user', content: results });
  }
  return note;
}

export async function runAccountManager(ctx, { projectId, events }) {
  const { store } = ctx;
  const project = store.get('projects', projectId);
  if (!project) return;
  const ownerDriven = events.some((e) => ['owner_instruction', 'approval_rejected', 'coaching'].includes(e.kind));
  if (!project.autopilot && !ownerDriven) {
    store.log('agent', `자동 응대 꺼짐 — 대표가 직접 처리: ${project.title}`, { projectId });
    return;
  }
  store.log('agent', `${staffLabel(leadStaff(store, 'am'))} 업무 시작 (${events.map((e) => e.kind).join(', ')}) — ${project.title}`, { projectId });
  const am = leadStaff(store, 'am');
  const note = await loop(ctx, {
    system: accountManagerSystem(store.settings, store.all('lessons')) + staffBlock(am),
    tools: ACCOUNT_TOOLS,
    context: buildProjectContext(store, project, events),
    purpose: 'account_manager',
    meta: { projectId, staffId: am?.id },
    model: modelFor(store, am),
    runTool: (name, input) => runAccountTool(ctx, project, name, input),
  });
  if (note) await postMessage(ctx, store.get('projects', projectId), { from: 'agent', internal: true, text: note, staffId: am?.id });
  store.log('agent', `에이전트 작업 완료 — ${short(note || project.title)}`, { projectId });
}

export async function runSales(ctx, { leadId, instruction }) {
  const { store } = ctx;
  const lead = store.get('leads', leadId);
  if (!lead) return;
  const s = store.settings;
  // 법적으로 보낼 수 없는 대상이면 Claude를 부르지 않습니다(비용 0).
  const blocked = outreachBlocked(store, lead);
  if (blocked) {
    store.update('leads', leadId, { status: 'needs_info', agentNotes: [...(lead.agentNotes ?? []), { at: new Date().toISOString(), text: `발송 불가: ${blocked}` }] });
    store.log('sales', `영업 메일 보류 — ${lead.company || lead.name}: ${blocked}`, { leadId });
    return;
  }
  const context = `Prospect ${lead.id}
- Legal basis for contacting: ${OUTREACH_BASIS[lead.basis]}${lead.basisNote ? ` (${lead.basisNote})` : ''}
- Name: ${lead.name || '(unknown)'}
- Company: ${lead.company || '(unknown)'}
- Email: ${lead.email || '(none — the owner will send manually)'}
- Website / channel: ${lead.website || '(none)'}
- Owner's notes: ${lead.notes || '(none)'}
- Status: ${lead.status}
- Previous outreach: ${lead.lastOutreach ? `${lead.lastOutreach.at}: ${lead.lastOutreach.subject}` : 'none'}
- Studio inquiry link: ${s.publicUrl.replace(/\/$/, '')}/
${instruction ? `\nOwner's instruction: ${instruction}` : ''}`;
  store.log('sales', `영업 메시지 작성 시작 — ${lead.company || lead.name}`, { leadId });
  const am = leadStaff(store, 'am');
  const note = await loop(ctx, {
    system: salesSystem(s, store.all('lessons')) + staffBlock(am),
    tools: SALES_TOOLS,
    context,
    purpose: 'sales',
    meta: { leadId, staffId: am?.id },
    model: modelFor(store, am),
    runTool: async (name, input) => {
      if (name === 'draft_outreach') {
        return gated(ctx, 'outreach', { type: 'outreach', leadId, subject: input.subject, body: input.body }, `${lead.company || lead.name}: ${short(input.subject, 40)}`);
      }
      if (name === 'update_lead') {
        const cur = store.get('leads', leadId);
        store.update('leads', leadId, {
          ...(input.status ? { status: input.status } : {}),
          agentNotes: [...(cur.agentNotes ?? []), { at: new Date().toISOString(), text: input.note }],
        });
        return '저장했습니다.';
      }
      return `알 수 없는 도구: ${name}`;
    },
  });
  store.log('sales', `영업 작업 완료 — ${short(note || lead.company || lead.name)} (${studioName(s)})`, { leadId });
}
