// 받은 메일함 — 등록한 Gmail을 2분마다 확인해서
//   · 진행 중인 프로젝트의 답장이면 그 대화에 붙이고 에이전트를 깨웁니다
//   · 처음 보는 사람의 메일이면 새 문의로 만듭니다
//   · '수신거부' 답장이면 영업 메일 대상에서 영구히 뺍니다
// 자동 응답 · 뉴스레터 · 반송 메일은 무시합니다. 읽은 메일은 '읽음'으로 표시합니다.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { GMAIL, mailAccount, accountAuth, isAuthError, explainMailError, imapClient } from './mailer.mjs';
import { ACTIVE_STATUSES, createInquiry, enqueueAgent, postMessage, short } from './actions.mjs';

const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

// 답장에서 인용된 이전 메일을 잘라 냅니다.
export function stripQuoted(text) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  const out = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/.test(line) || /^\d{4}년 .+작성:\s*$/.test(line) || /^-{2,}\s*Original Message/i.test(line) || /^-+ ?원본 메시지/.test(line)) break;
    if (/^>/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

function isAutomated(mail) {
  const h = mail.headers;
  const auto = String(h.get('auto-submitted') ?? 'no').toLowerCase();
  const prec = String(h.get('precedence') ?? '').toLowerCase();
  const from = mail.from?.value?.[0]?.address ?? '';
  // 플랫폼 알림 · 뉴스레터는 고객 문의가 아닙니다(수신거부 머리말은 사람 고객 메일에는 없음).
  const local = from.split('@')[0] ?? '';
  const domain = (from.split('@')[1] ?? '').toLowerCase();
  const AUTO_DOMAINS = ['mail.instagram.com', 'facebookmail.com', 'accounts.google.com', 'notifications.google.com', 'youtube.com', 'linkedin.com', 'mail.notion.so'];
  return auto !== 'no' || ['bulk', 'junk', 'list'].includes(prec) || h.has('list-id') || h.has('list-unsubscribe')
    || /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|alerts?|.*recap|digest|newsletter|updates?)$/i.test(local)
    || AUTO_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function saveAttachments(store, mail) {
  const out = [];
  for (const a of (mail.attachments ?? []).filter((x) => IMAGE_TYPES[x.contentType] && x.size <= 5 * 1024 * 1024).slice(0, 4)) {
    const file = `${crypto.randomBytes(12).toString('hex')}.${IMAGE_TYPES[a.contentType]}`;
    fs.writeFileSync(path.join(store.uploadsDir, file), a.content);
    out.push({ file, type: a.contentType, name: a.filename ?? file });
  }
  return out;
}

function findProject(store, mail, email) {
  const ids = [mail.inReplyTo, ...(Array.isArray(mail.references) ? mail.references : [mail.references])].filter(Boolean);
  if (ids.length) {
    const m = store.findOne('messages', (x) => x.emailId && ids.includes(x.emailId));
    if (m) return store.get('projects', m.projectId);
  }
  const ref = /\[(P-[0-9A-F]{6})\]/.exec(mail.subject ?? '')?.[1];
  if (ref) {
    const p = store.findOne('projects', (x) => x.ref === ref && !x.simulation);
    if (p) return p;
  }
  const client = store.findOne('clients', (c) => c.email === email && !c.simulation);
  if (!client) return null;
  return store.find('projects', (p) => p.clientId === client.id && ACTIVE_STATUSES.includes(p.status)).at(-1) ?? null;
}

// 메일 한 통 처리 — 테스트하기 쉽도록 IMAP과 분리했습니다.
export async function handleInbound(ctx, mail) {
  const { store } = ctx;
  const acct = mailAccount(store);
  const from = mail.from?.value?.[0] ?? {};
  const email = String(from.address ?? '').toLowerCase();
  if (!email || email === acct?.address?.toLowerCase()) return 'own';
  if (isAutomated(mail)) {
    store.log('mail', `자동 메일 무시: ${short(mail.subject, 50)} (${email})`);
    return 'ignored';
  }
  const text = stripQuoted(mail.text || '') || '(본문 없음)';

  if (/수신\s*거부|unsubscribe/i.test(`${mail.subject} ${text.slice(0, 200)}`)) {
    for (const l of store.find('leads', (l) => l.email === email)) store.update('leads', l.id, { optOut: true, status: 'lost' });
    for (const c of store.find('clients', (c) => c.email === email)) store.update('clients', c.id, { marketingOptOut: true });
    store.log('mail', `수신거부 처리: ${email}`);
  }

  const attachments = saveAttachments(store, mail);
  const project = findProject(store, mail, email);
  if (project) {
    await postMessage(ctx, project, { from: 'client', text, attachments, emailId: mail.messageId ?? null });
    store.log('message', `고객 메일: ${short(text)} — ${project.title}`, { projectId: project.id });
    enqueueAgent(store, project.id, { kind: 'client_message' }, { delayMs: 20e3 });
    return 'reply';
  }

  const lead = store.findOne('leads', (l) => l.email === email);
  if (lead) store.update('leads', lead.id, { status: lead.optOut ? 'lost' : 'replied' });
  if (lead?.optOut && /수신\s*거부|unsubscribe/i.test(`${mail.subject} ${text.slice(0, 200)}`)) return 'unsubscribed';

  const created = await createInquiry(ctx, {
    name: from.name || email.split('@')[0],
    email,
    description: `${mail.subject ? `[메일 제목] ${mail.subject}\n` : ''}${text}`,
    attachments,
    source: 'email',
  });
  store.update('messages', store.find('messages', (m) => m.projectId === created.id).at(-1).id, { emailId: mail.messageId ?? null });
  return 'inquiry';
}

export async function pollInbox(ctx) {
  const { store } = ctx;
  const acct = mailAccount(store);
  if (!acct || acct.inbox === false) return 0;
  const client = imapClient(store, acct, ImapFlow);
  let count = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // 계정을 등록한 날 이후에 온, 아직 안 읽은 메일만 봅니다(예전 메일 폭탄 방지).
      const uids = await client.search({ seen: false, since: new Date(acct.createdAt) }, { uid: true });
      for (const uid of (uids || []).slice(0, 50)) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        try {
          await handleInbound(ctx, await simpleParser(msg.source));
          count++;
        } catch (err) {
          store.log('error', `메일 처리 실패: ${err.message}`);
        }
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return count;
}

export function startInboxPoller(ctx, { intervalMs = 120e3 } = {}) {
  const { store } = ctx;
  let busy = false;
  const tick = async () => {
    const acct = mailAccount(store);
    // Google이 로그인을 거부했다면 대표가 앱 비밀번호를 바꿀 때까지 다시 시도하지 않습니다(반복 실패 시 Google이 계정을 잠글 수 있음).
    if (busy || store.settings.paused || !acct || acct.inbox === false || acct.authFailed) return;
    busy = true;
    try {
      const n = await pollInbox(ctx);
      if (acct.status !== 'ok') store.update('accounts', acct.id, { status: 'ok', lastError: '' });
      store.update('accounts', acct.id, { lastCheckAt: new Date().toISOString() });
      if (n) store.log('mail', `새 메일 ${n}통 처리`);
    } catch (err) {
      const auth = isAuthError(err);
      if (acct.status !== 'error') store.alert('urgent', `Gmail 받은편지함 확인 실패${auth ? ' — 자동 확인을 멈췄습니다' : ''}: ${explainMailError(err)}`);
      store.update('accounts', acct.id, { status: 'error', lastError: explainMailError(err), authFailed: auth });
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  setTimeout(tick, 5000).unref?.();
  return { stop: () => clearInterval(timer), tick };
}
