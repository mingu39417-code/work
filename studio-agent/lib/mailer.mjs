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
