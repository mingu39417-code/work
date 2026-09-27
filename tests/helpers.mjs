// Shared test helpers: temp projects, fake image headers, ffmpeg helpers.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const TEMPLATES = path.join(REPO, 'src', 'templates', 'index.mjs');
export const hasTemplates = () => fs.existsSync(TEMPLATES);

/** The binaries the tools use (FFMPEG_PATH / FFPROBE_PATH, else PATH) — tests spawn exactly these. */
export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH || (process.env.FFMPEG_PATH ? path.join(path.dirname(process.env.FFMPEG_PATH), `ffprobe${path.extname(process.env.FFMPEG_PATH)}`) : 'ffprobe');

export function hasFfmpeg() {
  const a = spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' });
  const b = spawnSync(FFPROBE, ['-version'], { stdio: 'ignore' });
  return a.status === 0 && b.status === 0;
}

const created = [];
process.on('exit', () => {
  if (process.env.KEEP_TEST_TMP) return;
  for (const d of created) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

/** Temp folder removed when the test process exits (set KEEP_TEST_TMP=1 to inspect). */
export async function tmpDir(prefix = 'tonecraft-test-') {
  const d = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  created.push(d);
  return d;
}

export async function write(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, data);
}

/** Minimal PNG header with the given size (enough for imagesize). */
export function fakePng(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  b[24] = 8;
  b[25] = 2;
  return b;
}

/** Minimal JPEG: SOI, an APP0 segment, SOF0 with size. */
export function fakeJpeg(w, h, { app1 = 0 } = {}) {
  const parts = [Buffer.from([0xff, 0xd8])];
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  parts.push(app0);
  // optional big APP1 segments (EXIF-like) to push SOF beyond the first 64 KB
  let remaining = app1;
  while (remaining > 0) {
    const len = Math.min(65533, remaining);
    const seg = Buffer.alloc(len + 2);
    seg[0] = 0xff;
    seg[1] = 0xe1;
    seg.writeUInt16BE(len, 2);
    parts.push(seg);
    remaining -= len;
  }
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  parts.push(sof, Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

/** Minimal WebP (VP8X canvas header). */
export function fakeWebp(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(22, 4);
  b.write('WEBP', 8, 'ascii');
  b.write('VP8X', 12, 'ascii');
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
}

export const BASE_SITE = {
  siteUrl: '',
  brand: { name: 'TONECRAFT', person: '임민규', role: '컬러리스트', tagline: '장면의 온도를 설계합니다' },
  contact: { email: 'crafttone3@gmail.com', kmongUrl: '' },
  categories: [
    { id: 'commercial', label: '광고' },
    { id: 'music-video', label: '뮤직비디오' },
    { id: 'film', label: '영화' },
  ],
  services: [{ id: 'grading', title: '컬러 그레이딩', en: 'COLOR GRADING', summary: '룩 개발부터 최종 마스터까지', points: ['룩 개발'] }],
  process: [{ title: '상담', body: '...' }],
  about: { paragraphs: ['소개 문단'], facts: [] },
  faq: [{ q: '질문?', a: '답' }],
  seo: { title: 'TONECRAFT — 컬러 그레이딩', description: '설명', keywords: ['컬러 그레이딩'] },
};

/**
 * Create a project folder: content/site.mjs, content/works.mjs and processed media for the given slugs.
 * media: { [slug]: { poster?: true, ba?: n, stills?: n, preview?: true, main?: true, og?: true } }
 */
export async function makeProject({ site = BASE_SITE, works = [], media = {}, reel = false } = {}) {
  const root = await tmpDir();
  await write(path.join(root, 'content', 'site.mjs'), `export default ${JSON.stringify(site, null, 2)};\n`);
  await write(path.join(root, 'content', 'works.mjs'), `export default ${JSON.stringify(works, null, 2)};\n`);
  for (const [slug, m] of Object.entries(media)) await addMedia(root, slug, m);
  if (reel) {
    const d = path.join(root, 'media', 'reel');
    await write(path.join(d, 'reel.mp4'), Buffer.alloc(2048, 1));
    await write(path.join(d, 'reel-loop.mp4'), Buffer.alloc(1024, 2));
    await write(path.join(d, 'poster.jpg'), fakeJpeg(1920, 1080));
    await write(path.join(d, 'poster-1280.webp'), fakeWebp(1280, 720));
    await write(path.join(d, 'poster-640.webp'), fakeWebp(640, 360));
  }
  return root;
}

export async function addMedia(root, slug, m = {}) {
  const d = path.join(root, 'media', 'works', slug);
  const { poster = true, ba = 0, stills = 0, preview = true, main = false, og = true, baVideo = false } = m;
  if (poster) {
    await write(path.join(d, 'poster.jpg'), fakeJpeg(1920, 1080));
    await write(path.join(d, 'poster-1920.webp'), fakeWebp(1920, 1080));
    await write(path.join(d, 'poster-1280.webp'), fakeWebp(1280, 720));
    await write(path.join(d, 'poster-640.webp'), fakeWebp(640, 360));
  }
  if (og) await write(path.join(d, 'og.jpg'), fakeJpeg(1200, 630));
  if (preview) await write(path.join(d, 'preview.mp4'), Buffer.alloc(512, 3));
  if (main) await write(path.join(d, 'main.mp4'), Buffer.alloc(4096, 4));
  for (let n = 1; n <= ba; n++) {
    for (const side of ['before', 'after']) {
      await write(path.join(d, `ba-${n}-${side}.webp`), fakeWebp(1920, 800));
      await write(path.join(d, `ba-${n}-${side}-1280.webp`), fakeWebp(1280, 534));
      await write(path.join(d, `ba-${n}-${side}-960.webp`), fakeWebp(960, 400));
    }
    if (baVideo) await write(path.join(d, `ba-${n}.mp4`), Buffer.alloc(256, 5));
  }
  for (let i = 1; i <= stills; i++) {
    const nn = String(i).padStart(2, '0');
    await write(path.join(d, 'stills', `${nn}.webp`), fakeWebp(1920, 1080));
    await write(path.join(d, 'stills', `${nn}-960.webp`), fakeWebp(960, 540));
  }
}

export function work(slug, extra = {}) {
  return { slug, title: `작품 ${slug}`, category: 'commercial', year: 2026, publish: true, consent: 'granted', ...extra };
}

/** Recursively read every file under dir → [{ rel, buf }] */
export async function readTree(dir) {
  const out = [];
  async function rec(abs, rel) {
    let ents;
    try {
      ents = await fsp.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const a = path.join(abs, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await rec(a, r);
      else out.push({ rel: r, buf: await fsp.readFile(a) });
    }
  }
  await rec(dir, '');
  return out;
}

/** A logger that captures output instead of printing. */
export function silentLogger() {
  const lines = [];
  const push = (p) => (s = '') => lines.push(`${p}${s}`);
  return { lines, quiet: true, log: push(''), info: push(''), step: push(''), ok: push('✓ '), warn: push('! '), error: push('✗ ') };
}
