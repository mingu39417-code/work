// 계정 보관함 — 비밀번호(앱 비밀번호 · 토큰)를 AES-256-GCM으로 암호화해 저장합니다.
// 암호화 키는 data/secret.key 에 따로 두므로, db.json 만 새어 나가도 비밀번호는 읽을 수 없습니다.
// (같은 컴퓨터를 통째로 가져간 경우까지 막지는 못합니다 — 컴퓨터 로그인 비밀번호를 꼭 쓰세요.)

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class Vault {
  constructor(dir) {
    const file = path.join(dir, 'secret.key');
    if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
    this.key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  }

  encrypt(text) {
    if (!text) return '';
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
    return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
  }

  decrypt(blob) {
    if (!blob) return '';
    const [v, iv, tag, ct] = String(blob).split(':');
    if (v !== 'v1') throw new Error('알 수 없는 암호화 형식');
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  }
}
