// Media pipeline on real-world source quirks: baked-in letterbox bars (auto-crop, B/A alignment, opt-out, cache),
// dark-but-not-letterboxed footage, a mixed showreel with a black intro, multi-track audio, vertical masters,
// before/after with different aspect ratios, still ordering and '%' in file names.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runMedia } from '../tools/lib/media-pipeline.mjs';
import { BASE_SITE, tmpDir, write, hasFfmpeg, silentLogger, work, FFMPEG, FFPROBE } from './helpers.mjs';

const skip = !hasFfmpeg() && 'ffmpeg/ffprobe 없음';

function ff(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${r.stderr}`);
}

function dims(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,level', '-of', 'json', file], { encoding: 'utf8' });
  const s = JSON.parse(r.stdout).streams[0];
  return { w: s.width, h: s.height, level: s.level };
}

function audioStreams(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=channels', '-of', 'json', file], { encoding: 'utf8' });
  return JSON.parse(r.stdout).streams.map((s) => s.channels);
}

/** One frame as full-range 8-bit gray. */
function gray(file, seek = 0) {
  const { w, h } = dims(file);
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...(seek ? ['-ss', String(seek)] : []), '-i', file, '-frames:v', '1', '-vf', 'scale=out_range=pc,format=gray', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 1 << 28 });
  return { buf: r.stdout, w, h };
}

/** One frame as rgb24, decoded with the matrix/range the file is meant to be shown with. */
function rgb(file, matrix, range) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=in_color_matrix=${matrix}:in_range=${range}:flags=accurate_rnd+full_chroma_int,format=rgb24`, '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 1 << 28 });
  return r.stdout;
}

const rowMean = (img, y) => {
  let s = 0;
  for (let x = 0; x < img.w; x++) s += img.buf[y * img.w + x];
  return s / img.w;
};
const colMean = (img, x) => {
  let s = 0;
  for (let y = 0; y < img.h; y++) s += img.buf[y * img.w + x];
  return s / img.h;
};
/** bounding box of pixels ≥ th → [x0, y0, x1, y1] */
function bbox(img, th = 250) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.buf[y * img.w + x] < th) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return [x0, y0, x1, y1];
}

/** RMS level (dB) of one output channel around a frequency. */
function band(file, channel, freq) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostdin', '-i', file, '-vn', '-af', `pan=mono|c0=c${channel},bandpass=f=${freq}:w=60,astats=metadata=0:reset=0`, '-f', 'null', '-'], { encoding: 'utf8' });
  const all = [...r.stderr.matchAll(/RMS level dB:\s*(-?[\d.]+|-inf)/g)];
  const v = all.length ? all[all.length - 1][1] : '-inf';
  return v === '-inf' ? -200 : Number(v);
}

// 640×360 with 46-px bars top and bottom = 2.39:1 scope blanking inside 16:9
const BARS = 'drawbox=x=0:y=0:w=iw:h=46:color=black:t=fill,drawbox=x=0:y=314:w=iw:h=46:color=black:t=fill';
const MARK = 'drawbox=x=300:y=150:w=40:h=40:color=white:t=fill';
const circle = (w, h) => `color=black:s=${w}x${h}:d=1,format=rgb24,geq=r='255*lte(hypot(X-${w / 2},Y-${h / 2}),100)':g='255*lte(hypot(X-${w / 2},Y-${h / 2}),100)':b='255*lte(hypot(X-${w / 2},Y-${h / 2}),100)'`;

async function makeProject() {
  const root = await tmpDir('tonecraft-sources-');
  const raw = (...p) => path.join(root, 'raw', ...p);
  for (const d of ['reel', 'works/scope', 'works/scope-off', 'works/dark', 'works/mismatch', 'works/dualmono', 'works/eightch', 'works/vertical', 'works/order/stills']) {
    await fsp.mkdir(raw(...d.split('/')), { recursive: true });
  }
  const x264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-pix_fmt', 'yuv420p'];
  // letterboxed master with audio
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=24:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-vf', BARS, ...x264, '-c:a', 'aac', '-shortest', raw('works', 'scope', 'main.mov')]);
  await fsp.copyFile(raw('works', 'scope', 'main.mov'), raw('works', 'scope-off', 'main.mov'));
  // B/A: pair 1 both letterboxed (flat "LOG" before), pair 2 before without bars; a white marker in the same spot
  const still = (vf, file) => ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=24:d=1', '-frames:v', '1', '-vf', `${vf},format=rgb24`, '-update', '1', file]);
  still(`${BARS},${MARK}`, raw('works', 'scope', 'after-1.png'));
  still(`eq=contrast=0.6:brightness=0.1,${BARS},${MARK}`, raw('works', 'scope', 'before-1.png'));
  still(`${BARS},${MARK}`, raw('works', 'scope', 'after-2.png'));
  still(`eq=contrast=0.6:brightness=0.1,${MARK}`, raw('works', 'scope', 'before-2.png'));
  // dark grainy sky and ground, no bars — must not be cropped
  ff(['-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=24:d=2', '-vf', "geq=lum='if(lt(Y,70)+gt(Y,290),10+22*random(1),60+60*random(1))':cb=128:cr=128,format=yuv420p", ...x264, raw('works', 'dark', 'main.mov')]);
  // B/A with different aspect ratios: 16:9 before, 2.39:1 after, same centered circle
  ff(['-f', 'lavfi', '-i', circle(640, 360), '-frames:v', '1', '-update', '1', raw('works', 'mismatch', 'before-1.png')]);
  ff(['-f', 'lavfi', '-i', circle(640, 268), '-frames:v', '1', '-update', '1', raw('works', 'mismatch', 'after-1.png')]);
  // MXF with one mono PCM track per channel (L = 440 Hz, R = 880 Hz)
  ff([
    '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=1', '-f', 'lavfi', '-i', 'sine=f=440:d=1:r=48000', '-f', 'lavfi', '-i', 'sine=f=880:d=1:r=48000',
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'mpeg2video', '-b:v', '4M', '-c:a', 'pcm_s24le', raw('works', 'dualmono', 'main.mxf'),
  ]);
  // one 8-channel track: 1-2 = stereo mix (440/660 Hz), 3-8 = stems (1500 Hz)
  const tones = [440, 660, 1500, 1500, 1500, 1500, 1500, 1500];
  ff([
    '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=24:d=1',
    ...tones.flatMap((f) => ['-f', 'lavfi', '-i', `sine=f=${f}:d=1:r=48000`]),
    '-filter_complex', `${tones.map((_, i) => `[${i + 1}:a]`).join('')}amerge=inputs=8[a]`, '-map', '0:v', '-map', '[a]',
    ...x264, '-c:a', 'pcm_s24le', raw('works', 'eightch', 'main.mov'),
  ]);
  // vertical 9:16 master
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=24:d=1', ...x264, raw('works', 'vertical', 'main.mp4')]);
  // stills: natural order (2 before 10) and printf-like names
  for (const [name, w] of [['1.png', 400], ['2.png', 500], ['10.png', 600], ['%d.png', 300], ['shot_%03d.png', 700]]) {
    ff(['-f', 'lavfi', '-i', `testsrc2=s=${w}x${Math.round((w * 9) / 16)}:d=1`, '-frames:v', '1', '-update', '1', raw('works', 'order', 'stills', 'tmp.png')]);
    await fsp.rename(raw('works', 'order', 'stills', 'tmp.png'), raw('works', 'order', 'stills', name));
  }
  // showreel: 1 s black, letterboxed / full-frame / letterboxed shots; plus an older reel file next to it
  ff([
    '-f', 'lavfi', '-i', 'color=black:s=640x360:r=24:d=1', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=24:d=1.5',
    '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=24:d=1.5', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=24:d=1.5', '-f', 'lavfi', '-i', 'sine=f=330:d=5.5',
    '-filter_complex', `[0:v]format=yuv420p[a];[1:v]${BARS},format=yuv420p[b];[2:v]hue=h=90,format=yuv420p[c];[3:v]hue=h=200,${BARS},format=yuv420p[d];[a][b][c][d]concat=n=4:v=1:a=0[v]`,
    '-map', '[v]', '-map', '4:a', ...x264, '-c:a', 'aac', '-shortest', raw('reel', 'a-reel.mov'),
  ]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=1', ...x264, raw('reel', 'z-old.mp4')]);

  const works = [
    work('scope', { posterTime: 1, comparisons: [{ caption: '1' }, { caption: '2' }] }),
    work('scope-off', { posterTime: 1, autoCrop: false }),
    work('dark'),
    work('mismatch'),
    work('dualmono'),
    work('eightch'),
    work('vertical'),
    work('order'),
  ];
  await write(path.join(root, 'content', 'site.mjs'), `export default ${JSON.stringify({ ...BASE_SITE, reel: { consent: 'granted' } })};`);
  await write(path.join(root, 'content', 'works.mjs'), `export default ${JSON.stringify(works)};`);
  return root;
}

const run = (root, extra = {}) => runMedia({ root, logger: silentLogger(), preset: 'veryfast', ...extra });

test('media pipeline: letterbox auto-crop, reel intro/poster, audio tracks, vertical masters, B/A fit, still order', { skip, timeout: 300000 }, async (t) => {
  const root = await makeProject();
  const media = (...p) => path.join(root, 'media', ...p);
  const first = await run(root);
  assert.equal(first.ok, true, JSON.stringify(first.stats?.failures));
  const manifest = JSON.parse(await fsp.readFile(media('manifest.json'), 'utf8'));

  await t.test('letterboxed main: poster, WebPs, og and preview lose the bars; main.mp4 keeps its framing', async () => {
    assert.deepEqual([dims(media('works', 'scope', 'main.mp4')).w, dims(media('works', 'scope', 'main.mp4')).h], [640, 360]);
    const poster = gray(media('works', 'scope', 'poster.jpg'));
    assert.equal(poster.w, 640);
    assert.ok(Math.abs(poster.h - 264) <= 4, `poster height ${poster.h}`);
    for (const y of [0, 2, poster.h - 1]) assert.ok(rowMean(poster, y) > 40, `poster row ${y} is black (${rowMean(poster, y)})`);
    const webp = dims(media('works', 'scope', 'poster-1920.webp'));
    assert.deepEqual([webp.w, webp.h], [poster.w, poster.h]);
    const og = gray(media('works', 'scope', 'og.jpg'));
    assert.deepEqual([og.w, og.h], [1200, 630]);
    for (const y of [0, 5, 625, 629]) assert.ok(rowMean(og, y) > 40, `og.jpg row ${y} is black`);
    const preview = gray(media('works', 'scope', 'preview.mp4'));
    assert.equal(preview.w, 640);
    assert.ok(Math.abs(preview.h - poster.h) <= 2, `preview ${preview.w}×${preview.h} vs poster ${poster.w}×${poster.h}`);
    assert.ok(rowMean(preview, 0) > 40);
    // manifest records the applied crop per output group (source pixels) and the uncropped frame
    const w = manifest.works.scope;
    assert.deepEqual(w.poster.frame, { w: 640, h: 360 });
    assert.equal(w.poster.crop.w, 640);
    assert.equal(w.poster.crop.h, poster.h);
    assert.equal(w.poster.crop.y % 2, 0);
    assert.deepEqual(w.og.crop, w.poster.crop);
    assert.deepEqual(w.preview.crop, w.poster.crop);
    assert.equal(w.main.crop, undefined, 'main.mp4 is never cropped');
    assert.ok(dims(media('works', 'scope', 'main.mp4')).level <= 41, 'main.mp4 is signalled level ≤ 4.1');
  });

  await t.test('B/A: one crop from the after side for both halves — pixel-aligned, also against a bar-less before', async () => {
    for (const n of [1, 2]) {
      const before = gray(media('works', 'scope', `ba-${n}-before.webp`));
      const after = gray(media('works', 'scope', `ba-${n}-after.webp`));
      assert.deepEqual([before.w, before.h], [after.w, after.h], `pair ${n} sizes`);
      assert.ok(after.h < 300, `pair ${n} after is cropped (${after.h})`);
      const [bx, by] = bbox(before);
      const [ax, ay] = bbox(after);
      assert.ok(Math.abs(bx - ax) <= 1 && Math.abs(by - ay) <= 1, `pair ${n} marker before (${bx},${by}) vs after (${ax},${ay})`);
      assert.ok(rowMean(before, 0) > 40 && rowMean(after, 0) > 40, `pair ${n} top rows`);
    }
    assert.ok(manifest.works.scope.ba[0].crop, 'pair crop recorded');
    for (const f of ['ba-1-after-1280.webp', 'ba-1-before-960.webp']) await fsp.stat(media('works', 'scope', f));
  });

  await t.test('dark grainy sky/ground is picture, not bars; autoCrop: false keeps the full frame', async () => {
    assert.deepEqual([dims(media('works', 'dark', 'poster.jpg')).w, dims(media('works', 'dark', 'poster.jpg')).h], [640, 360]);
    assert.equal(manifest.works.dark.poster.crop, null);
    assert.deepEqual([dims(media('works', 'scope-off', 'poster.jpg')).w, dims(media('works', 'scope-off', 'poster.jpg')).h], [640, 360]);
    assert.equal(manifest.works['scope-off'].preview.crop, null);
  });

  await t.test('showreel: loop skips the black intro, loses the bars (mixed reel), poster = loop frame 0; reel.mp4 as delivered', async () => {
    assert.deepEqual([dims(media('reel', 'reel.mp4')).w, dims(media('reel', 'reel.mp4')).h], [640, 360]);
    assert.ok(Math.abs(manifest.reel.full.duration - 5.5) < 0.2, 'reel.mp4 = the first file by name, whole');
    const loop = gray(media('reel', 'reel-loop.mp4'));
    assert.ok(loop.h < 300, `loop is cropped (${loop.w}×${loop.h})`);
    assert.ok(rowMean(loop, 0) > 40 && rowMean(loop, loop.h - 1) > 40, 'loop frame 0 is picture, no band');
    assert.ok(manifest.reel.loop.crop && manifest.reel.poster.crop, 'reel crops recorded');
    assert.ok(manifest.reel.loop.duration < 5, `loop starts after the intro (${manifest.reel.loop.duration} s)`);
    // the hero poster is exactly the loop's first frame (no flash when playback starts)
    const a = rgb(media('reel', 'reel-loop.mp4'), 'bt709', 'tv');
    const b = rgb(media('reel', 'poster.jpg'), 'bt601', 'pc');
    assert.equal(a.length, b.length);
    let se = 0;
    for (let i = 0; i < a.length; i++) se += (a[i] - b[i]) ** 2;
    const psnr = 10 * Math.log10((255 * 255) / (se / a.length));
    assert.ok(psnr >= 30, `poster vs loop frame 0: ${psnr.toFixed(1)} dB`);
    assert.ok(first.stats.warnings.some((w) => w.includes('raw/reel/') && w.includes('2개') && w.includes('a-reel.mov')), 'two reel files are reported');
  });

  await t.test('audio: two mono tracks become L/R stereo; an 8-channel track keeps only its stereo mix', async () => {
    const dual = media('works', 'dualmono', 'main.mp4');
    assert.deepEqual(audioStreams(dual), [2]);
    assert.ok(band(dual, 0, 440) > -30 && band(dual, 1, 880) > -30, 'both tracks present');
    assert.ok(band(dual, 0, 880) < -40 && band(dual, 1, 440) < -40, 'L/R kept apart');
    const eight = media('works', 'eightch', 'main.mp4');
    assert.deepEqual(audioStreams(eight), [2]);
    assert.ok(band(eight, 0, 440) > -30 && band(eight, 1, 660) > -30, 'mix channels present');
    assert.ok(band(eight, 0, 1500) < -45 && band(eight, 1, 1500) < -45, 'stems not summed into the mix');
    assert.ok(first.stats.warnings.some((w) => w.includes('eightch') && w.includes('8개')), '8-channel warning');
  });

  await t.test('vertical 9:16 master: long edge capped (preview 540×960), og shows it whole on black', async () => {
    const d = (f) => {
      const x = dims(media('works', 'vertical', f));
      return [x.w, x.h];
    };
    assert.deepEqual(d('preview.mp4'), [540, 960]);
    assert.deepEqual(d('main.mp4'), [1080, 1920]);
    assert.ok(dims(media('works', 'vertical', 'main.mp4')).level <= 41);
    assert.deepEqual(d('poster.jpg'), [1080, 1920]);
    assert.deepEqual(d('poster-1280.webp'), [720, 1280]);
    const og = gray(media('works', 'vertical', 'og.jpg'));
    assert.deepEqual([og.w, og.h], [1200, 630]);
    assert.ok(colMean(og, 5) < 3 && colMean(og, 1194) < 3 && colMean(og, 600) > 40, 'contain on black, not a center slice');
  });

  await t.test('B/A with different aspect ratios: before is center-cropped, never stretched', async () => {
    const before = gray(media('works', 'mismatch', 'ba-1-before.webp'));
    const after = gray(media('works', 'mismatch', 'ba-1-after.webp'));
    assert.deepEqual([before.w, before.h], [after.w, after.h]);
    const [x0, y0, x1, y1] = bbox(before, 128);
    assert.ok(Math.abs(x1 - x0 - (y1 - y0)) <= 3, `circle stays round: ${x1 - x0}×${y1 - y0}`);
    const [ax0, ay0] = bbox(after, 128);
    assert.ok(Math.abs(x0 - ax0) <= 2 && Math.abs(y0 - ay0) <= 2, 'aligned with after');
    assert.ok(first.stats.warnings.some((w) => w.includes('mismatch') && w.includes('가운데')));
  });

  await t.test('stills: Explorer/Finder name order (2 before 10), names with % work', async () => {
    const widths = [];
    for (const nn of ['01', '02', '03', '04', '05']) widths.push(dims(media('works', 'order', 'stills', `${nn}.webp`)).w);
    assert.deepEqual(widths, [300, 400, 500, 600, 700]);
  });

  await t.test('reel options: loopStart / loopDuration / autoCrop override the defaults; raw/reel/poster.* replaces the frame grab', async () => {
    const siteFile = path.join(root, 'content', 'site.mjs');
    await write(siteFile, `export default ${JSON.stringify({ ...BASE_SITE, reel: { consent: 'granted', loopStart: 0, loopDuration: 3, autoCrop: false } })};`);
    let r = await run(root, { reel: true });
    assert.equal(r.ok, true, JSON.stringify(r.stats.failures));
    let m = JSON.parse(await fsp.readFile(media('manifest.json'), 'utf8'));
    assert.ok(Math.abs(m.reel.loop.duration - 3) < 0.15, `loop ${m.reel.loop.duration} s`);
    assert.deepEqual([m.reel.loop.w, m.reel.loop.h, m.reel.loop.crop], [640, 360, null]);
    assert.ok(rowMean(gray(media('reel', 'reel-loop.mp4')), 180) < 5, 'loopStart 0 keeps the black intro, as asked');
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:d=1', '-frames:v', '1', '-update', '1', path.join(root, 'raw', 'reel', 'poster.png')]);
    r = await run(root, { reel: true });
    assert.equal(r.stats.ran, 1, 'only the poster family');
    m = JSON.parse(await fsp.readFile(media('manifest.json'), 'utf8'));
    assert.deepEqual([m.reel.poster.w, m.reel.poster.h], [320, 180]);
    await write(siteFile, `export default ${JSON.stringify({ ...BASE_SITE, reel: { consent: 'granted' } })};`);
    await fsp.rm(path.join(root, 'raw', 'reel', 'poster.png'));
  });

  await t.test('toggling autoCrop re-encodes only the affected groups; a rerun is up to date', async () => {
    await run(root, { reel: true }); // back to the default reel settings
    assert.equal((await run(root)).stats.ran, 0);
    const worksFile = path.join(root, 'content', 'works.mjs');
    await write(worksFile, (await fsp.readFile(worksFile, 'utf8')).replace('"autoCrop":false', '"autoCrop":true'));
    const again = await run(root);
    assert.equal(again.ok, true);
    assert.equal(again.stats.ran, 2, 'scope-off poster family + preview (main.mp4 untouched)');
    assert.ok(dims(media('works', 'scope-off', 'poster.jpg')).h < 300);
  });
});
