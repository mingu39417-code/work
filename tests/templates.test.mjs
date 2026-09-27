// Template helpers + rendered markup (src/templates) — pure functions, no build or media needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHome, renderWork, render404 } from '../src/templates/index.mjs';
import { krText, langAttr, metaHtml, pickSrc, linkHref } from '../src/templates/util.mjs';
import { workSpans, loneInPairs, fitFor, portraitRatioLabel } from '../src/templates/components.mjs';

// ---------------------------------------------------------------------------------------------
// works grid: 12-column rows

/** Group spans into 12-column rows (desktop). */
function rows(spans) {
  const out = [];
  let cur = [];
  let sum = 0;
  for (const s of spans) {
    cur.push(s);
    sum += s;
    if (sum >= 12) {
      out.push(cur);
      cur = [];
      sum = 0;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Group cards into 2-up rows (tablet): full-width cards (span 12 or flagged "lone") take a row alone. */
function twoUp(spans, lone) {
  const out = [];
  let cur = [];
  spans.forEach((s, i) => {
    if (s === 12 || lone[i]) {
      if (cur.length) out.push(cur);
      out.push(['F']);
      cur = [];
    } else {
      cur.push(i);
      if (cur.length === 2) {
        out.push(cur);
        cur = [];
      }
    }
  });
  if (cur.length) out.push(cur);
  return out;
}

function checkGrid(featured) {
  const spans = workSpans(featured.map((f) => ({ featured: f })));
  assert.equal(spans.length, featured.length, 'one span per work');
  const incomplete = rows(spans).filter((row) => row.reduce((a, b) => a + b, 0) !== 12);
  assert.deepEqual(incomplete, [], `every desktop row fills 12 columns: ${JSON.stringify(rows(spans))} (featured ${JSON.stringify(featured)})`);
  const lone = loneInPairs(spans.map((s) => s === 12));
  const alone = twoUp(spans, lone).filter((row) => row.length === 1 && row[0] !== 'F');
  assert.deepEqual(alone, [], `no lone half-width card at 2-up (featured ${JSON.stringify(featured)})`);
}

test('workSpans: rows always sum to 12 (1–24 works, first-k featured)', () => {
  for (let n = 1; n <= 24; n++) for (let k = 0; k <= n; k++) checkGrid(Array.from({ length: n }, (_, i) => i < k));
});

test('workSpans: rows always sum to 12 (random featured patterns)', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let t = 0; t < 3000; t++) {
    const n = 1 + Math.floor(rnd() * 26);
    checkGrid(Array.from({ length: n }, () => rnd() < 0.3));
  }
});

test('loneInPairs: flags the odd half-width card left alone at 2-up', () => {
  const spans = workSpans([true, false, false, false, false].map((f) => ({ featured: f })));
  const lone = loneInPairs(spans.map((s) => s === 12));
  assert.equal(lone.length, spans.length);
  assert.equal(lone.filter(Boolean).length, 1);
  assert.deepEqual(loneInPairs([false, false]), [false, false]);
  assert.deepEqual(loneInPairs([false]), [true]);
});

// ---------------------------------------------------------------------------------------------
// text helpers

test('krText: keeps separators and closing brackets with the words around them', () => {
  assert.equal(krText('그레이딩 · 카메라 매칭 · 룩'), '그레이딩&nbsp;· 카메라 매칭&nbsp;· 룩');
  assert.equal(krText('(XML·EDL·AAF 등)와 원본'), '(XML·EDL·AAF 등)&#8288;와 원본');
  assert.equal(krText('<b> · x'), '&lt;b&gt;&nbsp;· x', 'escapes HTML');
});

test('langAttr: English-only labels get lang="en"', () => {
  assert.equal(langAttr('GRADE NOTES'), ' lang="en"');
  assert.equal(langAttr('영화 DI'), '');
  assert.equal(langAttr('2026'), '');
});

test('metaHtml: parts after the first carry their own separator', () => {
  assert.equal(metaHtml(['광고', 2026, '']), '<span>광고</span><span class="meta__part"><span class="sep">, </span><span>2026</span></span>');
});

test('fitFor / portraitRatioLabel', () => {
  assert.equal(fitFor(1080, 1920), 'tall');
  assert.equal(fitFor(1440, 1080), 'contain');
  assert.equal(fitFor(1920, 1080), 'cover');
  assert.equal(fitFor(2560, 1080), 'contain');
  assert.equal(portraitRatioLabel(1080, 1920), '9:16');
  assert.equal(portraitRatioLabel(1080, 1350), '4:5');
  assert.equal(portraitRatioLabel(900, 1000), 'VERTICAL');
});

test('pickSrc: prefers the srcset WebP over the full JPEG at equal width', () => {
  assert.equal(pickSrc('', { src: 'p.jpg', w: 1080, srcset: [{ src: 'p-640.webp', w: 640 }, { src: 'p-1280.webp', w: 1080 }] }, 1280), 'p-1280.webp');
  assert.equal(
    pickSrc('', { src: 'p.jpg', w: 1920, srcset: [{ src: 'p-640.webp', w: 640 }, { src: 'p-1280.webp', w: 1280 }, { src: 'p.jpg', w: 1920 }] }, 1280),
    'p-1280.webp',
  );
});

test('linkHref: never renders script / data URLs', () => {
  assert.equal(linkHref('', '#contact'), '#contact');
  assert.equal(linkHref('../../', '#contact'), '../../#contact');
  assert.equal(linkHref('', 'https://kmong.com/x'), 'https://kmong.com/x');
  assert.equal(linkHref('', 'mailto:a@b.kr'), 'mailto:a@b.kr');
  assert.equal(linkHref('', 'javascript:alert(1)'), '#contact');
  assert.equal(linkHref('', ' JaVa\tScript:alert(1)'), '#contact');
  assert.equal(linkHref('', 'data:text/html,x'), '#contact');
});

// ---------------------------------------------------------------------------------------------
// rendered pages

const base = (extra = {}) => ({
  site: {
    brand: { name: 'TONECRAFT', person: '임민규', role: '컬러리스트' },
    contact: { email: 'crafttone3@gmail.com' },
    sections: { works: { eyebrow: 'WORKS', title: '작업', lead: '장르별로 정리한 작업입니다.' } },
    hero: {},
    inquiry: {},
    ...extra.site,
  },
  meta: { title: 'T', description: '긴 검색 설명', ogImage: 'https://x.kr/og.jpg', ogImageAlt: '대체 텍스트', ogImageWidth: 1200, ogImageHeight: 630, ogImageType: 'image/jpeg', ...extra.meta },
  build: { year: 2026, assetVersion: {} },
  paths: { root: '' },
  nav: [],
  works: extra.works || [],
  categories: [],
  comparisons: [],
  reel: {},
});

test('head: og:image size/type/alt, og:description prefers the short card text', () => {
  let html = renderHome(base({ meta: { ogDescription: '짧은 카드 문구' } }));
  assert.match(html, /<meta property="og:image:width" content="1200">/);
  assert.match(html, /<meta property="og:image:height" content="630">/);
  assert.match(html, /<meta property="og:image:type" content="image\/jpeg">/);
  assert.match(html, /<meta name="twitter:image:alt" content="대체 텍스트">/);
  assert.match(html, /<meta name="description" content="긴 검색 설명">/);
  assert.match(html, /<meta property="og:description" content="짧은 카드 문구">/);
  html = renderHome(base({ meta: { ogImageWidth: undefined, ogImageHeight: undefined, ogImageType: '' } }));
  assert.doesNotMatch(html, /og:image:width|og:image:type/);
  assert.match(html, /<meta property="og:description" content="긴 검색 설명">/, 'falls back to description');
});

test('home: empty works state (built-in copy, owner override, lead hidden)', () => {
  let html = renderHome(base());
  assert.match(html, /작업물을 정리하고 있습니다\./);
  assert.match(html, /공개 동의를 받은 작업부터/);
  assert.doesNotMatch(html, /레퍼런스 요청하기|따로 안내해 드리겠습니다/);
  assert.doesNotMatch(html, /장르별로 정리한 작업입니다/, 'works lead hidden in the empty state');
  html = renderHome(
    base({ site: { sections: { works: { eyebrow: 'WORKS', title: '작업', lead: 'L', empty: { title: '곧 올라갑니다', body: '본문', cta: '연락하기' } } } } }),
  );
  assert.match(html, /곧 올라갑니다/);
  assert.match(html, />연락하기</);
  html = renderHome(base({ site: { sections: { works: { eyebrow: 'WORKS', title: '작업', lead: 'L', empty: { title: '', body: '', cta: '' } } } } }));
  assert.match(html, /작업물을 정리하고 있습니다\./, 'empty strings fall back to the built-in copy');
});

test('home: inquiry copy (particle after the e-mail, placeholders, 필수 legend)', () => {
  const html = renderHome(base());
  assert.match(html, /<strong>crafttone3@gmail\.com<\/strong> 주소로 보내주세요\./);
  assert.match(html, /placeholder="홍길동 \/ 회사명"/);
  assert.match(html, /유튜브·SNS·방송 등/);
  assert.match(html, /<span class="field__req">필수<\/span> 표시 항목만/);
});

test('home: hero lead and actions paint without a reveal; English labels carry lang="en"', () => {
  const html = renderHome(base({ site: { hero: { lead: '리드 · 문장' } } }));
  assert.match(html, /<p class="hero__lead">리드&nbsp;· 문장<\/p>/);
  assert.match(html, /<div class="hero__actions">/);
  assert.match(html, /class="hero__eyebrow label" lang="en"/);
  assert.match(html, /<p class="label" lang="en">PROJECT BRIEF<\/p>/);
});

const poster = {
  src: 'media/works/a/poster.jpg',
  w: 1920,
  h: 1080,
  srcset: [
    { src: 'media/works/a/poster-640.webp', w: 640 },
    { src: 'media/works/a/poster-1280.webp', w: 1280 },
    { src: 'media/works/a/poster.jpg', w: 1920 },
  ],
};
const wvm = (media, work = {}) => ({
  ...base(),
  paths: { root: '../../' },
  homeUrl: '../../',
  work: { title: '작품', slug: 'a', categoryLabel: '광고', year: 2026, client: '고객사', summary: '요약 · 한 줄', media, ...work },
  prev: { title: '이전', url: '../p/' },
  next: { title: '다음', url: '../n/' },
});

test('work: self-hosted video uses poster-1280.webp as <video poster> and preloads exactly that URL', () => {
  const html = renderWork(wvm({ poster, main: { src: 'media/works/a/main.mp4', w: 1920, h: 1080 } }));
  assert.match(html, /<link rel="preload" as="image" fetchpriority="high" href="\.\.\/\.\.\/media\/works\/a\/poster-1280\.webp">/);
  assert.match(html, /poster="\.\.\/\.\.\/media\/works\/a\/poster-1280\.webp"/);
  assert.doesNotMatch(html, /class="work-hero" data-reveal/);
  assert.match(html, /<div class="work-top" style="--ar: 1\.7778">/);
  assert.ok(html.indexOf('work-player') < html.indexOf('work-top__summary'), 'summary after the player in DOM order');
  assert.match(html, /<dt class="label"><span aria-hidden="true">CLIENT<\/span><span class="sr-only">의뢰처<\/span><\/dt>/);
  assert.match(html, /<span aria-hidden="true">PREV<\/span><span class="sr-only">이전 작업: <\/span>/);
  assert.match(html, /<span aria-hidden="true">NEXT<\/span><span class="sr-only">다음 작업: <\/span>/);
  assert.match(html, /<p class="work-block__label label" lang="en">DETAILS<\/p>/);
});

test('work: embed preloads the poster with its srcset', () => {
  const html = renderWork(wvm({ poster, embed: { type: 'vimeo', id: '1', embedUrl: 'https://player.vimeo.com/video/1', pageUrl: 'https://vimeo.com/1' } }));
  assert.match(html, /<link rel="preload" as="image" fetchpriority="high" href="\.\.\/\.\.\/media\/works\/a\/poster\.jpg" imagesrcset=/);
});

test('work: player box keeps the uncropped frame when letterbox bars were cut off the poster', () => {
  const cropped = { ...poster, w: 1920, h: 800, crop: { w: 1920, h: 800, x: 0, y: 140 }, frame: { w: 1920, h: 1080 } };
  const embed = { type: 'vimeo', id: '1', embedUrl: 'https://player.vimeo.com/video/1', pageUrl: 'https://vimeo.com/1' };
  // embed: the hosted video still has its bars → 16:9 box
  let html = renderWork(wvm({ poster: cropped, embed }));
  assert.match(html, /<div class="work-top" style="--ar: 1\.7778">/);
  assert.match(html, /class="work-player work-player--embed" style="aspect-ratio: 1920 \/ 1080"/);
  // self-hosted: main.mp4 is never cropped
  html = renderWork(wvm({ poster: cropped, main: { src: 'media/works/a/main.mp4', w: 1920, h: 1080 } }));
  assert.match(html, /<div class="work-top" style="--ar: 1\.7778">/);
  // still: the cropped picture itself
  html = renderWork(wvm({ poster: cropped }));
  assert.match(html, /<div class="work-top" style="--ar: 2\.4">/);
});

test('work card: a wide scope poster carries its own ratio for full-row layouts', async () => {
  const { workCard } = await import('../src/templates/components.mjs');
  const scope = { src: 'media/works/a/poster.jpg', w: 1280, h: 532, srcset: [] };
  let html = workCard('', { title: 'A', slug: 'a', url: 'works/a/', category: 'film', media: { poster: scope } }, 12);
  assert.match(html, /class="work-card__media work-card__media--wide" style="--card-ar: 2\.406" data-preview-host data-fit="contain"/);
  html = workCard('', { title: 'B', slug: 'b', url: 'works/b/', category: 'film', media: { poster } }, 4);
  assert.match(html, /<div class="work-card__media" data-preview-host data-fit="cover">/);
  html = workCard('', { title: 'C', slug: 'c', url: 'works/c/', category: 'film', media: { poster: { src: 'p.jpg', w: 1440, h: 1080 } } }, 4);
  assert.doesNotMatch(html, /work-card__media--wide/, '4:3 is pillarboxed, not "wide"');
});

test('404: content paints without a reveal', () => {
  const html = render404({ ...base(), paths: { root: '/' } });
  assert.doesNotMatch(html, /data-reveal/);
  assert.match(html, /class="notfound__code label" lang="en"/);
});
