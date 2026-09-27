// Letterbox / pillarbox detection: black bars baked into a master (Resolve output blanking — 2.39:1 scope inside a
// 16:9 frame is the usual colorist deliverable). Pure functions; media-pipeline.mjs runs ffmpeg and feeds them.
//
// Each sampled frame is decoded to 8-bit full-range luma at its decoded size, with ffmpeg cropdetect in the same
// pass. cropdetect proposes the picture rectangle (its row/column *averages* also call a dark sky "black"), so the
// bars are then measured here as runs of *flat* black lines from each edge — mean near black and almost no
// brighter pixels — which a grainy night sky, a dark silhouette next to the bar or a burnt-in subtitle never are.
// A crop is only accepted when it is consistent over the samples, roughly symmetric (centered blanking), at least
// 2 % of the frame per side and leaves a standard picture aspect ratio.

/** cropdetect in the analysis pass (gray, full range): average ≤ 10 % → "black"; every frame reported (skip=0). */
export const CROPDETECT = 'cropdetect=limit=0.1:round=2:skip=0:reset=0';

export const BARS = {
  minSide: 0.02, // each bar ≥ 2 % of the dimension
  symmetry: 0.01, // |top − bottom| ≤ 1 % of the dimension + 2 px
  flatMean: 5, // a bar line averages ≤ 5/255 (≈ 2 %) above black …
  bright: 24, // … and at most 1 % of its pixels are brighter than 24/255 (grain, text, ringing)
  brightShare: 0.01,
  inset: 2, // px trimmed past the measured edge (codec ringing / anti-aliased blanking edge)
  loopShare: 0.4, // 'loop' mode (mixed showreel): the most common letterbox must be in ≥ 40 % of the samples
};

/** Picture aspect ratios a crop may leave (±2 %): vertical/social, TV, flat, scope. Anything else is not "bars". */
export const STANDARD_RATIOS = [9 / 16, 2 / 3, 3 / 4, 4 / 5, 1, 5 / 4, 4 / 3, 1.37, 1.43, 3 / 2, 1.6, 1.66, 16 / 9, 1.85, 1.9, 2, 2.2, 2.35, 2.39, 2.4, 2.55, 2.76];

const isStandardRatio = (r) => STANDARD_RATIOS.some((s) => Math.abs(r / s - 1) <= 0.02);

/** Last `crop=W:H:X:Y` in cropdetect's log → { w, h, x, y }, { black: true } for an all-black frame, null if none. */
export function parseCropdetect(stderr) {
  const all = [...String(stderr || '').matchAll(/crop=(-?\d+):(-?\d+):(-?\d+):(-?\d+)/g)];
  if (!all.length) return null;
  const [w, h, x, y] = all[all.length - 1].slice(1).map(Number);
  if (w <= 0 || h <= 0) return { black: true };
  return { w, h, x, y };
}

function flatLine(buf, start, step, n) {
  let sum = 0;
  let bright = 0;
  for (let i = 0, p = start; i < n; i++, p += step) {
    const v = buf[p];
    sum += v;
    if (v > BARS.bright) bright++;
  }
  return sum / n <= BARS.flatMean && bright <= n * BARS.brightShare;
}

/**
 * Measure the bars of one decoded frame (8-bit gray, full range, W × H).
 * Returns { black: true } for a black/near-black frame (fade, slate), else { W, H, top, bottom, left, right } (px).
 * `cd` (cropdetect's rectangle) caps every run: a flat run can never extend past what cropdetect calls picture.
 */
export function measureBars(buf, W, H, cd = null) {
  if (!buf || buf.length < W * H || W < 8 || H < 8) return null;
  if (cd?.black) return { black: true };
  const row = (y, x0, x1) => flatLine(buf, y * W + x0, 1, x1 - x0);
  const col = (x, y0, y1) => flatLine(buf, y0 * W + x, W, y1 - y0);
  let top = 0;
  while (top < H && row(top, 0, W)) top++;
  if (top >= H * 0.45) return { black: true };
  let bottom = 0;
  while (bottom < H - top && row(H - 1 - bottom, 0, W)) bottom++;
  if (top + bottom >= H * 0.9) return { black: true };
  const y0 = top;
  const y1 = H - bottom;
  let left = 0;
  while (left < W && col(left, y0, y1)) left++;
  let right = 0;
  while (right < W - left && col(W - 1 - right, y0, y1)) right++;
  if (left + right >= W * 0.9) return { black: true };
  if (cd) {
    top = Math.min(top, Math.max(0, cd.y));
    bottom = Math.min(bottom, Math.max(0, H - cd.y - cd.h));
    left = Math.min(left, Math.max(0, cd.x));
    right = Math.min(right, Math.max(0, W - cd.x - cd.w));
  }
  return { W, H, top, bottom, left, right };
}

/** [a, b] when both bars are big enough and roughly symmetric, else null. */
function barPair(a, b, dim) {
  const min = Math.max(2, dim * BARS.minSide);
  if (a < min || b < min) return null;
  if (Math.abs(a - b) > dim * BARS.symmetry + 2) return null;
  return [a, b];
}

/**
 * One axis over all samples.
 * 'strict' (work poster/preview/og, B/A, stills): every sample must show the bars; the smallest bar per side wins,
 *   so no sample ever loses picture (a dark shot next to the bar only makes its own run longer).
 * 'loop' (hero background of a mixed showreel): the most common letterbox wins when it is in ≥ 40 % of the samples —
 *   full-frame shots in the same reel lose a sliver top and bottom, which a cover-fitted background never shows.
 */
function pickAxis(pairs, dim, mode) {
  const boxed = pairs.map(([a, b]) => barPair(a, b, dim));
  let chosen;
  if (mode === 'loop') {
    const hits = boxed.filter(Boolean);
    if (hits.length < Math.max(2, Math.ceil(pairs.length * BARS.loopShare))) return null;
    const buckets = new Map();
    for (const p of hits) {
      const key = `${Math.round(p[0] / 8)}:${Math.round(p[1] / 8)}`;
      buckets.set(key, [...(buckets.get(key) || []), p]);
    }
    const best = [...buckets.values()].sort((x, y) => y.length - x.length || x[0][0] - y[0][0])[0];
    if (best.length < Math.max(2, Math.ceil(pairs.length * BARS.loopShare))) return null;
    chosen = best;
  } else {
    if (boxed.some((p) => !p)) return null;
    chosen = boxed;
  }
  return barPair(Math.min(...chosen.map((p) => p[0])), Math.min(...chosen.map((p) => p[1])), dim);
}

/**
 * Decide the crop for a source from its measured samples.
 * Returns { w, h, x, y } (decoded pixels, even-aligned, 2 px inset on cropped edges) or null (leave the frame alone).
 * minSamples: non-black samples needed (video 3, still 1). sar: display aspect of a pixel (for the ratio check).
 */
export function decideCrop(samples, { mode = 'strict', minSamples = 1, sar = 1 } = {}) {
  const valid = samples.filter((s) => s && !s.black);
  if (!valid.length || valid.length < minSamples) return null;
  const { W, H } = valid[0];
  if (valid.some((s) => s.W !== W || s.H !== H)) return null;
  const v = pickAxis(valid.map((s) => [s.top, s.bottom]), H, mode);
  const h = pickAxis(valid.map((s) => [s.left, s.right]), W, mode);
  if (!v && !h) return null;
  const [top, bottom] = v || [0, 0];
  const [left, right] = h || [0, 0];
  if (!isStandardRatio(((W - left - right) * sar) / (H - top - bottom))) return null;
  const up = (n) => Math.ceil(n / 2) * 2;
  const down = (n) => Math.floor(n / 2) * 2;
  const x = left ? up(left + BARS.inset) : 0;
  const y = top ? up(top + BARS.inset) : 0;
  const x2 = right ? down(W - right - BARS.inset) : down(W);
  const y2 = bottom ? down(H - bottom - BARS.inset) : down(H);
  if (x2 - x < W * 0.2 || y2 - y < H * 0.2) return null;
  return { w: x2 - x, h: y2 - y, x, y };
}

/**
 * Sample times for a video: `count` points spread over [start, end] (default the whole clip, skipping the first and
 * last 10 % where fades live). Unknown duration → the first frame only.
 */
export function sampleTimes(duration, { count = 5, start = null, end = null } = {}) {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const a = start ?? duration * 0.1;
  const b = Math.min(end ?? duration * 0.9, duration - 0.05);
  if (!(b > a)) return [Math.max(0, Math.min(a, duration / 2))];
  return Array.from({ length: count }, (_, i) => Math.round((a + ((b - a) * (i + 0.5)) / count) * 1000) / 1000);
}

/**
 * Map a crop found on one source (B/A "after") onto its partner ("before") by relative position, so both halves
 * show the same part of the frame even when the partner has another resolution. null stays null.
 */
export function mapCrop(crop, from, to) {
  if (!crop || !from?.w || !from?.h || !to?.w || !to?.h) return null;
  if (from.w === to.w && from.h === to.h) return { ...crop };
  const sx = to.w / from.w;
  const sy = to.h / from.h;
  const up = (n) => Math.ceil(n / 2) * 2;
  const down = (n) => Math.floor(n / 2) * 2;
  const x = up(crop.x * sx);
  const y = up(crop.y * sy);
  const w = Math.min(down((crop.x + crop.w) * sx), down(to.w)) - x;
  const h = Math.min(down((crop.y + crop.h) * sy), down(to.h)) - y;
  return w > 0 && h > 0 ? { w, h, x, y } : null;
}

/**
 * Where a video's opening settles: after leading black and the fade-in that usually follows it (logo slate,
 * dip from black). `levels` are mean luma values (0-255, full range) sampled every `step` seconds from 0.
 * Returns the time (s) of the first sample that is within 15 % of the brightest level of the following second
 * (plus one sample of margin); 0 when the video opens on picture (its first frame is not dark next to the next
 * 2 s) or never settles in the window.
 */
export function introEnd(levels, step = 0.1) {
  const win = Math.max(1, Math.round(1 / step));
  if (!levels.length) return 0;
  // only an opening that is dark next to what follows is an intro (a night shot or a slow sunrise is picture)
  const opening = Math.max(...levels.slice(0, Math.round(2 / step) + 1));
  if (levels[0] >= Math.max(8, opening * 0.5)) return 0;
  for (let i = 0; i < levels.length; i++) {
    const next = levels.slice(i, i + win + 1);
    const peak = Math.max(...next);
    if (peak < 8) continue; // still black
    if (levels[i] >= peak * 0.85) return i === 0 ? 0 : Math.round((i + 1) * step * 1000) / 1000;
  }
  return 0;
}
