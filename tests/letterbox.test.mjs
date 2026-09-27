// Letterbox detection logic (pure): flat-black runs, cropdetect parsing, sample consensus, B/A crop mapping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCropdetect, measureBars, decideCrop, sampleTimes, mapCrop, introEnd, BARS } from '../tools/lib/letterbox.mjs';

/** Synthetic 8-bit gray frame: mid-gray picture with fine "grain", optional bars, optional custom rows. */
function frame(W, H, { top = 0, bottom = 0, left = 0, right = 0, picture = 120, rows = null } = {}) {
  const buf = Buffer.alloc(W * H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const bar = y < top || y >= H - bottom || x < left || x >= W - right;
      const custom = rows?.(y, x, rnd);
      buf[y * W + x] = custom ?? (bar ? 0 : Math.max(0, Math.min(255, picture + Math.round((rnd() - 0.5) * 20))));
    }
  }
  return buf;
}

test('parseCropdetect: last rectangle wins; a black frame reports negative sizes', () => {
  const log = '[Parsed_cropdetect_2 @ 0x1] x1:0 x2:1919 y1:140 y2:941 w:1920 h:800 x:0 y:140 pts:0 t:0 limit:0.1 crop=1920:800:0:140\n' + '[Parsed_cropdetect_2 @ 0x1] ... crop=1920:804:0:138';
  assert.deepEqual(parseCropdetect(log), { w: 1920, h: 804, x: 0, y: 138 });
  assert.deepEqual(parseCropdetect('crop=-1918:-1078:1920:1080'), { black: true });
  assert.equal(parseCropdetect('no crop lines'), null);
});

test('measureBars: flat black bars vs dark-but-textured picture, subtitles, black frames', () => {
  const W = 320;
  const H = 180;
  // 2.39:1 inside 16:9 → 23 px bars on 180 lines
  assert.deepEqual(measureBars(frame(W, H, { top: 23, bottom: 23 }), W, H), { W, H, top: 23, bottom: 23, left: 0, right: 0 });
  // cropdetect caps a run (it never calls more "black" than it saw)
  assert.equal(measureBars(frame(W, H, { top: 23, bottom: 23 }), W, H, { w: W, h: 140, x: 0, y: 20 }).top, 20);
  // a grainy night sky at the top (mean ≈ 10, grain up to ≈ 30) is picture, not a bar
  const sky = frame(W, H, { rows: (y, x, rnd) => (y < 40 ? Math.round(4 + rnd() * 24) : null) });
  assert.equal(measureBars(sky, W, H).top, 0);
  // a dark silhouette right next to the bar does not make the bar bigger
  const ridge = frame(W, H, { top: 23, bottom: 23, rows: (y, x, rnd) => (y >= 130 && y < 157 ? Math.round(6 + rnd() * 14) : null) });
  assert.equal(measureBars(ridge, W, H).bottom, 23);
  // burnt-in subtitle inside the bottom bar: the bar stops at the text (so the frame will not be cropped through it)
  const sub = frame(W, H, { top: 23, bottom: 23, rows: (y, x) => (y >= 165 && y < 172 && x > 100 && x < 220 && x % 3 === 0 ? 230 : null) });
  assert.ok(measureBars(sub, W, H).bottom < 12);
  // pillarbox (4:3 inside 16:9)
  const pb = measureBars(frame(W, H, { left: 40, right: 40 }), W, H);
  assert.deepEqual([pb.left, pb.right, pb.top], [40, 40, 0]);
  assert.deepEqual(measureBars(Buffer.alloc(W * H), W, H), { black: true });
  assert.deepEqual(measureBars(frame(W, H), W, H, { black: true }), { black: true });
});

test('decideCrop strict: bars in every sample, symmetric, ≥ 2 %, standard ratio → even rect with 2 px inset', () => {
  const s = (top, bottom, extra = {}) => ({ W: 1920, H: 1080, top, bottom, left: 0, right: 0, ...extra });
  const crop = decideCrop([s(138, 138), s(138, 139), s(150, 138), s(138, 138), s(138, 138)], { minSamples: 3 });
  // smallest bar per side wins (the 150 is a dark shot next to the bar); inset 2 px, even
  assert.deepEqual(crop, { w: 1920, h: 800, x: 0, y: 140 });
  assert.equal(crop.y % 2 + crop.h % 2 + crop.w % 2, 0);
  // one full-frame sample (mixed-aspect edit) → leave the work alone
  assert.equal(decideCrop([s(138, 138), s(0, 0), s(138, 138)], { minSamples: 3 }), null);
  // asymmetric (dark sky on top only) → no crop
  assert.equal(decideCrop([s(200, 20), s(200, 20), s(200, 20)], { minSamples: 3 }), null);
  // bars under 2 % → no crop
  assert.equal(decideCrop([s(15, 15), s(15, 15), s(15, 15)], { minSamples: 3 }), null);
  // not enough readable samples (fades, black) → no crop
  assert.equal(decideCrop([s(138, 138), { black: true }, null], { minSamples: 3 }), null);
  // picture that would be left is not a standard aspect ratio (a product on black, a title card) → no crop
  assert.equal(decideCrop([s(330, 330)], { minSamples: 1 }), null);
  // pillarbox 4:3 inside 16:9
  assert.deepEqual(decideCrop([{ W: 1920, H: 1080, top: 0, bottom: 0, left: 240, right: 240 }]), { w: 1436, h: 1080, x: 242, y: 0 });
  assert.equal(BARS.minSide, 0.02);
});

test('decideCrop loop: a mixed showreel is cropped when its most common letterbox is in ≥ 40 % of the samples', () => {
  const s = (b) => ({ W: 1280, H: 720, top: b, bottom: b, left: 0, right: 0 });
  const mixed = [s(92), s(92), s(0), s(0), s(92), s(0), s(92), { black: true }, s(0)];
  assert.equal(decideCrop(mixed, { mode: 'strict', minSamples: 3 }), null);
  assert.deepEqual(decideCrop(mixed, { mode: 'loop', minSamples: 3 }), { w: 1280, h: 532, x: 0, y: 94 });
  // only one letterboxed shot in nine → the hero keeps the full frame
  assert.equal(decideCrop([s(92), s(0), s(0), s(0), s(0), s(0), s(0), s(0), s(0)], { mode: 'loop', minSamples: 3 }), null);
});

test('mapCrop: the after-side crop lands on the same part of a before with another resolution', () => {
  const crop = { w: 1920, h: 800, x: 0, y: 140 };
  assert.deepEqual(mapCrop(crop, { w: 1920, h: 1080 }, { w: 1920, h: 1080 }), crop);
  assert.deepEqual(mapCrop(crop, { w: 1920, h: 1080 }, { w: 3840, h: 2160 }), { w: 3840, h: 1600, x: 0, y: 280 });
  assert.equal(mapCrop(null, { w: 1, h: 1 }, { w: 1, h: 1 }), null);
});

test('sampleTimes / introEnd (leading black + fade-in skipped, picture openings untouched)', () => {
  assert.deepEqual(sampleTimes(10), [1.8, 3.4, 5, 6.6, 8.2]);
  assert.deepEqual(sampleTimes(null), [0]);
  const t = sampleTimes(12, { count: 9, start: 1.5, end: 13.5 });
  assert.equal(t.length, 9);
  assert.ok(t[0] > 1.5 && t[8] < 12);
  // 1 s black, hard cut to picture → starts one sample after the cut
  assert.equal(introEnd([...Array(10).fill(0), ...Array(30).fill(120)]), 1.1);
  // dip from black over 0.5 s (the demo reel) → starts where the fade has settled, not on a dark frame
  const fade = [0, 8, 13, 20, 26, 32, 36, 38, 38, 39, 38, 38, 39, 38, 38, 38, 38, 38, 38, 38];
  const start = introEnd(fade);
  assert.ok(start >= 0.4 && start <= 0.8, `fade start ${start}`);
  // opens on picture (even a brightening one) → 0
  assert.equal(introEnd([100, 104, 108, 110, 112, 115, 118, 120, 120, 121, 120]), 0);
  assert.equal(introEnd(Array(30).fill(0)), 0);
  assert.equal(introEnd([]), 0);
});
