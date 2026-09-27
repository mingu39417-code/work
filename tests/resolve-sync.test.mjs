import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { resolveWorkMedia, resolveReel, manifestIndex, hiddenReasons, referencedMediaFiles, loadManifest } from '../tools/lib/media-resolve.mjs';
import { syncMedia, cleanStalePages, addMarker, hasMarker, GENERATED_MARKER } from '../tools/lib/sync.mjs';
import { normalizeSite, normalizeWorks } from '../tools/lib/content.mjs';
import { BASE_SITE, makeProject, addMedia, tmpDir, write, fakeWebp } from './helpers.mjs';

const iss = () => ({ errors: [], warnings: [] });

test('resolveWorkMedia: poster srcset, comparisons, stills, preview; dims from headers', async () => {
  const root = await makeProject({ media: { a: { ba: 2, stills: 2, main: true } } });
  const site = normalizeSite(BASE_SITE, iss());
  const [work] = normalizeWorks(
    [{ slug: 'a', title: '작품 A', category: 'film', comparisons: [{ caption: 'LOG → 최종', beforeLabel: 'LOG', afterLabel: 'GRADED' }] }],
    site,
    iss(),
  );
  const m = await resolveWorkMedia({ mediaDir: path.join(root, 'media'), work });
  assert.deepEqual(m.poster, {
    src: 'media/works/a/poster.jpg',
    w: 1920,
    h: 1080,
    srcset: [
      { src: 'media/works/a/poster-640.webp', w: 640 },
      { src: 'media/works/a/poster-1280.webp', w: 1280 },
      { src: 'media/works/a/poster.jpg', w: 1920 },
    ],
  });
  assert.deepEqual(m.preview, { src: 'media/works/a/preview.mp4', w: null, h: null });
  assert.deepEqual(m.main, { src: 'media/works/a/main.mp4', w: null, h: null, duration: null });
  assert.deepEqual(m.og, { src: 'media/works/a/og.jpg', w: 1200, h: 630 });
  assert.equal(m.embed, null);
  assert.equal(m.comparisons.length, 2);
  assert.equal(m.comparisons[0].caption, 'LOG → 최종');
  assert.equal(m.comparisons[0].beforeLabel, 'LOG');
  assert.equal(m.comparisons[1].afterLabel, 'AFTER');
  assert.deepEqual(m.comparisons[0].after.srcset, [
    { src: 'media/works/a/ba-1-after-960.webp', w: 960 },
    { src: 'media/works/a/ba-1-after.webp', w: 1920 },
  ]);
  assert.equal(m.comparisons[0].video, null);
  assert.equal(m.stills.length, 2);
  assert.equal(m.stills[1].alt, '작품 A 스틸 2');
  assert.equal(m.stills[0].src, 'media/works/a/stills/01.webp');
});

test('resolveWorkMedia: manifest supplies video dims/duration; embed hides main', async () => {
  const root = await makeProject({ media: { a: { main: true, ba: 1, baVideo: true } } });
  const mediaDir = path.join(root, 'media');
  await write(
    path.join(mediaDir, 'manifest.json'),
    JSON.stringify({
      version: 1,
      reel: null,
      works: {
        a: {
          main: { file: 'works/a/main.mp4', w: 1920, h: 804, duration: 61.2, bytes: 1 },
          preview: { file: 'works/a/preview.mp4', w: 960, h: 402, duration: 6, bytes: 1 },
          ba: [{ before: { file: 'works/a/ba-1-before.webp', w: 1920, h: 800 }, after: { file: 'works/a/ba-1-after.webp', w: 1920, h: 800 }, video: { file: 'works/a/ba-1.mp4', w: 2560, h: 1066, duration: 8 } }],
        },
      },
    }),
  );
  const index = manifestIndex(await loadManifest(mediaDir));
  const site = normalizeSite(BASE_SITE, iss());
  let [work] = normalizeWorks([{ slug: 'a', title: 'A', category: 'film' }], site, iss());
  let m = await resolveWorkMedia({ mediaDir, work, index });
  assert.deepEqual(m.main, { src: 'media/works/a/main.mp4', w: 1920, h: 804, duration: 61.2 });
  assert.deepEqual(m.preview, { src: 'media/works/a/preview.mp4', w: 960, h: 402 });
  assert.deepEqual(m.comparisons[0].video, { src: 'media/works/a/ba-1.mp4', w: 2560, h: 1066 });
  [work] = normalizeWorks([{ slug: 'a', title: 'A', category: 'film', video: { type: 'youtube', id: 'dQw4w9WgXcQ' } }], site, iss());
  m = await resolveWorkMedia({ mediaDir, work, index });
  assert.equal(m.main, null);
  assert.equal(m.embed.type, 'youtube');
  assert.ok(!referencedMediaFiles(m).includes('media/works/a/main.mp4'));
  assert.ok(referencedMediaFiles(m).includes('media/works/a/ba-1.mp4'));
});

test('resolveWorkMedia: variant as large as the original is deduped from srcset', async () => {
  const root = await makeProject({ media: {} });
  const d = path.join(root, 'media', 'works', 's');
  await write(path.join(d, 'poster.jpg'), (await import('./helpers.mjs')).fakeJpeg(1000, 562));
  await write(path.join(d, 'poster-1280.webp'), fakeWebp(1000, 562));
  await write(path.join(d, 'poster-640.webp'), fakeWebp(640, 360));
  const site = normalizeSite(BASE_SITE, iss());
  const [work] = normalizeWorks([{ slug: 's', title: 'S', category: 'film' }], site, iss());
  const m = await resolveWorkMedia({ mediaDir: path.join(root, 'media'), work });
  assert.deepEqual(
    m.poster.srcset.map((s) => s.w),
    [640, 1000],
  );
  assert.equal(m.preview, null);
  assert.deepEqual(m.comparisons, []);
  assert.deepEqual(m.stills, []);
});

test('resolveReel: publish false → all null; embed hides full', async () => {
  const root = await makeProject({ reel: true });
  const mediaDir = path.join(root, 'media');
  let site = normalizeSite(BASE_SITE, iss());
  let r = await resolveReel({ mediaDir, site });
  assert.equal(r.full.src, 'media/reel/reel.mp4');
  assert.equal(r.loop.src, 'media/reel/reel-loop.mp4');
  assert.equal(r.poster.src, 'media/reel/poster.jpg');
  assert.equal(r.fps, 24);
  site = normalizeSite({ ...BASE_SITE, reel: { embed: { type: 'vimeo', id: '1' } } }, iss());
  r = await resolveReel({ mediaDir, site });
  assert.equal(r.full, null);
  assert.equal(r.embed.pageUrl, 'https://vimeo.com/1');
  site = normalizeSite({ ...BASE_SITE, reel: { publish: false } }, iss());
  r = await resolveReel({ mediaDir, site });
  assert.deepEqual([r.loop, r.full, r.poster, r.embed], [null, null, null, null]);
});

test('visibility rule: publish === true && consent !== pending && poster', () => {
  const poster = { poster: { src: 'x' } };
  assert.deepEqual(hiddenReasons({ publish: true, consent: 'granted' }, poster), []);
  assert.deepEqual(hiddenReasons({ publish: true, consent: 'not-required' }, poster), []);
  assert.equal(hiddenReasons({ publish: false, consent: 'granted' }, poster).length, 1);
  assert.equal(hiddenReasons({ publish: true, consent: 'pending' }, poster).length, 1);
  assert.equal(hiddenReasons({ publish: true, consent: 'granted' }, { poster: null }).length, 1);
  assert.equal(hiddenReasons({ publish: 'true', consent: 'pending' }, {}).length, 3);
});

test('syncMedia: copies new/changed, skips unchanged, deletes everything else', async () => {
  const root = await tmpDir();
  const media = path.join(root, 'media');
  const out = path.join(root, 'site', 'media');
  await write(path.join(media, 'works/a/poster.jpg'), 'A1');
  await write(path.join(media, 'works/a/main.mp4'), 'M');
  await write(path.join(media, 'works/b/poster.jpg'), 'B');
  await write(path.join(out, 'works/old/poster.jpg'), 'OLD');
  await write(path.join(out, 'stray.txt'), 'x');
  let r = await syncMedia({ mediaDir: media, siteMediaDir: out, files: ['media/works/a/poster.jpg', 'media/works/a/main.mp4', 'media/works/a/missing.webp'] });
  assert.deepEqual(r.copied.sort(), ['works/a/main.mp4', 'works/a/poster.jpg']);
  assert.deepEqual(r.deleted.sort(), ['stray.txt', 'works/old/poster.jpg']);
  assert.deepEqual(r.missing, ['works/a/missing.webp']);
  await assert.rejects(fsp.stat(path.join(out, 'works/old')));
  await assert.rejects(fsp.stat(path.join(out, 'works/b')));
  r = await syncMedia({ mediaDir: media, siteMediaDir: out, files: ['media/works/a/poster.jpg', 'media/works/a/main.mp4'] });
  assert.deepEqual(r.copied, []);
  assert.equal(r.unchanged, 2);
  // content change with a new mtime → copied again
  await new Promise((res) => setTimeout(res, 1100));
  await write(path.join(media, 'works/a/poster.jpg'), 'A2-changed');
  r = await syncMedia({ mediaDir: media, siteMediaDir: out, files: ['media/works/a/poster.jpg'] });
  assert.deepEqual(r.copied, ['works/a/poster.jpg']);
  assert.deepEqual(r.deleted, ['works/a/main.mp4']);
  assert.equal(await fsp.readFile(path.join(out, 'works/a/poster.jpg'), 'utf8'), 'A2-changed');
  // nothing wanted → folder removed entirely
  await syncMedia({ mediaDir: media, siteMediaDir: out, files: [] });
  await assert.rejects(fsp.stat(out));
});

test('cleanStalePages: removes generated pages only', async () => {
  const out = await tmpDir();
  await write(path.join(out, 'works/keep/index.html'), addMarker('<!doctype html><p>keep'));
  await write(path.join(out, 'works/gone/index.html'), addMarker('<!doctype html><p>gone'));
  await write(path.join(out, 'works/gone/extra.txt'), 'x');
  await write(path.join(out, 'works/handmade/index.html'), '<!doctype html><p>mine');
  await fsp.mkdir(path.join(out, 'works/empty'), { recursive: true });
  const r = await cleanStalePages({ outDir: out, keepSlugs: ['keep'] });
  assert.deepEqual(r.removed.sort(), ['empty', 'gone']);
  assert.deepEqual(r.foreign, ['handmade']);
  await fsp.stat(path.join(out, 'works/keep/index.html'));
  await fsp.stat(path.join(out, 'works/handmade/index.html'));
});

test('addMarker places the marker right after the doctype', () => {
  const html = addMarker('<!doctype html>\n<html lang="ko"></html>');
  assert.ok(html.startsWith(`<!doctype html>\n${GENERATED_MARKER}\n<html`));
  assert.ok(hasMarker(html));
  assert.ok(addMarker('<html></html>').startsWith(`<!doctype html>\n${GENERATED_MARKER}`));
});

test('addMedia fixture sanity', async () => {
  const root = await tmpDir();
  await addMedia(root, 'x', { ba: 1 });
  await fsp.stat(path.join(root, 'media/works/x/ba-1-before-960.webp'));
});
