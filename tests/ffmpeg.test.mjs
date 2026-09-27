import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaInfo, matrixOf, rangeOf, videoScaleFilter, rgbMasterFilter, jpegFromRgbFilter, webpFromRgbFilter, x264Args } from '../tools/lib/ffmpeg.mjs';
import { defaultPosterTime, scanRawWork } from '../tools/lib/media-pipeline.mjs';
import { tmpDir, write } from './helpers.mjs';
import path from 'node:path';

const probeOf = (v, extra = {}) => ({ streams: [{ codec_type: 'video', width: 1920, height: 1080, pix_fmt: 'yuv420p', avg_frame_rate: '24000/1001', ...v }], format: { duration: '10.5' }, ...extra });

test('mediaInfo: tags, range, HDR, rotation, SAR, interlace', () => {
  let i = mediaInfo(probeOf({ color_space: 'bt709', color_range: 'tv', color_transfer: 'bt709', color_primaries: 'bt709' }));
  assert.equal(i.w, 1920);
  assert.equal(i.duration, 10.5);
  assert.ok(Math.abs(i.fps - 23.976) < 0.001);
  assert.equal(i.range, 'tv');
  assert.equal(i.hdr, false);
  assert.equal(i.isRgb, false);
  i = mediaInfo(probeOf({ pix_fmt: 'yuvj420p' }));
  assert.equal(i.range, 'pc');
  i = mediaInfo(probeOf({ color_transfer: 'smpte2084', color_primaries: 'bt2020', pix_fmt: 'yuv420p10le' }));
  assert.equal(i.hdr, true);
  i = mediaInfo(probeOf({ color_transfer: 'arib-std-b67' }));
  assert.equal(i.hdr, true);
  i = mediaInfo(probeOf({ side_data_list: [{ rotation: -90 }] }));
  assert.deepEqual([i.w, i.h], [1080, 1920]);
  i = mediaInfo(probeOf({ width: 1440, sample_aspect_ratio: '4:3', field_order: 'tt' }));
  assert.deepEqual([i.w, i.h, i.sar, i.interlaced], [1920, 1080, 4 / 3, true]);
  i = mediaInfo(probeOf({ pix_fmt: 'rgb48le' }));
  assert.equal(i.isRgb, true);
  i = mediaInfo(probeOf({ pix_fmt: 'gbrp10le' }));
  assert.equal(i.isRgb, true);
  i = mediaInfo({ streams: [{ codec_type: 'video', width: 10, height: 10 }, { codec_type: 'audio', channels: 6 }], format: {} });
  assert.equal(i.hasAudio, true);
  assert.equal(i.audioChannels, 6);
  assert.equal(mediaInfo({ streams: [{ codec_type: 'audio' }] }), null);
});

test('matrix / range selection never leaves swscale guessing', () => {
  assert.equal(matrixOf({ space: 'bt709' }), 'bt709');
  assert.equal(matrixOf({ space: 'smpte170m' }), 'bt601');
  assert.equal(matrixOf({ space: '' }), 'bt709'); // untagged video: Rec.709 (Resolve default)
  assert.equal(matrixOf({ space: '' }, { still: true }), 'bt601'); // untagged JPEG/WebP: JFIF / VP8
  assert.equal(rangeOf({ range: 'pc' }), 'pc');
  assert.equal(rangeOf({ range: '' }), 'tv');
  assert.equal(rangeOf({ range: '', codec: 'mjpeg' }, { still: true }), 'pc');
});

test('filters: explicit matrices, never upscale, even sizes for H.264', () => {
  const v = videoScaleFilter({ space: 'bt709', range: 'tv' }, 1920);
  assert.match(v, /in_color_matrix=bt709:in_range=tv:out_color_matrix=bt709:out_range=tv,format=yuv420p$/);
  // long edge capped (vertical masters too), aspect kept, even dimensions
  assert.match(v, /w='min\(1920,iw\)':h='min\(1920,ih\)':force_original_aspect_ratio=decrease:force_divisible_by=2/);
  const pc = videoScaleFilter({ space: 'bt709', range: 'pc' }, 960);
  assert.match(pc, /in_range=pc:out_color_matrix=bt709:out_range=tv/);
  const rgb = videoScaleFilter({ isRgb: true }, 1920);
  assert.doesNotMatch(rgb, /in_color_matrix/);
  assert.match(rgb, /out_color_matrix=bt709:out_range=tv/);
  const hdv = videoScaleFilter({ w: 1920, h: 1080, sar: 4 / 3, interlaced: true, space: 'bt709' }, 1280);
  assert.match(hdv, /^bwdif=/);
  assert.match(hdv, /scale=w=1280:h=720:/);
  assert.match(hdv, /setsar=1$/);
  const m = rgbMasterFilter({ space: 'bt709', range: 'tv' }, { maxW: 1920 });
  assert.match(m, /in_color_matrix=bt709:in_range=tv,format=rgb24$/);
  const exact = rgbMasterFilter({ isRgb: true }, { size: { w: 1000, h: 500 } });
  assert.match(exact, /scale=w=1000:h=500:/);
  // exact size with another aspect ratio: cover + center crop, never a stretch
  const cover = rgbMasterFilter({ isRgb: true, storedW: 1920, storedH: 1080, w: 1920, h: 1080 }, { size: { w: 1920, h: 804 } });
  assert.match(cover, /scale=w=1920:h=1080:.*,format=rgb24,crop=1920:804,setsar=1$/);
  // letterbox crop comes first, before any scaling
  const lb = videoScaleFilter({ space: 'bt709', range: 'tv', storedW: 1920, storedH: 1080 }, 960, { crop: { w: 1920, h: 804, x: 0, y: 138 } });
  assert.match(lb, /^crop=1920:804:0:138,scale=/);
  assert.match(jpegFromRgbFilter(1920), /out_color_matrix=bt601:out_range=pc,format=yuvj420p/);
  assert.match(webpFromRgbFilter(960), /format=bgra$/);
  const x = x264Args({ crf: 20, preset: 'slow' }).join(' ');
  assert.match(x, /-profile:v high/);
  assert.match(x, /-color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv/);
  assert.doesNotMatch(x, /-maxrate|-level/);
  const capped = x264Args({ crf: 20, preset: 'slow', level: '4.1', maxrate: '12M', bufsize: '24M' }).join(' ');
  assert.match(capped, /-level:v 4\.1 -maxrate 12M -bufsize 24M/);
  assert.match(jpegFromRgbFilter(1920), /h='min\(1920,ih\)':force_original_aspect_ratio=decrease/);
});

test('default poster time: 30% of duration, max 20 s', () => {
  assert.equal(defaultPosterTime(10), 3);
  assert.equal(defaultPosterTime(300), 20);
  assert.equal(defaultPosterTime(null), 0);
});

test('scanRawWork: naming rules, case-insensitive, pairs and stills', async () => {
  const dir = await tmpDir();
  for (const f of ['Main.MOV', 'poster.JPG', 'before-1.png', 'AFTER-1.tif', 'before-2.mov', 'after-3.mp4', 'notes.txt', 'random.mp4']) await write(path.join(dir, f), 'x');
  await write(path.join(dir, 'stills', 'b.jpg'), 'x');
  await write(path.join(dir, 'stills', 'a.png'), 'x');
  await write(path.join(dir, 'stills', 'readme.txt'), 'x');
  const r = await scanRawWork(dir);
  assert.equal(path.basename(r.main), 'Main.MOV');
  assert.equal(path.basename(r.poster), 'poster.JPG');
  assert.deepEqual(
    r.pairs.map((p) => [p.n, path.basename(p.before), path.basename(p.after)]),
    [[1, 'before-1.png', 'AFTER-1.tif']],
  );
  assert.deepEqual(
    r.stills.map((f) => path.basename(f)),
    ['a.png', 'b.jpg'],
  );
  assert.equal(r.warnings.length, 2); // before-2 and after-3 have no partner
  assert.deepEqual(r.ignored, ['random.mp4']);
});
