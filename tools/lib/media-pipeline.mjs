// raw/ → media/ processing (spec §3). Incremental, color-managed (BT.709 video, sRGB-coded stills).
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { loadContent, SLUG_RE } from './content.mjs';
import {
  findFfmpeg,
  FFMPEG_HELP,
  runFfmpeg,
  probe,
  mediaInfo,
  videoScaleFilter,
  videoScaleExactFilter,
  rgbMasterFilter,
  jpegFromRgbFilter,
  webpFromRgbFilter,
  x264Args,
} from './ffmpeg.mjs';
import { imageSize } from './imagesize.mjs';
import { readJson, writeFileAtomic, statOrNull, isDir, renameWithRetry, hashString, rmrf, walkFiles, joinRel, toPosix, removeEmptyDirs } from './fsutil.mjs';
import { createLogger, c, formatBytes, formatDuration } from './log.mjs';

/** Bump when an encoding recipe changes so every output is rebuilt once. */
export const PIPELINE_VERSION = 5;

export const VIDEO_EXT = ['mp4', 'mov', 'mxf', 'mkv', 'm4v', 'avi', 'webm'];
export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp', 'bmp', 'dpx'];
const extOf = (f) => path.extname(f).slice(1).toLowerCase();
export const isVideoFile = (f) => VIDEO_EXT.includes(extOf(f));
export const isImageFile = (f) => IMAGE_EXT.includes(extOf(f));

const HDR_MSG = 'HDR 소스입니다 — Resolve에서 SDR Rec.709로 내보낸 파일을 사용하세요';

// Encoding recipes (spec §3.2)
export const RECIPES = {
  main: { maxW: 1920, crf: 20, preset: 'slow', audio: '192k' },
  reel: { maxW: 1920, crf: 20, preset: 'slow', audio: '192k' },
  loop: { maxW: 1280, crf: 27, preset: 'medium', maxDuration: 40 },
  preview: { maxW: 960, crf: 26, preset: 'medium' },
  baVideo: { maxW: 1280, crf: 23, preset: 'medium' },
  posterJpgW: 1920,
  posterWebp: [1280, 640],
  posterQuality: 82,
  baQuality: 88,
  stillQuality: 82,
  og: { w: 1200, h: 630 },
};

// ---------------------------------------------------------------------------------------------
// raw scanning

async function listFiles(dir) {
  try {
    const ents = await fsp.readdir(dir, { withFileTypes: true });
    return ents.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

async function listDirs(dir) {
  try {
    const ents = await fsp.readdir(dir, { withFileTypes: true });
    return ents.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
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

function audioArgs(info, bitrate) {
  if (!info?.hasAudio) return ['-an'];
  return ['-map', '0:a:0', '-c:a', 'aac', '-b:a', bitrate, ...(info.audioChannels > 2 ? ['-ac', '2'] : [])];
}

const COMMON_OUT = ['-map_metadata', '-1', '-map_chapters', '-1'];

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
    this.cache = { version: 1, jobs: {}, probe: {} };
    this.probeCache = new Map();
    this.stats = { ran: 0, skipped: 0, failed: 0, failures: [], warnings: [] };
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

  async probe(file) {
    if (this.probeCache.has(file)) return this.probeCache.get(file);
    const p = probe(this.tools.ffprobe, file).then(mediaInfo);
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

  // ---- primitive operations ----

  /** Any image or video frame → lossless rgb24 PNG master (≤ maxW or exact size). Returns { file, w, h }. */
  async rgbMaster(input, { time = null, maxW = 1920, size = null, name = 'master.png' } = {}) {
    const info = await this.probe(input);
    if (!info) throw new Error(`${path.basename(input)}: 영상/이미지 스트림이 없습니다`);
    const video = isVideoFile(input);
    const out = await this.tmp(name);
    const filter = rgbMasterFilter(info, { maxW, size, still: !video });
    const run = async (t) => {
      const seek = video && t > 0 ? ['-ss', t.toFixed(3)] : [];
      await this.ffmpeg([...seek, '-i', input, '-frames:v', '1', '-vf', filter, '-update', '1', out]);
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

  async encodeOg(master, out) {
    const { w, h } = RECIPES.og;
    const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos+accurate_rnd,crop=${w}:${h},${jpegFromRgbFilter(w)}`;
    await this.ffmpeg(['-i', master, '-vf', vf, '-c:v', 'mjpeg', '-q:v', '2', ...COMMON_OUT, '-update', '1', out]);
  }

  // ---- job runner ----

  /**
   * job: { key, label, inputs: [abs], outputs: [abs], params, duration?, run: async (tmpOutputs, onProgress) => void }
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

  async runJobs(jobs) {
    const queue = [];
    for (const job of jobs) {
      if (await this.needsRun(job)) queue.push(job);
      else this.stats.skipped++;
    }
    if (this.dryRun) {
      for (const job of queue) this.log.info(`  ${c.cyan('실행 예정')} ${job.label}`);
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
      await this.saveCache();
      this.stats.ran++;
      const sizes = [];
      for (const o of job.outputs) sizes.push((await statOrNull(o))?.size || 0);
      this.status.delete(job.key);
      this.clearStatus();
      this.log.ok(`${job.label} ${c.gray(`— ${formatBytes(sizes.reduce((a, b) => a + b, 0))} · ${formatDuration(Date.now() - t0)}`)}`);
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
    if (c0 && c0.version === 1) this.cache = { version: 1, jobs: c0.jobs || {}, probe: c0.probe || {} };
  }

  async saveCache() {
    if (this.dryRun) return;
    this.cacheWrite = (this.cacheWrite || Promise.resolve()).then(() =>
      writeFileAtomic(path.join(this.mediaDir, '.cache.json'), `${JSON.stringify(this.cache, null, 1)}\n`),
    );
    await this.cacheWrite;
  }

  // ---- planning ----

  videoJob({ key, label, input, output, recipe, info, seek = 0, duration = null, extraFilter = '', audio = false }) {
    const dur = duration ?? (info.duration ? Math.max(0, info.duration - seek) : 0);
    const maxDur = recipe.maxDuration ? Math.min(dur || recipe.maxDuration, recipe.maxDuration) : dur;
    const params = { kind: 'video', recipe, seek, duration: maxDur || null, extraFilter, audio, preset: this.preset(recipe) };
    return {
      key,
      label,
      inputs: [input],
      outputs: [output],
      params,
      run: async ([tmp], onProgress) => {
        const args = [];
        if (seek > 0) args.push('-ss', seek.toFixed(3));
        if (maxDur && (duration !== null || recipe.maxDuration)) args.push('-t', maxDur.toFixed(3));
        args.push('-i', input, '-map', '0:v:0');
        args.push('-vf', `${videoScaleFilter(info, recipe.maxW)}${extraFilter}`);
        args.push(...x264Args({ crf: recipe.crf, preset: this.preset(recipe) }));
        args.push(...(audio ? audioArgs(info, recipe.audio) : ['-an']));
        args.push(...COMMON_OUT, '-movflags', '+faststart', tmp);
        await this.ffmpeg(args, { duration: maxDur || info.duration || 0, onProgress });
      },
    };
  }

  posterJobs({ key, label, source, time, outDir, og = true }) {
    const outputs = [
      path.join(outDir, 'poster.jpg'),
      path.join(outDir, 'poster-1280.webp'),
      path.join(outDir, 'poster-640.webp'),
      ...(og ? [path.join(outDir, 'og.jpg')] : []),
    ];
    return {
      key,
      label,
      inputs: [source],
      outputs,
      params: { kind: 'poster', time, recipe: [RECIPES.posterJpgW, RECIPES.posterWebp, RECIPES.posterQuality, RECIPES.og] },
      run: async (tmps) => {
        const master = await this.rgbMaster(source, { time, maxW: RECIPES.posterJpgW });
        await this.encodeJpeg(master.file, tmps[0], { maxW: RECIPES.posterJpgW });
        await this.encodeWebp(master.file, tmps[1], { maxW: RECIPES.posterWebp[0], quality: RECIPES.posterQuality });
        await this.encodeWebp(master.file, tmps[2], { maxW: RECIPES.posterWebp[1], quality: RECIPES.posterQuality });
        if (tmps[3]) await this.encodeOg(master.file, tmps[3]);
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

    let mainInfo = null;
    if (raw.main) {
      mainInfo = await this.probe(raw.main).catch((err) => {
        this.warn(`${slug}: ${err.message}`);
        return null;
      });
      if (mainInfo?.hdr) this.warn(`${slug}: ${path.basename(raw.main)} — ${HDR_MSG}`);
    }
    const posterTime = mainInfo ? clampTime(opts.posterTime ?? defaultPosterTime(mainInfo.duration), mainInfo.duration, 0.25) : 0;

    if (raw.main && mainInfo) {
      if (opts.video) {
        this.log.info(c.gray(`  ${slug}: 외부 영상(${opts.video.type}) 사용 — main.mp4 생략`));
        expected.add(path.join(outDir, 'main.mp4')); // keep an existing copy, build ignores it
      } else {
        add(
          this.videoJob({
            key: `works/${slug}/main`,
            label: `${slug} · main.mp4`,
            input: raw.main,
            output: path.join(outDir, 'main.mp4'),
            recipe: RECIPES.main,
            info: mainInfo,
            audio: true,
          }),
        );
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
        }),
      );
    }

    // poster: explicit image → main frame → after-1
    let posterSource = null;
    let posterAt = 0;
    if (raw.poster) posterSource = raw.poster;
    else if (raw.main && mainInfo) {
      posterSource = raw.main;
      posterAt = posterTime;
    } else if (raw.pairs.length) {
      posterSource = raw.pairs[0].after;
      if (isVideoFile(posterSource)) posterAt = await this.baTime(raw.pairs[0], opts, 0);
    }
    if (posterSource) {
      add(this.posterJobs({ key: `works/${slug}/poster`, label: `${slug} · 포스터·공유 이미지`, source: posterSource, time: posterAt, outDir }));
    } else {
      this.warn(`${slug}: 포스터를 만들 원본이 없습니다 (main 영상, poster 이미지, after-1 중 하나 필요) — 사이트에 공개되지 않습니다`);
    }

    // before / after pairs
    for (const pair of raw.pairs) {
      const n = pair.n;
      const outs = ['before', 'after'].flatMap((s) => [path.join(outDir, `ba-${n}-${s}.webp`), path.join(outDir, `ba-${n}-${s}-960.webp`)]);
      const t = await this.baTime(pair, opts, n - 1);
      add({
        key: `works/${slug}/ba-${n}`,
        label: `${slug} · 비포·애프터 ${n}`,
        inputs: [pair.before, pair.after],
        outputs: outs,
        params: { kind: 'ba', t, q: RECIPES.baQuality },
        run: async (tmps) => {
          const after = await this.rgbMaster(pair.after, { time: t, name: 'after.png' });
          const before = await this.rgbMaster(pair.before, { time: t, size: { w: after.w, h: after.h }, name: 'before.png' });
          const bInfo = await this.probe(pair.before);
          const aInfo = await this.probe(pair.after);
          if (bInfo?.w && bInfo?.h && aInfo?.w && aInfo?.h && Math.abs(bInfo.w / bInfo.h - aInfo.w / aInfo.h) > 0.01) {
            this.warn(`${slug}: before-${n}와 after-${n}의 화면비가 달라 before를 after 크기(${after.w}×${after.h})에 맞췄습니다`);
          }
          for (const hdrInfo of [bInfo, aInfo]) if (hdrInfo?.hdr) this.warn(`${slug}: 비포·애프터 ${n} — ${HDR_MSG}`);
          await this.encodeWebp(before.file, tmps[0], { maxW: 1920, quality: RECIPES.baQuality });
          await this.encodeWebp(before.file, tmps[1], { maxW: 960, quality: RECIPES.baQuality });
          await this.encodeWebp(after.file, tmps[2], { maxW: 1920, quality: RECIPES.baQuality });
          await this.encodeWebp(after.file, tmps[3], { maxW: 960, quality: RECIPES.baQuality });
          await fsp.rm(before.file, { force: true });
          await fsp.rm(after.file, { force: true });
        },
      });
      if (opts.baVideo && isVideoFile(pair.before) && isVideoFile(pair.after)) {
        add(await this.baVideoJob(slug, pair, opts, outDir));
      } else if (opts.baVideo && n === 1 && !(isVideoFile(pair.before) && isVideoFile(pair.after))) {
        this.log.info(c.gray(`  ${slug}: baVideo — before-${n}/after-${n}가 둘 다 영상일 때만 비교 영상을 만듭니다`));
      }
    }

    // stills
    raw.stills.forEach((file, i) => {
      const nn = String(i + 1).padStart(2, '0');
      add({
        key: `works/${slug}/stills/${nn}`,
        label: `${slug} · 스틸 ${nn}`,
        inputs: [file],
        outputs: [path.join(outDir, 'stills', `${nn}.webp`), path.join(outDir, 'stills', `${nn}-960.webp`)],
        params: { kind: 'still', q: RECIPES.stillQuality },
        run: async (tmps) => {
          const m = await this.rgbMaster(file, { name: `still-${nn}.png` });
          await this.encodeWebp(m.file, tmps[0], { maxW: 1920, quality: RECIPES.stillQuality });
          await this.encodeWebp(m.file, tmps[1], { maxW: 960, quality: RECIPES.stillQuality });
          await fsp.rm(m.file, { force: true });
        },
      });
    });

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

  async baVideoJob(slug, pair, opts, outDir) {
    const n = pair.n;
    const [bInfo, aInfo] = await Promise.all([this.probe(pair.before), this.probe(pair.after)]);
    const maxW = RECIPES.baVideo.maxW;
    const W = Math.max(2, Math.floor(Math.min(maxW, aInfo.w || maxW) / 2) * 2);
    const H = Math.max(2, Math.round(((aInfo.h || 720) * W) / (aInfo.w || W) / 2) * 2);
    const minDur = Math.min(bInfo.duration || Infinity, aInfo.duration || Infinity);
    let start = opts.baVideoStart ?? opts.baTimes?.[n - 1] ?? 0;
    if (Number.isFinite(minDur)) start = Math.max(0, Math.min(start, Math.max(0, minDur - 1)));
    const dur = Number.isFinite(minDur) ? Math.min(opts.baVideoDuration || 8, minDur - start) : opts.baVideoDuration || 8;
    const fps = capFpsFilter(aInfo).replace(/^,/, '') || (aInfo.fps ? `fps=${Math.round(aInfo.fps * 1000) / 1000}` : '');
    const scale = (info) => videoScaleExactFilter(info, W, H);
    const graph = [
      `[0:v]${scale(bInfo)}${fps ? `,${fps}` : ''}[b]`,
      `[1:v]${scale(aInfo)}${fps ? `,${fps}` : ''}[a]`,
      '[b][a]hstack=inputs=2,format=yuv420p[v]',
    ].join(';');
    const recipe = RECIPES.baVideo;
    return {
      key: `works/${slug}/ba-${n}-video`,
      label: `${slug} · 비교 영상 ba-${n}.mp4`,
      inputs: [pair.before, pair.after],
      outputs: [path.join(outDir, `ba-${n}.mp4`)],
      params: { kind: 'baVideo', W, H, start, dur, fps, recipe, preset: this.preset(recipe) },
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

  async planReel(site) {
    const dir = path.join(this.rawDir, 'reel');
    const outDir = path.join(this.mediaDir, 'reel');
    const expected = new Set();
    const jobs = [];
    const video = (await listFiles(dir)).find(isVideoFile);
    if (!video) return { jobs, expected, outDir, none: true };
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
    if (site?.reel?.embed) {
      this.log.info(c.gray(`  쇼릴: 외부 영상(${site.reel.embed.type}) 사용 — reel.mp4 생략`));
      expected.add(path.join(outDir, 'reel.mp4'));
    } else {
      add(this.videoJob({ key: 'reel/full', label: '쇼릴 · reel.mp4', input, output: path.join(outDir, 'reel.mp4'), recipe: RECIPES.reel, info, audio: true }));
    }
    add(
      this.videoJob({
        key: 'reel/loop',
        label: '쇼릴 · reel-loop.mp4 (배경)',
        input,
        output: path.join(outDir, 'reel-loop.mp4'),
        recipe: RECIPES.loop,
        info,
        extraFilter: capFpsFilter(info),
      }),
    );
    add(this.posterJobs({ key: 'reel/poster', label: '쇼릴 · 포스터', source: input, time: defaultPosterTime(info.duration), outDir, og: false }));
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

  async buildManifest() {
    const md = this.mediaDir;
    // rebuild the probe cache from what exists now (entries for deleted files drop out)
    this.oldProbe = this.cache.probe;
    this.cache.probe = {};
    const reelDir = path.join(md, 'reel');
    const reel = (await isDir(reelDir))
      ? {
          full: await this.fileEntry(path.join(reelDir, 'reel.mp4'), 'video'),
          loop: await this.fileEntry(path.join(reelDir, 'reel-loop.mp4'), 'video'),
          poster: await this.fileEntry(path.join(reelDir, 'poster.jpg'), 'image'),
        }
      : null;
    const works = {};
    for (const slug of await listDirs(path.join(md, 'works'))) {
      const d = path.join(md, 'works', slug);
      const files = await listFiles(d);
      const nums = [...new Set(files.map((f) => f.match(/^ba-(\d+)-(?:before|after)\.webp$/)).filter(Boolean).map((m) => Number(m[1])))].sort((a, b) => a - b);
      const ba = [];
      for (const n of nums) {
        const before = await this.fileEntry(path.join(d, `ba-${n}-before.webp`), 'image');
        const after = await this.fileEntry(path.join(d, `ba-${n}-after.webp`), 'image');
        if (!before || !after) continue;
        ba.push({ before, after, video: await this.fileEntry(path.join(d, `ba-${n}.mp4`), 'video') });
      }
      const stills = [];
      for (const f of (await listFiles(path.join(d, 'stills'))).filter((f) => /^\d+\.webp$/.test(f)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))) {
        stills.push(await this.fileEntry(path.join(d, 'stills', f), 'image'));
      }
      works[slug] = {
        main: await this.fileEntry(path.join(d, 'main.mp4'), 'video'),
        preview: await this.fileEntry(path.join(d, 'preview.mp4'), 'video'),
        poster: await this.fileEntry(path.join(d, 'poster.jpg'), 'image'),
        og: await this.fileEntry(path.join(d, 'og.jpg'), 'image'),
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
  /^ba-\d+(?:-(?:before|after)(?:-960)?\.webp|\.mp4)$/,
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
