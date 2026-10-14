// 더블클릭 실행용 — start-windows.bat(Windows) / start-mac.command(Mac)가 이 파일을 실행합니다.
// 1) 필요한 부품이 없으면 설치  2) 서버 켜기  3) 브라우저로 대시보드 열기
// 이미 켜져 있으면 브라우저만 엽니다.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4300;
const HOST = process.env.HOST || '127.0.0.1';
const URL = `http://localhost:${PORT}/admin`;

function pause(code) {
  // 창이 바로 닫혀 오류를 못 보는 일이 없도록 Enter를 기다립니다.
  console.log('\n창을 닫으려면 Enter 키를 누르세요.');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(code));
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
  const manual = () => console.log(`브라우저에서 직접 여세요: ${url}`);
  try {
    const child = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true });
    child.on('error', manual);
    child.unref();
  } catch {
    manual();
  }
}

function depsReady() {
  return ['@anthropic-ai/sdk', 'nodemailer', 'imapflow', 'mailparser'].every((d) => fs.existsSync(path.join(here, 'node_modules', d, 'package.json')));
}

async function alreadyRunning() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/auth/status`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.log(`Node.js ${process.versions.node} 은 너무 오래된 버전입니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.`);
  openBrowser('https://nodejs.org');
  pause(1);
} else if (await alreadyRunning()) {
  console.log('이미 실행 중입니다. 대시보드를 엽니다.');
  openBrowser(URL);
  setTimeout(() => process.exit(0), 1500);
} else {
  if (!depsReady()) {
    console.log('처음 실행 — 필요한 부품을 설치합니다 (1~2분, 인터넷 필요)...\n');
    const r = spawnSync('npm install --no-audit --no-fund', { cwd: here, stdio: 'inherit', shell: true });
    if (r.status !== 0 || !depsReady()) {
      console.log('\n설치에 실패했습니다. 인터넷 연결을 확인하고 다시 실행하세요.');
      pause(1);
    }
  }
  if (depsReady()) {
    const { createApp } = await import('./server.mjs');
    const app = createApp();
    app.server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') console.log(`\n${PORT}번 포트를 다른 프로그램이 쓰고 있습니다. 그 프로그램을 끄고 다시 실행하세요.`);
      else console.log(`\n실행 오류: ${err.message}`);
      pause(1);
    });
    app.server.listen(PORT, HOST, () => {
      console.log('\n  ✅ 스튜디오 에이전트가 켜졌습니다');
      console.log(`  대시보드    ${URL}`);
      console.log(`  문의 양식   http://localhost:${PORT}/`);
      console.log('\n  이 창을 닫으면 프로그램이 꺼집니다. 쓰는 동안 열어 두세요.\n');
      openBrowser(URL);
    });
  }
}
