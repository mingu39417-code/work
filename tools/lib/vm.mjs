// View-model construction for the templates (spec §4).
import { buildMeta, homeJsonLd, workJsonLd } from './seo.mjs';

/** Nav items in home section order. Each has a predicate on the home data. */
const NAV = [
  { id: 'works', label: '작업', has: () => true },
  { id: 'compare', label: '비포·애프터', has: (d) => d.comparisons.length > 0 },
  { id: 'services', label: '서비스', has: (d) => d.site.services.length > 0 },
  { id: 'process', label: '진행 방식', has: (d) => d.site.process.length > 0 },
  { id: 'packages', label: '가격', has: (d) => d.site.packages.length > 0 },
  { id: 'about', label: '소개', has: (d) => d.site.about.paragraphs.length > 0 || d.site.about.facts.length > 0 },
  { id: 'faq', label: 'FAQ', has: (d) => d.site.faq.length > 0 },
  { id: 'contact', label: '문의', has: () => true },
];

/** prefix: '' on home, '../../' on work pages, absolute root on 404. */
export function buildNav(site, comparisons, prefix = '') {
  const data = { site, comparisons };
  return NAV.filter((n) => n.has(data)).map((n) => ({ id: n.id, label: n.label, href: `${prefix}#${n.id}` }));
}

/** Home B/A picks: first comparison of each work that has one, featured works first, max 4. */
export function pickComparisons(works, max = 4) {
  const withCmp = works.filter((w) => w.media?.comparisons?.length);
  const ordered = [...withCmp.filter((w) => w.featured), ...withCmp.filter((w) => !w.featured)];
  return ordered.slice(0, max).map((work) => ({ work, comparison: work.media.comparisons[0] }));
}

/** Categories that have at least one (published) work, in site order, with counts. */
export function categoriesWithCounts(site, works) {
  const counts = new Map();
  for (const w of works) counts.set(w.category, (counts.get(w.category) || 0) + 1);
  return site.categories.filter((c) => counts.get(c.id)).map((c) => ({ id: c.id, label: c.label, count: counts.get(c.id) }));
}

export function withUrl(work, media) {
  return { ...work, media, url: `works/${work.slug}/` };
}

/**
 * Build all page view models.
 * works: normalized works that will be rendered (production: published only), each already { ...work, media, url }.
 */
export function buildViewModels({ site, works, reel, build }) {
  const comparisons = pickComparisons(works);
  const preview = Boolean(build.preview);

  const homeRoot = '';
  const home = {
    site,
    meta: buildMeta({ site, kind: 'home', preview, root: homeRoot }),
    jsonLd: homeJsonLd(site),
    build,
    paths: { root: homeRoot },
    nav: buildNav(site, comparisons, homeRoot),
    works,
    categories: categoriesWithCounts(site, works),
    comparisons,
    reel,
  };

  const workRoot = '../../';
  const workNav = buildNav(site, comparisons, workRoot);
  const pages = works.map((work, i) => {
    const prev = works[i - 1];
    const next = works[i + 1];
    return {
      slug: work.slug,
      vm: {
        site,
        meta: buildMeta({ site, kind: 'work', work, preview, root: workRoot }),
        jsonLd: workJsonLd(site, work),
        build,
        paths: { root: workRoot },
        nav: workNav,
        work,
        prev: prev ? { title: prev.title, url: `../${prev.slug}/` } : null,
        next: next ? { title: next.title, url: `../${next.slug}/` } : null,
        homeUrl: workRoot,
      },
    };
  });

  const nfRoot = site.siteUrl ? `${site.siteUrl}/` : '/';
  const notFound = {
    site,
    meta: buildMeta({ site, kind: '404', preview, root: nfRoot }),
    jsonLd: [],
    build,
    paths: { root: nfRoot },
    nav: buildNav(site, comparisons, nfRoot),
  };

  return { home, pages, notFound };
}
