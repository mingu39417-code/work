import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { imageSize, imageSizeFromBuffer } from '../tools/lib/imagesize.mjs';
import { fakeJpeg, fakePng, fakeWebp, tmpDir, write, hasFfmpeg, FFMPEG } from './helpers.mjs';

test('PNG / JPEG / WebP(VP8X) headers', () => {
  assert.deepEqual(imageSizeFromBuffer(fakePng(1920, 1080)), { w: 1920, h: 1080, type: 'png' });
  assert.deepEqual(imageSizeFromBuffer(fakeJpeg(1280, 533)), { w: 1280, h: 533, type: 'jpeg' });
  assert.deepEqual(imageSizeFromBuffer(fakeWebp(640, 360)), { w: 640, h: 360, type: 'webp' });
  assert.equal(imageSizeFromBuffer(Buffer.from('not an image at all')), null);
  assert.equal(imageSizeFromBuffer(Buffer.alloc(0)), null);
});

test('JPEG with a large EXIF block before SOF (needs a full read)', async () => {
  const dir = await tmpDir();
  const f = path.join(dir, 'big.jpg');
  await write(f, fakeJpeg(4000, 3000, { app1: 150000 }));
  assert.deepEqual(await imageSize(f), { w: 4000, h: 3000, type: 'jpeg' });
  assert.equal(await imageSize(path.join(dir, 'missing.jpg')), null);
});

test('real files encoded by ffmpeg (lossy VP8, lossless VP8L, progressive JPEG)', { skip: !hasFfmpeg() && 'ffmpeg 없음' }, async () => {
  const dir = await tmpDir();
  const cases = [
    ['lossy.webp', ['-c:v', 'libwebp', '-quality', '80'], 321, 123],
    ['lossless.webp', ['-c:v', 'libwebp', '-lossless', '1'], 333, 111],
    ['prog.jpg', ['-c:v', 'mjpeg', '-q:v', '3'], 500, 281],
    ['img.png', [], 17, 9],
  ];
  for (const [name, args, w, h] of cases) {
    const out = path.join(dir, name);
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360', '-frames:v', '1', '-vf', `scale=${w}:${h},format=rgb24`, ...args, out]);
    assert.equal(r.status, 0, r.stderr?.toString());
    const got = await imageSize(out);
    assert.equal(got.w, w, name);
    assert.equal(got.h, h, name);
  }
});
