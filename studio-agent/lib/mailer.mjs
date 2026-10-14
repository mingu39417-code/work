// 이메일 발송 (선택) — 설정 → 이메일(SMTP)을 채우면 켜집니다.
// 비워 두면 메일은 보내지 않고, 고객은 포털 링크에서 대화를 확인합니다.

import nodemailer from 'nodemailer';

export function smtpReady(settings) {
  const s = settings.smtp ?? {};
  return Boolean(s.host && s.from);
}

let cached = { sig: '', transport: null };

function transport(settings) {
  const s = settings.smtp;
  const sig = JSON.stringify(s);
  if (cached.sig !== sig) {
    cached = {
      sig,
      transport: nodemailer.createTransport({
        host: s.host,
        port: Number(s.port) || 587,
        secure: Boolean(s.secure),
        auth: s.user ? { user: s.user, pass: s.pass } : undefined,
      }),
    };
  }
  return cached.transport;
}

// sender는 테스트에서 바꿔 끼웁니다.
export const mailer = {
  async send(settings, { to, subject, text }) {
    if (!smtpReady(settings) || !to) return { sent: false, reason: 'SMTP 미설정 또는 받는 사람 없음' };
    await transport(settings).sendMail({ from: settings.smtp.from, to, subject, text });
    return { sent: true };
  },
};
