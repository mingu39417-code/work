// 대시보드 비밀번호를 잊었을 때 — 비밀번호만 지우고 나머지(API 키 · 고객 · 프로젝트)는 그대로 둡니다.
// 사용법: 프로그램을 끈 뒤  node reset-password.mjs  → 다시 켜면 '처음 설정' 화면에서 새 비밀번호를 정합니다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(process.env.DATA_DIR ?? path.join(here, 'data'), 'db.json');
if (!fs.existsSync(file)) {
  console.log('아직 데이터가 없습니다. 프로그램을 켜면 처음 설정 화면이 나옵니다.');
  process.exit(0);
}
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
db.settings.auth = { ...db.settings.auth, passwordHash: '', sessions: [] };
fs.writeFileSync(file, JSON.stringify(db, null, 2));
console.log('비밀번호를 지웠습니다. 프로그램을 다시 켜고 대시보드에서 새 비밀번호를 정하세요.');
