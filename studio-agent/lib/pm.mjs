// PM · 재무 — 회사 운영 업무
//   킥오프   계약금이 들어오면 PM이 일정(마일스톤)을 세우고 디자이너를 배정, 사내 채널에 공유
//   스탠드업 매일 아침 PM이 진행 중인 모든 프로젝트를 정리해 대표에게 보고
//   회고     정산이 끝나면 PM이 잘된 점 · 아쉬운 점 · 다음에 적용할 규칙을 정리 (대표가 채택하면 학습 노트)
//   점검     (Claude 호출 없음) 마일스톤 지연 · 청구서 연체를 매시간 확인해 AM에게 알림
// 숫자(매출 · 미수금 · 직원별 비용)는 코드가 계산하고, Claude는 요약 · 판단만 합니다.

import { enqueue, enqueueAgent, postMessage, money, short, STATUSES, ACTIVE_STATUSES, acceptedQuote } from './actions.mjs';
import { jsonOf, textOf } from './claude.mjs';
import { lead, pickDesigner, modelFor, staffBlock, staffLabel } from './staff.mjs';
import { profileBlock, lessonsBlock } from './prompts.mjs';

const KST = 9 * 3600e3;
const kstDate = (t = Date.now()) => new Date(t + KST).toISOString().slice(0, 10);
const kstHour = (t = Date.now()) => new Date(t + KST).getUTCHours();

function pmSystem(s, pm, lessons) {
  return `You are the project manager of a small design studio run by AI employees and overseen by the owner.

${profileBlock(s)}

You are the studio's project manager. You plan realistic schedules, track progress against them, flag risks early and keep the owner informed. You never contact clients directly; the account manager does that.${staffBlock(pm)}${lessonsBlock(s, lessons, 'account')}`;
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    milestones: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, owner: { type: 'string', enum: ['am', 'ad', 'designer', 'client', 'finance'] }, due: { type: 'string' } },
        required: ['title', 'owner', 'due'],
        additionalProperties: false,
      },
    },
    risks: { type: 'array', items: { type: 'string' } },
    kickoff_note: { type: 'string' },
  },
  required: ['milestones', 'risks', 'kickoff_note'],
  additionalProperties: false,
};

// ── 킥오프 ────────────────────────────────────────────────────
export async function runKickoff(ctx, { projectId }) {
  const { store, llm } = ctx;
  const s = store.settings;
  const project = store.get('projects', projectId);
  if (!project || project.plan) return;
  const pm = lead(store, 'pm');
  const designer = pickDesigner(store, project);
  if (designer) store.update('projects', project.id, { designerId: designer.id });
  const q = acceptedQuote(store, project);
  const msg = await llm.create({
    model: modelFor(store, pm),
    max_tokens: 8000,
    system: [{ type: 'text', text: pmSystem(s, pm, store.all('lessons')), cache_control: { type: 'ephemeral' } }],
    output_config: { effort: s.agentEffort, format: { type: 'json_schema', schema: PLAN_SCHEMA } },
    messages: [{
      role: 'user',
      content: `Kickoff for project "${project.title}". Today (KST): ${kstDate()}. Working days: Mon-Fri.
Brief: ${project.brief || '(see quote)'}
Client deadline: ${project.deadline || '(none given)'}
Quote: ${q ? `${q.items.map((i) => i.name).join(', ')} — ${q.timelineDays} working days, ${q.revisions} revision rounds` : '(none)'}
Assigned designer: ${staffLabel(designer)}

Plan 4-7 milestones from now to final delivery (dates as YYYY-MM-DD, working days only, inside the quoted timeline and the client deadline). Include: creative direction (ad), first concepts (designer), internal review (ad), client presentation (am), client feedback (client), revision(s), final files (designer), final invoice (finance). List the main risks. "kickoff_note" is a short Korean message to the team in the internal channel.`,
    }],
  }, 'pm_kickoff', { projectId, staffId: pm?.id });
  const plan = jsonOf(msg);
  store.update('projects', project.id, { plan: { ...plan, milestones: plan.milestones.map((m) => ({ ...m, done: false })), createdAt: new Date().toISOString() } });
  await postMessage(ctx, project, {
    from: 'staff', staffId: pm?.id, internal: true,
    text: `[킥오프] ${plan.kickoff_note}\n\n일정:\n${plan.milestones.map((m) => `· ${m.due} ${m.title} (${m.owner})`).join('\n')}${plan.risks.length ? `\n\n리스크: ${plan.risks.join(' / ')}` : ''}\n담당 디자이너: ${designer?.name ?? '-'}`,
  });
  store.log('pm', `${pm?.name ?? 'PM'} 킥오프 완료 — 마일스톤 ${plan.milestones.length}개, 담당 ${designer?.name ?? '-'} — ${project.title}`, { projectId });
  enqueueAgent(store, project.id, { kind: 'kickoff_done' });
}

// 디자인 라운드가 끝나면 해당 마일스톤을 완료 처리합니다.
export function completeMilestones(store, project, owners) {
  if (!project.plan) return;
  // 담당별로 아직 안 끝난 첫 마일스톤을 하나씩 완료 처리합니다.
  const pending = new Set(owners);
  const milestones = project.plan.milestones.map((m) => {
    if (!m.done && pending.has(m.owner)) {
      pending.delete(m.owner);
      return { ...m, done: true, doneAt: new Date().toISOString() };
    }
    return m;
  });
  store.update('projects', project.id, { plan: { ...project.plan, milestones } });
}

// ── 데일리 스탠드업 ─────────────────────────────────────────────
export function companySnapshot(store) {
  const s = store.settings;
  const real = store.find('projects', (p) => !p.simulation);
  const active = real.filter((p) => ACTIVE_STATUSES.includes(p.status));
  const today = kstDate();
  return active.map((p) => {
    const next = (p.plan?.milestones ?? []).find((m) => !m.done);
    const unpaid = store.find('invoices', (i) => i.projectId === p.id && i.status === 'sent');
    const last = store.find('messages', (m) => m.projectId === p.id && !m.internal).at(-1);
    return {
      title: p.title,
      status: STATUSES[p.status],
      next: next ? `${next.due} ${next.title}${next.due < today ? ' (지연)' : ''}` : '-',
      unpaid: unpaid.map((i) => `${money(s, i.amount)} (기한 ${i.dueDate})`).join(', '),
      lastMessage: last ? `${last.from === 'client' ? '고객' : '스튜디오'} ${last.createdAt.slice(0, 10)}: ${short(last.text, 60)}` : '',
    };
  });
}

export async function runStandup(ctx) {
  const { store, llm } = ctx;
  const s = store.settings;
  const pm = lead(store, 'pm');
  const snap = companySnapshot(store);
  const yesterday = new Date(Date.now() - 864e5).toISOString();
  const recent = store.find('activity', (a) => a.createdAt >= yesterday && ['deal', 'payment', 'delivery', 'inquiry', 'alert', 'error'].includes(a.kind)).map((a) => `- ${a.text}`);
  let body;
  if (!snap.length && !recent.length) {
    body = '진행 중인 프로젝트가 없습니다. 오늘은 문의 대응과 포트폴리오 · 영업 준비에 집중합니다.';
  } else {
    const msg = await llm.create({
      model: modelFor(store, pm),
      max_tokens: 4000,
      system: [{ type: 'text', text: pmSystem(s, pm, store.all('lessons')), cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: `Write today's (${kstDate()}) stand-up report to the owner in Korean, under 15 lines: 1) what happened since yesterday, 2) today's priorities per project, 3) blockers or decisions the owner must make. Facts only from below.\n\nActive projects:\n${JSON.stringify(snap, null, 1)}\n\nLast 24h:\n${recent.join('\n') || '(nothing)'}` }],
    }, 'pm_standup', { staffId: pm?.id });
    body = textOf(msg);
  }
  const r = store.insert('reports', { kind: 'standup', day: kstDate(), title: `${kstDate()} 데일리 스탠드업`, body, staffId: pm?.id });
  store.log('report', `${pm?.name ?? 'PM'} 데일리 스탠드업 보고`, { reportId: r.id });
}

// ── 회고 ──────────────────────────────────────────────────────
const RETRO_SCHEMA = {
  type: 'object',
  properties: {
    went_well: { type: 'array', items: { type: 'string' } },
    to_improve: { type: 'array', items: { type: 'string' } },
    proposed_rules: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, scope: { type: 'string', enum: ['account', 'design', 'all'] } }, required: ['text', 'scope'], additionalProperties: false } },
  },
  required: ['went_well', 'to_improve', 'proposed_rules'],
  additionalProperties: false,
};

export async function runRetro(ctx, { projectId }) {
  const { store, llm } = ctx;
  const s = store.settings;
  const project = store.get('projects', projectId);
  if (!project) return;
  const pm = lead(store, 'pm');
  const thread = store.find('messages', (m) => m.projectId === project.id).map((m) => `${m.from}${m.internal ? '(internal)' : ''}: ${short(m.text, 300)}`).join('\n');
  const designs = store.find('designs', (d) => d.projectId === project.id);
  const msg = await llm.create({
    model: modelFor(store, pm),
    max_tokens: 6000,
    system: [{ type: 'text', text: pmSystem(s, pm, store.all('lessons')), cache_control: { type: 'ephemeral' } }],
    output_config: { effort: s.agentEffort, format: { type: 'json_schema', schema: RETRO_SCHEMA } },
    messages: [{ role: 'user', content: `Project retrospective in Korean for "${project.title}". Rounds: ${project.designRounds}, designs: ${designs.length}, average AD score: ${avg(designs.map((d) => d.review?.score).filter(Boolean))}, AD reworks: ${designs.reduce((t, d) => t + (d.reworks ?? 0), 0)}.\nPlan: ${JSON.stringify(project.plan?.milestones ?? [])}\n\nThread:\n${thread}\n\nGive what went well, what to improve, and at most 3 concrete rules the team should follow next time (each one sentence, actionable).` }],
  }, 'pm_retro', { projectId, staffId: pm?.id });
  const r = jsonOf(msg);
  const report = store.insert('reports', {
    kind: 'retro', day: kstDate(), projectId, staffId: pm?.id,
    title: `회고 — ${project.title}`,
    body: `잘된 점\n${r.went_well.map((x) => `· ${x}`).join('\n')}\n\n아쉬운 점\n${r.to_improve.map((x) => `· ${x}`).join('\n')}`,
    proposals: r.proposed_rules.map((x) => ({ ...x, status: 'pending' })),
  });
  store.log('report', `${pm?.name ?? 'PM'} 프로젝트 회고 — 학습 노트 제안 ${r.proposed_rules.length}개 (보고서에서 채택)`, { projectId, reportId: report.id });
}

function avg(xs) {
  return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '-';
}

// ── 정기 점검 (Claude 호출 없음) ─────────────────────────────────
export function maintenance(store, now = Date.now()) {
  const s = store.settings;
  const today = kstDate(now);

  // 매일 아침 스탠드업
  const hour = Number(s.company.standupHour ?? 9);
  if (kstHour(now) >= hour && !store.findOne('reports', (r) => r.kind === 'standup' && r.day === today)
    && !store.findOne('jobs', (j) => j.kind === 'standup' && ['queued', 'running'].includes(j.status))) {
    enqueue(store, 'standup', { day: today });
  }

  for (const p of store.find('projects', (x) => !x.simulation && ACTIVE_STATUSES.includes(x.status))) {
    // 지난 마일스톤 (하루 한 번만 알림)
    const late = (p.plan?.milestones ?? []).find((m) => !m.done && m.due < today && m.owner !== 'finance');
    if (late && p.lateNotified !== `${late.title}:${today}`) {
      store.update('projects', p.id, { lateNotified: `${late.title}:${today}` });
      store.log('pm', `일정 지연: ${late.title} (기한 ${late.due}) — ${p.title}`, { projectId: p.id });
      enqueueAgent(store, p.id, { kind: 'milestone_overdue', title: late.title, due: late.due });
    }
    // 연체 청구서 (며칠 간격으로 한 번)
    const gap = (Number(s.company.overdueReminderDays) || 3) * 864e5;
    for (const inv of store.find('invoices', (i) => i.projectId === p.id && i.status === 'sent' && i.dueDate && i.dueDate < today && !i.clientNotified)) {
      if (inv.lastReminderAt && now - Date.parse(inv.lastReminderAt) < gap) continue;
      store.update('invoices', inv.id, { lastReminderAt: new Date(now).toISOString(), reminders: (inv.reminders ?? 0) + 1 });
      const fin = lead(store, 'finance');
      store.log('finance', `${fin?.name ?? '재무'}: 연체 청구서 ${money(s, inv.amount)} (기한 ${inv.dueDate}) — ${p.title}`, { projectId: p.id });
      if ((inv.reminders ?? 0) >= 2) store.alert('urgent', `[${p.title}] ${money(s, inv.amount)} 청구서가 독촉 2회 후에도 미입금입니다. 직접 연락이 필요할 수 있습니다.`, { projectId: p.id });
      else enqueueAgent(store, p.id, { kind: 'invoice_overdue', invoiceId: inv.id, dueDate: inv.dueDate });
    }
  }
}

// ── 재무 요약 (Claude 호출 없음) ──────────────────────────────────
export function financeSummary(store, month = new Date().toISOString().slice(0, 7)) {
  const real = new Set(store.find('projects', (p) => !p.simulation).map((p) => p.id));
  const inv = store.find('invoices', (i) => real.has(i.projectId));
  const paid = inv.filter((i) => i.status === 'paid' && (i.paidAt ?? '').startsWith(month));
  const usage = store.find('usage', (u) => u.day.startsWith(month));
  const revenue = paid.reduce((t, i) => t + i.amount, 0);
  const apiUsd = usage.reduce((t, u) => t + u.cost, 0);
  const byStaff = store.all('staff').map((st) => {
    const u = usage.filter((x) => x.staffId === st.id);
    return { id: st.id, name: st.name, role: st.role, calls: u.length, costUsd: u.reduce((t, x) => t + x.cost, 0) };
  });
  const other = usage.filter((x) => !x.staffId).reduce((t, x) => t + x.cost, 0);
  return {
    month,
    revenue,
    receivables: inv.filter((i) => i.status === 'sent').reduce((t, i) => t + i.amount, 0),
    overdue: inv.filter((i) => i.status === 'sent' && i.dueDate && i.dueDate < kstDate()).reduce((t, i) => t + i.amount, 0),
    contractsSigned: store.find('contracts', (c) => c.status === 'signed' && (c.signedAt ?? '').startsWith(month)).length,
    projectsCompleted: store.find('projects', (p) => real.has(p.id) && p.status === 'completed' && (p.updatedAt ?? '').startsWith(month)).length,
    apiUsd,
    practiceUsd: usage.filter((u) => u.projectId && !real.has(u.projectId)).reduce((t, u) => t + u.cost, 0),
    byStaff,
    otherUsd: other,
    paid: paid.map((i) => ({ amount: i.amount, kind: i.kind, paidAt: i.paidAt, project: store.get('projects', i.projectId)?.title })),
  };
}
