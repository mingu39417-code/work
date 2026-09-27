// Reusable template fragments: section heads, work cards, before/after compare, media placeholders.
import { esc, krText, attrs, arr, filled, int, assetUrl, srcsetOf, pickSrc, ratio, pad2, labelClass, langAttr, metaHtml, hasHangul } from './util.mjs';
import { icons, brandMark } from './icons.mjs';

/**
 * Section heading block.
 *  num: render-order number (1-based) or null; eyebrow: mono label; aside: optional small mono text at the right.
 */
export function sectionHead({ id, num, eyebrow, title, lead, aside = '', level = 2 }) {
  const heading = filled(title) ? title : eyebrow;
  const tag = `h${level}`;
  return `<header class="section-head" data-reveal>
    <p class="${labelClass(eyebrow, 'section-head__eyebrow label')}">${num ? `<span class="section-head__num">${esc(pad2(num))}</span><span class="section-head__dash" aria-hidden="true"></span>` : ''}<span${langAttr(eyebrow)}>${esc(eyebrow)}</span></p>
    <${tag} class="section-head__title" id="${esc(id)}-title">${esc(heading)}</${tag}>
    ${filled(lead) ? `<p class="section-head__lead">${krText(lead)}</p>` : ''}
    ${filled(aside) ? `<p class="section-head__aside label" aria-hidden="true">${esc(aside)}</p>` : ''}
  </header>`;
}

/** Neutral "no media" placeholder (only reachable in preview builds — published works always have a poster). */
export function mediaEmpty(label = 'NO MEDIA') {
  return `<div class="media-empty" aria-hidden="true">${brandMark('media-empty__mark', 32)}<span class="label">${esc(label)}</span></div>`;
}

/**
 * How a frame sits in a 16:9 card: wide scope frames are letterboxed, near-16:9 fills, 4:3-ish frames are
 * pillarboxed ('contain'). Portrait frames (9:16 shorts, 4:5 feed ads) are 'tall': shown whole, over a dimmed,
 * blurred fill of their own poster — a bare 9:16 strip in a black 16:9 box reads as a broken thumbnail.
 */
export function fitFor(w, h) {
  const W = int(w);
  const H = int(h);
  if (!W || !H) return 'cover';
  const r = W / H;
  if (r > 1.9) return 'contain';
  if (r < 1) return 'tall';
  if (r < 1.45) return 'contain';
  return 'cover';
}

/** Short label for a portrait frame ('9:16', '4:5' …) shown on the card; 'VERTICAL' when no common ratio fits. */
export function portraitRatioLabel(w, h) {
  const r = int(w) / int(h);
  const known = [
    [9, 16],
    [2, 3],
    [3, 4],
    [4, 5],
    [1, 2],
  ];
  const [a, b] = known.reduce((best, k) => (Math.abs(k[0] / k[1] - r) < Math.abs(best[0] / best[1] - r) ? k : best));
  return Math.abs(a / b - r) <= 0.02 ? `${a}:${b}` : 'VERTICAL';
}

/**
 * Grid spans for the default ("전체") works view on ≥1100px (12 columns).
 * Every row is complete — [6,6], [12] or [4,4,4] — so no count of works (1, 2, 4, 7 …) leaves a lone card
 * or a two-thirds-empty last row. Featured prefer 6 (or 12), others 4. A tiny DP picks the tidiest layout
 * that keeps DOM order (e.g. 1 → [12], 2 → [6,6], 4 → [6,6][6,6], 7 → [6,6][6,6][4,4,4]).
 * Filtered views ignore this and use a uniform 3-up grid (CSS).
 */
export function workSpans(works) {
  const n = works.length;
  const feat = works.map((w) => Boolean(w.featured));
  const memo = new Array(n + 1).fill(null);
  memo[n] = { cost: 0, spans: [] };
  for (let i = n - 1; i >= 0; i--) {
    const options = [];
    const rest = (k) => memo[i + k];
    // [12]
    options.push({ cost: (feat[i] ? 0.5 : 5) + rest(1).cost, spans: [12, ...rest(1).spans] });
    if (i + 1 < n) {
      // [6,6]
      options.push({ cost: (feat[i] ? 0 : 1) + (feat[i + 1] ? 0 : 1) + rest(2).cost, spans: [6, 6, ...rest(2).spans] });
    }
    if (i + 2 < n && !feat[i] && !feat[i + 1] && !feat[i + 2]) {
      options.push({ cost: rest(3).cost, spans: [4, 4, 4, ...rest(3).spans] });
    }
    options.sort((a, b) => a.cost - b.cost);
    memo[i] = options[0];
  }
  return memo[0].spans;
}

/**
 * 2-up layouts where some items take a full row: `fullRow[i]` true = item i spans the row, false = half a row.
 * Half-row items between full-row ones pair up in DOM order; returns, per item, whether it would sit alone
 * (the last of an odd run) — callers widen those instead of leaving an empty half row.
 * Used for the works grid at 640–1099px (span-12 cards are full rows) and the home before/after list.
 */
export function loneInPairs(fullRow) {
  const lone = fullRow.map(() => false);
  let run = 0;
  fullRow.forEach((full, i) => {
    if (full) {
      run = 0;
      return;
    }
    run += 1;
    const endsRun = i === fullRow.length - 1 || fullRow[i + 1];
    if (endsRun && run % 2 === 1) lone[i] = true;
  });
  return lone;
}

/**
 * Work card for the home grid.
 *  span: 12 | 6 | 4 on ≥1100px (see workSpans); mdFull: card takes the full row at 640–1099px (see loneInPairs).
 */
export function workCard(root, work, span = 4, { mdFull = false } = {}) {
  const media = work.media || {};
  const poster = media.poster;
  const preview = media.preview;
  const featured = Boolean(work.featured);
  const md = mdFull ? '92vw' : '46vw';
  const sizes =
    span === 12
      ? '(min-width: 1440px) 1344px, (min-width: 640px) 92vw, 100vw'
      : span === 6
        ? `(min-width: 1440px) 664px, (min-width: 1100px) 46vw, (min-width: 640px) ${md}, 100vw`
        : `(min-width: 1440px) 440px, (min-width: 1100px) 30vw, (min-width: 640px) ${md}, 100vw`;
  const fit = poster ? fitFor(poster.w, poster.h) : 'cover';
  // wide scope frame (e.g. 2.39:1 once the media tool cut the letterbox bars off): a card that has its row to
  // itself takes the frame's own ratio instead of letterboxing it again (CSS decides where; see .work-card__media--wide)
  const posterRatio = poster && int(poster.w) && int(poster.h) ? int(poster.w) / int(poster.h) : 0;
  const wideRow = fit === 'contain' && posterRatio > 1.9;
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
  const tall = fit === 'tall';
  // decorative fill behind a portrait frame: the smallest poster variant, blurred and dimmed in CSS
  const backdrop = tall
    ? `<img class="work-card__backdrop"${attrs({
        src: pickSrc(root, poster, 640),
        alt: '',
        'aria-hidden': 'true',
        loading: 'lazy',
        decoding: 'async',
        width: int(poster.w),
        height: int(poster.h),
      })}>`
    : '';
  const ratioBadge = tall ? `<span class="work-card__ratio label" aria-hidden="true">${esc(portraitRatioLabel(poster.w, poster.h))}</span>` : '';

  return `<li${attrs({
    class: `work-grid__item work-grid__item--span-${span}${mdFull && span !== 12 ? ' work-grid__item--md-full' : ''}`,
    'data-work-item': true,
    'data-category': work.category,
    'data-featured': featured,
  })} data-reveal>
        <a${attrs({ class: 'work-card', href: `${root}${work.url || ''}`, 'data-preview-src': preview ? assetUrl(root, preview.src) : null })}>
          <div${attrs({ class: `work-card__media${wideRow ? ' work-card__media--wide' : ''}`, style: wideRow ? `--card-ar: ${Math.round(Math.min(posterRatio, 3) * 10000) / 10000}` : null })} data-preview-host${attrs({ 'data-fit': fit })}>
            ${backdrop}${img}${ratioBadge}
          </div>
          <div class="work-card__body">
            ${meta ? `<p class="work-card__meta meta label${hasHangul(work.categoryLabel) ? ' label--ko' : ''}">${meta}</p>` : ''}
            <h3 class="work-card__title">${esc(work.title)}${icons.arrowRight('work-card__arrow')}</h3>
            ${filled(work.client) || filled(work.summary) ? `<p class="work-card__client">${krText(filled(work.client) ? work.client : work.summary)}</p>` : ''}
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
    <input class="compare__range" type="range" min="0" max="100" step="1" value="50" data-compare-range${attrs({ 'aria-label': `비포·애프터 비교 — 왼쪽 ${beforeLabel}, 오른쪽 ${afterLabel}` })}>
    <div class="compare__handle" data-compare-handle aria-hidden="true"><span class="compare__grip">${icons.chevrons()}</span></div>
    <span class="${labelClass(beforeLabel, 'compare__label compare__label--before')}" aria-hidden="true">${esc(beforeLabel)}</span>
    <span class="${labelClass(afterLabel, 'compare__label compare__label--after')}" aria-hidden="true">${esc(afterLabel)}</span>
    ${hasVideo ? `<button class="compare__play" type="button" data-compare-play aria-pressed="false">${icons.play('compare__icon-play')}${icons.pause('compare__icon-pause')}<span>영상 비교 재생</span></button>` : ''}
  </div>
  ${captionHtml ? `<figcaption class="compare__caption">${captionHtml}</figcaption>` : ''}
</figure>`;
}

/** Bulleted list helper */
export function bulletList(items, cls = 'bullets') {
  const list = arr(items).filter(filled);
  if (!list.length) return '';
  return `<ul class="${esc(cls)}">${list.map((t) => `<li>${krText(t)}</li>`).join('')}</ul>`;
}
