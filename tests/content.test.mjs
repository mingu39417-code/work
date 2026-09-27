import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { normalizeSite, normalizeWorks, normalizeEmbed, parseEmbedRef, sortWorks, loadContent } from '../tools/lib/content.mjs';
import { BASE_SITE, makeProject, work, write, REPO } from './helpers.mjs';

const issues = () => ({ errors: [], warnings: [] });

test('normalizeSite fills every default (no undefined reaches templates)', () => {
  const is = issues();
  const site = normalizeSite({ contact: { email: 'a@b.co' }, categories: [{ id: 'film', label: '영화' }] }, is);
  assert.deepEqual(is.errors, []);
  assert.equal(site.siteUrl, '');
  assert.equal(site.brand.name, 'TONECRAFT');
  assert.equal(site.contact.kmongLabel, '크몽에서 의뢰하기');
  assert.deepEqual(site.hero.primaryCta, { label: '프로젝트 문의하기', href: '#contact' });
  assert.equal(site.hero.reelCta.label, '쇼릴 보기');
  assert.deepEqual(site.hero.title, []);
  assert.equal(site.reel.publish, true);
  assert.equal(site.reel.fps, 24);
  assert.equal(site.reel.embed, null);
  for (const k of ['works', 'compare', 'services', 'process', 'formats', 'packages', 'about', 'faq', 'contact']) {
    assert.equal(typeof site.sections[k].eyebrow, 'string');
    assert.equal(site.sections[k].title, '');
  }
  assert.equal(site.sections.compare.eyebrow, 'BEFORE / AFTER');
  assert.deepEqual(site.packages, []);
  assert.deepEqual(site.formats, { groups: [] });
  assert.equal(site.about.portrait, null);
  assert.equal(site.inquiry.subjectPrefix, '[TONECRAFT 문의]');
  assert.equal(site.seo.ogImage, 'assets/img/og-default.jpg');
  assert.equal(site.analytics.ga4Id, '');
  // deep scan: no undefined anywhere
  const scan = (v, p) => {
    assert.notEqual(v, undefined, `undefined at ${p}`);
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) scan(x, `${p}.${k}`);
  };
  scan(site, 'site');
  assert.ok(is.warnings.some((w) => w.includes('siteUrl')));
  assert.ok(is.warnings.some((w) => w.includes('kmongUrl')));
});

test('siteUrl is normalized without trailing slash; must be https', () => {
  let is = issues();
  assert.equal(normalizeSite({ ...BASE_SITE, siteUrl: 'https://tonecraft.kr/' }, is).siteUrl, 'https://tonecraft.kr');
  assert.equal(normalizeSite({ ...BASE_SITE, siteUrl: 'https://user.github.io/work///' }, is).siteUrl, 'https://user.github.io/work');
  assert.deepEqual(is.errors, []);
  is = issues();
  normalizeSite({ ...BASE_SITE, siteUrl: 'http://tonecraft.kr' }, is);
  assert.equal(is.errors.length, 1);
  is = issues();
  normalizeSite({ ...BASE_SITE, contact: { email: 'a@b.co', kmongUrl: 'kmong.com/gig/1', formEndpoint: 'ftp://x' } }, is);
  assert.equal(is.errors.length, 2);
});

test('invalid / missing email is an error', () => {
  let is = issues();
  normalizeSite({ ...BASE_SITE, contact: { email: 'not-an-email' } }, is);
  assert.equal(is.errors.length, 1);
  is = issues();
  normalizeSite({ ...BASE_SITE, contact: {} }, is);
  assert.equal(is.errors.length, 1);
});

test('category ids validated, duplicates rejected', () => {
  const is = issues();
  normalizeSite({ ...BASE_SITE, categories: [{ id: 'Music Video' }, { id: 'film' }, { id: 'film' }] }, is);
  assert.equal(is.errors.length, 2);
});

test('embeds: computed embedUrl/pageUrl exactly as specified', () => {
  const is = issues();
  const v = normalizeEmbed({ type: 'vimeo', id: '123456' }, 'x', is);
  assert.deepEqual(
    { type: v.type, id: v.id, embedUrl: v.embedUrl, pageUrl: v.pageUrl },
    {
      type: 'vimeo',
      id: '123456',
      embedUrl: 'https://player.vimeo.com/video/123456?autoplay=1&dnt=1&title=0&byline=0&portrait=0',
      pageUrl: 'https://vimeo.com/123456',
    },
  );
  const y = normalizeEmbed({ type: 'youtube', id: 'dQw4w9WgXcQ' }, 'x', is);
  assert.equal(y.embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1');
  assert.equal(y.pageUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.deepEqual(is.errors, []);
});

test('embeds: full URLs and unlisted Vimeo links are accepted', () => {
  assert.deepEqual(parseEmbedRef('youtube', 'https://youtu.be/dQw4w9WgXcQ?t=3'), { type: 'youtube', id: 'dQw4w9WgXcQ', hash: '' });
  assert.equal(parseEmbedRef('youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x').id, 'dQw4w9WgXcQ');
  assert.equal(parseEmbedRef('youtube', 'https://www.youtube.com/shorts/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  assert.deepEqual(parseEmbedRef('vimeo', 'https://vimeo.com/76979871/8272103f6e'), { type: 'vimeo', id: '76979871', hash: '8272103f6e' });
  assert.deepEqual(parseEmbedRef('vimeo', 'https://player.vimeo.com/video/76979871?h=8272103f6e'), { type: 'vimeo', id: '76979871', hash: '8272103f6e' });
  const is = issues();
  const v = normalizeEmbed('https://vimeo.com/76979871/8272103f6e', 'x', is);
  assert.equal(v.pageUrl, 'https://vimeo.com/76979871/8272103f6e');
  assert.ok(v.embedUrl.startsWith('https://player.vimeo.com/video/76979871?autoplay=1&dnt=1&title=0&byline=0&portrait=0'));
  assert.ok(v.embedUrl.endsWith('&h=8272103f6e'));
});

test('embeds: invalid type / id are errors', () => {
  const is = issues();
  assert.equal(normalizeEmbed({ type: 'dailymotion', id: 'x' }, 'a', is), null);
  assert.equal(normalizeEmbed({ type: 'youtube', id: 'short' }, 'b', is), null);
  assert.equal(normalizeEmbed({ type: 'vimeo', id: 'abc' }, 'c', is), null);
  assert.equal(normalizeEmbed({ type: 'vimeo', id: '1"><script>' }, 'd', is), null);
  assert.equal(is.errors.length, 4);
  assert.equal(normalizeEmbed(null, 'e', is), null);
  assert.equal(is.errors.length, 4);
});

test('works: validation errors (slug, duplicate, title, category, consent, embed)', () => {
  const site = normalizeSite(BASE_SITE, issues());
  const is = issues();
  const out = normalizeWorks(
    [
      { title: 'no slug', category: 'film' },
      { slug: 'Bad_Slug', title: 'x', category: 'film' },
      { slug: 'ok-1', title: 'a', category: 'film' },
      { slug: 'ok-1', title: 'dup', category: 'film' },
      { slug: 'no-title', category: 'film' },
      { slug: 'bad-cat', title: 'x', category: 'nope' },
      { slug: 'bad-consent', title: 'x', category: 'film', consent: 'yes' },
      { slug: 'bad-embed', title: 'x', category: 'film', video: { type: 'tiktok', id: '1' } },
    ],
    site,
    is,
  );
  assert.equal(is.errors.length, 7, is.errors.join('\n'));
  assert.deepEqual(
    out.map((w) => w.slug),
    ['ok-1'],
  );
});

test('works: defaults and coercions', () => {
  const site = normalizeSite(BASE_SITE, issues());
  const is = issues();
  const [w] = normalizeWorks(
    [{ slug: 'a', title: '제목', category: 'film', year: '2025', comparisons: [{ caption: 'LOG → 최종' }, {}], notes: '한 문단' }],
    site,
    is,
  );
  assert.deepEqual(is.errors, []);
  assert.equal(w.year, 2025);
  assert.equal(w.role, '컬러 그레이딩');
  assert.equal(w.consent, 'pending');
  assert.equal(w.publish, false);
  assert.equal(w.categoryLabel, '영화');
  assert.equal(w.alt, '제목 컬러 그레이딩 장면');
  assert.deepEqual(w.notes, ['한 문단']);
  assert.deepEqual(w.comparisons, [
    { caption: 'LOG → 최종', beforeLabel: 'BEFORE', afterLabel: 'AFTER' },
    { caption: '', beforeLabel: 'BEFORE', afterLabel: 'AFTER' },
  ]);
  assert.equal(w.previewDuration, 6);
  assert.equal(w.baVideoDuration, 8);
  assert.equal(w.posterTime, null);
  assert.equal(w.video, null);
  assert.equal(w.client, '');
  assert.deepEqual(w.credits, []);
});

test('works: publish must be literally true; date validated and fills year', () => {
  const site = normalizeSite(BASE_SITE, issues());
  const is = issues();
  const out = normalizeWorks(
    [
      { slug: 'a', title: 'a', category: 'film', publish: 'true', date: '2026-02-30' },
      { slug: 'b', title: 'b', category: 'film', publish: true, date: '2024-05-01' },
    ],
    site,
    is,
  );
  const a = out.find((w) => w.slug === 'a');
  const b = out.find((w) => w.slug === 'b');
  assert.equal(a.publish, false);
  assert.equal(a.date, '');
  assert.equal(b.date, '2024-05-01');
  assert.equal(b.year, 2024);
  assert.equal(is.warnings.length, 1);
});

test('sortWorks: order asc, then year desc (unknown last), then title', () => {
  const ws = [
    { slug: 'c', title: '다', order: 0, year: 2024 },
    { slug: 'a', title: '가', order: 0, year: 2026 },
    { slug: 'z', title: '하', order: -1, year: 2020 },
    { slug: 'n', title: '나', order: 0, year: null },
    { slug: 'b', title: '나', order: 0, year: 2024 },
  ];
  assert.deepEqual(
    sortWorks(ws).map((w) => w.slug),
    ['z', 'a', 'b', 'c', 'n'],
  );
});

test('loadContent reads fresh copies and reports syntax errors in Korean', async () => {
  const root = await makeProject({ works: [work('one')] });
  let c = await loadContent(root);
  assert.deepEqual(c.errors, []);
  assert.equal(c.works.length, 1);
  await write(path.join(root, 'content', 'works.mjs'), `export default [${JSON.stringify(work('one'))}, ${JSON.stringify(work('two'))}];`);
  c = await loadContent(root);
  assert.equal(c.works.length, 2, 'second load must not be cached');
  await write(path.join(root, 'content', 'works.mjs'), 'export default [ { slug: "x" ');
  c = await loadContent(root);
  assert.equal(c.errors.length, 1);
  assert.match(c.errors[0], /works\.mjs/);
  // missing comma between two works → line number, source line and a hint
  await write(path.join(root, 'content', 'works.mjs'), "export default [\n  { slug: 'a', title: 'x', category: 'film' }\n  { slug: 'b' },\n];\n");
  c = await loadContent(root);
  assert.match(c.errors[0], /3번째 줄/);
  assert.match(c.errors[0], /\{ slug: 'b' \}/);
  assert.match(c.errors[0], /쉼표/);
  // unquoted Korean text → ReferenceError with line number
  await write(path.join(root, 'content', 'works.mjs'), "export default [\n  { slug: 'a', title: 안녕, category: 'film' },\n];\n");
  c = await loadContent(root);
  assert.match(c.errors[0], /2번째 줄/);
  assert.match(c.errors[0], /따옴표/);
});

test('the repository content validates without errors', async () => {
  const c = await loadContent(REPO);
  assert.deepEqual(c.errors, []);
});
