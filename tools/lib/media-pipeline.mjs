// raw/ → media/ processing (spec §3). Incremental, color-managed (BT.709 video, sRGB-coded stills).
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { loadContent, SLUG_RE } from './content.mjs';
import {
  findFfmpeg,
  FFMPEG_HELP,
  runFfmpeg,
  runCaptureAll,
  probe,
  mediaInfo,
  rangeOf,
  videoScaleFilter,
  videoScaleExactFilter,
  rgbMasterFilter,
  jpegFromRgbFilter,
  webpFromRgbFilter,
  x264Args,
  IMAGE_INPUT,
} from './ffmpeg.mjs';
import { CROPDETECT, parseCropdetect, measureBars, decideCrop, sampleTimes, mapCrop, introEnd } from './letterbox.mjs';
import { imageSize } from './imagesize.mjs';
import { readJson, writeFileAtomic, statOrNull, isDir, isFile, renameWithRetry, hashString, rmrf, walkFiles, joinRel, toPosix, removeEmptyDirs } from './fsutil.mjs';
import { createLogger, c, formatBytes, formatDuration } from './log.mjs';

/** Bump when an encoding recipe changes so every output is rebuilt once. */
export const PIPELINE_VERSION = 6;
/** Bump when the letterbox / reel-intro analysis changes so cached detections are redone. */
export const DETECT_VERSION = 1;

export const VIDEO_EXT = ['mp4', 'mov', 'mxf', 'mkv', 'm4v', 'avi', 'webm'];
export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp', 'bmp', 'dpx'];
const extOf = (f) => path.extname(f).slice(1).toLowerCase();
export const isVideoFile = (f) => VIDEO_EXT.includes(extOf(f));
export const isImageFile = (f) => IMAGE_EXT.includes(extOf(f));

const HDR_MSG = 'HDR 소스입니다 — Resolve에서 SDR Rec.709로 내보낸 파일을 사용하세요';

export const MB = 1024 * 1024;

// Encoding recipes (spec §3.2). Sizes are a maxW × maxW box: the long edge is capped (vertical masters too).
export const RECIPES = {
  // level 4.1 → x264 clamps reference frames so every phone decodes 1080p; the VBV ceiling only trims grain peaks
  main: { maxW: 1920, crf: 20, preset: 'slow', audio: '192k', level: '4.1', maxrate: '12M', bufsize: '24M' },
  reel: { maxW: 1920, crf: 20, preset: 'slow', audio: '192k', level: '4.1', maxrate: '12M', bufsize: '24M' },
  // hero background: autoplays on every phone, so short and capped (≈ 3 MB for 20 s)
  loop: { maxW: 1280, crf: 27, preset: 'medium', maxDuration: 20, maxrate: '1200k', bufsize: '2400k' },
  preview: { maxW: 960, crf: 26, preset: 'medium' },
  baVideo: { maxW: 1280, crf: 23, preset: 'medium' },
  posterJpgW: 1920,
  posterWebp: [1920, 1280, 640],
  posterQuality: 82,
  baWebp: [1920, 1280, 960],
  baQuality: 88,
  stillQuality: 82,
  og: { w: 1200, h: 630 },
};

const LOOP_WARN_BYTES = 4 * MB;
const HOSTING_WARN_BYTES = 25 * MB;

// Explorer / Finder order: still-2 before still-10, case-insensitive; the code-unit tie-break keeps it deterministic.
const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
export const naturalCompare = (a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------------------------------------
// raw scanning

async function listFiles(dir) {
  try {
    const ents = await fsp.readdir(dir, { withFileTypes: true });
    return ents.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name).sort(naturalCompare);
  } catch {
    return [];
  }
}

async function listDirs(dir) {
  try {
    const ents = await fsp.readdir(dir, { withFileTypes: true });
    return ents.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort(naturalCompare);
  } catch {
    return [];
  }
}

/** Inventory of one raw work folder. */
export async function scanRawWork(dir) {
  const files = await listFiles(dir);
  const warnings = [];
  const mains = files.filter((f) => /^main\.[^.]+$/i.test(f) && isVideoFile(f));
  const posters = files.filter((f) => /^poster\.[^.]+$/i.test(f) && isImageFile(f));
  if (mains.length > 1) warnings.push(`main 영상이 여러 개입니다 (${mains.join(', ')}) — ${mains[0]} 사용`);
  if (posters.length > 1) warnings.push(`poster 이미지가 여러 개입니다 (${posters.join(', ')}) — ${posters[0]} 사용`);
  const sides = new Map();
  for (const f of files) {
    const m = f.match(/^(before|after)-(\d+)\.[^.]+$/i);
    if (!m || !(isVideoFile(f) || isImageFile(f))) continue;
    const n = Number(m[2]);
    const side = m[1].toLowerCase();
    const cur = sides.get(n) || {};
    if (cur[side]) warnings.push(`${side}-${n} 파일이 여러 개입니다 — ${cur[side]} 사용`);
    else cur[side] = f;
    sides.set(n, cur);
  }
  const pairs = [];
  for (const n of [...sides.keys()].sort((a, b) => a - b)) {
    const p = sides.get(n);
    if (p.before && p.after) pairs.push({ n, before: path.join(dir, p.before), after: path.join(dir, p.after) });
    else warnings.push(`${p.before ? `before-${n}` : `after-${n}`}의 짝(${p.before ? 'after' : 'before'}-${n})이 없어 건너뜁니다`);
  }
  const stillsDir = path.join(dir, 'stills');
  const stills = (await listFiles(stillsDir)).filter(isImageFile).map((f) => path.join(stillsDir, f));
  const ignored = files.filter(
    (f) => !mains.includes(f) && !posters.includes(f) && !/^(before|after)-\d+\./i.test(f) && !/^(readme|notes?)\b/i.test(f) && !/^(thumbs\.db|desktop\.ini)$/i.test(f),
  );
  return {
    main: mains[0] ? path.join(dir, mains[0]) : null,
    poster: posters[0] ? path.join(dir, posters[0]) : null,
    pairs,
    stills,
    ignored,
    warnings,
  };
}

// ---------------------------------------------------------------------------------------------
// job helpers

function tmpPath(out) {
  const ext = path.extname(out);
  return path.join(path.dirname(out), `.${path.basename(out, ext)}.tmp-${process.pid}${ext}`);
}

const clampTime = (t, duration, room = 0.1) => {
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, t || 0);
  return Math.max(0, Math.min(t || 0, Math.max(0, duration - room)));
};

/** Default poster time: 30% of the duration, at most 20 s (spec §2.2). */
export function defaultPosterTime(duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(duration * 0.3, 20);
}

function capFpsFilter(info, max = 30.5) {
  let fps = info?.fps;
  if (!fps || fps <= max) return '';
  while (fps > max) fps /= 2;
  return `,fps=${Math.round(fps * 1000) / 1000}`;
}

/**
 * How a master's audio becomes the site's AAC track. Dispatches on track / channel counts — channel-layout labels
 * are unreliable (discrete 8-channel exports probe as '7.1').
 *   stereo (or mono) first track → as is · two mono tracks (MXF OP1a / MOV per-channel deliverables) → joined L/R
 *   5.1 → standard stereo downmix · any other multichannel track (stereo mix + stems) → channels 1-2 only
 */
export function audioPlan(info) {
  const tracks = info?.audio?.length ? info.audio : info?.hasAudio ? [{ channels: info.audioChannels || 0 }] : [];
  if (!tracks.length) return { key: 'none', args: ['-an'] };
  const [a0, a1] = tracks;
  if (a0.channels === 1 && a1?.channels === 1) {
    return {
      key: 'join2',
      filter: '[0:a:0][0:a:1]join=inputs=2:channel_layout=stereo[aout]',
      args: ['-map', '[aout]'],
      note: `모노 오디오 트랙 ${tracks.length}개 — 1·2번 트랙을 스테레오(L/R)로 합침`,
    };
  }
  if (!a0.channels || a0.channels <= 2) return { key: 'map', args: ['-map', '0:a:0'] };
  if (a0.channels === 6) return { key: 'down51', args: ['-map', '0:a:0', '-ac', '2'] };
  return {
    key: 'pan12',
    args: ['-map', '0:a:0', '-af', 'pan=stereo|c0=c0|c1=c1'],
    warn: `오디오 채널이 ${a0.channels}개입니다 — 1·2번 채널(스테레오 믹스)만 사용합니다. 믹스가 다른 채널에 있다면 Resolve에서 스테레오 트랙으로 다시 내보내세요`,
  };
}

const COMMON_OUT = ['-map_metadata', '-1', '-map_chapters', '-1'];

const cropNote = (crop) => (crop ? `레터박스 감지: ${crop.w}x${crop.h}로 자름` : '');

/**
 * Media processor bound to one project root.
 */
export class MediaProcessor {
  constructor({ root, tools, log, force = false, dryRun = false, preset = process.env.TONECRAFT_X264_PRESET || '', concurrency }) {
    this.root = root;
    this.rawDir = path.join(root, 'raw');
    this.mediaDir = path.join(root, 'media');
    this.tools = tools;
    this.log = log;
    this.force = force;
    this.dryRun = dryRun;
    this.presetOverride = preset;
    const cpus = os.cpus()?.length || 2;
    this.concurrency = concurrency || Number(process.env.TONECRAFT_MEDIA_JOBS) || (cpus >= 8 ? 3 : 2);
    // detect: letterbox / leading-black analysis per input file · crops: crop applied per job (→ manifest)
    this.cache = { version: 1, jobs: {}, probe: {}, detect: {}, crops: {} };
    this.probeCache = new Map();
    this.detectMemo = new Map();
    this.stats = { ran: 0, skipped: 0, failed: 0, failures: [], warnings: [], cropped: 0 };
    this.tmpDir = null;
    this.status = new Map();
  }

  preset(recipe) {
    return this.presetOverride || recipe.preset;
  }

  rel(abs) {
    return toPosix(path.relative(this.root, abs));
  }

  warn(msg) {
    this.stats.warnings.push(msg);
    this.clearStatus();
    this.log.warn(msg);
    this.renderStatus();
  }

  // ---- status line (TTY only) ----
  renderStatus() {
    if (!process.stdout.isTTY || this.log.quiet || !this.status.size) return;
    const text = [...this.status.values()].join(c.gray('  ·  '));
    const width = (process.stdout.columns || 100) - 2;
    process.stdout.write(`\r\x1b[2K${c.gray('  …')} ${text.length > width ? `${text.slice(0, width - 1)}…` : text}`);
    this.statusShown = true;
  }

  clearStatus() {
    if (this.statusShown && process.stdout.isTTY) process.stdout.write('\r\x1b[2K');
    this.statusShown = false;
  }

  /** ffmpeg input options for a file (stills: no image-sequence pattern expansion of '%d' in names). */
  inputOpts(file) {
    return isImageFile(file) ? IMAGE_INPUT : [];
  }

  async probe(file) {
    if (this.probeCache.has(file)) return this.probeCache.get(file);
    const p = probe(this.tools.ffprobe, file, { image: isImageFile(file) }).then(mediaInfo);
    this.probeCache.set(file, p);
    return p;
  }

  async ffmpeg(args, opts) {
    return runFfmpeg(this.tools.ffmpeg, args, opts);
  }

  async tmp(name) {
    // one shared temp folder; the promise is cached so parallel jobs never create (and leak) a second one
    if (!this.tmpDir) this.tmpDir = fsp.mkdtemp(path.join(os.tmpdir(), 'tonecraft-media-'));
    const dir = await this.tmpDir;
    return path.join(dir, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${name}`);
  }

  // ---- analysis (cached per input file in .cache.json) ----

  /** Cached analysis result: `compute` runs once per run (memo) and only when the input or the sampling changed. */
  async analysis(key, input, extra, compute) {
    const sig = hashString(JSON.stringify({ v: DETECT_VERSION, extra, in: await this.inputSig([input]) }), 16);
    const memo = `${key}@${sig}`;
    if (!this.detectMemo.has(memo)) {
      this.detectMemo.set(
        memo,
        (async () => {
          const hit = this.cache.detect[key];
          if (!this.force && hit && hit.sig === sig) return hit.value ?? null;
          this.status.set(memo, `분석 중 ${path.basename(input)}`);
          this.renderStatus();
          try {
            const value = await compute();
            this.cache.detect[key] = { sig, file: this.rel(input), value };
            return value;
          } finally {
            this.status.delete(memo);
            this.clearStatus();
          }
        })(),
      );
    }
    return this.detectMemo.get(memo);
  }

  /** Decode one frame to 8-bit full-range gray (+ cropdetect in the same pass) and measure its bars. */
  async measureFrame(input, info, t) {
    const W = info.storedW;
    const H = info.storedH;
    const video = isVideoFile(input);
    const gray = info.isRgb ? 'scale=out_range=pc,format=gray' : `scale=in_range=${rangeOf(info, { still: !video })}:out_range=pc,format=gray`;
    const run = (level, vf) =>
      runCaptureAll(this.tools.ffmpeg, [
        '-hide_banner', '-nostdin', '-loglevel', level,
        ...(video && t > 0 ? ['-ss', t.toFixed(3)] : []), ...this.inputOpts(input), '-i', input,
        '-frames:v', '1', '-an', '-sn', '-dn', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
      ]);
    let res = null;
    let cd = null;
    try {
      res = await run('info', `${gray},${CROPDETECT}`);
      cd = parseCropdetect(res.stderr);
    } catch {
      // an older ffmpeg without cropdetect's options: the flat-line measurement alone still works
      res = await run('error', gray).catch(() => null);
    }
    if (!res || res.stdout.length !== W * H) return null;
    return measureBars(res.stdout, W, H, cd);
  }

  /**
   * Baked-in black bars of a source → crop rectangle { w, h, x, y } (decoded pixels) or null.
   * Video: `times` (default 5 points over the clip); image: its only frame. mode: 'strict' | 'loop' (letterbox.mjs).
   */
  async detectCrop(input, { mode = 'strict', times = null } = {}) {
    const info = await this.probe(input);
    if (!info?.storedW || !info?.storedH) return null;
    const video = isVideoFile(input);
    const ts = video ? times || sampleTimes(info.duration) : [0];
    return this.analysis(`crop:${mode}:${this.rel(input)}`, input, { mode, ts }, async () => {
      // a few decoders at a time (4K ProRes frames are heavy), in sample order
      const samples = new Array(ts.length);
      let next = 0;
      const worker = async () => {
        while (next < ts.length) {
          const i = next++;
          samples[i] = await this.measureFrame(input, info, ts[i]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(this.concurrency, ts.length) }, worker));
      return decideCrop(samples, { mode, sar: info.sar || 1, minSamples: video ? Math.min(3, ts.length) : 1 });
    });
  }

  /**
   * Seconds of intro a video opens with — black, a logo slate on black, the fade-in after it — so the hero loop
   * (and its poster, the loop's first frame) starts on picture. 0 when it opens on picture.
   */
  async introEnd(input) {
    const info = await this.probe(input);
    const step = 0.1;
    return this.analysis(`intro:${this.rel(input)}`, input, { step, t: 8 }, async () => {
      const range = info?.isRgb ? '' : `in_range=${rangeOf(info)}:`;
      try {
        const { stdout } = await runCaptureAll(this.tools.ffmpeg, [
          '-hide_banner', '-nostdin', '-loglevel', 'error', '-t', '8', '-i', input, '-an', '-sn', '-dn',
          '-vf', `fps=${1 / step},scale=w=64:h=36:${range}out_range=pc,format=gray`, '-f', 'rawvideo', 'pipe:1',
        ]);
        const n = 64 * 36;
        const levels = [];
        for (let o = 0; o + n <= stdout.length; o += n) {
          let sum = 0;
          for (let i = o; i < o + n; i++) sum += stdout[i];
          levels.push(sum / n);
        }
        return introEnd(levels, step);
      } catch {
        return 0;
      }
    });
  }

  // ---- primitive operations ----

  /**
   * Any image or video frame → lossless rgb24 PNG master. Returns { file, w, h }.
   * Fitted into maxW × maxW, or an exact `size` (cover + center crop); `crop` (letterbox) is applied first.
   */
  async rgbMaster(input, { time = null, maxW = 1920, size = null, crop = null, name = 'master.png' } = {}) {
    const info = await this.probe(input);
    if (!info) throw new Error(`${path.basename(input)}: 영상/이미지 스트림이 없습니다`);
    const video = isVideoFile(input);
    const out = await this.tmp(name);
    const filter = rgbMasterFilter(info, { maxW, size, crop, still: !video });
    const run = async (t) => {
      const seek = video && t > 0 ? ['-ss', t.toFixed(3)] : [];
      await this.ffmpeg([...seek, ...this.inputOpts(input), '-i', input, '-frames:v', '1', '-vf', filter, '-update', '1', out]);
    };
    const t = video ? clampTime(time ?? defaultPosterTime(info.duration), info.duration, 0.25) : 0;
    await run(t);
    if (!(await statOrNull(out))?.size && t > 0) await run(0); // seek past the last frame → first frame
    const dims = await imageSize(out);
    if (!dims) throw new Error(`${path.basename(input)}: 프레임을 추출하지 못했습니다`);
    return { file: out, w: dims.w, h: dims.h, info };
  }

  async encodeWebp(master, out, { maxW, quality }) {
    await this.ffmpeg(['-i', master, '-vf', webpFromRgbFilter(maxW), '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '5', ...COMMON_OUT, out]);
  }

  async encodeJpeg(master, out, { maxW }) {
    await this.ffmpeg(['-i', master, '-vf', jpegFromRgbFilter(maxW), '-c:v', 'mjpeg', '-q:v', '2', ...COMMON_OUT, '-update', '1', out]);
  }

  /** 1200×630 share image: center cover crop; a vertical frame is shown whole on black instead of a thin slice. */
  async encodeOg(master, out, { w: mw = 0, h: mh = 0 } = {}) {
    const { w, h } = RECIPES.og;
    const fit =
      mw && mh && mw / mh < 1.2
        ? `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos+accurate_rnd,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`
        : `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos+accurate_rnd,crop=${w}:${h}`;
    await this.ffmpeg(['-i', master, '-vf', `${fit},${jpegFromRgbFilter(w)}`, '-c:v', 'mjpeg', '-q:v', '2', ...COMMON_OUT, '-update', '1', out]);
  }

  // ---- job runner ----

  /**
   * job: { key, label, inputs: [abs], outputs: [abs], params, run: async (tmpOutputs, onProgress) => void,
   *        crop?: { rect, frame } (recorded for the manifest), note?, sizeWarn?: { bytes, msg(bytes) } }
   */
  async needsRun(job) {
    const hash = hashString(JSON.stringify({ v: PIPELINE_VERSION, params: job.params, inputs: await this.inputSig(job.inputs) }), 16);
    job.hash = hash;
    if (this.force) return true;
    if (this.cache.jobs[job.key] !== hash) return true;
    let newestInput = 0;
    for (const i of job.inputs) newestInput = Math.max(newestInput, (await statOrNull(i))?.mtimeMs || 0);
    for (const o of job.outputs) {
      const st = await statOrNull(o);
      if (!st || !st.size || st.mtimeMs + 1 < newestInput) return true;
    }
    return false;
  }

  async inputSig(inputs) {
    const out = [];
    for (const i of inputs) {
      const st = await statOrNull(i);
      out.push([this.rel(i), st?.size ?? 0, Math.trunc((st?.mtimeMs ?? 0) / 1000)]);
    }
    return out;
  }

  /** Remember which crop an up-to-date output group was made with (manifest). */
  recordCrop(job) {
    if (job.crop) this.cache.crops[job.key] = { rect: job.crop.rect || null, frame: job.crop.frame || null };
  }

  async runJobs(jobs) {
    const queue = [];
    for (const job of jobs) {
      if (await this.needsRun(job)) queue.push(job);
      else {
        this.stats.skipped++;
        this.recordCrop(job);
      }
    }
    if (this.dryRun) {
      for (const job of queue) this.log.info(`  ${c.cyan('실행 예정')} ${job.label}${job.note ? ` · ${job.note}` : ''}`);
      this.stats.planned = queue.length;
      return;
    }
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const job = queue[next++];
        await this.runJob(job);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, queue.length) }, worker));
  }

  async runJob(job) {
    const t0 = Date.now();
    const tmps = job.outputs.map(tmpPath);
    this.status.set(job.key, job.label);
    this.renderStatus();
    try {
      for (const o of job.outputs) await fsp.mkdir(path.dirname(o), { recursive: true });
      await job.run(tmps, (f) => {
        this.status.set(job.key, `${job.label} ${Math.round(f * 100)}%`);
        this.renderStatus();
      });
      for (let i = 0; i < tmps.length; i++) {
        if (!(await statOrNull(tmps[i]))?.size) throw new Error(`${path.basename(job.outputs[i])} 결과 파일이 비어 있습니다`);
      }
      for (let i = 0; i < tmps.length; i++) await renameWithRetry(tmps[i], job.outputs[i]);
      // inputs with a future mtime (camera clock, FAT drive) would otherwise look newer than the outputs forever
      let newestInput = 0;
      for (const inp of job.inputs) newestInput = Math.max(newestInput, (await statOrNull(inp))?.mtimeMs || 0);
      for (const o of job.outputs) {
        const st = await statOrNull(o);
        if (st && st.mtimeMs < newestInput) await fsp.utimes(o, new Date(), new Date(newestInput)).catch(() => {});
      }
      this.cache.jobs[job.key] = job.hash;
      this.recordCrop(job);
      await this.saveCache();
      this.stats.ran++;
      if (job.crop?.rect) this.stats.cropped++;
      const sizes = [];
      for (const o of job.outputs) sizes.push((await statOrNull(o))?.size || 0);
      const bytes = sizes.reduce((a, b) => a + b, 0);
      this.status.delete(job.key);
      this.clearStatus();
      this.log.ok(`${job.label} ${c.gray(`— ${formatBytes(bytes)} · ${formatDuration(Date.now() - t0)}`)}${job.note ? ` · ${job.note}` : ''}`);
      if (job.sizeWarn && bytes > job.sizeWarn.bytes) this.warn(job.sizeWarn.msg(bytes));
    } catch (err) {
      for (const t of tmps) await fsp.rm(t, { force: true }).catch(() => {});
      delete this.cache.jobs[job.key];
      this.stats.failed++;
      this.stats.failures.push({ label: job.label, message: err.message });
      this.status.delete(job.key);
      this.clearStatus();
      this.log.error(`${job.label} 실패 — ${err.message}`);
    }
    this.renderStatus();
  }

  async loadCache() {
    const c0 = await readJson(path.join(this.mediaDir, '.cache.json'), null);
    if (c0 && c0.version === 1) {
      this.cache = { version: 1, jobs: c0.jobs || {}, probe: c0.probe || {}, detect: c0.detect || {}, crops: c0.crops || {} };
    }
  }

  async saveCache() {
    if (this.dryRun) return;
    this.cacheWrite = (this.cacheWrite || Promise.resolve()).then(() =>
      writeFileAtomic(path.join(this.mediaDir, '.cache.json'), `${JSON.stringify(this.cache, null, 1)}\n`),
    );
    await this.cacheWrite;
  }

  /** Drop analyses of raw files that no longer exist. */
  async pruneAnalyses() {
    for (const [key, entry] of Object.entries(this.cache.detect)) {
      if (!entry?.file || !(await isFile(joinRel(this.root, entry.file)))) delete this.cache.detect[key];
    }
  }

  // ---- planning ----

  videoJob({ key, label, input, output, recipe, info, seek = 0, duration = null, extraFilter = '', audio = false, crop = null, note = '' }) {
    const dur = duration ?? (info.duration ? Math.max(0, info.duration - seek) : 0);
    const maxDur = recipe.maxDuration ? Math.min(dur || recipe.maxDuration, recipe.maxDuration) : dur;
    const plan = audio ? audioPlan(info) : { key: 'none', args: ['-an'] };
    // level 4.1 covers 1080p up to 30 fps; 50/60p masters need 4.2
    const level = recipe.level && info.fps > 31 ? '4.2' : recipe.level || null;
    const params = { kind: 'video', recipe, seek, duration: maxDur || null, extraFilter, audio: plan.key, crop, level, preset: this.preset(recipe) };
    return {
      key,
      label,
      inputs: [input],
      outputs: [output],
      params,
      crop: { rect: crop, frame: { w: info.storedW, h: info.storedH } },
      note: [note, plan.note].filter(Boolean).join(' · '),
      audioWarn: plan.warn || '',
      run: async ([tmp], onProgress) => {
        const args = [];
        if (seek > 0) args.push('-ss', seek.toFixed(3));
        if (maxDur && (duration !== null || recipe.maxDuration)) args.push('-t', maxDur.toFixed(3));
        args.push('-i', input);
        if (plan.filter) args.push('-filter_complex', plan.filter);
        args.push('-map', '0:v:0', '-vf', `${videoScaleFilter(info, recipe.maxW, { crop })}${extraFilter}`);
        args.push(...x264Args({ crf: recipe.crf, preset: this.preset(recipe), level, maxrate: recipe.maxrate, bufsize: recipe.bufsize }));
        args.push(...plan.args, ...(plan.key === 'none' ? [] : ['-c:a', 'aac', '-b:a', recipe.audio]));
        args.push(...COMMON_OUT, '-movflags', '+faststart', tmp);
        await this.ffmpeg(args, { duration: maxDur || info.duration || 0, onProgress });
      },
    };
  }

  /** poster.jpg + WebP ladder (+ og.jpg) from one frame; `crop` (letterbox) applies to the whole family. */
  posterJobs({ key, label, source, time, outDir, og = true, crop = null, frame = null }) {
    const webps = RECIPES.posterWebp.map((w) => path.join(outDir, `poster-${w}.webp`));
    const outputs = [path.join(outDir, 'poster.jpg'), ...webps, ...(og ? [path.join(outDir, 'og.jpg')] : [])];
    return {
      key,
      label,
      inputs: [source],
      outputs,
      params: { kind: 'poster', time, crop, recipe: [RECIPES.posterJpgW, RECIPES.posterWebp, RECIPES.posterQuality, RECIPES.og] },
      crop: { rect: crop, frame },
      note: cropNote(crop),
      run: async (tmps) => {
        const master = await this.rgbMaster(source, { time, maxW: RECIPES.posterJpgW, crop });
        await this.encodeJpeg(master.file, tmps[0], { maxW: RECIPES.posterJpgW });
        for (const [i, w] of RECIPES.posterWebp.entries()) await this.encodeWebp(master.file, tmps[1 + i], { maxW: w, quality: RECIPES.posterQuality });
        if (og) await this.encodeOg(master.file, tmps[tmps.length - 1], master);
        await fsp.rm(master.file, { force: true });
      },
    };
  }

  async planWork(slug, work) {
    const dir = path.join(this.rawDir, 'works', slug);
    const outDir = path.join(this.mediaDir, 'works', slug);
    const raw = await scanRawWork(dir);
    for (const w of raw.warnings) this.warn(`${slug}: ${w}`);
    if (raw.ignored.length) this.log.info(c.gray(`  ${slug}: 규칙에 맞지 않아 무시한 파일 — ${raw.ignored.join(', ')}`));
    const opts = work || {};
    const jobs = [];
    const expected = new Set();
    const add = (job) => {
      jobs.push(job);
      for (const o of job.outputs) expected.add(o);
    };
    const infoOf = (file) => this.probe(file).catch(() => null);
    const frameOf = (info) => (info ? { w: info.storedW, h: info.storedH } : null);
    // letterbox: detected per source (autoCrop: false in works.mjs turns it off); main.mp4 always keeps its framing
    const autoCrop = opts.autoCrop !== false;
    const cropOf = async (file) => {
      if (!autoCrop || !file) return null;
      try {
        return await this.detectCrop(file);
      } catch (err) {
        this.log.info(c.gray(`  ${slug}: ${path.basename(file)} 레터박스 검사 생략 — ${err.message}`));
        return null;
      }
    };

    let mainInfo = null;
    if (raw.main) {
      mainInfo = await this.probe(raw.main).catch((err) => {
        this.warn(`${slug}: ${err.message}`);
        return null;
      });
      if (mainInfo?.hdr) this.warn(`${slug}: ${path.basename(raw.main)} — ${HDR_MSG}`);
    }
    const posterTime = mainInfo ? clampTime(opts.posterTime ?? defaultPosterTime(mainInfo.duration), mainInfo.duration, 0.25) : 0;
    const mainCrop = raw.main && mainInfo ? await cropOf(raw.main) : null;

    if (raw.main && mainInfo) {
      if (opts.video) {
        this.log.info(c.gray(`  ${slug}: 외부 영상(${opts.video.type}) 사용 — main.mp4 생략`));
        expected.add(path.join(outDir, 'main.mp4')); // keep an existing copy, build ignores it
      } else {
        const job = this.videoJob({
          key: `works/${slug}/main`,
          label: `${slug} · main.mp4`,
          input: raw.main,
          output: path.join(outDir, 'main.mp4'),
          recipe: RECIPES.main,
          info: mainInfo,
          audio: true,
        });
        delete job.crop; // the full video is never cropped
        job.sizeWarn = {
          bytes: HOSTING_WARN_BYTES,
          msg: (b) =>
            `${slug}: main.mp4 가 ${formatBytes(b)}입니다 — 25 MB를 넘는 파일은 Cloudflare Pages에 올릴 수 없고, 95 MB를 넘으면 GitHub에도 올릴 수 없습니다. 긴 영상은 Vimeo/YouTube에 올리고 works.mjs 에 video: { type, id } 로 연결하세요 (README 12장).`,
        };
        if (job.audioWarn) this.warn(`${slug}: ${path.basename(raw.main)} — ${job.audioWarn}`);
        add(job);
      }
      const dur = opts.previewDuration || 6;
      let start = opts.previewStart ?? posterTime;
      if (mainInfo.duration) start = Math.max(0, Math.min(start, mainInfo.duration - Math.min(dur, mainInfo.duration)));
      add(
        this.videoJob({
          key: `works/${slug}/preview`,
          label: `${slug} · preview.mp4`,
          input: raw.main,
          output: path.join(outDir, 'preview.mp4'),
          recipe: RECIPES.preview,
          info: mainInfo,
          seek: start,
          duration: mainInfo.duration ? Math.min(dur, mainInfo.duration - start) : dur,
          extraFilter: capFpsFilter(mainInfo),
          crop: mainCrop,
          note: cropNote(mainCrop),
        }),
      );
    }

    // poster: explicit image → main frame → after-1 (the card shows poster and preview in one frame: same crop)
    let posterSource = null;
    let posterAt = 0;
    let posterCrop = null;
    if (raw.poster) {
      posterSource = raw.poster;
      posterCrop = await cropOf(raw.poster);
    } else if (raw.main && mainInfo) {
      posterSource = raw.main;
      posterAt = posterTime;
      posterCrop = mainCrop;
    } else if (raw.pairs.length) {
      posterSource = raw.pairs[0].after;
      if (isVideoFile(posterSource)) posterAt = await this.baTime(raw.pairs[0], opts, 0);
      posterCrop = await cropOf(posterSource);
    }
    if (posterSource) {
      const frame = frameOf(await infoOf(posterSource));
      add(this.posterJobs({ key: `works/${slug}/poster`, label: `${slug} · 포스터·공유 이미지`, source: posterSource, time: posterAt, outDir, crop: posterCrop, frame }));
    } else {
      this.warn(`${slug}: 포스터를 만들 원본이 없습니다 (main 영상, poster 이미지, after-1 중 하나 필요) — 사이트에 공개되지 않습니다`);
    }

    // before / after pairs: ONE crop, found on the graded "after", applied to both halves so they stay aligned
    for (const pair of raw.pairs) {
      const n = pair.n;
      const outs = ['before', 'after'].flatMap((s) => RECIPES.baWebp.map((w, i) => path.join(outDir, i ? `ba-${n}-${s}-${w}.webp` : `ba-${n}-${s}.webp`)));
      const t = await this.baTime(pair, opts, n - 1);
      const [bInfo, aInfo] = await Promise.all([infoOf(pair.before), infoOf(pair.after)]);
      const aCrop = await cropOf(pair.after);
      const bCrop = mapCrop(aCrop, frameOf(aInfo), frameOf(bInfo));
      add({
        key: `works/${slug}/ba-${n}`,
        label: `${slug} · 비포·애프터 ${n}`,
        inputs: [pair.before, pair.after],
        outputs: outs,
        params: { kind: 'ba', t, q: RECIPES.baQuality, widths: RECIPES.baWebp, crop: aCrop, beforeCrop: bCrop },
        crop: { rect: aCrop, frame: frameOf(aInfo) },
        note: aCrop ? `${cropNote(aCrop)} (after-${n} 기준, before-${n}에도 같게)` : '',
        run: async (tmps) => {
          const after = await this.rgbMaster(pair.after, { time: t, crop: aCrop, name: 'after.png' });
          const before = await this.rgbMaster(pair.before, { time: t, crop: bCrop, size: { w: after.w, h: after.h }, name: 'before.png' });
          const bi = await this.probe(pair.before);
          const ai = await this.probe(pair.after);
          const ratio = (info, crop) => ((crop ? crop.w : info.storedW) * (info.sar || 1)) / (crop ? crop.h : info.storedH);
          if (bi?.storedW && bi?.storedH && ai?.storedW && ai?.storedH && Math.abs(ratio(bi, bCrop) / ratio(ai, aCrop) - 1) > 0.01) {
            this.warn(
              `${slug}: before-${n}과 after-${n}의 화면비가 달라 before의 가운데를 after 비율(${(after.w / after.h).toFixed(2)}:1)에 맞춰 잘랐습니다 — 같은 프레임·같은 해상도로 내보내면 가장 정확합니다`,
            );
          }
          for (const hdrInfo of [bi, ai]) if (hdrInfo?.hdr) this.warn(`${slug}: 비포·애프터 ${n} — ${HDR_MSG}`);
          const k = RECIPES.baWebp.length;
          for (const [i, w] of RECIPES.baWebp.entries()) {
            await this.encodeWebp(before.file, tmps[i], { maxW: w, quality: RECIPES.baQuality });
            await this.encodeWebp(after.file, tmps[k + i], { maxW: w, quality: RECIPES.baQuality });
          }
          await fsp.rm(before.file, { force: true });
          await fsp.rm(after.file, { force: true });
        },
      });
      if (opts.baVideo && isVideoFile(pair.before) && isVideoFile(pair.after)) {
        add(await this.baVideoJob(slug, pair, opts, outDir, { aCrop, bCrop }));
      } else if (opts.baVideo && n === 1 && !(isVideoFile(pair.before) && isVideoFile(pair.after))) {
        this.log.info(c.gray(`  ${slug}: baVideo — before-${n}/after-${n}가 둘 다 영상일 때만 비교 영상을 만듭니다`));
      }
    }

    // stills (each image is checked for bars on its own)
    for (const [i, file] of raw.stills.entries()) {
      const nn = String(i + 1).padStart(2, '0');
      const crop = await cropOf(file);
      add({
        key: `works/${slug}/stills/${nn}`,
        label: `${slug} · 스틸 ${nn} (${path.basename(file)})`,
        inputs: [file],
        outputs: [path.join(outDir, 'stills', `${nn}.webp`), path.join(outDir, 'stills', `${nn}-960.webp`)],
        params: { kind: 'still', q: RECIPES.stillQuality, crop },
        crop: { rect: crop, frame: frameOf(await infoOf(file)) },
        note: cropNote(crop),
        run: async (tmps) => {
          const m = await this.rgbMaster(file, { crop, name: `still-${nn}.png` });
          await this.encodeWebp(m.file, tmps[0], { maxW: 1920, quality: RECIPES.stillQuality });
          await this.encodeWebp(m.file, tmps[1], { maxW: 960, quality: RECIPES.stillQuality });
          await fsp.rm(m.file, { force: true });
        },
      });
    }

    return { jobs, expected, outDir };
  }

  async baTime(pair, opts, index) {
    const explicit = opts.baTimes?.[index];
    const infos = [];
    for (const f of [pair.before, pair.after]) if (isVideoFile(f)) infos.push(await this.probe(f).catch(() => null));
    const durs = infos.map((i) => i?.duration).filter((d) => Number.isFinite(d) && d > 0);
    const minDur = durs.length ? Math.min(...durs) : null;
    if (explicit !== null && explicit !== undefined) return clampTime(explicit, minDur, 0.25);
    return minDur ? minDur / 3 : 0;
  }

  async baVideoJob(slug, pair, opts, outDir, { aCrop = null, bCrop = null } = {}) {
    const n = pair.n;
    const [bInfo, aInfo] = await Promise.all([this.probe(pair.before), this.probe(pair.after)]);
    const maxW = RECIPES.baVideo.maxW;
    // each half: the (cropped) after frame fitted into maxW × maxW; before is cover-fitted to exactly the same size
    const dW = (aCrop ? aCrop.w : aInfo.storedW || maxW) * (aInfo.sar || 1);
    const dH = aCrop ? aCrop.h : aInfo.storedH || 720;
    const k = Math.min(1, maxW / dW, maxW / dH);
    const W = Math.max(2, Math.floor((dW * k) / 2) * 2);
    const H = Math.max(2, Math.round((dH * k) / 2) * 2);
    const minDur = Math.min(bInfo.duration || Infinity, aInfo.duration || Infinity);
    let start = opts.baVideoStart ?? opts.baTimes?.[n - 1] ?? 0;
    if (Number.isFinite(minDur)) start = Math.max(0, Math.min(start, Math.max(0, minDur - 1)));
    const dur = Number.isFinite(minDur) ? Math.min(opts.baVideoDuration || 8, minDur - start) : opts.baVideoDuration || 8;
    const fps = capFpsFilter(aInfo).replace(/^,/, '') || (aInfo.fps ? `fps=${Math.round(aInfo.fps * 1000) / 1000}` : '');
    const graph = [
      `[0:v]${videoScaleExactFilter(bInfo, W, H, { crop: bCrop })}${fps ? `,${fps}` : ''}[b]`,
      `[1:v]${videoScaleExactFilter(aInfo, W, H, { crop: aCrop })}${fps ? `,${fps}` : ''}[a]`,
      '[b][a]hstack=inputs=2,format=yuv420p[v]',
    ].join(';');
    const recipe = RECIPES.baVideo;
    return {
      key: `works/${slug}/ba-${n}-video`,
      label: `${slug} · 비교 영상 ba-${n}.mp4`,
      inputs: [pair.before, pair.after],
      outputs: [path.join(outDir, `ba-${n}.mp4`)],
      params: { kind: 'baVideo', W, H, start, dur, fps, recipe, crop: aCrop, beforeCrop: bCrop, preset: this.preset(recipe) },
      note: cropNote(aCrop),
      run: async ([tmp], onProgress) => {
        const seek = start > 0 ? ['-ss', start.toFixed(3)] : [];
        await this.ffmpeg(
          [
            ...seek, '-t', dur.toFixed(3), '-i', pair.before,
            ...seek, '-t', dur.toFixed(3), '-i', pair.after,
            '-filter_complex', graph, '-map', '[v]',
            ...x264Args({ crf: recipe.crf, preset: this.preset(recipe) }),
            '-an', ...COMMON_OUT, '-movflags', '+faststart', tmp,
          ],
          { duration: dur, onProgress },
        );
      },
    };
  }

  /**
   * Showreel: reel.mp4 (as delivered), the hero background loop and its poster.
   * site.reel: loopStart (default: after the black the reel opens with), loopDuration (default 20 s),
   * posterTime (default: the loop's first frame, so <video poster> and frame 0 match), autoCrop (default true:
   * the loop and its poster lose baked-in bars — cover-fitted, bars would be a hard black band under the header).
   * raw/reel/poster.<image> replaces the frame grab.
   */
  async planReel(site) {
    const cfg = site?.reel || {};
    const dir = path.join(this.rawDir, 'reel');
    const outDir = path.join(this.mediaDir, 'reel');
    const expected = new Set();
    const jobs = [];
    const files = await listFiles(dir);
    const videos = files.filter(isVideoFile);
    const posterImage = files.find((f) => /^poster\.[^.]+$/i.test(f) && isImageFile(f));
    if (!videos.length) return { jobs, expected, outDir, none: true };
    const video = videos[0];
    if (videos.length > 1) {
      this.warn(`raw/reel/ 에 영상이 ${videos.length}개 있습니다 (${videos.join(', ')}) — 이름순 첫 번째인 '${video}'만 사용합니다. 새 쇼릴만 남기고 나머지는 지우세요`);
    }
    this.log.info(c.gray(`  쇼릴 원본: ${video}${posterImage ? ` · 포스터 이미지: ${posterImage}` : ''}`));
    const input = path.join(dir, video);
    const info = await this.probe(input);
    if (!info) {
      this.warn(`쇼릴: ${video}에서 영상 스트림을 찾지 못했습니다`);
      return { jobs, expected, outDir, none: true };
    }
    if (info.hdr) this.warn(`쇼릴 ${video} — ${HDR_MSG}`);
    const add = (job) => {
      jobs.push(job);
      for (const o of job.outputs) expected.add(o);
    };
    if (cfg.embed) {
      this.log.info(c.gray(`  쇼릴: 외부 영상(${cfg.embed.type}) 사용 — reel.mp4 생략`));
      expected.add(path.join(outDir, 'reel.mp4'));
    } else {
      const job = this.videoJob({ key: 'reel/full', label: '쇼릴 · reel.mp4', input, output: path.join(outDir, 'reel.mp4'), recipe: RECIPES.reel, info, audio: true });
      delete job.crop; // the full reel keeps its framing
      job.sizeWarn = {
        bytes: HOSTING_WARN_BYTES,
        msg: (b) => `쇼릴 reel.mp4 가 ${formatBytes(b)}입니다 — 25 MB를 넘는 파일은 Cloudflare Pages에 올릴 수 없습니다. 전체 쇼릴은 Vimeo/YouTube에 올리고 site.mjs 의 reel.embed 로 연결하세요 (배경 루프는 그대로 직접 호스팅됩니다).`,
      };
      if (job.audioWarn) this.warn(`쇼릴 ${video} — ${job.audioWarn}`);
      add(job);
    }

    // background loop window
    const dur = info.duration || 0;
    let loopStart = cfg.loopStart ?? null;
    let skippedIntro = 0;
    if (loopStart === null) {
      skippedIntro = await this.introEnd(input);
      loopStart = skippedIntro;
    }
    if (dur) loopStart = Math.max(0, Math.min(loopStart, dur - Math.min(1, dur)));
    const loopLen = cfg.loopDuration || RECIPES.loop.maxDuration;
    const loopDur = dur ? Math.min(loopLen, dur - loopStart) : loopLen;
    let crop = null;
    if (cfg.autoCrop !== false) {
      crop = await this.detectCrop(input, { mode: 'loop', times: sampleTimes(dur, { count: 12, start: loopStart, end: loopStart + loopDur }) }).catch(() => null);
    }
    // the hero cover-fits on height: a wide (cropped) loop keeps 720 lines instead of shrinking to 1280 × 536
    const d = crop ? { w: crop.w * (info.sar || 1), h: crop.h } : { w: info.w || 16, h: info.h || 9 };
    const loopMaxW = Math.min(1920, Math.max(RECIPES.loop.maxW, Math.round((720 * (d.w / d.h)) / 2) * 2));
    const loop = this.videoJob({
      key: 'reel/loop',
      label: '쇼릴 · reel-loop.mp4 (배경)',
      input,
      output: path.join(outDir, 'reel-loop.mp4'),
      recipe: { ...RECIPES.loop, maxW: loopMaxW, maxDuration: loopLen },
      info,
      seek: loopStart,
      duration: loopDur,
      extraFilter: capFpsFilter(info),
      crop,
      note: [skippedIntro > 0 && `앞부분 검은 화면·페이드인 ${skippedIntro.toFixed(1)}초 건너뜀 (reel.loopStart 로 조절)`, cropNote(crop)].filter(Boolean).join(' · '),
    });
    loop.sizeWarn = {
      bytes: LOOP_WARN_BYTES,
      msg: (b) => `쇼릴 배경 영상 reel-loop.mp4 가 ${formatBytes(b)}입니다 — 휴대폰이 첫 화면에서 바로 받는 파일이라 4 MB 이하를 권장합니다. site.mjs 의 reel.loopDuration 을 줄이세요 (기본 20초).`,
    };
    add(loop);

    // hero poster = the loop's first frame unless reel.posterTime / raw/reel/poster.* say otherwise
    const posterSrc = posterImage ? path.join(dir, posterImage) : input;
    let posterCrop = crop;
    if (posterImage) posterCrop = cfg.autoCrop === false ? null : await this.detectCrop(posterSrc).catch(() => null);
    const posterAt = posterImage ? 0 : clampTime(cfg.posterTime ?? loopStart, dur, 0.25);
    const frameInfo = posterImage ? await this.probe(posterSrc).catch(() => null) : info;
    add(
      this.posterJobs({
        key: 'reel/poster',
        label: '쇼릴 · 포스터',
        source: posterSrc,
        time: posterAt,
        outDir,
        og: false,
        crop: posterCrop,
        frame: frameInfo ? { w: frameInfo.storedW, h: frameInfo.storedH } : null,
      }),
    );
    return { jobs, expected, outDir };
  }

  /** Remove outputs (with our naming) that the current raw inputs no longer produce. */
  async pruneStale(outDir, expected, patterns) {
    const removed = [];
    for (const rel of await walkFiles(outDir)) {
      const abs = joinRel(outDir, rel);
      if (expected.has(abs)) continue;
      if (/(^|\/)\.[^/]+\.tmp-\d+\./.test(rel)) {
        if (!this.dryRun) await fsp.rm(abs, { force: true });
        continue;
      }
      if (!patterns.some((re) => re.test(rel))) continue;
      if (!this.dryRun) await fsp.rm(abs, { force: true });
      removed.push(rel);
    }
    return removed;
  }

  // ---- manifest ----

  async fileEntry(abs, kind) {
    const st = await statOrNull(abs);
    if (!st || !st.isFile()) return null;
    const file = toPosix(path.relative(this.mediaDir, abs));
    if (kind === 'image') {
      const d = await imageSize(abs);
      return d ? { file, w: d.w, h: d.h, bytes: st.size } : { file, w: null, h: null, bytes: st.size };
    }
    const cached = (this.oldProbe || this.cache.probe)[file];
    if (cached && cached.size === st.size && cached.mtime === Math.trunc(st.mtimeMs)) {
      return { file, w: cached.w, h: cached.h, duration: cached.duration, bytes: st.size };
    }
    const info = await probe(this.tools.ffprobe, abs).then(mediaInfo).catch(() => null);
    const entry = { file, w: info?.w ?? null, h: info?.h ?? null, duration: info?.duration ? Math.round(info.duration * 1000) / 1000 : null, bytes: st.size };
    this.cache.probe[file] = { size: st.size, mtime: Math.trunc(st.mtimeMs), w: entry.w, h: entry.h, duration: entry.duration };
    return entry;
  }

  /**
   * Letterbox crop an output group was made with: { crop: { w, h, x, y } | null, frame: { w, h } } (source pixels),
   * attached to the group's manifest entry. Groups made before crops were tracked get nothing.
   */
  cropFields(key) {
    const rec = this.cache.crops[key];
    return rec ? { crop: rec.rect || null, frame: rec.frame || null } : {};
  }

  async buildManifest() {
    const md = this.mediaDir;
    // rebuild the probe cache from what exists now (entries for deleted files drop out)
    this.oldProbe = this.cache.probe;
    this.cache.probe = {};
    const withCrop = (entry, key) => (entry ? { ...entry, ...this.cropFields(key) } : entry);
    const reelDir = path.join(md, 'reel');
    const reel = (await isDir(reelDir))
      ? {
          full: await this.fileEntry(path.join(reelDir, 'reel.mp4'), 'video'),
          loop: withCrop(await this.fileEntry(path.join(reelDir, 'reel-loop.mp4'), 'video'), 'reel/loop'),
          poster: withCrop(await this.fileEntry(path.join(reelDir, 'poster.jpg'), 'image'), 'reel/poster'),
        }
      : null;
    const works = {};
    for (const slug of await listDirs(path.join(md, 'works'))) {
      const d = path.join(md, 'works', slug);
      const key = `works/${slug}`;
      const files = await listFiles(d);
      const nums = [...new Set(files.map((f) => f.match(/^ba-(\d+)-(?:before|after)\.webp$/)).filter(Boolean).map((m) => Number(m[1])))].sort((a, b) => a - b);
      const ba = [];
      for (const n of nums) {
        const before = await this.fileEntry(path.join(d, `ba-${n}-before.webp`), 'image');
        const after = await this.fileEntry(path.join(d, `ba-${n}-after.webp`), 'image');
        if (!before || !after) continue;
        ba.push({ before, after, video: await this.fileEntry(path.join(d, `ba-${n}.mp4`), 'video'), ...this.cropFields(`${key}/ba-${n}`) });
      }
      const stills = [];
      for (const f of (await listFiles(path.join(d, 'stills'))).filter((f) => /^\d+\.webp$/.test(f)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))) {
        stills.push(withCrop(await this.fileEntry(path.join(d, 'stills', f), 'image'), `${key}/stills/${f.replace(/\.webp$/, '')}`));
      }
      works[slug] = {
        main: await this.fileEntry(path.join(d, 'main.mp4'), 'video'),
        preview: withCrop(await this.fileEntry(path.join(d, 'preview.mp4'), 'video'), `${key}/preview`),
        poster: withCrop(await this.fileEntry(path.join(d, 'poster.jpg'), 'image'), `${key}/poster`),
        og: withCrop(await this.fileEntry(path.join(d, 'og.jpg'), 'image'), `${key}/poster`),
        ba,
        stills: stills.filter(Boolean),
      };
    }
    this.oldProbe = null;
    return { version: 1, generatedAt: new Date().toISOString(), reel, works };
  }

  async cleanup() {
    if (this.tmpDir) await rmrf(await this.tmpDir).catch(() => {});
    this.tmpDir = null;
  }
}

const WORK_OUTPUT_PATTERNS = [
  /^main\.mp4$/,
  /^preview\.mp4$/,
  /^poster(?:-\d+)?\.(?:jpg|webp)$/,
  /^og\.jpg$/,
  /^ba-\d+(?:-(?:before|after)(?:-\d+)?\.webp|\.mp4)$/,
  /^stills\/\d+(?:-960)?\.webp$/,
];
const REEL_OUTPUT_PATTERNS = [/^reel(?:-loop)?\.mp4$/, /^poster(?:-\d+)?\.(?:jpg|webp)$/];

/**
 * Process raw/ → media/.
 * @returns {Promise<{ ok, code, stats, manifest }>}
 */
export async function runMedia(o = {}) {
  const t0 = Date.now();
  const root = path.resolve(o.root);
  const log = o.logger || createLogger({ quiet: o.quiet });
  const tools = o.tools || (await findFfmpeg());
  if (!tools) {
    log.error(FFMPEG_HELP);
    return { ok: false, code: 'no-ffmpeg' };
  }
  const proc = new MediaProcessor({ root, tools, log, force: o.force, dryRun: o.dryRun, preset: o.preset, concurrency: o.concurrency });
  log.info(c.bold(`TONECRAFT 미디어 처리${o.dryRun ? ' — 미리 보기 (--dry-run, 파일을 쓰지 않음)' : ''}${o.force ? ' — 전체 다시 만들기 (--force)' : ''}`));
  const ver = (tools.version.match(/version\s+(\S+)/) || [])[1] || '';
  log.info(c.gray(`  원본 ${proc.rel(proc.rawDir) || 'raw'}/ → 결과 ${proc.rel(proc.mediaDir) || 'media'}/  ·  ffmpeg ${ver}`));

  // work options from content/works.mjs (lenient: media still runs when content has errors)
  const content = await loadContent(root);
  if (content.errors.length) {
    log.warn(`content/ 에 오류가 있어 일부 작업은 기본 옵션으로 처리합니다 (npm run check 로 확인):`);
    for (const e of content.errors.slice(0, 5)) log.info(c.gray(`    ${e}`));
  }
  const bySlug = new Map(content.works.map((w) => [w.slug, w]));

  const slugsArg = (o.slugs || []).filter(Boolean);
  const doAll = !slugsArg.length && !o.reel;
  const rawWorksDir = path.join(proc.rawDir, 'works');
  const rawSlugs = await listDirs(rawWorksDir);
  if (!(await isDir(proc.rawDir))) {
    if (!o.dryRun) {
      await fsp.mkdir(path.join(proc.rawDir, 'reel'), { recursive: true });
      await fsp.mkdir(path.join(proc.rawDir, 'works'), { recursive: true });
    }
    log.warn(`raw/ 폴더가 없어${o.dryRun ? '' : ' 새로 만들었습니다'} — 원본을 넣어 주세요: raw/reel/(쇼릴 영상), raw/works/<slug>/(작업별 main·poster·before-1·after-1 …)`);
  }
  let targets = doAll ? rawSlugs : slugsArg;
  for (const s of slugsArg) if (!rawSlugs.includes(s)) log.warn(`raw/works/${s}/ 폴더가 없습니다 — 건너뜁니다.`);
  targets = targets.filter((s) => rawSlugs.includes(s));
  const invalid = targets.filter((s) => !SLUG_RE.test(s));
  for (const s of invalid) log.warn(`raw/works/${s}/ — 폴더 이름은 slug 형식(소문자·숫자·하이픈)이어야 합니다. 건너뜁니다.`);
  targets = targets.filter((s) => SLUG_RE.test(s));
  for (const s of targets) if (!bySlug.has(s)) log.info(c.gray(`  ${s}: content/works.mjs에 없는 작업 — 기본 옵션으로 처리 (사이트에는 works.mjs에 추가해야 표시)`));
  if (doAll) {
    const missing = content.works.filter((w) => !rawSlugs.includes(w.slug)).map((w) => w.slug);
    if (missing.length) log.info(c.gray(`  원본 폴더가 없는 작업: ${missing.join(', ')}`));
  }

  let ok = true;
  try {
    await proc.loadCache();
    const jobs = [];
    const pruneList = [];
    if (doAll || o.reel) {
      if (content.site.reel.publish === false) log.info(c.gray('  쇼릴: 비공개(reel.publish: false) — 건너뜀'));
      else {
        const plan = await proc.planReel(content.site);
        if (plan.none) log.info(c.gray('  쇼릴: raw/reel/ 에 영상이 없습니다 — 건너뜀'));
        else {
          jobs.push(...plan.jobs);
          pruneList.push([plan.outDir, plan.expected, REEL_OUTPUT_PATTERNS]);
        }
      }
    }
    for (const slug of targets) {
      try {
        const plan = await proc.planWork(slug, bySlug.get(slug));
        jobs.push(...plan.jobs);
        pruneList.push([plan.outDir, plan.expected, WORK_OUTPUT_PATTERNS]);
      } catch (err) {
        // an unreadable/corrupt raw file must not stop the other works
        proc.stats.failed++;
        proc.stats.failures.push({ label: slug, message: err.message });
        log.error(`${slug}: 원본을 읽지 못해 건너뜁니다 — ${err.message}`);
      }
    }
    await proc.runJobs(jobs);
    if (proc.stats.cropped) {
      log.info(
        c.gray(
          '  레터박스(검은 띠)는 포스터·미리보기·공유 이미지·비포·애프터·스틸·첫 화면 배경에서만 잘랐습니다 (main.mp4·reel.mp4는 원본 그대로). 끄려면 works.mjs 의 작업에 autoCrop: false, 쇼릴은 site.mjs 의 reel.autoCrop: false',
        ),
      );
    }
    const pruned = [];
    for (const [dir, expected, patterns] of pruneList) {
      for (const rel of await proc.pruneStale(dir, expected, patterns)) pruned.push(toPosix(path.relative(proc.mediaDir, joinRel(dir, rel))));
    }
    if (pruned.length) log.info(`  ${o.dryRun ? '삭제 예정' : '원본이 없어진 결과 삭제'}: ${pruned.join(', ')}`);

    let manifest = null;
    if (!o.dryRun) {
      await removeEmptyDirs(path.join(proc.mediaDir, 'works'));
      manifest = await proc.buildManifest();
      await writeFileAtomic(path.join(proc.mediaDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      await proc.pruneAnalyses();
      await proc.saveCache();
    }
    const s = proc.stats;
    ok = s.failed === 0;
    log.info('');
    if (o.dryRun) log.ok(`미리 보기 — 실행 예정 ${s.planned || 0} · 최신 상태라 건너뜀 ${s.skipped}`);
    else log[ok ? 'ok' : 'error'](`미디어 처리 ${ok ? '완료' : '일부 실패'} — 새로 만듦 ${s.ran} · 건너뜀(최신) ${s.skipped}${s.failed ? ` · 실패 ${s.failed}` : ''} ${c.gray(`(${formatDuration(Date.now() - t0)})`)}`);
    if (s.warnings.length) log.warn(`경고 ${s.warnings.length}개 (위 내용 참고)`);
    if (!o.dryRun && ok) log.info(c.gray('  다음 단계: npm run build (또는 npm run preview 로 비공개 작업까지 확인)'));
    return { ok, code: ok ? 'ok' : 'failed', stats: s, manifest };
  } finally {
    await proc.cleanup();
  }
}
