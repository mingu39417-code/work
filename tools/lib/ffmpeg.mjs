// ffmpeg / ffprobe discovery, execution and color-safe filter builders (spec §3.2 "Color correctness").
import { spawn } from 'node:child_process';
import path from 'node:path';

// ---------------------------------------------------------------------------------------------
// discovery

function tryVersion(bin) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(bin, ['-version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? out.split('\n')[0].trim() : null));
  });
}

/** Find ffmpeg + ffprobe (FFMPEG_PATH / FFPROBE_PATH or PATH). Returns { ffmpeg, ffprobe, version } or null. */
export async function findFfmpeg(env = process.env) {
  const ffmpeg = env.FFMPEG_PATH || 'ffmpeg';
  let ffprobe = env.FFPROBE_PATH;
  if (!ffprobe) {
    if (env.FFMPEG_PATH) {
      const dir = path.dirname(env.FFMPEG_PATH);
      const ext = path.extname(env.FFMPEG_PATH);
      ffprobe = path.join(dir, `ffprobe${ext}`);
    } else ffprobe = 'ffprobe';
  }
  const [v1, v2] = await Promise.all([tryVersion(ffmpeg), tryVersion(ffprobe)]);
  if (!v1 || !v2) return null;
  return { ffmpeg, ffprobe, version: v1 };
}

export const FFMPEG_HELP = [
  'ffmpeg을 찾을 수 없습니다. 영상·이미지 변환에 ffmpeg(ffprobe 포함)이 필요합니다.',
  '',
  '  Windows : 터미널(PowerShell)에서  winget install Gyan.FFmpeg  실행 후, 터미널을 닫았다가 다시 여세요.',
  '  macOS   : brew install ffmpeg   (Homebrew가 없다면 https://brew.sh 참고)',
  '',
  '설치했는데도 안 되면 경로를 직접 지정할 수 있습니다:',
  '  FFMPEG_PATH=C:\\ffmpeg\\bin\\ffmpeg.exe  FFPROBE_PATH=C:\\ffmpeg\\bin\\ffprobe.exe',
].join('\n');

// ---------------------------------------------------------------------------------------------
// execution

export class FfmpegError extends Error {}

/**
 * Run ffmpeg with an argument array (never a shell string).
 * onProgress(fraction 0..1) is called when `duration` (seconds) is known.
 */
export function runFfmpeg(bin, args, { duration = 0, onProgress, signal, cwd } = {}) {
  const full = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...(onProgress ? ['-progress', 'pipe:1', '-nostats'] : []), ...args];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, full, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal, cwd });
    let stderr = '';
    let buf = '';
    child.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.stdout.on('data', (d) => {
      if (!onProgress) return;
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
        if (m && duration > 0) onProgress(Math.max(0, Math.min(1, Number(m[1]) / 1e6 / duration)));
      }
    });
    child.on('error', (err) => reject(new FfmpegError(`ffmpeg 실행 실패: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve({ stderr });
      else {
        const tail = stderr.trim().split('\n').slice(-6).join('\n');
        reject(new FfmpegError(`ffmpeg 오류 (코드 ${code}):\n${tail}`));
      }
    });
  });
}

/** Run a binary and collect stdout as a Buffer. */
export function runCapture(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.on('error', (err) => reject(new FfmpegError(`${path.basename(bin)} 실행 실패: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new FfmpegError(`${path.basename(bin)} 오류 (코드 ${code}): ${stderr.trim().split('\n').slice(-4).join('\n')}`));
    });
  });
}

// ---------------------------------------------------------------------------------------------
// probing

export async function probe(ffprobe, file) {
  let out;
  try {
    out = await runCapture(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  } catch (err) {
    const detail = String(err.message).split('\n').pop().replace(/^.*?:\s*/, '').trim();
    throw new FfmpegError(`${path.basename(file)} 파일을 읽을 수 없습니다 — 손상되었거나 지원하지 않는 형식입니다 (${detail})`);
  }
  return JSON.parse(out.toString('utf8'));
}

const RGB_FMT = /^(?:rgb|bgr|gbr|argb|abgr|rgba|bgra|0rgb|0bgr|rgb0|bgr0|x2rgb|x2bgr|pal8|gray|ya8|ya16|monob|monow)/;

function parseRate(r) {
  if (!r || typeof r !== 'string') return null;
  const [a, b] = r.split('/').map(Number);
  const v = b ? a / b : a;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Summarize the first video stream. Returns null when the file has no video. */
export function mediaInfo(probeJson) {
  const streams = probeJson?.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic) || streams.find((s) => s.codec_type === 'video');
  if (!v) return null;
  let w = Number(v.width) || null;
  let h = Number(v.height) || null;
  let rotation = 0;
  for (const sd of v.side_data_list || []) if (typeof sd.rotation === 'number') rotation = sd.rotation;
  if (!rotation && v.tags?.rotate) rotation = Number(v.tags.rotate) || 0;
  // non-square pixels (HDV/DVCPRO 1440×1080, anamorphic): report display size, filters resample to square pixels
  let sar = 1;
  const sarMatch = String(v.sample_aspect_ratio || '').match(/^(\d+):(\d+)$/);
  if (sarMatch && +sarMatch[1] > 0 && +sarMatch[2] > 0) sar = +sarMatch[1] / +sarMatch[2];
  if (Math.abs(sar - 1) < 0.01) sar = 1;
  if (Math.abs(rotation) % 180 === 90) [w, h] = [h, w];
  if (w && sar !== 1) w = Math.round(w * sar);
  const durations = [Number(v.duration), Number(probeJson?.format?.duration)].filter((d) => Number.isFinite(d) && d > 0);
  const pixFmt = v.pix_fmt || '';
  const transfer = v.color_transfer || '';
  const primaries = v.color_primaries || '';
  return {
    w,
    h,
    duration: durations.length ? durations[0] : null,
    fps: parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate),
    codec: v.codec_name || '',
    pixFmt,
    isRgb: RGB_FMT.test(pixFmt),
    range: v.color_range === 'pc' || /^yuvj/.test(pixFmt) ? 'pc' : v.color_range === 'tv' ? 'tv' : '',
    space: v.color_space || '',
    transfer,
    primaries,
    hdr: transfer === 'smpte2084' || transfer === 'arib-std-b67' || /^bt2020/.test(primaries),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    audioChannels: Number(streams.find((s) => s.codec_type === 'audio')?.channels) || 0,
    frames: Number(v.nb_frames) || null,
    sar,
    interlaced: ['tt', 'bb', 'tb', 'bt'].includes(v.field_order),
  };
}

// ---------------------------------------------------------------------------------------------
// color-safe filters

/** swscale matrix name for a probed YUV source. `still` → untagged defaults to BT.601 (JPEG/WebP are 601 by spec). */
export function matrixOf(info, { still = false } = {}) {
  switch (info?.space) {
    case 'bt709':
      return 'bt709';
    case 'smpte170m':
    case 'bt470bg':
      return 'bt601';
    case 'bt2020nc':
    case 'bt2020c':
      return 'bt2020';
    case 'fcc':
      return 'fcc';
    case 'smpte240m':
      return 'smpte240m';
    default:
      return still ? 'bt601' : 'bt709';
  }
}

/** swscale range name for a probed source. `still` → untagged JPEG is full range, other untagged sources limited. */
export function rangeOf(info, { still = false, codec = '' } = {}) {
  if (info?.range === 'pc') return 'pc';
  if (info?.range === 'tv') return 'tv';
  if (still && /mjpeg|jpeg/.test(codec || info?.codec || '')) return 'pc';
  return 'tv';
}

const even = (v) => Math.max(2, Math.round(v / 2) * 2);

/** Deinterlace only frames flagged interlaced (1080i broadcast masters); '' for progressive sources. */
function deint(info) {
  return info?.interlaced ? 'bwdif=mode=send_frame:parity=auto:deint=interlaced,' : '';
}

/**
 * Target size part of a scale filter. Square-pixel sources use expressions (width ≤ maxW, aspect kept);
 * non-square sources get explicit display-aspect dimensions (+ setsar=1 afterwards).
 */
function sizeFor(info, maxW, { evenDims }) {
  if (info?.sar && info.sar !== 1 && info.w && info.h) {
    const W = Math.min(maxW, info.w);
    const H = Math.round((W * info.h) / info.w);
    return { dims: evenDims ? `w=${even(W)}:h=${even(H)}` : `w=${W}:h=${H}`, post: ',setsar=1' };
  }
  return { dims: evenDims ? `w='trunc(min(${maxW},iw)/2)*2':h=-2` : `w='min(${maxW},iw)':h=-1`, post: '' };
}

/** video (any) → H.264 yuv420p BT.709 limited range, width ≤ maxW (never upscaled). */
export function videoScaleFilter(info, maxW) {
  const flags = 'flags=lanczos+accurate_rnd';
  const { dims, post } = sizeFor(info, maxW, { evenDims: true });
  const color = info?.isRgb ? '' : `:in_color_matrix=${matrixOf(info)}:in_range=${rangeOf(info)}`;
  return `${deint(info)}scale=${dims}:${flags}${color}:out_color_matrix=bt709:out_range=tv,format=yuv420p${post}`;
}

/** Exact-size variant (stacked B/A halves). */
export function videoScaleExactFilter(info, W, H) {
  const color = info?.isRgb ? '' : `:in_color_matrix=${matrixOf(info)}:in_range=${rangeOf(info)}`;
  return `${deint(info)}scale=w=${W}:h=${H}:flags=lanczos+accurate_rnd${color}:out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1`;
}

/**
 * anything → rgb24 (lossless master for stills). Exactly one explicit YUV→RGB conversion.
 * Either width ≤ maxW (aspect kept) or an exact { w, h } size.
 */
export function rgbMasterFilter(info, { maxW = 1920, size = null, still = false } = {}) {
  const { dims, post } = size ? { dims: `w=${size.w}:h=${size.h}`, post: ',setsar=1' } : sizeFor(info, maxW, { evenDims: false });
  const flags = 'flags=lanczos+accurate_rnd+full_chroma_int+full_chroma_inp';
  const color = info?.isRgb ? '' : `:in_color_matrix=${matrixOf(info, { still })}:in_range=${rangeOf(info, { still })}`;
  return `${deint(info)}scale=${dims}:${flags}${color},format=rgb24${post}`;
}

/** rgb24 master → JPEG (JFIF: BT.601 matrix, full range), width ≤ maxW. */
export function jpegFromRgbFilter(maxW) {
  return `scale=w='min(${maxW},iw)':h=-1:flags=lanczos+accurate_rnd:out_color_matrix=bt601:out_range=pc,format=yuvj420p`;
}

/** rgb24 master → BGRA for libwebp (libwebp does its own RGB→YUV, matching WebP decoders), width ≤ maxW. */
export function webpFromRgbFilter(maxW) {
  return `scale=w='min(${maxW},iw)':h=-1:flags=lanczos+accurate_rnd,format=bgra`;
}

/** Output flags that tag a video stream as BT.709 SDR (spec §3.2). */
export const BT709_TAGS = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];

/**
 * H.264 High, yuv420p, BT.709-tagged. aq-mode 3 (auto-variance with dark-scene bias) keeps smooth dark
 * gradients — skies, vignettes, fades — from banding at the higher CRFs used for previews and loops.
 */
export function x264Args({ crf, preset = 'medium' }) {
  return ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-profile:v', 'high', '-aq-mode', '3', '-pix_fmt', 'yuv420p', ...BT709_TAGS];
}
