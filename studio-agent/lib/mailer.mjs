// 이메일 발송 — 대시보드 → 계정에 등록한 Gmail(앱 비밀번호)로 보냅니다.
// 등록하지 않으면 메일은 보내지 않고, 고객은 포털 링크에서 대화를 확인합니다.

import nodemailer from 'nodemailer';

export const GMAIL = { smtp: { host: 'smtp.gmail.com', port: 465, secure: true }, imap: { host: 'imap.gmail.com', port: 993, secure: true } };

// 발송 · 수신에 쓰는 Gmail 계정 (켜져 있는 첫 번째)
export function mailAccount(store) {
  return store.findOne('accounts', (a) => a.kind === 'gmail' && a.enabled !== false) ?? null;
}

export function accountAuth(store, acct) {
  return { user: acct.address, pass: store.vault.decrypt(acct.secret).replace(/\s+/g, '') };
}

let cached = { sig: '', transport: null };

function transport(store, acct) {
  const auth = accountAuth(store, acct);
  const sig = `${acct.id}:${acct.updatedAt}`;
  if (cached.sig !== sig) cached = { sig, transport: nodemailer.createTransport({ ...GMAIL.smtp, auth }) };
  return cached.transport;
}

function fromName(store) {
  const p = store.settings.profile;
  return (p.studioName || p.ownerName || '디자인 스튜디오').replace(/["<>]/g, '');
}

// 테스트에서 mailer.deliver 를 바꿔 끼웁니다.
// Gmail 앱 비밀번호는 영문 16자리입니다(화면에는 4자리씩 띄어 보임). 공백을 빼고 소문자로 맞춥니다.
export function normalizeAppPassword(raw) {
  return String(raw ?? '').replace(/\s+/g, '').toLowerCase();
}
export const APP_PASSWORD_HELP = "Google 계정 비밀번호가 아니라 '앱 비밀번호'(영문 16자리)를 넣어 주세요. Google 계정 → 보안 → 2단계 인증을 켠 뒤 → 앱 비밀번호(myaccount.google.com/apppasswords)에서 새로 만들 수 있습니다.";
export function checkAppPassword(raw) {
  return /^[a-z]{16}$/.test(normalizeAppPassword(raw)) ? null : APP_PASSWORD_HELP;
}

// Google이 아이디 · 비밀번호를 거부한 오류인지(이때는 같은 비밀번호로 다시 시도하면 안 됩니다)
export function isAuthError(err) {
  const text = `${err?.message ?? err ?? ''} ${err?.response ?? ''} ${err?.responseText ?? ''} ${err?.serverResponseCode ?? ''}`;
  return Boolean(err?.authenticationFailed) || /535|BadCredentials|Invalid login|AUTHENTICATIONFAILED|Invalid credentials|authenticationFailed/i.test(text);
}

// Gmail 로그인 실패를 대표가 알아듣는 말로 바꿉니다(원래 메시지는 뒤에 붙여 둡니다).
export function explainMailError(err) {
  const raw = String(err?.message ?? err ?? '');
  const text = `${raw} ${err?.response ?? ''} ${err?.responseText ?? ''} ${err?.serverResponseCode ?? ''}`;
  if (isAuthError(err)) {
    return `Google이 로그인을 거부했습니다. ${APP_PASSWORD_HELP} 앱 비밀번호를 지웠거나 Google 비밀번호를 바꾸면 앱 비밀번호도 다시 만들어야 합니다. (원문: ${raw.split('\n')[0].slice(0, 120)})`;
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|getaddrinfo/i.test(text)) return `Gmail 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요. (원문: ${raw.slice(0, 120)})`;
  return raw;
}

// Gmail 받은편지함(IMAP) 연결 — 연결이 끊기거나 시간이 초과돼도 프로그램이 꺼지지 않게 오류를 받아 둡니다.
export function imapClient(store, acct, ImapFlow) {
  const client = new ImapFlow({ ...GMAIL.imap, auth: accountAuth(store, acct), logger: false, socketTimeout: 60e3 });
  client.on('error', (err) => store.log('error', `Gmail 받은편지함 연결 오류: ${err.message}`));
  return client;
}

export const mailer = {
  async deliver(store, acct, message) {
    const info = await transport(store, acct).sendMail(message);
    return info.messageId;
  },

  // { to, subject, text, inReplyTo, references, attachments, headers }
  async send(store, msg) {
    const acct = mailAccount(store);
    if (!acct || !msg.to) return { sent: false, reason: '발송용 Gmail이 등록되지 않았거나 받는 사람이 없음' };
    const messageId = await this.deliver(store, acct, {
      from: `"${fromName(store)}" <${acct.address}>`,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      inReplyTo: msg.inReplyTo,
      references: msg.references,
      attachments: msg.attachments,
      headers: msg.headers,
    });
    return { sent: true, messageId };
  },

  async verify(store, acct) {
    await nodemailer.createTransport({ ...GMAIL.smtp, auth: accountAuth(store, acct) }).verify();
  },
};
