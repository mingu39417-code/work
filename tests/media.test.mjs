// Media pipeline: color correctness (SMPTE HD bars round-trip), BT.709 tagging, incremental runs, --force.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { runMedia } from '../tools/lib/media-pipeline.mjs';
import { BASE_SITE, tmpDir, write, hasFfmpeg, silentLogger, work, REPO } from './helpers.mjs';

const skip = !hasFfmpeg() && 'ffmpeg/ffprobe 없음';

// ---------------------------------------------------------------------------------------------
// helpers

function ff(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${r.stderr}`);
}

function probeStream(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', file], { encoding: 'utf8' });
  return JSON.parse(r.stdout).streams[0];
}

/** Decode one frame to rgb24 with an explicit input matrix/range (how a standards-following decoder shows it). */
function decodeRgb(file, { matrix, range, seek = 0 }) {
  return new Promise((resolve, reject) => {
    const vf = `scale=in_color_matrix=${matrix}:in_range=${range}:flags=accurate_rnd+full_chroma_int,format=rgb24`;
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', ...(seek ? ['-ss', String(seek)] : []), '-i', file, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-'];
    const child = spawn('ffmpeg', args);
    const chunks = [];
    let err = '';
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err));
      const s = probeStream(file);
      resolve({ buf: Buffer.concat(chunks), w: s.width, h: s.height });
    });
  });
}

// SMPTE RP 219 (smptehdbars) patches: relative positions and ideal 8-bit full-range RGB values.
const X7 = (i) => (240 + (1440 / 7) * (i + 0.5)) / 1920;
const PATCHES = [
  { name: '75% white', x: X7(0), y: 0.185, rgb: [191, 191, 191] },
  { name: '75% yellow', x: X7(1), y: 0.185, rgb: [191, 191, 0] },
  { name: '75% cyan', x: X7(2), y: 0.185, rgb: [0, 191, 191] },
  { name: '75% green', x: X7(3), y: 0.185, rgb: [0, 191, 0] },
  { name: '75% magenta', x: X7(4), y: 0.185, rgb: [191, 0, 191] },
  { name: '75% red', x: X7(5), y: 0.185, rgb: [191, 0, 0] },
  { name: '75% blue', x: X7(6), y: 0.185, rgb: [0, 0, 191] },
  { name: '100% cyan', x: 120 / 1920, y: 0.648, rgb: [0, 255, 255] },
  { name: '100% blue', x: 1800 / 1920, y: 0.648, rgb: [0, 0, 255] },
  { name: '100% white', x: 600 / 1920, y: 0.833, rgb: [255, 255, 255] },
  { name: '0% black', x: 360 / 1920, y: 0.833, rgb: [0, 0, 0] },
];

function sample(img, px, py, crop = null) {
  // crop: { sx, sy, sw, sh } maps relative source coordinates into a cropped output (og.jpg)
  let x = px;
  let y = py;
  if (crop) {
    x = (px - crop.sx) / crop.sw;
    y = (py - crop.sy) / crop.sh;
  }
  const cx = Math.round(x * img.w);
  const cy = Math.round(y * img.h);
  const r = Math.max(1, Math.round(img.w / 240));
  const sum = [0, 0, 0];
  let n = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const i = ((cy + dy) * img.w + (cx + dx)) * 3;
      sum[0] += img.buf[i];
      sum[1] += img.buf[i + 1];
      sum[2] += img.buf[i + 2];
      n++;
    }
  }
  return sum.map((v) => v / n);
}

function maxDiff(a, b) {
  return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
}

function assertBars(img, tolerance, label, crop = null) {
  for (const p of PATCHES) {
    if (crop && (p.y < crop.sy + 0.02 || p.y > crop.sy + crop.sh - 0.02)) continue;
    const got = sample(img, p.x, p.y, crop);
    const d = maxDiff(got, p.rgb);
    assert.ok(d <= tolerance, `${label}: ${p.name} = [${got.map((v) => v.toFixed(1))}] vs [${p.rgb}] (Δ${d.toFixed(1)} > ${tolerance})`);
  }
}

function assertBt709(file, label) {
  const s = probeStream(file);
  assert.equal(s.codec_name, 'h264', label);
  assert.equal(s.profile, 'High', label);
  assert.equal(s.pix_fmt, 'yuv420p', label);
  assert.equal(s.color_primaries, 'bt709', `${label} primaries`);
  assert.equal(s.color_transfer, 'bt709', `${label} trc`);
  assert.equal(s.color_space, 'bt709', `${label} matrix`);
  assert.equal(s.color_range, 'tv', `${label} range`);
}

const JPEG = { matrix: 'bt601', range: 'pc' }; // JFIF
const WEBP = { matrix: 'bt601', range: 'tv' }; // VP8
const H264 = { matrix: 'bt709', range: 'tv' }; // as tagged

// ---------------------------------------------------------------------------------------------
// fixture: raw inputs made from SMPTE HD bars

async function makeBarsProject() {
  const root = await tmpDir('tonecraft-media-');
  const raw = (...p) => path.join(root, 'raw', ...p);
  for (const d of ['works/bars-img/stills', 'works/bars-vid', 'works/bars-pc', 'works/bars-rgb', 'works/bars-hdv', 'reel']) await fsp.mkdir(raw(...d.split('/')), { recursive: true });
  const barsPng = raw('works', 'bars-img', 'after-1.png');
  // exact RGB bars: explicit BT.709 limited-range decode of the lavfi source
  ff(['-f', 'lavfi', '-i', 'smptehdbars=s=1920x1080', '-frames:v', '1', '-vf', 'scale=in_color_matrix=bt709:in_range=tv:flags=accurate_rnd+full_chroma_int,format=rgb24', '-update', '1', barsPng]);
  await fsp.copyFile(barsPng, raw('works', 'bars-img', 'before-1.png'));
  await fsp.copyFile(barsPng, raw('works', 'bars-img', 'stills', '01.png'));
  const tag709 = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];
  // limited-range BT.709 video (the normal Resolve export)
  ff(['-f', 'lavfi', '-i', 'smptehdbars=s=1920x1080:r=24:d=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv420p', ...tag709, '-color_range', 'tv', raw('works', 'bars-vid', 'main.mov')]);
  await fsp.copyFile(raw('works', 'bars-vid', 'main.mov'), raw('works', 'bars-vid', 'before-1.mov'));
  await fsp.copyFile(raw('works', 'bars-vid', 'main.mov'), raw('works', 'bars-vid', 'after-1.mov'));
  // full-range ("data levels") BT.709 video
  ff([
    '-f', 'lavfi', '-i', 'smptehdbars=s=1920x1080:r=24:d=2',
    '-vf', 'scale=in_color_matrix=bt709:in_range=tv:out_color_matrix=bt709:out_range=pc:flags=accurate_rnd,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', ...tag709, '-color_range', 'pc', raw('works', 'bars-pc', 'main.mp4'),
  ]);
  // RGB-coded video (PNG in MOV)
  ff(['-loop', '1', '-t', '1', '-framerate', '24', '-i', barsPng, '-c:v', 'png', '-pix_fmt', 'rgb24', raw('works', 'bars-rgb', 'main.mov')]);
  // 1080i HDV-style master: 1440×1080 stored, 4:3 pixels (16:9 display), interlaced top field first
  ff([
    '-f', 'lavfi', '-i', 'smptehdbars=s=1440x1080:r=25:d=2', '-vf', 'setsar=4/3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-flags', '+ilme+ildct', '-top', '1', '-pix_fmt', 'yuv420p', ...tag709, '-color_range', 'tv',
    raw('works', 'bars-hdv', 'main.mov'),
  ]);
  // reel
  ff(['-f', 'lavfi', '-i', 'smptehdbars=s=1280x720:r=24:d=3', '-f', 'lavfi', '-i', 'sine=d=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-pix_fmt', 'yuv420p', ...tag709, '-c:a', 'aac', '-shortest', raw('reel', 'reel.mov')]);

  const works = [
    work('bars-img', { comparisons: [{ caption: 'bars' }] }),
    work('bars-vid', { baVideo: true, posterTime: 1, baTimes: [1] }),
    work('bars-pc', { posterTime: 1 }),
    work('bars-rgb', { posterTime: 0.5 }),
    work('bars-hdv', { posterTime: 1 }),
  ];
  await write(path.join(root, 'content', 'site.mjs'), `export default ${JSON.stringify(BASE_SITE)};`);
  await write(path.join(root, 'content', 'works.mjs'), `export default ${JSON.stringify(works)};`);
  return root;
}

// 'veryfast' keeps tests quick while still producing High-profile streams ('ultrafast' falls back to Baseline).
const run = (root, extra = {}) => runMedia({ root, logger: silentLogger(), preset: 'veryfast', ...extra });

// ---------------------------------------------------------------------------------------------

test('media pipeline: color-exact outputs, BT.709 tags, incremental, --force', { skip, timeout: 240000 }, async (t) => {
  const root = await makeBarsProject();
  const media = (...p) => path.join(root, 'media', ...p);

  const first = await run(root);
  assert.equal(first.ok, true, JSON.stringify(first.stats?.failures));
  const total = first.stats.ran;
  assert.ok(total >= 12, `jobs ran: ${total}`);

  await t.test('source bars are what we think they are', async () => {
    const src = await decodeRgb(path.join(root, 'raw', 'works', 'bars-img', 'after-1.png'), { matrix: 'bt709', range: 'pc' });
    assertBars(src, 2, 'source PNG');
  });

  await t.test('RGB image → B/A WebP, poster JPEG/WebP, og crop, stills', async () => {
    assertBars(await decodeRgb(media('works', 'bars-img', 'ba-1-after.webp'), WEBP), 6, 'ba-1-after.webp');
    assertBars(await decodeRgb(media('works', 'bars-img', 'ba-1-before.webp'), WEBP), 6, 'ba-1-before.webp');
    assertBars(await decodeRgb(media('works', 'bars-img', 'ba-1-after-960.webp'), WEBP), 6, 'ba-1-after-960.webp');
    assertBars(await decodeRgb(media('works', 'bars-img', 'poster.jpg'), JPEG), 6, 'poster.jpg');
    assertBars(await decodeRgb(media('works', 'bars-img', 'poster-1280.webp'), WEBP), 6, 'poster-1280.webp');
    assertBars(await decodeRgb(media('works', 'bars-img', 'poster-640.webp'), WEBP), 8, 'poster-640.webp');
    assertBars(await decodeRgb(media('works', 'bars-img', 'stills', '01.webp'), WEBP), 6, 'stills/01.webp');
    const og = await decodeRgb(media('works', 'bars-img', 'og.jpg'), JPEG);
    assert.deepEqual([og.w, og.h], [1200, 630]);
    // 1920×1080 → cover 1200×675 → center crop 630 rows
    assertBars(og, 6, 'og.jpg', { sx: 0, sy: 22.5 / 675, sw: 1, sh: 630 / 675 });
    const webp = await decodeRgb(media('works', 'bars-img', 'ba-1-after.webp'), WEBP);
    assert.deepEqual([webp.w, webp.h], [1920, 1080]);
  });

  await t.test('video → H.264 BT.709 (limited) → frame, poster from video', async () => {
    const main = media('works', 'bars-vid', 'main.mp4');
    assertBt709(main, 'main.mp4');
    assertBars(await decodeRgb(main, { ...H264, seek: 1 }), 4, 'main.mp4');
    assertBt709(media('works', 'bars-vid', 'preview.mp4'), 'preview.mp4');
    assertBars(await decodeRgb(media('works', 'bars-vid', 'preview.mp4'), H264), 5, 'preview.mp4');
    assertBars(await decodeRgb(media('works', 'bars-vid', 'poster.jpg'), JPEG), 6, 'poster.jpg (from video)');
    assertBars(await decodeRgb(media('works', 'bars-vid', 'ba-1-after.webp'), WEBP), 6, 'ba-1-after.webp (from video)');
    // negative control: the same file decoded with the wrong (BT.601) matrix must fail the check,
    // proving the assertion is sensitive to matrix mistakes.
    const wrong = await decodeRgb(main, { matrix: 'bt601', range: 'tv', seek: 1 });
    assert.throws(() => assertBars(wrong, 4, 'wrong matrix'));
    const wrongRange = await decodeRgb(main, { matrix: 'bt709', range: 'pc', seek: 1 });
    assert.throws(() => assertBars(wrongRange, 4, 'wrong range'));
  });

  await t.test('stacked B/A comparison video: [before | after], same size halves, BT.709', async () => {
    const f = media('works', 'bars-vid', 'ba-1.mp4');
    assertBt709(f, 'ba-1.mp4');
    const img = await decodeRgb(f, H264);
    assert.equal(img.w, 2560);
    assert.equal(img.h, 720);
    // sample each half by remapping x
    for (const side of [0, 1]) {
      for (const p of PATCHES.slice(0, 7)) {
        const got = sample(img, (p.x + side) / 2, p.y);
        assert.ok(maxDiff(got, p.rgb) <= 5, `ba-1.mp4 ${side ? 'after' : 'before'} ${p.name}: ${got}`);
      }
    }
  });

  await t.test('full-range (pc) source is converted to limited range without level shifts', async () => {
    const f = media('works', 'bars-pc', 'main.mp4');
    assertBt709(f, 'bars-pc main.mp4');
    assertBars(await decodeRgb(f, { ...H264, seek: 1 }), 4, 'bars-pc main.mp4');
    assertBars(await decodeRgb(media('works', 'bars-pc', 'poster.jpg'), JPEG), 6, 'bars-pc poster.jpg');
  });

  await t.test('RGB-coded video source (PNG in MOV)', async () => {
    const f = media('works', 'bars-rgb', 'main.mp4');
    assertBt709(f, 'bars-rgb main.mp4');
    assertBars(await decodeRgb(f, H264), 4, 'bars-rgb main.mp4');
  });

  await t.test('non-square pixels + interlaced source → square-pixel progressive 1920×1080', async () => {
    const f = media('works', 'bars-hdv', 'main.mp4');
    assertBt709(f, 'bars-hdv main.mp4');
    const s = probeStream(f);
    assert.deepEqual([s.width, s.height], [1920, 1080]);
    assert.ok(!s.sample_aspect_ratio || s.sample_aspect_ratio === '1:1', `sar ${s.sample_aspect_ratio}`);
    assert.ok(!['tt', 'bb', 'tb', 'bt'].includes(s.field_order), `field_order ${s.field_order}`);
    assertBars(await decodeRgb(f, { ...H264, seek: 1 }), 5, 'bars-hdv main.mp4');
    const poster = await decodeRgb(media('works', 'bars-hdv', 'poster.jpg'), JPEG);
    assert.deepEqual([poster.w, poster.h], [1920, 1080]);
    assertBars(poster, 6, 'bars-hdv poster.jpg');
  });

  await t.test('reel outputs + manifest', async () => {
    assertBt709(media('reel', 'reel.mp4'), 'reel.mp4');
    assertBt709(media('reel', 'reel-loop.mp4'), 'reel-loop.mp4');
    const reel = probeStream(media('reel', 'reel-loop.mp4'));
    assert.equal(reel.width, 1280);
    const audio = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', media('reel', 'reel-loop.mp4')], { encoding: 'utf8' });
    assert.equal(audio.stdout.trim(), '', 'loop must be muted');
    const full = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', media('reel', 'reel.mp4')], { encoding: 'utf8' });
    assert.equal(full.stdout.trim(), 'aac');
    const m = JSON.parse(await fsp.readFile(media('manifest.json'), 'utf8'));
    assert.equal(m.version, 1);
    assert.equal(m.reel.full.file, 'reel/reel.mp4');
    assert.equal(m.reel.full.w, 1280);
    assert.ok(Math.abs(m.reel.full.duration - 3) < 0.2);
    assert.equal(m.works['bars-vid'].main.w, 1920);
    assert.ok(m.works['bars-vid'].main.duration > 2.5);
    assert.deepEqual(
      [m.works['bars-img'].ba[0].after.w, m.works['bars-img'].ba[0].after.h],
      [1920, 1080],
    );
    assert.equal(m.works['bars-vid'].ba[0].video.file, 'works/bars-vid/ba-1.mp4');
    assert.equal(m.works['bars-img'].stills[0].file, 'works/bars-img/stills/01.webp');
    assert.equal(m.works['bars-img'].main, null);
  });

  await t.test('second run skips everything; touching one input reruns only its jobs', async () => {
    const again = await run(root);
    assert.equal(again.ok, true);
    assert.equal(again.stats.ran, 0);
    assert.equal(again.stats.skipped, total);
    const still = path.join(root, 'raw', 'works', 'bars-img', 'stills', '01.png');
    const future = new Date(Date.now() + 5000);
    await fsp.utimes(still, future, future);
    const touched = await run(root);
    assert.equal(touched.stats.ran, 1);
    // an input dated in the future must not make the job rerun forever
    assert.equal((await run(root)).stats.ran, 0);
    // option change (posterTime) reruns only that work's poster job
    const worksFile = path.join(root, 'content', 'works.mjs');
    await write(worksFile, (await fsp.readFile(worksFile, 'utf8')).replace('"posterTime":1,', '"posterTime":1.5,'));
    const opt = await run(root);
    assert.ok(opt.stats.ran >= 1 && opt.stats.ran <= 3, `ran ${opt.stats.ran}`);
  });

  await t.test('--dry-run writes nothing; --force rebuilds everything', async () => {
    const before = (await fsp.stat(media('manifest.json'))).mtimeMs;
    await fsp.rm(media('works', 'bars-img', 'og.jpg'));
    const dry = await run(root, { dryRun: true });
    assert.equal(dry.stats.planned, 1);
    await assert.rejects(fsp.stat(media('works', 'bars-img', 'og.jpg')));
    assert.equal((await fsp.stat(media('manifest.json'))).mtimeMs, before);
    const forced = await run(root, { force: true, slugs: ['bars-img'] });
    assert.equal(forced.ok, true);
    assert.equal(forced.stats.ran, 3); // bars-img only: poster family, ba-1, still 01
  });

  await t.test('stale outputs are pruned when raw inputs disappear', async () => {
    await fsp.rm(path.join(root, 'raw', 'works', 'bars-img', 'stills'), { recursive: true });
    await fsp.rm(path.join(root, 'raw', 'works', 'bars-vid', 'before-1.mov'));
    const r = await run(root);
    assert.equal(r.ok, true);
    await assert.rejects(fsp.stat(media('works', 'bars-img', 'stills', '01.webp')));
    await assert.rejects(fsp.stat(media('works', 'bars-vid', 'ba-1-after.webp')));
    await assert.rejects(fsp.stat(media('works', 'bars-vid', 'ba-1.mp4')));
    await fsp.stat(media('works', 'bars-vid', 'main.mp4'));
    const m = JSON.parse(await fsp.readFile(media('manifest.json'), 'utf8'));
    assert.deepEqual(m.works['bars-img'].stills, []);
    assert.deepEqual(m.works['bars-vid'].ba, []);
    assert.ok(r.stats.warnings.some((w) => w.includes('after-1')), 'unpaired after-1 is reported');
  });
});

test('missing ffmpeg → Korean install help and exit code 1', async () => {
  const root = await tmpDir();
  const env = { FFMPEG_PATH: path.join(root, 'nope-ffmpeg'), FFPROBE_PATH: path.join(root, 'nope-ffprobe') };
  const { findFfmpeg } = await import('../tools/lib/ffmpeg.mjs');
  assert.equal(await findFfmpeg(env), null);
  const child = spawnSync(process.execPath, [path.join(REPO, 'tools', 'media.mjs'), '--root', root], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /winget install Gyan\.FFmpeg/);
  assert.match(child.stderr, /brew install ffmpeg/);
});
