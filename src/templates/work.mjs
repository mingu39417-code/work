// Work detail page (site/works/<slug>/index.html).
import { esc, krText, attrs, arr, filled, int, assetUrl, srcsetOf, pickSrc, ratio, externalAttrs, pad2, metaHtml, hasHangul } from './util.mjs';
import { icons } from './icons.mjs';
import { documentShell, kmongButton } from './layout.mjs';
import { compareFigure, mediaEmpty } from './components.mjs';

const PLAYER_SIZES = '(min-width: 1440px) 1344px, 100vw';

function player(root, work) {
  const media = work.media || {};
  const poster = media.poster && filled(media.poster.src) ? media.poster : null;
  const embed = media.embed && filled(media.embed.embedUrl) ? media.embed : null;
  const main = media.main && filled(media.main.src) ? media.main : null;
  const { w, h } = frameSize(media);
  const alt = filled(work.alt) ? work.alt : `${work.title} 컬러 그레이딩 장면`;
  const posterImg = (extra = {}) =>
    poster
      ? `<img${attrs({
          class: 'work-player__poster',
          src: assetUrl(root, poster.src),
          srcset: srcsetOf(root, poster) || null,
          sizes: srcsetOf(root, poster) ? PLAYER_SIZES : null,
          alt,
          width: int(poster.w) || w,
          height: int(poster.h) || h,
          fetchpriority: 'high',
          decoding: 'async',
          ...extra,
        })}>`
      : '';

  let inner;
  let kind;
  if (embed) {
    kind = 'embed';
    const href = embed.pageUrl || embed.embedUrl;
    inner = `<a${attrs({
      class: 'work-player__facade',
      href,
      ...externalAttrs(href),
      'data-embed-facade': true,
      'data-embed-src': embed.embedUrl,
      'data-embed-title': work.title,
      'data-track': 'work_play',
    })}>
      ${posterImg({ alt: '' }) || mediaEmpty('VIDEO')}
      <span class="work-player__play"><span class="work-player__play-icon" aria-hidden="true">${icons.play()}</span><span class="work-player__play-text">재생</span><span class="sr-only">: ${esc(work.title)} (${esc(embed.type === 'youtube' ? 'YouTube' : 'Vimeo')})</span></span>
    </a>`;
  } else if (main) {
    kind = 'video';
    inner = `<video${attrs({
      class: 'work-player__video',
      controls: true,
      playsinline: true,
      preload: 'metadata',
      // a poster attribute takes one URL (no srcset): the 1280 WebP, not the ≤1920 JPEG — same choice as the hero.
      // It is the page's LCP image, so renderWork() preloads exactly this URL.
      poster: videoPosterUrl(root, poster),
      width: w,
      height: h,
      'aria-label': `${work.title} 영상`,
    })}><source${attrs({ src: assetUrl(root, main.src), type: 'video/mp4' })}></video>`;
  } else {
    kind = 'still';
    inner = posterImg() || mediaEmpty();
  }
  return `<div${attrs({ class: `work-player work-player--${kind}`, style: `aspect-ratio: ${ratio(w, h)}` })}>
    ${inner}
  </div>`;
}

/**
 * Pixel size of the player box.
 * - self-hosted video: main.mp4 (never cropped — baked-in letterbox bars stay part of the file).
 * - embed (Vimeo/YouTube): the hosted video keeps the master's own frame too, so when the media tool cut
 *   baked-in bars off the poster, poster.frame (the uncropped source size) sizes the box, not the 2.39:1 poster.
 * - still: the (cropped) poster itself.
 */
function frameSize(media = {}) {
  const main = media.main && filled(media.main.src) ? media.main : null;
  const poster = media.poster && filled(media.poster.src) ? media.poster : null;
  const embed = media.embed && filled(media.embed.embedUrl) ? media.embed : null;
  if (main && int(main.w) && int(main.h)) return { w: int(main.w), h: int(main.h) };
  if (embed && poster?.frame && int(poster.frame.w) && int(poster.frame.h)) return { w: int(poster.frame.w), h: int(poster.frame.h) };
  return { w: int(poster?.w) || 1920, h: int(poster?.h) || 1080 };
}

/** Frame aspect ratio of the player (drives the height cap of the player and of the block around it). */
function playerRatio(work) {
  const { w, h } = frameSize(work.media || {});
  return Math.round((w / h) * 10000) / 10000;
}

function videoPosterUrl(root, poster) {
  return poster ? pickSrc(root, poster, 1280) : null;
}

/** true when the player is the self-hosted <video> (no embed): its poster attribute is the LCP image. */
function isSelfHostedVideo(media) {
  return Boolean(media.main && filled(media.main.src) && !(media.embed && filled(media.embed.embedUrl)));
}

/** Spec rows. The English term is the visual label; screen readers get the Korean name (the term is the value's only label). */
function specs(work) {
  const rows = [
    ['CLIENT', '의뢰처', work.client],
    ['CATEGORY', '분류', work.categoryLabel],
    ['YEAR', '연도', work.year],
    ['ROLE', '담당', filled(work.role) ? work.role : '컬러 그레이딩'],
    ['CAMERA', '카메라', work.camera],
  ].filter(([, , v]) => filled(v === null || v === undefined ? '' : String(v)));
  return rows
    .map(([en, ko, v]) => `<div class="spec__row"><dt class="label"><span aria-hidden="true">${esc(en)}</span><span class="sr-only">${esc(ko)}</span></dt><dd>${esc(v)}</dd></div>`)
    .join('');
}

export function renderWork(vm) {
  const root = vm.paths?.root ?? '../../';
  const homeUrl = vm.homeUrl || root || '../../';
  const work = vm.work || {};
  const media = work.media || {};
  const notes = arr(work.notes).filter(filled);
  const credits = arr(work.credits).filter((c) => c && (filled(c.role) || filled(c.name)));
  const comparisons = arr(media.comparisons).filter((c) => c && c.before && c.after);
  const stills = arr(media.stills).filter((s) => s && filled(s.src));
  const meta = metaHtml([work.categoryLabel, work.year, work.client]);
  const specRows = specs(work);
  const kmong = kmongButton(vm);

  const details =
    notes.length || specRows || credits.length
      ? `<section${attrs({ class: `work-details${notes.length ? '' : ' work-details--facts-only'}` })} aria-label="작업 정보">
      ${
        notes.length
          ? `<div class="work-details__notes" data-reveal>
        <p class="work-block__label label" lang="en">GRADE NOTES</p>
        ${notes.map((p) => `<p>${krText(p)}</p>`).join('\n        ')}
      </div>`
          : ''
      }
      <div class="work-details__side" data-reveal>
        ${specRows ? `<div class="spec-block">${notes.length ? '' : '<p class="work-block__label label" lang="en">DETAILS</p>'}<dl class="spec">${specRows}</dl></div>` : ''}
        ${
          credits.length
            ? `<div class="credits"><p class="work-block__label label" lang="en">CREDITS</p><dl class="credits__list">${credits
                .map((c) => `<div class="credits__row"><dt>${esc(c.role)}</dt><dd>${esc(c.name)}</dd></div>`)
                .join('')}</dl></div>`
            : ''
        }
      </div>
    </section>`
      : '';

  const compareBlock = comparisons.length
    ? `<section class="work-section work-section--compare" aria-labelledby="work-compare-title">
      <div class="work-section__head" data-reveal>
        <p class="label" lang="en">BEFORE / AFTER</p>
        <h2 class="work-section__title" id="work-compare-title">비포 · 애프터</h2>
        <p class="work-section__aside label" aria-hidden="true">DRAG TO COMPARE</p>
      </div>
      <div class="work-compare">
        ${comparisons
          .map((c, i) => {
            const caption = `<span class="compare__index label">${esc(pad2(i + 1))}${comparisons.length > 1 ? ` / ${esc(pad2(comparisons.length))}` : ''}</span>${
              filled(c.caption) ? `<span class="compare__text"><span class="compare__desc">${esc(c.caption)}</span></span>` : ''
            }`;
            return `<div class="work-compare__item" data-reveal>${compareFigure(root, c, { title: work.title, sizes: PLAYER_SIZES, captionHtml: caption })}</div>`;
          })
          .join('\n        ')}
      </div>
    </section>`
    : '';

  const stillsBlock = stills.length
    ? `<section class="work-section work-section--stills" aria-labelledby="work-stills-title">
      <div class="work-section__head" data-reveal>
        <p class="label" lang="en">STILLS</p>
        <h2 class="work-section__title" id="work-stills-title">스틸 컷</h2>
        <p class="work-section__aside label" aria-hidden="true">${esc(pad2(stills.length))} FRAMES</p>
      </div>
      <ul${attrs({ class: `stills stills--${stills.length === 1 ? 'single' : 'multi'}` })}>
        ${stills
          .map((s, i) => {
            const wide = stills.length % 2 === 1 && i === 0;
            return `<li${attrs({ class: `stills__item${wide ? ' stills__item--wide' : ''}` })} data-reveal><img${attrs({
              src: assetUrl(root, s.src),
              srcset: srcsetOf(root, s) || null,
              sizes: srcsetOf(root, s) ? (wide || stills.length === 1 ? PLAYER_SIZES : '(min-width: 1440px) 664px, (min-width: 700px) 48vw, 100vw') : null,
              alt: filled(s.alt) ? s.alt : `${work.title} 스틸 ${i + 1}`,
              width: int(s.w) || 1920,
              height: int(s.h) || 1080,
              loading: 'lazy',
              decoding: 'async',
            })}></li>`;
          })
          .join('\n        ')}
      </ul>
    </section>`
    : '';

  const pager =
    vm.prev || vm.next
      ? `<nav class="work-pager" aria-label="다른 작업">
      ${
        vm.prev
          ? `<a class="work-pager__link work-pager__link--prev"${attrs({ href: vm.prev.url })} rel="prev"><span class="label">${icons.arrowLeft()}<span aria-hidden="true">PREV</span><span class="sr-only">이전 작업: </span></span><span class="work-pager__title">${esc(vm.prev.title)}</span></a>`
          : '<span class="work-pager__link work-pager__link--empty" aria-hidden="true"></span>'
      }
      ${
        vm.next
          ? `<a class="work-pager__link work-pager__link--next"${attrs({ href: vm.next.url })} rel="next"><span class="label"><span aria-hidden="true">NEXT</span><span class="sr-only">다음 작업: </span>${icons.arrowRight()}</span><span class="work-pager__title">${esc(vm.next.title)}</span></a>`
          : '<span class="work-pager__link work-pager__link--empty" aria-hidden="true"></span>'
      }
    </nav>`
      : '';

  // Above the fold, no data-reveal: the title and the player must paint without waiting for main.js.
  // Desktop: a compact band (back link + meta on one row, title) sits above a player sized to the remaining
  // viewport height, and the summary follows the player. Phones keep title → summary → player (CSS order).
  const main = `<article class="work">
  <div class="container">
    <div${attrs({ class: 'work-top', style: `--ar: ${playerRatio(work)}` })}>
      <header class="work-hero">
        <div class="work-hero__bar">
          <a class="back-link"${attrs({ href: `${homeUrl}#works` })}>${icons.arrowLeft()}전체 작업</a>
          ${meta ? `<p class="work-hero__meta meta label${hasHangul(`${work.categoryLabel}${work.client}`) ? ' label--ko' : ''}">${meta}</p>` : ''}
        </div>
        <h1 class="work-hero__title">${esc(work.title)}</h1>
      </header>
      ${player(root, work)}
      ${filled(work.summary) ? `<p class="work-top__summary">${krText(work.summary)}</p>` : ''}
    </div>
    ${details}
    ${compareBlock}
    ${stillsBlock}
    <aside class="work-cta" aria-label="문의" data-reveal>
      <p class="label" lang="en">NEXT PROJECT</p>
      <p class="work-cta__title">이런 톤이 필요하신가요?</p>
      <p class="work-cta__lead">촬영 소스와 원하시는 분위기를 알려주시면 작업 범위와 일정, 견적을 안내해 드립니다.</p>
      <div class="work-cta__actions">
        <a class="button button--primary"${attrs({ href: `${homeUrl}#contact` })} data-track="cta_contact">프로젝트 문의하기${icons.arrowRight()}</a>
        ${kmong}
      </div>
    </aside>
    ${pager}
  </div>
</article>`;

  const poster = media.poster && filled(media.poster.src) ? media.poster : null;
  let preload = '';
  if (poster && isSelfHostedVideo(media)) {
    // same URL string as the <video poster> attribute, or the browser fetches it twice
    preload = `<link rel="preload" as="image" fetchpriority="high"${attrs({ href: videoPosterUrl(root, poster) })}>`;
  } else if (poster) {
    preload = `<link rel="preload" as="image" fetchpriority="high"${attrs({
      href: assetUrl(root, poster.src),
      imagesrcset: srcsetOf(root, poster) || null,
      imagesizes: srcsetOf(root, poster) ? PLAYER_SIZES : null,
    })}>`;
  }

  return documentShell(vm, { page: 'work', head: preload, main });
}

