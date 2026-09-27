// End-to-end build tests (need src/templates/index.mjs — skipped until the templates exist).
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { buildSite } from '../tools/lib/build-site.mjs';
import { GENERATED_MARKER } from '../tools/lib/sync.mjs';
import { BASE_SITE, makeProject, work, write, readTree, silentLogger, hasTemplates, REPO, fakeJpeg } from './helpers.mjs';

const skip = !hasTemplates() && 'src/templates/index.mjs 없음 (템플릿 작성 전)';
const NOW = new Date('2026-09-27T12:00:00Z');
const build = (root, extra = {}) => buildSite({ root, logger: silentLogger(), now: NOW, ...extra });

const SECRET = { slug: 'secret-draft-x7', title: '비밀프로젝트-XYZ' };
const PENDING = { slug: 'pending-consent-q9', title: '동의대기-QQQ' };

function consentFixture({ siteUrl = 'https://tonecraft.example' } = {}) {
  return makeProject({
    site: { ...BASE_SITE, siteUrl },
    works: [
      work('public-one', { title: '공개작품', featured: true, comparisons: [{ caption: '공개 비교' }] }),
      work(SECRET.slug, { title: SECRET.title, publish: false, client: '비밀클라이언트' }),
      work(PENDING.slug, { title: PENDING.title, consent: 'pending', category: 'film' }),
      work('no-media-yet', { title: '미디어없음', category: 'music-video' }),
    ],
    media: {
      'public-one': { ba: 1, stills: 1, main: true },
      [SECRET.slug]: { ba: 1, stills: 1, main: true },
      [PENDING.slug]: { ba: 1, main: true },
    },
    reel: true,
  });
}

/** Assert that none of the needles appear in any file (bytes, UTF-8) or path under dir. */
async function assertNoTrace(dir, needles) {
  const files = await readTree(dir);
  assert.ok(files.length > 0, 'output must not be empty');
  for (const f of files) {
    for (const n of needles) {
      assert.ok(!f.rel.includes(n), `path ${f.rel} contains "${n}"`);
      assert.ok(!f.buf.includes(Buffer.from(n, 'utf8')), `${f.rel} contains "${n}"`);
    }
  }
}

test('consent safety: hidden works leave no trace anywhere under site/', { skip }, async () => {
  const root = await consentFixture();
  const r = await build(root);
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.deepEqual(r.published, ['public-one']);
  assert.deepEqual(
    r.hidden.map((h) => h.slug).sort(),
    ['no-media-yet', PENDING.slug, SECRET.slug].sort(),
  );
  const site = path.join(root, 'site');
  await assertNoTrace(site, [SECRET.slug, SECRET.title, '비밀클라이언트', PENDING.slug, PENDING.title, 'no-media-yet', '미디어없음']);
  assert.deepEqual(await fsp.readdir(path.join(site, 'works')), ['public-one']);
  assert.deepEqual(await fsp.readdir(path.join(site, 'media', 'works')), ['public-one']);
  const sitemap = await fsp.readFile(path.join(site, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /works\/public-one\//);
  const home = await fsp.readFile(path.join(site, 'index.html'), 'utf8');
  assert.match(home, /공개작품/);
  assert.match(home, /works\/public-one\//);
});

test('stale pages and media are removed when a work is unpublished', { skip }, async () => {
  const root = await consentFixture();
  const site = path.join(root, 'site');
  // publish the secret work first
  const worksFile = path.join(root, 'content', 'works.mjs');
  const original = await fsp.readFile(worksFile, 'utf8');
  await write(worksFile, original.replace('"publish": false', '"publish": true'));
  let r = await build(root);
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.ok(r.published.includes(SECRET.slug));
  await fsp.stat(path.join(site, 'works', SECRET.slug, 'index.html'));
  await fsp.stat(path.join(site, 'media', 'works', SECRET.slug, 'poster.jpg'));
  assert.match(await fsp.readFile(path.join(site, 'index.html'), 'utf8'), new RegExp(SECRET.title));
  // a hand-made folder and a stray media file
  await write(path.join(site, 'works', 'handmade', 'index.html'), '<!doctype html><p>mine</p>');
  await write(path.join(site, 'media', 'old-stuff', 'x.mp4'), 'x');

  // unpublish again → page + media gone, nothing references it
  await write(worksFile, original);
  r = await build(root);
  assert.equal(r.ok, true);
  assert.deepEqual(r.removedPages, [SECRET.slug]);
  await assert.rejects(fsp.stat(path.join(site, 'works', SECRET.slug)));
  await assert.rejects(fsp.stat(path.join(site, 'media', 'works', SECRET.slug)));
  await assert.rejects(fsp.stat(path.join(site, 'media', 'old-stuff')));
  await fsp.stat(path.join(site, 'works', 'handmade', 'index.html')); // not ours → kept, but warned
  assert.ok(r.warnings.some((w) => w.includes('handmade')));
  await fsp.rm(path.join(site, 'works', 'handmade'), { recursive: true });
  await assertNoTrace(site, [SECRET.slug, SECRET.title]);

  // siteUrl removed → stale sitemap deleted, robots without Sitemap line
  const siteFile = path.join(root, 'content', 'site.mjs');
  await write(siteFile, (await fsp.readFile(siteFile, 'utf8')).replace('"siteUrl": "https://tonecraft.example"', '"siteUrl": ""'));
  r = await build(root);
  assert.equal(r.ok, true);
  await assert.rejects(fsp.stat(path.join(site, 'sitemap.xml')));
  assert.equal(await fsp.readFile(path.join(site, 'robots.txt'), 'utf8'), 'User-agent: *\nAllow: /\n');
});

test('preview build includes drafts, is noindex, and never writes to site/', { skip }, async () => {
  const root = await consentFixture();
  await build(root);
  const site = path.join(root, 'site');
  const snapshot = async () =>
    Promise.all((await readTree(site)).map(async (f) => `${f.rel}:${(await fsp.stat(path.join(site, f.rel))).mtimeMs}:${f.buf.length}`));
  const before = await snapshot();
  const r = await build(root, { preview: true });
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.deepEqual(await snapshot(), before, 'site/ must be untouched by --preview');
  const pv = path.join(root, '.preview');
  const works = (await fsp.readdir(path.join(pv, 'works'))).sort();
  assert.deepEqual(works, ['no-media-yet', 'pending-consent-q9', 'public-one', 'secret-draft-x7']);
  const home = await fsp.readFile(path.join(pv, 'index.html'), 'utf8');
  assert.match(home, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(home, /PREVIEW/);
  assert.match(home, new RegExp(SECRET.title));
  for (const f of ['sitemap.xml', 'robots.txt', 'media']) await assert.rejects(fsp.stat(path.join(pv, f)), f);
  const page = await fsp.readFile(path.join(pv, 'works', SECRET.slug, 'index.html'), 'utf8');
  assert.match(page, /noindex,nofollow/);
});

test('generated HTML: marker, relative URLs (subfolder-safe), cache-busting, JSON-LD', { skip }, async () => {
  const root = await consentFixture();
  const r = await build(root);
  assert.equal(r.ok, true);
  const site = path.join(root, 'site');
  const home = await fsp.readFile(path.join(site, 'index.html'), 'utf8');
  const page = await fsp.readFile(path.join(site, 'works', 'public-one', 'index.html'), 'utf8');
  const nf = await fsp.readFile(path.join(site, '404.html'), 'utf8');
  for (const html of [home, page, nf]) {
    assert.ok(html.startsWith(`<!doctype html>\n${GENERATED_MARKER}\n`), 'marker right after doctype');
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
  }
  // subfolder deploys: no root-absolute URLs on home/work pages
  for (const html of [home, page]) {
    assert.doesNotMatch(html, /\s(?:href|src|srcset|poster|data-src|data-video-src|data-preview-src|data-compare-video)="\/(?!\/)/);
  }
  assert.match(page, /href="\.\.\/\.\.\/assets\/css\/main\.css\?v=[0-9a-f]{8}"/);
  assert.match(page, /\.\.\/\.\.\/media\/works\/public-one\/poster/);
  assert.match(home, /<link rel="canonical" href="https:\/\/tonecraft\.example\/">/);
  assert.match(page, /"@type":"(?:VideoObject|CreativeWork)"/);
  assert.match(page, /"@type":"BreadcrumbList"/);
  assert.match(home, /"@type":"Organization"/);
  assert.doesNotMatch(home, /ProfessionalService|serviceType/);
  assert.match(nf, /noindex,nofollow/);
  const manifest = JSON.parse(await fsp.readFile(path.join(site, 'site.webmanifest'), 'utf8'));
  assert.equal(manifest.short_name, 'TONECRAFT');
  // assets copied for a project outside the repo
  await fsp.stat(path.join(site, 'assets', 'css', 'main.css'));
});

test('every media / page / css / js reference in generated pages resolves to a file in site/', { skip }, async () => {
  const root = await consentFixture();
  const r = await build(root);
  assert.equal(r.ok, true);
  const site = path.join(root, 'site');
  const pages = (await readTree(site)).filter((f) => f.rel.endsWith('.html') && f.rel !== '404.html');
  let checked = 0;
  for (const page of pages) {
    const html = page.buf.toString('utf8');
    const refs = [];
    for (const m of html.matchAll(/\s(?:href|src|poster|data-src|data-video-src|data-preview-src|data-compare-video|data-video-poster)="([^"]*)"/g)) refs.push(m[1]);
    for (const m of html.matchAll(/\s(?:srcset|imagesrcset)="([^"]*)"/g)) for (const part of m[1].split(',')) refs.push(part.trim().split(/\s+/)[0]);
    for (const ref of refs) {
      const u = ref.replace(/&amp;/g, '&').split('#')[0].split('?')[0];
      if (!u || /^[a-z]+:/i.test(u)) continue;
      const target = path.resolve(site, path.dirname(page.rel), decodeURIComponent(u));
      const rel = path.relative(site, target).split(path.sep).join('/');
      if (!/^(media\/|works\/|assets\/(css|js)\/)/.test(rel) && rel !== '') continue;
      const file = u.endsWith('/') || rel === '' ? path.join(target, 'index.html') : target;
      await fsp.stat(file).catch(() => assert.fail(`${page.rel}: ${ref} → missing ${path.relative(site, file)}`));
      checked++;
    }
  }
  assert.ok(checked > 20, `checked ${checked} references`);
});

test('embed works do not ship main.mp4; unpublished reel ships nothing', { skip }, async () => {
  const root = await makeProject({
    site: { ...BASE_SITE, reel: { publish: false } },
    works: [work('embedded', { video: { type: 'vimeo', id: '76979871' } })],
    media: { embedded: { main: true } },
    reel: true,
  });
  const r = await build(root);
  assert.equal(r.ok, true, r.errors.join('\n'));
  const site = path.join(root, 'site');
  await assert.rejects(fsp.stat(path.join(site, 'media', 'works', 'embedded', 'main.mp4')));
  await fsp.stat(path.join(site, 'media', 'works', 'embedded', 'poster.jpg'));
  await assert.rejects(fsp.stat(path.join(site, 'media', 'reel')));
  const page = await fsp.readFile(path.join(site, 'works', 'embedded', 'index.html'), 'utf8');
  assert.match(page, /player\.vimeo\.com\/video\/76979871/);
});

test('zero published works still builds (empty state) and 404 uses absolute root', { skip }, async () => {
  const root = await makeProject({ works: [work('draft', { publish: false })], media: { draft: {} } });
  const r = await build(root);
  assert.equal(r.ok, true, r.errors.join('\n'));
  const site = path.join(root, 'site');
  assert.deepEqual(await fsp.readdir(site).then((l) => l.includes('works')), false);
  await assert.rejects(fsp.stat(path.join(site, 'media')));
  const nf = await fsp.readFile(path.join(site, '404.html'), 'utf8');
  assert.match(nf, /href="\/assets\/css\/main\.css/);
});

test('--check validates and reports without writing anything', { skip: false }, async () => {
  const root = await consentFixture();
  const r = await build(root, { check: true });
  assert.equal(r.ok, true);
  assert.equal(r.published.length, 1);
  assert.equal(r.hidden.length, 3);
  const entries = await fsp.readdir(root);
  assert.ok(!entries.includes('site') && !entries.includes('.preview'), entries.join(','));
});

test('content errors abort the build and leave site/ untouched', { skip: false }, async () => {
  const root = await makeProject({ works: [work('a', { category: 'nope' }), { slug: 'a', title: 'dup', category: 'film' }] });
  const r = await build(root);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 2);
  await assert.rejects(fsp.stat(path.join(root, 'site')));
});

test('CLI: build --check exits 0; bad option exits 2 with Korean help', async () => {
  const root = await makeProject({ works: [work('a')], media: { a: {} } });
  let p = spawnSync(process.execPath, [path.join(REPO, 'tools', 'build.mjs'), '--check', '--root', root], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /공개 작업 1개/);
  p = spawnSync(process.execPath, [path.join(REPO, 'tools', 'build.mjs'), '--bogus'], { encoding: 'utf8' });
  assert.equal(p.status, 2);
  assert.match(p.stderr, /알 수 없는 옵션/);
  await write(path.join(root, 'content', 'works.mjs'), 'export default [{ slug: "Bad Slug", title: "x", category: "film" }];');
  p = spawnSync(process.execPath, [path.join(REPO, 'tools', 'build.mjs'), '--root', root], { encoding: 'utf8' });
  assert.equal(p.status, 1);
  assert.match(p.stderr, /slug/);
});

test('reel consent: pending (the default) keeps the reel out of site/ but in preview; granted publishes it', { skip }, async () => {
  const root = await consentFixture();
  let r = await build(root);
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.match(r.reelHidden, /pending/);
  assert.ok(r.warnings.some((w) => w.includes('쇼릴 숨김') && w.includes("consent: 'granted'")));
  await assert.rejects(fsp.stat(path.join(root, 'site', 'media', 'reel')));
  assert.doesNotMatch(await fsp.readFile(path.join(root, 'site', 'index.html'), 'utf8'), /reel-loop\.mp4/);
  const pv = await build(root, { preview: true });
  assert.equal(pv.ok, true);
  assert.match(await fsp.readFile(path.join(root, '.preview', 'index.html'), 'utf8'), /reel-loop\.mp4/);
  const siteFile = path.join(root, 'content', 'site.mjs');
  await write(siteFile, `export default ${JSON.stringify({ ...BASE_SITE, siteUrl: 'https://tonecraft.example', reel: { consent: 'granted' } })};`);
  r = await build(root);
  assert.equal(r.ok, true);
  assert.equal(r.reelHidden, '');
  await fsp.stat(path.join(root, 'site', 'media', 'reel', 'reel-loop.mp4'));
  assert.match(await fsp.readFile(path.join(root, 'site', 'index.html'), 'utf8'), /reel-loop\.mp4/);
});

test('a hidden work that cannot be fully removed from site/ fails the build (locked file, hand-made folder)', { skip }, async () => {
  const root = await consentFixture();
  const site = path.join(root, 'site');
  const worksFile = path.join(root, 'content', 'works.mjs');
  const original = await fsp.readFile(worksFile, 'utf8');
  await write(worksFile, original.replace('"publish": false', '"publish": true'));
  assert.equal((await build(root)).ok, true);
  await fsp.stat(path.join(site, 'media', 'works', SECRET.slug, 'main.mp4'));
  await write(worksFile, original);
  // Windows: a video player / Explorer preview holds main.mp4 open → rm fails with EBUSY
  const realRm = fsp.rm;
  const locked = mock.method(fsp, 'rm', async function rm(p, opts) {
    if (String(p).includes(SECRET.slug) && String(p).endsWith('main.mp4')) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    return realRm.call(this, p, opts);
  });
  let r;
  try {
    r = await build(root);
  } finally {
    locked.mock.restore();
  }
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes(`media/works/${SECRET.slug}/main.mp4`) && e.includes('EBUSY') && e.includes('npm run build')), r.errors.join('\n'));
  // every other file of the hidden work is still removed (no abort half-way)
  await assert.rejects(fsp.stat(path.join(site, 'media', 'works', SECRET.slug, 'poster.jpg')));
  await assert.rejects(fsp.stat(path.join(site, 'works', SECRET.slug)));
  // lock released → the next build cleans up and succeeds
  r = await build(root);
  assert.equal(r.ok, true, r.errors.join('\n'));
  await assert.rejects(fsp.stat(path.join(site, 'media', 'works', SECRET.slug)));

  // a hand-made (unmarked) folder named like a hidden work is not deleted — and not uploaded as if all was fine
  await write(path.join(site, 'works', PENDING.slug, 'index.html'), '<!doctype html><p>copied from the old site');
  r = await build(root);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes(`site/works/${PENDING.slug}/`)), r.errors.join('\n'));
  await fsp.stat(path.join(site, 'works', PENDING.slug, 'index.html'));
});

test('report: baVideo without a comparison video, oversized / HEIC portrait, private works file', { skip: false }, async () => {
  const root = await makeProject({
    site: { ...BASE_SITE, about: { paragraphs: ['소개'], portrait: 'assets/img/portrait.jpg' } },
    works: [work('cmp', { baVideo: true })],
    media: { cmp: { ba: 1 } },
  });
  await write(path.join(root, 'site', 'assets', 'img', 'portrait.jpg'), fakeJpeg(3024, 4032, { app1: 500000 }));
  await write(path.join(root, 'content', 'works.private.mjs'), `export default ${JSON.stringify([work('secret-one', { consent: 'pending' })])};`);
  const logger = silentLogger();
  let r = await buildSite({ root, logger, now: NOW, check: true });
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.ok(r.warnings.some((w) => w.includes('cmp') && w.includes('ba-N.mp4')));
  assert.ok(r.warnings.some((w) => w.includes('프로필 사진') && w.includes('3024×4032')));
  assert.ok(logger.lines.some((l) => l.includes('works.private.mjs') && l.includes('1개')));
  assert.equal(r.hidden.length, 1);
  await write(path.join(root, 'site', 'assets', 'img', 'me.heic'), 'heic');
  await write(path.join(root, 'content', 'site.mjs'), `export default ${JSON.stringify({ ...BASE_SITE, about: { paragraphs: ['소개'], portrait: 'assets/img/me.heic' } })};`);
  r = await build(root, { check: true });
  assert.ok(r.warnings.some((w) => w.includes('HEIC')));
});
