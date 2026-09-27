import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSite, normalizeWorks } from '../tools/lib/content.mjs';
import { buildMeta, homeJsonLd, workJsonLd, sitemapXml, robotsTxt, webManifest, isoDuration, absUrl, clip } from '../tools/lib/seo.mjs';
import { buildNav, pickComparisons, categoriesWithCounts, buildViewModels, withUrl } from '../tools/lib/vm.mjs';
import { BASE_SITE } from './helpers.mjs';

const iss = () => ({ errors: [], warnings: [] });
const site = (extra = {}) => normalizeSite({ ...BASE_SITE, ...extra }, iss());

function mediaFor(slug, { cmp = 0, main = false, embed = null } = {}) {
  const img = (f, w = 1920, h = 1080) => ({ src: `media/works/${slug}/${f}`, w, h, srcset: [{ src: `media/works/${slug}/${f}`, w }] });
  return {
    poster: img('poster.jpg'),
    preview: { src: `media/works/${slug}/preview.mp4`, w: 960, h: 540 },
    main: main ? { src: `media/works/${slug}/main.mp4`, w: 1920, h: 1080, duration: 83.4 } : null,
    embed,
    og: { src: `media/works/${slug}/og.jpg`, w: 1200, h: 630 },
    comparisons: Array.from({ length: cmp }, (_, i) => ({
      before: img(`ba-${i + 1}-before.webp`),
      after: img(`ba-${i + 1}-after.webp`),
      video: null,
      caption: '',
      beforeLabel: 'BEFORE',
      afterLabel: 'AFTER',
    })),
    stills: [],
  };
}

function works(s, list) {
  return normalizeWorks(list, s, iss());
}

test('isoDuration / absUrl / clip helpers', () => {
  assert.equal(isoDuration(83.4), 'PT1M23S');
  assert.equal(isoDuration(3600), 'PT1H');
  assert.equal(isoDuration(3725), 'PT1H2M5S');
  assert.equal(isoDuration(0.3), 'PT1S');
  assert.equal(isoDuration(null), null);
  assert.equal(absUrl('https://x.kr', 'media/works/a/og.jpg'), 'https://x.kr/media/works/a/og.jpg');
  assert.equal(absUrl('https://x.kr', 'assets/img/포트레이트.jpg'), 'https://x.kr/assets/img/%ED%8F%AC%ED%8A%B8%EB%A0%88%EC%9D%B4%ED%8A%B8.jpg');
  assert.equal(absUrl('https://x.kr', 'https://cdn.x/a.jpg'), 'https://cdn.x/a.jpg');
  assert.equal(clip('가'.repeat(200), 150).length, 150);
});

test('home meta: relative og without siteUrl, absolute with siteUrl; preview → noindex', () => {
  const s0 = site();
  const m0 = buildMeta({ site: s0, kind: 'home', root: '' });
  assert.equal(m0.canonical, '');
  assert.equal(m0.ogUrl, '');
  assert.equal(m0.ogImage, 'assets/img/og-default.jpg');
  assert.equal(m0.robots, 'index,follow');
  assert.equal(m0.ogType, 'website');
  assert.equal(m0.locale, 'ko_KR');
  assert.equal(m0.siteName, 'TONECRAFT');
  const s1 = site({ siteUrl: 'https://tonecraft.kr/' });
  const m1 = buildMeta({ site: s1, kind: 'home', root: '' });
  assert.equal(m1.canonical, 'https://tonecraft.kr/');
  assert.equal(m1.ogImage, 'https://tonecraft.kr/assets/img/og-default.jpg');
  assert.equal(buildMeta({ site: s1, kind: 'home', preview: true }).robots, 'noindex,nofollow');
  assert.equal(buildMeta({ site: s1, kind: '404', root: 'https://tonecraft.kr/' }).robots, 'noindex,nofollow');
});

test('work meta: og.jpg, video.other when playable, relative-with-root without siteUrl', () => {
  const s0 = site();
  const [w] = works(s0, [{ slug: 'a', title: '광고 A', category: 'commercial', summary: '한 줄 요약' }]);
  const wm = withUrl(w, mediaFor('a', { main: true }));
  const m = buildMeta({ site: s0, kind: 'work', work: wm, root: '../../' });
  assert.equal(m.ogImage, '../../media/works/a/og.jpg');
  assert.deepEqual([m.ogImageWidth, m.ogImageHeight, m.ogImageType], [1200, 630, 'image/jpeg']);
  assert.equal(m.ogType, 'video.other');
  // search snippet: summary + category/role/brand context; share cards keep the bare summary
  assert.equal(m.description, '한 줄 요약 — 광고 컬러 그레이딩 · TONECRAFT 컬러리스트 임민규');
  assert.equal(m.ogDescription, '한 줄 요약');
  assert.equal(m.ogImageAlt, '광고 A 컬러 그레이딩 장면');
  assert.match(m.title, /^광고 A — 컬러 그레이딩 \| TONECRAFT$/);
  const s1 = site({ siteUrl: 'https://tonecraft.kr' });
  const m1 = buildMeta({ site: s1, kind: 'work', work: withUrl(w, { ...mediaFor('a'), main: null }), root: '../../' });
  assert.equal(m1.canonical, 'https://tonecraft.kr/works/a/');
  assert.equal(m1.ogImage, 'https://tonecraft.kr/media/works/a/og.jpg');
  assert.equal(m1.ogType, 'website');
});

test('home JSON-LD: Organization (LocalBusiness only with an address) + WebSite; url/@id only with siteUrl', () => {
  const [biz0, web0] = homeJsonLd(site());
  assert.equal(biz0['@type'], 'Organization');
  assert.equal(biz0.url, undefined);
  assert.equal(biz0['@id'], undefined);
  assert.equal(biz0.email, 'crafttone3@gmail.com');
  assert.deepEqual(biz0.founder, { '@type': 'Person', name: '임민규', jobTitle: '컬러리스트' });
  assert.equal(biz0.areaServed, undefined, 'no service-area claim that content/site.mjs does not make');
  assert.deepEqual(biz0.knowsAbout, ['컬러 그레이딩']);
  assert.equal(biz0.serviceType, undefined, 'serviceType exists only on schema.org Service');
  assert.equal(web0['@type'], 'WebSite');
  assert.equal(web0.url, undefined);
  assert.deepEqual(web0.publisher, { '@type': 'Organization', name: 'TONECRAFT' });
  const [local] = homeJsonLd(site({ business: { address: '서울시 어딘가 1' } }));
  assert.equal(local['@type'], 'LocalBusiness');
  assert.equal(local.address.streetAddress, '서울시 어딘가 1');
  const [biz1, web1] = homeJsonLd(site({ siteUrl: 'https://tonecraft.kr', contact: { email: 'crafttone3@gmail.com', kmongUrl: 'https://kmong.com/gig/1' } }));
  assert.equal(biz1.url, 'https://tonecraft.kr/');
  assert.equal(biz1.image, 'https://tonecraft.kr/assets/img/og-default.jpg');
  assert.deepEqual(biz1.sameAs, ['https://kmong.com/gig/1']);
  assert.equal(web1.url, 'https://tonecraft.kr/');
  assert.deepEqual(web1.publisher, { '@id': 'https://tonecraft.kr/#business' });
});

test('work JSON-LD: VideoObject only with siteUrl + video + date; else CreativeWork; always BreadcrumbList', () => {
  const s1 = site({ siteUrl: 'https://tonecraft.kr' });
  const [w] = works(s1, [{ slug: 'a', title: 'A', category: 'film', date: '2026-03-02', client: '클라이언트' }]);
  const [vo, bc] = workJsonLd(s1, withUrl(w, mediaFor('a', { main: true })));
  assert.equal(vo['@type'], 'VideoObject');
  assert.equal(vo.uploadDate, '2026-03-02T00:00:00+09:00');
  assert.equal(vo.duration, 'PT1M23S');
  assert.equal(vo.contentUrl, 'https://tonecraft.kr/media/works/a/main.mp4');
  assert.deepEqual(vo.thumbnailUrl, ['https://tonecraft.kr/media/works/a/og.jpg', 'https://tonecraft.kr/media/works/a/poster.jpg']);
  assert.equal(vo.url, 'https://tonecraft.kr/works/a/');
  assert.equal(vo.productionCompany.name, '클라이언트');
  assert.equal(bc['@type'], 'BreadcrumbList');
  assert.equal(bc.itemListElement.length, 2);
  assert.equal(bc.itemListElement[1].item, 'https://tonecraft.kr/works/a/');

  // embed → embedUrl without autoplay, uploadDate from year
  const [w2] = works(s1, [{ slug: 'b', title: 'B', category: 'film', year: 2024, video: { type: 'vimeo', id: '42' } }]);
  const [vo2] = workJsonLd(s1, withUrl(w2, { ...mediaFor('b'), main: null, embed: w2.video }));
  assert.equal(vo2.embedUrl, 'https://player.vimeo.com/video/42');
  assert.equal(vo2.uploadDate, '2024-01-01T00:00:00+09:00');
  assert.equal(vo2.contentUrl, undefined);
  assert.equal(vo2.duration, undefined);

  // no siteUrl → CreativeWork, no absolute urls
  const s0 = site();
  const [w3] = works(s0, [{ slug: 'c', title: 'C', category: 'film', year: 2025 }]);
  const [cw, bc3] = workJsonLd(s0, withUrl(w3, mediaFor('c', { main: true })));
  assert.equal(cw['@type'], 'CreativeWork');
  assert.equal(cw.url, undefined);
  assert.equal(cw.image, undefined);
  assert.equal(cw.dateCreated, '2025');
  assert.equal(bc3.itemListElement[0].item, '../../');
  assert.ok(!JSON.stringify(cw).includes('undefined'));
});

test('sitemap / robots / webmanifest', () => {
  const s1 = site({ siteUrl: 'https://tonecraft.kr' });
  const [w] = works(s1, [{ slug: 'a', title: 'A & <B>', category: 'film' }]);
  const xml = sitemapXml(s1, [withUrl(w, mediaFor('a'))]);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<loc>https:\/\/tonecraft\.kr\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/tonecraft\.kr\/works\/a\/<\/loc>/);
  assert.match(xml, /<image:loc>https:\/\/tonecraft\.kr\/media\/works\/a\/poster\.jpg<\/image:loc>/);
  assert.equal(robotsTxt(s1), 'User-agent: *\nAllow: /\n\nSitemap: https://tonecraft.kr/sitemap.xml\n');
  assert.equal(robotsTxt(site()), 'User-agent: *\nAllow: /\n');
  const man = JSON.parse(webManifest(s1, [{ src: 'assets/img/icon-192.png', sizes: '192x192', type: 'image/png' }]));
  assert.equal(man.short_name, 'TONECRAFT');
  assert.equal(man.start_url, './');
  assert.equal(man.theme_color, '#101010');
  assert.equal(man.lang, 'ko');
  assert.equal(man.icons.length, 1);
});

test('nav: only sections with data; prefixes per page', () => {
  const s = site();
  const nav = buildNav(s, []);
  assert.deepEqual(
    nav.map((n) => n.id),
    ['works', 'services', 'process', 'about', 'faq', 'contact'],
  );
  assert.deepEqual(nav[0], { id: 'works', label: '작업', href: '#works' });
  const withCmp = buildNav(s, [{}], '../../');
  assert.deepEqual(withCmp[1], { id: 'compare', label: '비포·애프터', href: '../../#compare' });
  const bare = normalizeSite({ contact: { email: 'a@b.co' }, categories: [{ id: 'x' }] }, iss());
  assert.deepEqual(
    buildNav(bare, []).map((n) => n.id),
    ['works', 'contact'],
  );
  const withPk = normalizeSite({ ...BASE_SITE, packages: [{ name: '기본', price: null }] }, iss());
  assert.ok(buildNav(withPk, []).some((n) => n.id === 'packages'));
});

test('comparison picks: first pair per work, featured first, max 4', () => {
  const s = site();
  const list = works(s, [
    { slug: 'a', title: 'a', category: 'film', order: 1 },
    { slug: 'b', title: 'b', category: 'film', order: 2, featured: true },
    { slug: 'c', title: 'c', category: 'film', order: 3 },
    { slug: 'd', title: 'd', category: 'film', order: 4 },
    { slug: 'e', title: 'e', category: 'film', order: 5 },
    { slug: 'f', title: 'f', category: 'film', order: 6, featured: true },
  ]).map((w) => withUrl(w, mediaFor(w.slug, { cmp: w.slug === 'c' ? 0 : 2 })));
  const picks = pickComparisons(list);
  assert.deepEqual(
    picks.map((p) => p.work.slug),
    ['b', 'f', 'a', 'd'],
  );
  assert.equal(picks[0].comparison, list[1].media.comparisons[0]);
});

test('view models: categories with counts, prev/next relative urls, 404 root', () => {
  const s = site({ siteUrl: 'https://tonecraft.kr' });
  const list = works(s, [
    { slug: 'a', title: 'A', category: 'film', order: 1 },
    { slug: 'b', title: 'B', category: 'commercial', order: 2 },
    { slug: 'c', title: 'C', category: 'film', order: 3 },
  ]).map((w) => withUrl(w, mediaFor(w.slug)));
  const build = { preview: false, year: 2026, generatedAt: '2026-01-01T00:00:00.000Z', assetVersion: { css: 'aaaa', js: 'bbbb' } };
  const reel = { loop: null, full: null, poster: null, embed: null, title: 'R', fps: 24 };
  const { home, pages, notFound } = buildViewModels({ site: s, works: list, reel, build });
  assert.deepEqual(home.categories, [
    { id: 'commercial', label: '광고', count: 1 },
    { id: 'film', label: '영화', count: 2 },
  ]);
  assert.equal(home.paths.root, '');
  assert.equal(home.works[0].url, 'works/a/');
  assert.equal(pages.length, 3);
  assert.equal(pages[0].vm.prev, null);
  assert.deepEqual(pages[0].vm.next, { title: 'B', url: '../b/' });
  assert.deepEqual(pages[2].vm.prev, { title: 'B', url: '../b/' });
  assert.equal(pages[2].vm.next, null);
  assert.equal(pages[1].vm.homeUrl, '../../');
  assert.equal(pages[1].vm.paths.root, '../../');
  assert.equal(pages[1].vm.nav[0].href, '../../#works');
  assert.equal(notFound.paths.root, 'https://tonecraft.kr/');
  assert.equal(notFound.nav[0].href, 'https://tonecraft.kr/#works');
  assert.equal(notFound.meta.robots, 'noindex,nofollow');
  assert.deepEqual(notFound.jsonLd, []);
  const nf2 = buildViewModels({ site: site(), works: [], reel, build }).notFound;
  assert.equal(nf2.paths.root, '/');
  assert.deepEqual(categoriesWithCounts(s, []), []);
});

test('og:image size/type: og.jpg 1200×630, poster fallback, default image size measured by the build', () => {
  const s = site({ siteUrl: 'https://tonecraft.kr' });
  let m = buildMeta({ site: s, kind: 'home' });
  assert.deepEqual([m.ogImageWidth, m.ogImageHeight, m.ogImageType], [null, null, 'image/jpeg']);
  s.seo.ogImageSize = { w: 1200, h: 630 }; // set by buildSite from the file
  m = buildMeta({ site: s, kind: 'home' });
  assert.deepEqual([m.ogImageWidth, m.ogImageHeight], [1200, 630]);
  assert.equal(buildMeta({ site: s, kind: '404', root: 'https://tonecraft.kr/' }).ogImageWidth, 1200);
  const [w] = works(s, [{ slug: 'a', title: 'A', category: 'film' }]);
  const noOg = withUrl(w, { ...mediaFor('a'), og: null });
  m = buildMeta({ site: s, kind: 'work', work: noOg, root: '../../' });
  assert.equal(m.ogImage, 'https://tonecraft.kr/media/works/a/poster.jpg');
  assert.deepEqual([m.ogImageWidth, m.ogImageHeight], [1920, 1080]);
  m = buildMeta({ site: s, kind: 'work', work: withUrl(w, { ...mediaFor('a'), og: null, poster: null }), root: '../../' });
  assert.deepEqual([m.ogImage, m.ogImageWidth], ['https://tonecraft.kr/assets/img/og-default.jpg', 1200]);
});

test('work description: summary + client/category/role/brand context, clipped; og description stays the summary', () => {
  const s = site();
  const [w] = works(s, [{ slug: 'a', title: 'A', category: 'commercial', client: '브랜드X', summary: '노을빛 하이라이트의 광고 룩' }]);
  const m = buildMeta({ site: s, kind: 'work', work: withUrl(w, mediaFor('a')) });
  assert.equal(m.description, '노을빛 하이라이트의 광고 룩 — 브랜드X 광고 컬러 그레이딩 · TONECRAFT 컬러리스트 임민규');
  assert.equal(m.ogDescription, '노을빛 하이라이트의 광고 룩');
  const [long] = works(s, [{ slug: 'b', title: 'B', category: 'film', summary: '가'.repeat(300) }]);
  const d = buildMeta({ site: s, kind: 'work', work: withUrl(long, mediaFor('b')) }).description;
  assert.ok(d.length <= 125, `${d.length}`);
  assert.ok(d.endsWith('TONECRAFT 컬러리스트 임민규'));
});
