// Reusable template fragments: section heads, work cards, before/after compare, media placeholders.
import { esc, attrs, arr, filled, int, assetUrl, srcsetOf, ratio, pad2, labelClass, metaHtml, hasHangul } from './util.mjs';
import { icons, brandMark } from './icons.mjs';

/**
 * Section heading block.
 *  num: render-order number (1-based) or null; eyebrow: mono label; aside: optional small mono text at the right.
 */
export function sectionHead({ id, num, eyebrow, title, lead, aside = '', level = 2 }) {
  const heading = filled(title) ? title : eyebrow;
  const tag = `h${level}`;
  return `<header class="section-head" data-reveal>
    <p class="${labelClass(eyebrow, 'section-head__eyebrow label')}">${num ? `<span class="section-head__num">${esc(pad2(num))}</span><span class="section-head__dash" aria-hidden="true"></span>` : ''}<span>${esc(eyebrow)}</span></p>
    <${tag} class="section-head__title" id="${esc(id)}-title">${esc(heading)}</${tag}>
    ${filled(lead) ? `<p class="section-head__lead">${esc(lead)}</p>` : ''}
    ${filled(aside) ? `<p class="section-head__aside label" aria-hidden="true">${esc(aside)}</p>` : ''}
  </header>`;
}

/** Neutral "no media" placeholder (only reachable in preview builds — published works always have a poster). */
export function mediaEmpty(label = 'NO MEDIA') {
  return `<div class="media-empty" aria-hidden="true">${brandMark('media-empty__mark', 32)}<span class="label">${esc(label)}</span></div>`;
}

/** How a frame sits in a 16:9 card: wide scope frames are letterboxed, near-16:9 fills, tall frames are pillarboxed. */
export function fitFor(w, h) {
  const W = int(w);
  const H = int(h);
  if (!W || !H) return 'cover';
  const r = W / H;
  if (r > 1.9) return 'contain';
  if (r < 1.45) return 'contain';
  return 'cover';
}

/**
 * Grid spans for the default ("전체") works view on ≥1100px (12 columns).
 * Rows are [6,6], [12] or [4,4,4]; featured prefer 6 (or 12), others 4. A tiny DP picks the tidiest
 * layout that keeps DOM order. Filtered views ignore this and use a uniform 3-up grid (CSS).
 */
export function workSpans(works) {
  const n = works.length;
  const feat = works.map((w) => Boolean(w.featured));
  const memo = new Array(n + 1).fill(null);
  memo[n] = { cost: 0, spans: [] };
  for (let i = n - 1; i >= 0; i--) {
    const options = [];
    const rest = (k) => memo[i + k];
    const last = (k) => i + k === n;
    // [12]
    options.push({ cost: (feat[i] ? 0.5 : 5) + rest(1).cost, spans: [12, ...rest(1).spans] });
    if (i + 1 < n) {
      // [6,6]
      options.push({ cost: (feat[i] ? 0 : 1) + (feat[i + 1] ? 0 : 1) + rest(2).cost, spans: [6, 6, ...rest(2).spans] });
    }
    if (i + 2 < n && !feat[i] && !feat[i + 1] && !feat[i + 2]) {
      options.push({ cost: rest(3).cost, spans: [4, 4, 4, ...rest(3).spans] });
    }
    // incomplete final rows of normal cards
    if (!feat[i] && last(1)) options.push({ cost: 1.2, spans: [4] });
    if (i + 1 < n && !feat[i] && !feat[i + 1] && last(2)) options.push({ cost: 0.8, spans: [4, 4] });
    options.sort((a, b) => a.cost - b.cost);
    memo[i] = options[0];
  }
  return memo[0].spans;
}

/** Work card for the home grid. */
export function workCard(root, work, span = 4) {
  const media = work.media || {};
  const poster = media.poster;
  const preview = media.preview;
  const featured = Boolean(work.featured);
  const sizes =
    span === 12
      ? '(min-width: 1440px) 1344px, (min-width: 640px) 92vw, 100vw'
      : span === 6
        ? '(min-width: 1440px) 664px, (min-width: 640px) 46vw, 100vw'
        : '(min-width: 1440px) 440px, (min-width: 1100px) 30vw, (min-width: 640px) 46vw, 100vw';
  const fit = poster ? fitFor(poster.w, poster.h) : 'cover';
  const meta = metaHtml([work.categoryLabel, work.year]);
  const img = poster
    ? `<img class="work-card__poster"${attrs({
        src: assetUrl(root, poster.src),
        srcset: srcsetOf(root, poster),
        sizes: srcsetOf(root, poster) ? sizes : null,
        alt: '',
        loading: 'lazy',
        decoding: 'async',
        width: int(poster.w) || 1920,
        height: int(poster.h) || 1080,
      })}>`
    : mediaEmpty();

  return `<li${attrs({
    class: `work-grid__item work-grid__item--span-${span}`,
    'data-work-item': true,
    'data-category': work.category,
    'data-featured': featured,
  })} data-reveal>
        <a${attrs({ class: 'work-card', href: `${root}${work.url || ''}`, 'data-preview-src': preview ? assetUrl(root, preview.src) : null })}>
          <div class="work-card__media" data-preview-host${attrs({ 'data-fit': fit, style: `--media-ar: ${ratio(poster?.w, poster?.h)}` })}>
            ${img}
          </div>
          <div class="work-card__body">
            ${meta ? `<p class="work-card__meta meta label${hasHangul(work.categoryLabel) ? ' label--ko' : ''}">${meta}</p>` : ''}
            <h3 class="work-card__title">${esc(work.title)}${icons.arrowRight('work-card__arrow')}</h3>
            ${filled(work.client) || filled(work.summary) ? `<p class="work-card__client">${esc(filled(work.client) ? work.client : work.summary)}</p>` : ''}
          </div>
        </a>
      </li>`;
}

/**
 * Before/After comparison figure.
 * opts: { title, sizes, captionHtml (already-escaped html for figcaption; '' = none), index }
 */
export function compareFigure(root, comparison, { title = '', sizes = '100vw', captionHtml = '', lazy = true } = {}) {
  if (!comparison || !comparison.before || !comparison.after) return '';
  const { before, after, video } = comparison;
  const beforeLabel = filled(comparison.beforeLabel) ? comparison.beforeLabel : 'BEFORE';
  const afterLabel = filled(comparison.afterLabel) ? comparison.afterLabel : 'AFTER';
  const w = int(after.w) || int(before.w);
  const h = int(after.h) || int(before.h);
  const img = (image, cls, alt) =>
    `<img${attrs({
      class: `compare__img ${cls}`,
      src: assetUrl(root, image.src),
      srcset: srcsetOf(root, image),
      sizes: srcsetOf(root, image) ? sizes : null,
      alt,
      width: int(image.w) || w || 1920,
      height: int(image.h) || h || 1080,
      loading: lazy ? 'lazy' : null,
      decoding: 'async',
      draggable: 'false',
    })}>`;
  const hasVideo = video && filled(video.src);
  const titled = (label) => (filled(title) ? `${label}: ${title}` : label);

  const ar = w && h ? Math.round((w / h) * 10000) / 10000 : 1.7778;
  return `<figure${attrs({ class: `compare${hasVideo ? ' compare--video' : ''}`, 'data-compare': true, 'data-compare-video': hasVideo ? assetUrl(root, video.src) : null, style: `--ar: ${ar}` })}>
  <div class="compare__frame" data-compare-frame${attrs({ style: `--pos: 50%; aspect-ratio: ${ratio(w, h)}` })}>
    ${img(after, 'compare__img--after', titled(afterLabel))}
    <div class="compare__before" data-compare-before>
      ${img(before, 'compare__img--before', titled(beforeLabel))}
    </div>
    ${hasVideo ? '<canvas class="compare__canvas" data-compare-canvas aria-hidden="true"></canvas>' : ''}
    <input class="compare__range" type="range" min="0" max="100" step="0.5" value="50" data-compare-range${attrs({ 'aria-label': `비포·애프터 비교 — 왼쪽 ${beforeLabel}, 오른쪽 ${afterLabel}` })}>
    <div class="compare__handle" data-compare-handle aria-hidden="true"><span class="compare__grip">${icons.chevrons()}</span></div>
    <span class="compare__label compare__label--before" aria-hidden="true">${esc(beforeLabel)}</span>
    <span class="compare__label compare__label--after" aria-hidden="true">${esc(afterLabel)}</span>
    ${hasVideo ? `<button class="compare__play" type="button" data-compare-play aria-pressed="false">${icons.play('compare__icon-play')}${icons.pause('compare__icon-pause')}<span>영상 비교 재생</span></button>` : ''}
  </div>
  ${captionHtml ? `<figcaption class="compare__caption">${captionHtml}</figcaption>` : ''}
</figure>`;
}

/** Bulleted list helper */
export function bulletList(items, cls = 'bullets') {
  const list = arr(items).filter(filled);
  if (!list.length) return '';
  return `<ul class="${esc(cls)}">${list.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}
