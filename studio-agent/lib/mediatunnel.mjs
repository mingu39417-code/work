// 이미지 전용 임시 공개 주소 — 인스타그램은 이미지를 인터넷 주소로 직접 내려받아 갑니다.
// 게시하는 동안만: ① 이미지만 내보내는 작은 서버를 따로 띄우고 ② Cloudflare 무료 터널(cloudflared)로 임시 https 주소를 연 뒤
// ③ 게시가 끝나면 둘 다 닫습니다. 대시보드 · 고객 정보는 이 주소로 절대 열리지 않습니다.

import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const CANDIDATES = [
  process.env.CLOUDFLARED,
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  'C:\\Program Files\\cloudflared\\cloudflared.exe',
  '/opt/homebrew/bin/cloudflared',
  '/usr/local/bin/cloudflared',
  '/usr/bin/cloudflared',
].filter(Boolean);

export function cloudflaredPath() {
  return CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) ?? null;
}

// serve(token) → JPEG Buffer 또는 null
export async function openMediaTunnel(serve, { timeoutMs = 45000 } = {}) {
  const bin = cloudflaredPath();
  if (!bin) throw new Error('이미지 임시 공개 프로그램(cloudflared)이 설치되어 있지 않습니다');
  const server = http.createServer(async (req, res) => {
    const m = /^\/m\/([\w-]{20,})\.jpg$/.exec(req.url.split('?')[0]);
    const jpg = m && req.method === 'GET' ? await Promise.resolve(serve(m[1])).catch(() => null) : null;
    if (!jpg) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': jpg.length });
    res.end(jpg);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const proc = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { windowsHide: true });
  const close = async () => {
    try { proc.kill(); } catch { /* 이미 꺼짐 */ }
    await new Promise((r) => server.close(() => r()));
  };
  try {
    const url = await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error('임시 공개 주소를 만들지 못했습니다(시간 초과)')), timeoutMs);
      const onData = (d) => {
        buf += d.toString();
        const hit = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (hit) { clearTimeout(timer); resolve(hit[0]); }
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`cloudflared가 종료됐습니다(코드 ${code})`)); });
    });
    // 새 주소가 인터넷에서 열릴 때까지 잠깐 기다립니다.
    for (let i = 0; i < 20; i++) {
      try { const r = await fetch(`${url}/m/ping-ping-ping-ping-ping.jpg`); if (r.status === 404) break; } catch { /* 아직 */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return { url, close };
  } catch (err) {
    await close();
    throw err;
  }
}