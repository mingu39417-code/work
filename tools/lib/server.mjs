// Tiny static file server for local checks (Range, HEAD, 301 slash redirects, 404 page, traversal-safe).
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { isInside } from './fsutil.mjs';
import { c } from './log.mjs';

export const MIME = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  vtt: 'text/vtt; charset=utf-8',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  xml: 'application/xml; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  pdf: 'application/pdf',
};

export function mimeOf(file) {
  return MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
}

async function statOrNull(p) {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

/**
 * Parse a single-range "Range" header. Returns
 *   null            → no/ignorable header (serve 200)
 *   { start, end }  → satisfiable
 *   'unsatisfiable' → 416
 */
export function parseRange(header, size) {
  if (!header) return null;
  const h = String(header).trim();
  if (!h.startsWith('bytes=')) return null;
  const spec = h.slice(6).trim();
  if (spec.includes(',')) return null; // multiple ranges: serve the whole file (allowed by RFC 9110)
  const m = /^(\d*)-(\d*)$/.exec(spec);
  if (!m || (m[1] === '' && m[2] === '')) return 'unsatisfiable';
  let start;
  let end;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/**
 * layers: [{ dir, prefix = '/' }] searched in order (first hit wins).
 *   e.g. preview: [{ dir: <root>/media, prefix: '/media/' }, { dir: <root>/.preview }, { dir: <root>/site }]
 * notFound: list of candidate 404.html files (first existing is used).
 */
export function createStaticServer({ layers, notFound = [], log = null }) {
  const bases = layers.map((l) => ({ dir: path.resolve(l.dir), prefix: l.prefix || '/' }));

  async function resolve(pathname) {
    const segs = pathname.split('/').filter(Boolean);
    for (const layer of bases) {
      if (!pathname.startsWith(layer.prefix)) continue;
      const rest = layer.prefix === '/' ? segs : pathname.slice(layer.prefix.length).split('/').filter(Boolean);
      const abs = path.join(layer.dir, ...rest);
      if (!isInside(layer.dir, abs)) continue;
      const st = await statOrNull(abs);
      if (!st) continue;
      if (st.isDirectory()) {
        if (!pathname.endsWith('/')) return { redirect: true };
        const index = path.join(abs, 'index.html');
        const ist = await statOrNull(index);
        if (ist && ist.isFile()) return { file: index, stat: ist };
        continue;
      }
      if (st.isFile()) return { file: abs, stat: st };
    }
    return null;
  }

  function send(req, res, status, headers, body) {
    res.writeHead(status, { 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  function sendFile(req, res, file, st, status = 200) {
    const size = st.size;
    const headers = {
      'Content-Type': mimeOf(file),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      'Last-Modified': st.mtime.toUTCString(),
      'X-Content-Type-Options': 'nosniff',
    };
    let start = 0;
    let end = size - 1;
    if (status === 200) {
      const range = parseRange(req.headers.range, size);
      if (range === 'unsatisfiable') {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
        res.end();
        return 416;
      }
      if (range) {
        start = range.start;
        end = range.end;
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      }
    }
    headers['Content-Length'] = size === 0 ? 0 : end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || size === 0) {
      res.end();
      return status;
    }
    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    return status;
  }

  async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(req, res, 405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
      return 405;
    }
    let url;
    let pathname;
    try {
      url = new URL(req.url, 'http://localhost');
      pathname = decodeURIComponent(url.pathname);
    } catch {
      send(req, res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad Request');
      return 400;
    }
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.includes(':') || pathname.split('/').some((s) => s === '..' || s === '.')) {
      send(req, res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden');
      return 403;
    }
    // dotfiles are never content (media/.cache.json, .x.tmp-123.mp4, .DS_Store …): answer like a missing file
    const hidden = pathname.split('/').some((seg) => seg.startsWith('.'));
    const hit = hidden ? null : await resolve(pathname);
    if (hit?.redirect) {
      send(req, res, 301, { Location: `${url.pathname}/${url.search}`, 'Content-Type': 'text/plain; charset=utf-8' }, 'Moved Permanently');
      return 301;
    }
    if (hit) return sendFile(req, res, hit.file, hit.stat);
    for (const f of notFound) {
      const st = await statOrNull(f);
      if (st && st.isFile()) return sendFile(req, res, f, st, 404);
    }
    send(req, res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
    return 404;
  }

  return http.createServer((req, res) => {
    const t0 = Date.now();
    handle(req, res)
      .then((status) => {
        if (!log) return;
        const color = status >= 500 ? c.red : status >= 400 ? c.yellow : status >= 300 ? c.cyan : c.gray;
        const range = status === 206 ? c.gray(` ${req.headers.range}`) : '';
        log(`${color(String(status))} ${req.method === 'HEAD' ? 'HEAD ' : ''}${safeDisplay(req.url)}${range} ${c.gray(`${Date.now() - t0}ms`)}`);
      })
      .catch((err) => {
        if (!res.headersSent) send(req, res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Internal Server Error');
        else res.destroy();
        if (log) log(`${c.red('500')} ${safeDisplay(req.url)} ${err.message}`);
      });
  });
}

function safeDisplay(u) {
  try {
    return decodeURI(u);
  } catch {
    return u;
  }
}

/** Listen on port, trying the next ports if busy. Resolves with the bound port. */
export function listen(server, { port = 4173, host = '0.0.0.0', tries = 20 } = {}) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPort = (p) => {
      const onError = (err) => {
        server.off('listening', onListening);
        if ((err.code === 'EADDRINUSE' || err.code === 'EACCES') && attempt < tries && p !== 0) {
          attempt++;
          tryPort(p + 1);
        } else reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve(server.address().port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, host);
    };
    tryPort(port);
  });
}

/** LAN IPv4 addresses (for testing on a phone on the same Wi-Fi). */
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
    }
  }
  return out;
}
