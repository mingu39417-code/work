// SEO objects: page meta, JSON-LD, sitemap.xml, robots.txt, site.webmanifest.
// Only published works are ever passed in here (consent safety is enforced by the caller).

/** Percent-encode each path segment ('media/works/x/poster.jpg' stays readable; Korean names get encoded). */
export function encodePath(p) {
  return String(p || '')
    .split('/')
    .map((seg) => {
      try {
        return encodeURIComponent(decodeURIComponent(seg));
      } catch {
        return encodeURIComponent(seg);
      }
    })
    .join('/');
}

export function isAbsoluteUrl(u) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(String(u || ''));
}

/** site-relative path → absolute URL (requires siteUrl) */
export function absUrl(siteUrl, rel) {
  if (!rel) return '';
  if (isAbsoluteUrl(rel)) return rel;
  return `${siteUrl}/${encodePath(String(rel).replace(/^\.?\//, ''))}`;
}

/** site-relative path → URL for a page: absolute when siteUrl is set, else relative with the page's root prefix. */
export function pageUrlFor(siteUrl, root, rel) {
  if (!rel) return '';
  if (isAbsoluteUrl(rel)) return rel;
  return siteUrl ? absUrl(siteUrl, rel) : `${root}${encodePath(String(rel).replace(/^\.?\//, ''))}`;
}

/** seconds → ISO 8601 duration ('PT1M23S'); null for unknown/invalid */
export function isoDuration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return null;
  let total = Math.round(s);
  if (total === 0) total = 1;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${sec || (!h && !m) ? `${sec}S` : ''}`;
}

/** Collapse whitespace and cut to max chars on a word boundary where possible. */
export function clip(text, max = 150) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.·—-]+$/, '')}…`;
}

/** Drop undefined / null / '' / [] values (recursively) so JSON-LD stays clean. */
export function compact(value) {
  if (Array.isArray(value)) {
    const arr = value.map(compact).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const c = compact(v);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (value === null || value === undefined || value === '') return undefined;
  return value;
}

/**
 * Work page meta description (≈ 120 chars): the one-line summary plus the search context it lacks —
 * client, category, role, brand and person ('… — DEMO 모터스 광고 컬러 그레이딩 · TONECRAFT 컬러리스트 임민규').
 */
export function workDescription(site, work) {
  const who = [site.brand.name, site.brand.role, site.brand.person].filter(Boolean).join(' ');
  const context = [work.client, work.categoryLabel, work.role || '컬러 그레이딩'].filter(Boolean).join(' ');
  const lead = work.summary || work.notes?.[0] || '';
  if (lead) {
    const tail = ` — ${[context, who].filter(Boolean).join(' · ')}`;
    return `${clip(lead, Math.max(40, 120 - tail.length))}${tail}`.replace(/\s+/g, ' ').trim();
  }
  const parts = [work.client, work.categoryLabel, work.year].filter((p) => p !== null && p !== undefined && p !== '');
  return clip(`${work.title}${parts.length ? ` (${parts.join(' · ')})` : ''} — ${work.role} 작업. ${who}`.trim(), 160);
}

/** og:image:type from the file name ('' when unknown, e.g. an extension-less CDN URL). */
export function imageTypeOf(src) {
  const ext = String(src || '').split(/[?#]/)[0].split('.').pop().toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' }[ext] || '';
}

/** Share-image fields: absolute/relative URL + its pixel size and type (Facebook renders the first share without waiting). */
function ogImageFields(siteUrl, root, src, size) {
  return {
    ogImage: pageUrlFor(siteUrl, root, src),
    ogImageWidth: size?.w || null,
    ogImageHeight: size?.h || null,
    ogImageType: imageTypeOf(src),
  };
}

/**
 * Page meta (spec §4). kind: 'home' | 'work' | '404'.
 * root: the page's paths.root (used for relative og:image when siteUrl is empty).
 * description is the search snippet; ogDescription the (shorter) text for KakaoTalk/Facebook cards.
 */
export function buildMeta({ site, kind, work = null, preview = false, root = '' }) {
  const { siteUrl, brand, seo } = site;
  const base = {
    siteName: brand.name,
    locale: 'ko_KR',
    robots: preview || kind === '404' ? 'noindex,nofollow' : 'index,follow',
  };
  const defaultOg = seo.ogImage;
  const defaultSize = seo.ogImageSize || null;
  const defaultAlt = [brand.name, [brand.person, brand.role].filter(Boolean).join(' ')].filter(Boolean).join(' — ');
  if (kind === 'work' && work) {
    const media = work.media || {};
    const canonical = siteUrl ? `${siteUrl}/works/${work.slug}/` : '';
    const img = media.og?.src ? media.og : media.poster?.src ? media.poster : null;
    const description = workDescription(site, work);
    return {
      ...base,
      title: `${work.title} — ${work.role || '컬러 그레이딩'} | ${brand.name}`,
      description,
      ogDescription: work.summary ? clip(work.summary, 160) : description,
      canonical,
      ogUrl: canonical,
      ...ogImageFields(siteUrl, root, img ? img.src : defaultOg, img ? { w: img.w, h: img.h } : defaultSize),
      ogImageAlt: img ? work.alt : defaultAlt,
      ogType: media.main || media.embed ? 'video.other' : 'website',
    };
  }
  if (kind === '404') {
    const description = seo.description || brand.tagline;
    return {
      ...base,
      title: `페이지를 찾을 수 없습니다 | ${brand.name}`,
      description,
      ogDescription: description,
      canonical: '',
      ogUrl: '',
      ...ogImageFields(siteUrl, root, defaultOg, defaultSize),
      ogImageAlt: defaultAlt,
      ogType: 'website',
    };
  }
  const canonical = siteUrl ? `${siteUrl}/` : '';
  const description = seo.description || brand.tagline;
  return {
    ...base,
    title: seo.title || brand.name,
    description,
    ogDescription: description,
    canonical,
    ogUrl: canonical,
    ...ogImageFields(siteUrl, root, defaultOg, defaultSize),
    ogImageAlt: defaultAlt,
    ogType: 'website',
  };
}

// ---------------------------------------------------------------------------------------------
// JSON-LD

function person(site) {
  return compact({ '@type': 'Person', name: site.brand.person || undefined, jobTitle: site.brand.role || undefined });
}

export function homeJsonLd(site) {
  const { siteUrl, brand, contact, seo, services, business } = site;
  const id = (frag) => (siteUrl ? `${siteUrl}/#${frag}` : undefined);
  const serviceNames = services.map((s) => s.title);
  // Organization: a freelancer without a street address is not a LocalBusiness (Google requires `address` there;
  // schema.org deprecated the ProfessionalService subtype). With business.address filled in → LocalBusiness.
  const business0 = compact({
    '@context': 'https://schema.org',
    '@type': business.address ? 'LocalBusiness' : 'Organization',
    '@id': id('business'),
    name: brand.name,
    alternateName: brand.person ? `${brand.name} ${brand.person}` : undefined,
    description: seo.description || brand.tagline || undefined,
    slogan: brand.tagline || undefined,
    url: siteUrl ? `${siteUrl}/` : undefined,
    email: contact.email || undefined,
    image: siteUrl ? absUrl(siteUrl, seo.ogImage) : undefined,
    logo: siteUrl ? absUrl(siteUrl, 'assets/img/icon-512.png') : undefined,
    founder: person(site),
    knowsAbout: serviceNames.length ? serviceNames : undefined,
    sameAs: contact.kmongUrl ? [contact.kmongUrl] : undefined,
    address: business.address ? { '@type': 'PostalAddress', streetAddress: business.address, addressCountry: 'KR' } : undefined,
    hasOfferCatalog: services.length
      ? {
          '@type': 'OfferCatalog',
          name: '서비스',
          itemListElement: services.map((s) => ({
            '@type': 'Offer',
            itemOffered: compact({ '@type': 'Service', name: s.title, description: s.summary || undefined }),
          })),
        }
      : undefined,
  });
  const website = compact({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': id('website'),
    name: brand.name,
    url: siteUrl ? `${siteUrl}/` : undefined,
    inLanguage: 'ko-KR',
    description: seo.description || undefined,
    publisher: siteUrl ? { '@id': id('business') } : { '@type': 'Organization', name: brand.name },
  });
  return [business0, website];
}

/** Embed URL for structured data (no autoplay parameters). */
export function plainEmbedUrl(embed) {
  if (!embed) return undefined;
  if (embed.type === 'vimeo') return `https://player.vimeo.com/video/${embed.id}${embed.hash ? `?h=${embed.hash}` : ''}`;
  if (embed.type === 'youtube') return `https://www.youtube.com/embed/${embed.id}`;
  return undefined;
}

export function workJsonLd(site, work) {
  const { siteUrl, brand } = site;
  const media = work.media || {};
  const pageUrl = siteUrl ? `${siteUrl}/works/${work.slug}/` : undefined;
  const description = workDescription(site, work);
  const dateStr = work.date || (work.year ? String(work.year) : '');
  const thumbs = [media.og?.src, media.poster?.src].filter(Boolean);
  const client = work.client ? { '@type': 'Organization', name: work.client } : undefined;
  const hasVideo = Boolean(media.main || media.embed);
  const out = [];
  if (siteUrl && hasVideo && dateStr && thumbs.length) {
    out.push(
      compact({
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: work.title,
        description,
        thumbnailUrl: thumbs.map((t) => absUrl(siteUrl, t)),
        // ISO 8601 with the Korean time zone (a date alone is ambiguous to Google); year-only → 1 January
        uploadDate: `${work.date || `${work.year}-01-01`}T00:00:00+09:00`,
        duration: media.main ? isoDuration(media.main.duration) || undefined : undefined,
        contentUrl: media.main ? absUrl(siteUrl, media.main.src) : undefined,
        embedUrl: media.embed ? plainEmbedUrl(media.embed) : undefined,
        url: pageUrl,
        inLanguage: 'ko',
        genre: work.categoryLabel || undefined,
        contributor: person(site),
        productionCompany: client,
      }),
    );
  } else {
    out.push(
      compact({
        '@context': 'https://schema.org',
        '@type': 'CreativeWork',
        name: work.title,
        description,
        url: pageUrl,
        image: siteUrl && thumbs.length ? absUrl(siteUrl, thumbs[0]) : undefined,
        dateCreated: dateStr || undefined,
        genre: work.categoryLabel || undefined,
        inLanguage: 'ko',
        contributor: person(site),
        sourceOrganization: client,
      }),
    );
  }
  out.push({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: brand.name, item: siteUrl ? `${siteUrl}/` : '../../' },
      compact({ '@type': 'ListItem', position: 2, name: work.title, item: pageUrl }),
    ],
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// files

function xmlEscape(s) {
  return String(s).replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch]);
}

/** sitemap.xml for published works (requires siteUrl — caller deletes the file otherwise). */
export function sitemapXml(site, works) {
  const { siteUrl } = site;
  const entries = [{ loc: `${siteUrl}/`, image: absUrl(siteUrl, site.seo.ogImage), priority: '1.0' }];
  for (const w of works) {
    const img = w.media?.poster?.src || w.media?.og?.src;
    entries.push({ loc: `${siteUrl}/works/${w.slug}/`, image: img ? absUrl(siteUrl, img) : '', priority: '0.8' });
  }
  const body = entries
    .map(
      (e) =>
        `  <url>\n    <loc>${xmlEscape(e.loc)}</loc>\n    <priority>${e.priority}</priority>${
          e.image ? `\n    <image:image><image:loc>${xmlEscape(e.image)}</image:loc></image:image>` : ''
        }\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${body}\n</urlset>\n`;
}

export function robotsTxt(site) {
  return `User-agent: *\nAllow: /\n${site.siteUrl ? `\nSitemap: ${site.siteUrl}/sitemap.xml\n` : ''}`;
}

/** icons: [{ src, sizes, type }] — only files that exist. */
export function webManifest(site, icons = []) {
  const { brand, seo } = site;
  const name = [brand.name, [brand.person, brand.role].filter(Boolean).join(' ')].filter(Boolean).join(' — ');
  return `${JSON.stringify(
    {
      name,
      short_name: brand.name,
      description: seo.description || brand.tagline || '',
      lang: 'ko',
      dir: 'ltr',
      start_url: './',
      scope: './',
      display: 'browser',
      background_color: '#101010',
      theme_color: '#101010',
      icons,
    },
    null,
    2,
  )}\n`;
}
