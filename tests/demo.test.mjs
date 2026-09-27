// Demo generator: LUT math, category mapping, and a render smoke test of every scene (catches filtergraph typos).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { LOOKS, cubeText, SCENES, SceneRenderer, mapCategories, DEMO_WORKS, demoRootProblem, demoSiteModule, generateDemoProject } from '../tools/lib/demo.mjs';
import { imageSize } from '../tools/lib/imagesize.mjs';
import { loadContent } from '../tools/lib/content.mjs';
import { tmpDir, hasFfmpeg, FFMPEG, write, REPO } from './helpers.mjs';

test('LOG look is flat: lifted blacks, rolled-off whites, less saturation', () => {
  const [bk] = LOOKS.log(0, 0, 0);
  const [wh] = LOOKS.log(1, 1, 1);
  assert.ok(bk > 0.05 && wh < 0.95, `black ${bk}, white ${wh}`);
  const red = LOOKS.log(0.8, 0.1, 0.1);
  assert.ok(red[0] - red[1] < 0.7 * (0.8 - 0.1), 'desaturated');
  for (const [name, fn] of Object.entries(LOOKS)) {
    for (const v of fn(0.5, 0.4, 0.3)) assert.ok(Number.isFinite(v), name);
  }
});

test('cube files have the declared size', () => {
  const text = cubeText(LOOKS.tealOrange, 5);
  const rows = text.trim().split('\n').filter((l) => /^[\d.]+ [\d.]+ [\d.]+$/.test(l));
  assert.match(text, /LUT_3D_SIZE 5/);
  assert.equal(rows.length, 125);
});

test('demo works: ≥ 6 published over ≥ 3 categories, one draft, one pending consent, DEMO titles', () => {
  const works = mapCategories(DEMO_WORKS.map((d) => ({ publish: true, consent: 'granted', ...d.work })), [
    { id: 'commercial' },
    { id: 'music-video' },
    { id: 'film' },
  ]);
  const published = works.filter((w) => w.publish && w.consent !== 'pending');
  assert.ok(published.length >= 6);
  assert.ok(new Set(published.map((w) => w.category)).size >= 3);
  assert.ok(works.every((w) => ['commercial', 'music-video', 'film'].includes(w.category)));
  assert.equal(works.filter((w) => !w.publish).length, 1);
  assert.equal(works.filter((w) => w.consent === 'pending').length, 1);
  assert.ok(works.every((w) => w.title.includes('DEMO')));
  assert.ok(DEMO_WORKS.some((d) => d.raw.baVideo && d.work.baVideo));
});

test('every scene renders (before + after frame)', { skip: !hasFfmpeg() && 'ffmpeg 없음', timeout: 120000 }, async () => {
  const dir = await tmpDir();
  const renderer = new SceneRenderer({ ffmpeg: FFMPEG, tmp: dir });
  await Promise.all(
    Object.keys(SCENES).map((key) =>
      renderer.render(key, {
        frames: [
          { t: 2, look: 'after', file: path.join(dir, `${key}-after.png`) },
          { t: 2, look: 'before', file: path.join(dir, `${key}-before.jpg`) },
        ],
      }),
    ),
  );
  for (const key of Object.keys(SCENES)) {
    for (const f of [`${key}-after.png`, `${key}-before.jpg`]) {
      const size = await imageSize(path.join(dir, f));
      assert.deepEqual([size.w, size.h], [1280, 720], f);
    }
  }
  await fsp.rm(dir, { recursive: true, force: true });
});

test('demo never overwrites a real project (repo root, real works.mjs, foreign raw files)', async () => {
  // CLI: the repository itself is refused before anything is written
  const p = spawnSync(process.execPath, [path.join(REPO, 'tools', 'demo.mjs'), '--root', REPO], { encoding: 'utf8' });
  assert.equal(p.status, 2);
  assert.match(p.stderr, /\.demo 같은 별도 폴더/);

  const empty = await tmpDir();
  assert.equal(await demoRootProblem(empty), '');
  const real = await tmpDir();
  await write(path.join(real, 'content', 'works.mjs'), "export default [{ slug: 'my-real-work' }];");
  assert.match(await demoRootProblem(real), /works\.mjs/);
  await assert.rejects(generateDemoProject({ root: real, repoRoot: REPO, ffmpeg: FFMPEG }), /별도 폴더/);
  assert.match(await fsp.readFile(path.join(real, 'content', 'works.mjs'), 'utf8'), /my-real-work/, 'untouched');

  const reel = await tmpDir();
  await write(path.join(reel, 'raw', 'reel', 'MY-MASTER-REEL-2026.mov'), 'master');
  assert.match(await demoRootProblem(reel), /MY-MASTER-REEL-2026\.mov/);
  const work = await tmpDir();
  await write(path.join(work, 'raw', 'works', DEMO_WORKS[0].work.slug, 'main.mp4'), 'x');
  await write(path.join(work, 'raw', 'works', DEMO_WORKS[0].work.slug, '.DS_Store'), 'x');
  assert.equal(await demoRootProblem(work), '', 'files the demo writes itself (and OS junk) are fine');
  await write(path.join(work, 'raw', 'works', DEMO_WORKS[0].work.slug, 'my-grade.mov'), 'x');
  assert.match(await demoRootProblem(work), /데모가 만들지 않은/);
});

test('demo site.mjs = the repository settings with a publishable (synthetic) demo reel', async () => {
  const root = await tmpDir();
  const text = await fsp.readFile(path.join(REPO, 'content', 'site.mjs'), 'utf8');
  await write(path.join(root, 'content', 'site.mjs'), demoSiteModule(text));
  const repo = await loadContent(REPO);
  const demo = await loadContent(root);
  assert.deepEqual(demo.errors, []);
  assert.equal(demo.site.reel.consent, 'not-required');
  assert.equal(demo.site.brand.name, repo.site.brand.name);
  assert.deepEqual(demo.site.categories, repo.site.categories);
  assert.match(demoSiteModule('not a module'), /consent: 'not-required'/);
});
