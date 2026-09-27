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
  assert.deepEqual(site.sections.works.empty, { title: '', body: '', cta: '' });
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

test('sections.works.empty (0 public works) is passed through for the owner to edit', () => {
  const site = normalizeSite(
    { contact: { email: 'a@b.co' }, sections: { works: { title: '작업', empty: { title: ' 곧 올라갑니다 ', body: '본문', cta: 3, extra: 'x' } } } },
    issues(),
  );
  assert.deepEqual(site.sections.works.empty, { title: '곧 올라갑니다', body: '본문', cta: '3' });
  assert.equal(site.sections.works.title, '작업');
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
  // the quoted 'true' is not silently read as false: the owner is told to drop the quotes
  assert.equal(is.warnings.length, 2);
  assert.ok(is.warnings.some((w) => w.includes('publish') && w.includes('따옴표 없이')));
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

test('works.private.mjs: merged after works.mjs, duplicate slugs across files caught, leaks from works.mjs reported', async () => {
  const root = await makeProject({
    works: [work('public-one'), work('pending-in-public', { consent: 'pending', client: '대기클라이언트' }), work('draft-plain', { publish: false })],
  });
  let c = await loadContent(root);
  assert.equal(c.privateCount, 0);
  assert.equal(c.works.find((w) => w.slug === 'public-one').source, 'works');
  // the tracked file names a client for a work without consent → move it
  const leak = c.warnings.find((w) => w.includes('works.private.mjs'));
  assert.ok(leak && leak.includes('pending-in-public') && !leak.includes('draft-plain'), leak);
  await write(path.join(root, 'content', 'works.mjs'), `export default ${JSON.stringify([work('public-one')])};`);
  await write(path.join(root, 'content', 'works.private.mjs'), `export default ${JSON.stringify([work('pending-in-public', { consent: 'pending', client: '대기클라이언트' })])};`);
  c = await loadContent(root);
  assert.deepEqual(c.errors, []);
  assert.equal(c.privateCount, 1);
  assert.deepEqual(c.works.map((w) => [w.slug, w.source]).sort(), [['pending-in-public', 'private'], ['public-one', 'works']]);
  assert.ok(!c.warnings.some((w) => w.includes('works.private.mjs')), 'nothing left to move');
  await write(path.join(root, 'content', 'works.private.mjs'), `export default ${JSON.stringify([work('public-one', { title: 'dup' })])};`);
  c = await loadContent(root);
  assert.ok(c.errors.some((e) => e.includes('works.private[0]') && e.includes('중복')), c.errors.join('\n'));
});

test('content files: missing export default, non-UTF-8 (ANSI/CP949) encoding and string booleans are reported', async () => {
  const root = await makeProject({ works: [work('a')] });
  const worksFile = path.join(root, 'content', 'works.mjs');
  await write(worksFile, `export const works = ${JSON.stringify([work('a')])};`);
  let c = await loadContent(root);
  assert.ok(c.errors.some((e) => e.includes('export default')), 'export const → error, not an empty site');
  // '작품' in CP949 (EUC-KR) bytes: C0 DB C7 B0
  await write(worksFile, Buffer.concat([Buffer.from("export default [{ slug: 'a', title: '"), Buffer.from([0xc0, 0xdb, 0xc7, 0xb0]), Buffer.from("', category: 'film' }];")]));
  c = await loadContent(root);
  assert.ok(c.errors.some((e) => e.includes('UTF-8')), c.errors.join('\n'));
  // a UTF-8 file with BOM + CRLF is fine
  await write(worksFile, `﻿export default [\r\n  { slug: 'a', title: '작품', category: 'film', publish: 'true', featured: 'yes' },\r\n];\r\n`);
  c = await loadContent(root);
  assert.deepEqual(c.errors, []);
  assert.equal(c.works[0].title, '작품');
  assert.equal(c.works[0].publish, false);
  assert.ok(c.warnings.some((w) => w.includes('publish') && w.includes('따옴표 없이')));
  assert.ok(c.warnings.some((w) => w.includes('featured')));
});

test('hero.primaryCta.href: sections, relative paths, https/mailto/tel only', () => {
  const href = (h) => {
    const is = issues();
    const s = normalizeSite({ ...BASE_SITE, hero: { primaryCta: { href: h } } }, is);
    return [s.hero.primaryCta.href, is.errors.length];
  };
  assert.deepEqual(href('#contact'), ['#contact', 0]);
  assert.deepEqual(href('works/brand-film/'), ['works/brand-film/', 0]);
  assert.deepEqual(href('https://kmong.com/gig/1'), ['https://kmong.com/gig/1', 0]);
  assert.deepEqual(href('mailto:crafttone3@gmail.com'), ['mailto:crafttone3@gmail.com', 0]);
  assert.deepEqual(href('tel:010-1234-5678'), ['tel:010-1234-5678', 0]);
  assert.deepEqual(href(''), ['#contact', 0]);
  for (const bad of ['javascript:alert(document.cookie)', 'http://kmong.com', 'kmong.com/gig/1', '//evil.example/x', 'data:text/html,x']) {
    assert.deepEqual(href(bad), ['#contact', 1], bad);
  }
  const is = issues();
  normalizeSite({ ...BASE_SITE, hero: { primaryCta: { href: 'kmong.com/gig/1' } } }, is);
  assert.match(is.errors[0], /https:\/\/kmong\.com\/gig\/1/);
});

test('seo verification: a pasted <meta> tag is reduced to its code; junk is dropped with a warning', () => {
  const is = issues();
  const s = normalizeSite(
    {
      ...BASE_SITE,
      seo: {
        naverVerification: '<meta name="naver-site-verification" content="0a1b2c3d4e5f6a7b8c9d" />',
        googleVerification: 'abcDEF_123-xyz456',
      },
    },
    is,
  );
  assert.equal(s.seo.naverVerification, '0a1b2c3d4e5f6a7b8c9d');
  assert.equal(s.seo.googleVerification, 'abcDEF_123-xyz456');
  const is2 = issues();
  assert.equal(normalizeSite({ ...BASE_SITE, seo: { googleVerification: '구글 코드 넣기' } }, is2).seo.googleVerification, '');
  assert.equal(is2.warnings.filter((w) => w.includes('googleVerification')).length, 1);
});

test('reel options: consent (default pending), autoCrop, poster/loop timing', () => {
  let is = issues();
  let r = normalizeSite(BASE_SITE, is).reel;
  assert.deepEqual([r.consent, r.autoCrop, r.posterTime, r.loopStart, r.loopDuration], ['pending', true, null, null, 20]);
  r = normalizeSite({ ...BASE_SITE, reel: { consent: 'granted', autoCrop: false, posterTime: 12.5, loopStart: 2, loopDuration: 30 } }, is).reel;
  assert.deepEqual([r.consent, r.autoCrop, r.posterTime, r.loopStart, r.loopDuration], ['granted', false, 12.5, 2, 30]);
  assert.deepEqual(is.errors, []);
  is = issues();
  r = normalizeSite({ ...BASE_SITE, reel: { consent: 'yes', loopDuration: 90, autoCrop: 'false' } }, is).reel;
  assert.equal(r.consent, 'pending');
  assert.equal(is.errors.length, 1);
  assert.equal(r.loopDuration, 20);
  assert.equal(r.autoCrop, true);
  assert.equal(is.warnings.filter((w) => w.includes('loopDuration') || w.includes('autoCrop')).length, 2);
  // works: autoCrop defaults to true
  const site = normalizeSite(BASE_SITE, issues());
  const [w1, w2] = normalizeWorks([work('a'), work('b', { autoCrop: false })], site, issues());
  assert.deepEqual([w1.autoCrop, w2.autoCrop], [true, false]);
});
