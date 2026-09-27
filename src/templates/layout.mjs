// Document shell shared by every page: <head>, header/nav, footer, video dialog, toast, preview banner.
import { esc, attrs, arr, filled, int, externalAttrs, jsonLdScript, tidy } from './util.mjs';
import { icons, brandMark } from './icons.mjs';

const BUSINESS_LABELS = [
  ['name', '상호'],
  ['owner', '대표'],
  ['regNo', '사업자등록번호'],
  ['mailOrderNo', '통신판매업 신고번호'],
  ['address', '주소'],
];

function headMeta(vm) {
  const meta = vm.meta || {};
  const site = vm.site || {};
  const seo = site.seo || {};
  const root = vm.paths?.root ?? '';
  const build = vm.build || {};
  const v = build.assetVersion || {};
  const lines = [];

  lines.push(`<title>${esc(meta.title)}</title>`);
  if (filled(meta.description)) lines.push(`<meta name="description"${attrs({ content: meta.description })}>`);
  const keywords = arr(seo.keywords).filter(filled).join(', ');
  if (keywords) lines.push(`<meta name="keywords"${attrs({ content: keywords })}>`);
  if (filled(meta.canonical)) lines.push(`<link rel="canonical"${attrs({ href: meta.canonical })}>`);
  lines.push(`<meta name="robots"${attrs({ content: meta.robots || 'index,follow' })}>`);
  lines.push('<meta name="theme-color" content="#101010">');
  lines.push('<meta name="color-scheme" content="dark">');
  lines.push('<meta name="format-detection" content="telephone=no">');

  // Open Graph / Twitter
  lines.push(`<meta property="og:type"${attrs({ content: meta.ogType || 'website' })}>`);
  if (filled(meta.siteName)) lines.push(`<meta property="og:site_name"${attrs({ content: meta.siteName })}>`);
  lines.push(`<meta property="og:title"${attrs({ content: meta.title })}>`);
  // og:description is the shorter card text (work summary); the meta description above is the longer search snippet.
  const ogDescription = filled(meta.ogDescription) ? meta.ogDescription : meta.description;
  if (filled(ogDescription)) lines.push(`<meta property="og:description"${attrs({ content: ogDescription })}>`);
  if (filled(meta.ogUrl)) lines.push(`<meta property="og:url"${attrs({ content: meta.ogUrl })}>`);
  if (filled(meta.ogImage)) {
    lines.push(`<meta property="og:image"${attrs({ content: meta.ogImage })}>`);
    // dimensions let KakaoTalk / Facebook lay out the card before fetching the image (set by the build when known)
    if (int(meta.ogImageWidth) && int(meta.ogImageHeight)) {
      lines.push(`<meta property="og:image:width"${attrs({ content: int(meta.ogImageWidth) })}>`);
      lines.push(`<meta property="og:image:height"${attrs({ content: int(meta.ogImageHeight) })}>`);
    }
    if (filled(meta.ogImageType)) lines.push(`<meta property="og:image:type"${attrs({ content: meta.ogImageType })}>`);
    if (filled(meta.ogImageAlt)) lines.push(`<meta property="og:image:alt"${attrs({ content: meta.ogImageAlt })}>`);
  }
  lines.push(`<meta property="og:locale"${attrs({ content: meta.locale || 'ko_KR' })}>`);
  lines.push('<meta name="twitter:card" content="summary_large_image">');
  // X/Twitter ignores og:image:alt
  if (filled(meta.ogImage) && filled(meta.ogImageAlt)) lines.push(`<meta name="twitter:image:alt"${attrs({ content: meta.ogImageAlt })}>`);

  if (filled(seo.googleVerification)) lines.push(`<meta name="google-site-verification"${attrs({ content: seo.googleVerification })}>`);
  if (filled(seo.naverVerification)) lines.push(`<meta name="naver-site-verification"${attrs({ content: seo.naverVerification })}>`);

  // Icons + manifest
  lines.push(`<link rel="icon"${attrs({ href: `${root}assets/img/favicon.svg`, type: 'image/svg+xml' })}>`);
  lines.push(`<link rel="icon"${attrs({ href: `${root}assets/img/favicon-32.png`, type: 'image/png', sizes: '32x32' })}>`);
  lines.push(`<link rel="apple-touch-icon"${attrs({ href: `${root}assets/img/apple-touch-icon.png` })}>`);
  lines.push(`<link rel="manifest"${attrs({ href: `${root}site.webmanifest` })}>`);

  return { lines, root, v };
}

function analytics(site, build) {
  if (build?.preview) return ''; // never track local preview builds
  const id = String(site?.analytics?.ga4Id || '').trim();
  // Only a plausible measurement id is ever written into inline JS.
  if (!/^[A-Za-z0-9-]{4,40}$/.test(id)) return '';
  return (
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(id)}"></script>\n` +
    `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`
  );
}

export function header(vm) {
  const root = vm.paths?.root ?? '';
  const brand = vm.site?.brand || {};
  const items = arr(vm.nav)
    .map((item) => `<li><a class="site-nav__link"${attrs({ href: item.href })} data-nav-link>${esc(item.label)}</a></li>`)
    .join('\n        ');
  return `<header class="site-header" data-header>
  <div class="site-header__inner">
    <a class="brand"${attrs({ href: root || './' })}>${brandMark()}<span class="brand__name">${esc(brand.name || 'TONECRAFT')}</span></a>
    <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-nav"><span class="sr-only">메뉴</span><span class="nav-toggle__bars" aria-hidden="true"><span></span><span></span></span></button>
    <nav class="site-nav" id="site-nav" data-nav aria-label="주요 메뉴">
      <ul class="site-nav__list">
        ${items}
      </ul>
      <a class="button button--primary button--sm site-nav__cta"${attrs({ href: `${root}#contact` })} data-track="nav_contact">견적 문의</a>
      <p class="site-nav__foot" aria-hidden="true"><span>${esc(brand.role || 'COLORIST')}</span><span>${esc(brand.person || '')}</span></p>
    </nav>
  </div>
</header>`;
}

/** Email + copy button (+ Kmong) — used in contact section and footer. */
export function contactLinks(vm, { variant = 'footer' } = {}) {
  const contact = vm.site?.contact || {};
  const out = [];
  if (filled(contact.email)) {
    out.push(`<div class="email-line email-line--${esc(variant)}">
  <a class="email-line__link"${attrs({ href: `mailto:${contact.email}` })} data-track="email_click">${esc(contact.email)}</a>
  <button class="copy-button" type="button"${attrs({ 'data-copy': contact.email })} aria-label="이메일 주소 복사">${icons.copy()}<span>복사</span></button>
</div>`);
  }
  return out.join('\n');
}

export function kmongButton(vm, cls = 'button button--ghost') {
  const contact = vm.site?.contact || {};
  if (!filled(contact.kmongUrl)) return '';
  return `<a${attrs({ class: `${cls} button--kmong`, href: contact.kmongUrl, ...externalAttrs(contact.kmongUrl) })} data-track="kmong_click">${esc(contact.kmongLabel || '크몽에서 의뢰하기')}${icons.arrowUpRight()}<span class="sr-only"> (새 창)</span></a>`;
}

/**
 * Full-width footer wordmark. For the default brand name the SVG viewBox is fitted to the measured ink
 * bounds of Pretendard 700 (so it spans the container exactly at any width); textLength keeps the
 * advance stable even if the web font fails to load. Other names fall back to plain text.
 */
function footerWordmark(name) {
  if (name === 'TONECRAFT') {
    return `<p class="site-footer__wordmark" aria-hidden="true"><svg class="site-footer__wordmark-svg" viewBox="3 -73 589 74" focusable="false"><text x="0" y="0" font-size="100" textLength="595" lengthAdjust="spacingAndGlyphs">TONECRAFT</text></svg></p>`;
  }
  return `<p class="site-footer__wordmark site-footer__wordmark--text" aria-hidden="true">${esc(name)}</p>`;
}

export function footer(vm) {
  const site = vm.site || {};
  const brand = site.brand || {};
  const contact = site.contact || {};
  const year = vm.build?.year || '';
  const business = site.business || {};
  const bizLines = BUSINESS_LABELS.filter(([k]) => filled(business[k])).map(
    ([k, label]) => `<div class="footer-biz__row"><dt>${esc(label)}</dt><dd>${esc(business[k])}</dd></div>`,
  );
  const navItems = arr(vm.nav)
    .map((item) => `<li><a${attrs({ href: item.href })}>${esc(item.label)}</a></li>`)
    .join('');
  const kmong = kmongButton(vm, 'button button--ghost button--sm');

  return `<footer class="site-footer">
  <div class="container">
    <div class="site-footer__top">
      ${footerWordmark(brand.name || 'TONECRAFT')}
    </div>
    <div class="site-footer__grid">
      <div class="site-footer__col site-footer__col--contact">
        <p class="label" lang="en">CONTACT</p>
        ${contactLinks(vm, { variant: 'footer' })}
        ${kmong ? `<div class="site-footer__kmong">${kmong}</div>` : ''}
        ${filled(contact.responseNote) ? `<p class="site-footer__note">${esc(contact.responseNote)}</p>` : ''}
      </div>
      ${navItems ? `<nav class="site-footer__col site-footer__nav" aria-label="바닥글 메뉴"><p class="label" lang="en">MENU</p><ul>${navItems}</ul></nav>` : ''}
      ${bizLines.length ? `<div class="site-footer__col"><p class="label" lang="en">BUSINESS</p><dl class="footer-biz">${bizLines.join('')}</dl></div>` : ''}
    </div>
    <div class="site-footer__bottom">
      <p class="site-footer__copy">© ${esc(year)} ${esc(brand.name || 'TONECRAFT')} · ${esc(brand.person || '')}</p>
      <a class="site-footer__top-link" href="#main">맨 위로${icons.arrowUp()}</a>
    </div>
  </div>
</footer>`;
}

export function videoDialog() {
  return `<dialog class="video-dialog" data-video-dialog aria-labelledby="video-dialog-title">
  <div class="video-dialog__inner">
    <div class="video-dialog__bar"><h2 class="video-dialog__title" id="video-dialog-title" data-video-dialog-title></h2>
      <button class="video-dialog__close" type="button" data-video-dialog-close aria-label="닫기">${icons.close()}</button></div>
    <div class="video-dialog__stage" data-video-dialog-stage></div>
  </div>
</dialog>`;
}

function previewBanner(vm) {
  if (!vm.build?.preview) return '';
  return '<aside class="preview-banner" aria-label="미리보기 빌드 안내"><span class="preview-banner__dot" aria-hidden="true"></span><span lang="en">PREVIEW</span> · <span class="preview-banner__ko">비공개 작업 포함 — 배포용 아님</span></aside>';
}

/**
 * Full HTML document.
 * @param {object} vm           common view model
 * @param {object} opts         { page: 'home'|'work'|'404', head: extra head html, main: main html }
 */
export function documentShell(vm, { page, head = '', main = '' }) {
  const { lines, root, v } = headMeta(vm);
  const ld = arr(vm.jsonLd).map(jsonLdScript).join('\n');
  const bodyAttrs = attrs({ 'data-page': page, 'data-build': vm.build?.preview ? 'preview' : null });
  return tidy(`<!doctype html>
<html lang="ko" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<script>document.documentElement.className=document.documentElement.className.replace('no-js','js')</script>
${lines.join('\n')}
${head}
<link rel="stylesheet"${attrs({ href: `${root}assets/fonts/pretendard/pretendard.css` })}>
<link rel="stylesheet"${attrs({ href: `${root}assets/fonts/jetbrains-mono/jetbrains-mono.css` })}>
<link rel="stylesheet"${attrs({ href: `${root}assets/css/main.css${v.css ? `?v=${v.css}` : ''}` })}>
${ld}
${analytics(vm.site, vm.build)}
<script${attrs({ src: `${root}assets/js/main.js${v.js ? `?v=${v.js}` : ''}` })} defer></script>
</head>
<body${bodyAttrs}>
<a class="skip-link" href="#main">본문 바로가기</a>
${previewBanner(vm)}
${header(vm)}
<main id="main" tabindex="-1">
${main}
</main>
${footer(vm)}
${videoDialog()}
<div class="toast" data-toast role="status" aria-live="polite" hidden></div>
</body>
</html>
`);
}

