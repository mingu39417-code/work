// Build-side media resolution (spec §3.3): media/ + manifest.json → objects the templates render.
// Paths returned are site-root-relative without a leading slash ('media/works/<slug>/poster.jpg').
import path from 'node:path';
import fsp from 'node:fs/promises';
import { readJson, isFile, joinRel } from './fsutil.mjs';
import { imageSize } from './imagesize.mjs';

const MEDIA_PREFIX = 'media/';

export async function loadManifest(mediaDir) {
  const m = await readJson(path.join(mediaDir, 'manifest.json'), null);
  return m && typeof m === 'object' ? m : null;
}

/** Map every { file, w, h, duration, bytes } entry in the manifest by its file path. */
export function manifestIndex(manifest) {
  const index = new Map();
  const visit = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(visit);
    if (typeof v.file === 'string') index.set(v.file, v);
    for (const [k, child] of Object.entries(v)) if (k !== 'file') visit(child);
  };
  visit(manifest);
  return index;
}

function posInt(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

function makeResolver(mediaDir, index) {
  const has = (rel) => isFile(joinRel(mediaDir, rel));
  const dims = async (rel, { image = true } = {}) => {
    const e = index.get(rel);
    let w = posInt(e?.w);
    let h = posInt(e?.h);
    if ((!w || !h) && image) {
      const s = await imageSize(joinRel(mediaDir, rel));
      if (s) {
        w = s.w;
        h = s.h;
      }
    }
    return { w: w || null, h: h || null, duration: Number.isFinite(e?.duration) ? e.duration : null };
  };
  /** Image with optional smaller variants → { src, w, h, srcset } */
  const image = async (rel, variants = []) => {
    if (!(await has(rel))) return null;
    const d = await dims(rel);
    const srcset = [];
    for (const v of variants) {
      if (!(await has(v))) continue;
      const vd = await dims(v);
      if (vd.w) srcset.push({ src: MEDIA_PREFIX + v, w: vd.w });
    }
    if (d.w) srcset.push({ src: MEDIA_PREFIX + rel, w: d.w });
    return { src: MEDIA_PREFIX + rel, w: d.w, h: d.h, srcset: dedupeSrcset(srcset) };
  };
  const video = async (rel, withDuration = false) => {
    if (!(await has(rel))) return null;
    const d = await dims(rel, { image: false });
    const out = { src: MEDIA_PREFIX + rel, w: d.w, h: d.h };
    if (withDuration) out.duration = d.duration;
    return out;
  };
  return { has, dims, image, video };
}

/** Keep one entry per width (first wins — variants are listed before the full-size file), sorted ascending. */
function dedupeSrcset(list) {
  const seen = new Set();
  return list
    .filter((s) => (seen.has(s.w) ? false : (seen.add(s.w), true)))
    .sort((a, b) => a.w - b.w);
}

async function listDir(dir) {
  try {
    return await fsp.readdir(dir);
  } catch {
    return [];
  }
}

/** Resolve the media object for one normalized work (spec §3.3). */
export async function resolveWorkMedia({ mediaDir, work, index = new Map() }) {
  const r = makeResolver(mediaDir, index);
  const base = `works/${work.slug}`;
  const poster = await r.image(`${base}/poster.jpg`, [`${base}/poster-640.webp`, `${base}/poster-1280.webp`]);
  const preview = await r.video(`${base}/preview.mp4`);
  const main = work.video ? null : await r.video(`${base}/main.mp4`, true);
  const ogRel = `${base}/og.jpg`;
  const og = (await r.has(ogRel)) ? { src: MEDIA_PREFIX + ogRel, w: 1200, h: 630 } : null;

  const files = await listDir(joinRel(mediaDir, base));
  const pairNums = [
    ...new Set(
      files
        .map((f) => f.match(/^ba-(\d+)-(?:before|after)\.webp$/))
        .filter(Boolean)
        .map((m) => Number(m[1])),
    ),
  ].sort((a, b) => a - b);
  const comparisons = [];
  for (const n of pairNums) {
    const before = await r.image(`${base}/ba-${n}-before.webp`, [`${base}/ba-${n}-before-960.webp`]);
    const after = await r.image(`${base}/ba-${n}-after.webp`, [`${base}/ba-${n}-after-960.webp`]);
    if (!before || !after) continue;
    const meta = work.comparisons?.[n - 1] || {};
    comparisons.push({
      before,
      after,
      video: await r.video(`${base}/ba-${n}.mp4`),
      caption: meta.caption || '',
      beforeLabel: meta.beforeLabel || 'BEFORE',
      afterLabel: meta.afterLabel || 'AFTER',
    });
  }

  const stillFiles = (await listDir(joinRel(mediaDir, `${base}/stills`)))
    .map((f) => f.match(/^(\d+)\.webp$/))
    .filter(Boolean)
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  const stills = [];
  for (const m of stillFiles) {
    const rel = `${base}/stills/${m[0]}`;
    const img = await r.image(rel, [`${base}/stills/${m[1]}-960.webp`]);
    if (img) stills.push({ ...img, alt: `${work.title} 스틸 ${stills.length + 1}` });
  }

  return { poster, preview, main, embed: work.video || null, og, comparisons, stills };
}

/** Resolve the showreel (spec §3.3). reel.publish === false → everything null. */
export async function resolveReel({ mediaDir, site, index = new Map() }) {
  const cfg = site.reel;
  const empty = { loop: null, full: null, poster: null, embed: null, title: cfg.title, fps: cfg.fps };
  if (!cfg.publish) return empty;
  const r = makeResolver(mediaDir, index);
  return {
    loop: await r.video('reel/reel-loop.mp4'),
    full: cfg.embed ? null : await r.video('reel/reel.mp4', true),
    poster: await r.image('reel/poster.jpg', ['reel/poster-640.webp', 'reel/poster-1280.webp']),
    embed: cfg.embed || null,
    title: cfg.title,
    fps: cfg.fps,
  };
}

/** Visibility rule (spec §2.4). Returns the list of Korean reasons a work is hidden ([] = published). */
export function hiddenReasons(work, media) {
  const reasons = [];
  if (work.publish !== true) reasons.push('publish: false (비공개 설정)');
  if (work.consent === 'pending') reasons.push("consent: 'pending' (공개 동의 대기)");
  if (!media?.poster) reasons.push('포스터 이미지 없음 (raw/ 준비 후 npm run media)');
  return reasons;
}

export function isPublished(work, media) {
  return hiddenReasons(work, media).length === 0;
}

/** Every site-relative media path referenced by a work media object or reel object. */
export function referencedMediaFiles(obj) {
  const out = new Set();
  const add = (img) => {
    if (!img) return;
    if (img.src) out.add(img.src);
    for (const s of img.srcset || []) if (s.src) out.add(s.src);
  };
  if (!obj) return [];
  // work media
  add(obj.poster);
  add(obj.preview);
  add(obj.main);
  add(obj.og);
  for (const c of obj.comparisons || []) {
    add(c.before);
    add(c.after);
    add(c.video);
  }
  for (const s of obj.stills || []) add(s);
  // reel
  add(obj.loop);
  add(obj.full);
  return [...out].filter((p) => p.startsWith(MEDIA_PREFIX));
}
