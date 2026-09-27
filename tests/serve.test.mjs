import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createStaticServer, listen, parseRange, mimeOf } from '../tools/lib/server.mjs';
import { tmpDir, write, REPO } from './helpers.mjs';

function request(port, pathname, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Raw request line (so '..' and '%2e' reach the server unnormalized). */
function rawRequest(port, rawPath) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write(`GET ${rawPath} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
    let data = '';
    sock.on('data', (d) => (data += d));
    sock.on('end', () => resolve(Number(data.split(' ')[1])));
    sock.on('error', reject);
  });
}

async function fixture() {
  const root = await tmpDir();
  const video = Buffer.alloc(1000);
  for (let i = 0; i < video.length; i++) video[i] = i % 256;
  await write(path.join(root, 'site', 'index.html'), '<!doctype html><title>home</title>');
  await write(path.join(root, 'site', '404.html'), '<!doctype html><title>없음</title>');
  await write(path.join(root, 'site', 'works', 'a', 'index.html'), 'work a');
  await write(path.join(root, 'site', 'media', 'works', 'a', 'main.mp4'), video);
  await write(path.join(root, 'site', 'assets', '한글 이름.txt'), '한글');
  await write(path.join(root, 'site', 'empty.txt'), '');
  await write(path.join(root, 'secret.txt'), 'outside the web root');
  // preview overlay
  await write(path.join(root, '.preview', 'index.html'), 'preview home');
  await write(path.join(root, '.preview', 'works', 'draft', 'index.html'), 'draft page');
  await write(path.join(root, 'media', 'works', 'draft', 'poster.jpg'), 'draft poster');
  return { root, video };
}

test('parseRange', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=900-', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=990-5000', 1000), { start: 990, end: 999 });
  assert.equal(parseRange('bytes=1000-', 1000), 'unsatisfiable');
  assert.equal(parseRange('bytes=5-2', 1000), 'unsatisfiable');
  assert.equal(parseRange('bytes=-0', 1000), 'unsatisfiable');
  assert.equal(parseRange('bytes=abc', 1000), 'unsatisfiable');
  assert.equal(parseRange('bytes=0-1,5-6', 1000), null);
  assert.equal(parseRange(undefined, 1000), null);
  assert.equal(parseRange('items=0-1', 1000), null);
  assert.equal(mimeOf('a.webmanifest'), 'application/manifest+json; charset=utf-8');
  assert.equal(mimeOf('A.MP4'), 'video/mp4');
  assert.equal(mimeOf('x.unknown'), 'application/octet-stream');
});

test('static server: pages, redirects, ranges, HEAD, 404, traversal', async (t) => {
  const { root, video } = await fixture();
  const server = createStaticServer({ layers: [{ dir: path.join(root, 'site') }], notFound: [path.join(root, 'site', '404.html')] });
  const port = await listen(server, { port: 0, host: '127.0.0.1' });
  t.after(() => server.close());

  let r = await request(port, '/');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(r.headers['cache-control'], 'no-cache');
  assert.equal(r.headers['accept-ranges'], 'bytes');
  assert.equal(r.body.toString(), '<!doctype html><title>home</title>');

  r = await request(port, '/works/a?x=1');
  assert.equal(r.status, 301);
  assert.equal(r.headers.location, '/works/a/?x=1');
  r = await request(port, '/works/a/');
  assert.equal(r.status, 200);
  assert.equal(r.body.toString(), 'work a');

  // Range
  r = await request(port, '/media/works/a/main.mp4', { headers: { Range: 'bytes=10-19' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers['content-range'], 'bytes 10-19/1000');
  assert.equal(r.headers['content-length'], '10');
  assert.equal(r.headers['content-type'], 'video/mp4');
  assert.deepEqual(r.body, video.subarray(10, 20));
  r = await request(port, '/media/works/a/main.mp4', { headers: { Range: 'bytes=-5' } });
  assert.equal(r.status, 206);
  assert.deepEqual(r.body, video.subarray(995));
  r = await request(port, '/media/works/a/main.mp4', { headers: { Range: 'bytes=5000-' } });
  assert.equal(r.status, 416);
  assert.equal(r.headers['content-range'], 'bytes */1000');
  r = await request(port, '/media/works/a/main.mp4');
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 1000);

  // HEAD
  r = await request(port, '/media/works/a/main.mp4', { method: 'HEAD' });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-length'], '1000');
  assert.equal(r.body.length, 0);
  r = await request(port, '/media/works/a/main.mp4', { method: 'HEAD', headers: { Range: 'bytes=0-9' } });
  assert.equal(r.status, 206);
  assert.equal(r.body.length, 0);

  // Korean file names (percent-encoded) and empty files
  r = await request(port, `/assets/${encodeURIComponent('한글 이름.txt')}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.toString(), '한글');
  r = await request(port, '/empty.txt');
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 0);

  // 404 page with 404 status
  r = await request(port, '/nope/');
  assert.equal(r.status, 404);
  assert.match(r.body.toString(), /없음/);
  assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');

  // other methods
  r = await request(port, '/', { method: 'POST' });
  assert.equal(r.status, 405);

  // traversal: every variant must fail and never serve secret.txt
  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%2e%2e%2fsecret.txt', '/..%5csecret.txt', '/works/%2e%2e/%2e%2e/secret.txt', '/%00', '/%E0%A4%A']) {
    const status = await rawRequest(port, p);
    assert.ok([400, 403, 404].includes(status), `${p} → ${status}`);
  }
  r = await request(port, '/..%2fsecret.txt');
  assert.ok(!r.body.toString().includes('outside the web root'));
});

test('preview overlay: .preview over site/, /media → raw media folder', async (t) => {
  const { root } = await fixture();
  const server = createStaticServer({
    layers: [{ dir: path.join(root, 'media'), prefix: '/media/' }, { dir: path.join(root, '.preview') }, { dir: path.join(root, 'site') }],
    notFound: [path.join(root, '.preview', '404.html'), path.join(root, 'site', '404.html')],
  });
  const port = await listen(server, { port: 0, host: '127.0.0.1' });
  t.after(() => server.close());
  assert.equal((await request(port, '/')).body.toString(), 'preview home');
  assert.equal((await request(port, '/works/draft/')).body.toString(), 'draft page');
  assert.equal((await request(port, '/works/a/')).body.toString(), 'work a'); // falls through to site/
  assert.equal((await request(port, '/media/works/draft/poster.jpg')).body.toString(), 'draft poster');
  assert.equal((await request(port, '/media/works/a/main.mp4')).status, 200); // site/media fallback
  assert.equal((await request(port, '/media/../secret.txt')).status, 404);
  // dotfiles (media/.cache.json, temp files) are never served
  await write(path.join(root, 'media', '.cache.json'), '{"jobs":{}}');
  assert.equal((await request(port, '/media/.cache.json')).status, 404);
  assert.equal((await request(port, '/media/works/.x.tmp-1.mp4')).status, 404);
  const nf = await request(port, '/missing');
  assert.equal(nf.status, 404);
  assert.match(nf.body.toString(), /없음/);
});

test('listen() moves to the next port when busy', async (t) => {
  const a = createStaticServer({ layers: [] });
  const p1 = await listen(a, { port: 0, host: '127.0.0.1' });
  t.after(() => a.close());
  const b = createStaticServer({ layers: [] });
  const p2 = await listen(b, { port: p1, host: '127.0.0.1' });
  t.after(() => b.close());
  assert.notEqual(p2, p1);
});

test('CLI: serve --preview prints URLs and serves', async () => {
  const { root } = await fixture();
  const child = spawn(process.execPath, [path.join(REPO, 'tools', 'serve.mjs'), '--root', root, '--preview', '--port', '0', '--host', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const port = await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`timeout: ${out}`)), 10000);
      child.stdout.on('data', (d) => {
        out += d;
        const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
        if (m && out.includes('Ctrl+C')) {
          clearTimeout(timer);
          assert.match(out, /미리보기/);
          resolve(Number(m[1]));
        }
      });
      child.on('exit', (code) => reject(new Error(`exited ${code}: ${out}`)));
    });
    const r = await request(port, '/works/draft/');
    assert.equal(r.status, 200);
  } finally {
    child.kill();
  }
});

/** Start serve.mjs and resolve with its full banner once it is listening. */
function startServe(args) {
  const child = spawn(process.execPath, [path.join(REPO, 'tools', 'serve.mjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const banner = new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`timeout: ${out}`)), 10000);
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes('Ctrl+C')) {
        clearTimeout(timer);
        resolve(out);
      }
    });
    child.on('exit', (code) => reject(new Error(`exited ${code}: ${out}`)));
  });
  return { child, banner };
}

test('CLI: the preview (unconsented works) listens on this computer only unless --lan', async () => {
  const { root } = await fixture();
  let { child, banner } = startServe(['--root', root, '--preview', '--port', '0']);
  try {
    const out = await banner;
    assert.match(out, /http:\/\/127\.0\.0\.1:\d+\//);
    assert.doesNotMatch(out, /휴대폰\(같은 와이파이\)/);
    assert.match(out, /--lan/);
  } finally {
    child.kill();
  }
  ({ child, banner } = startServe(['--root', root, '--preview', '--lan', '--port', '0']));
  try {
    const out = await banner;
    assert.match(out, /http:\/\/localhost:\d+\//);
    assert.match(out, /비공개 작업이 같은 네트워크의 모든 기기에 보입니다/);
  } finally {
    child.kill();
  }
});
