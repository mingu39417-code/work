// Home page: hero → works → compare → services → process → formats → packages → about → faq → contact.
import { esc, krText, attrs, arr, filled, int, assetUrl, linkHref, srcsetOf, pickSrc, externalAttrs, joinParts, pad2, labelClass, langAttr, hasHangul } from './util.mjs';
import { icons, vectorscope } from './icons.mjs';
import { documentShell, contactLinks, kmongButton } from './layout.mjs';
import { sectionHead, workCard, workSpans, loneInPairs, compareFigure, bulletList } from './components.mjs';

// ---------------------------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------------------------

function heroParts(vm) {
  const root = vm.paths?.root ?? '';
  const reel = vm.reel || {};
  const hasLoop = Boolean(reel.loop && filled(reel.loop.src));
  const poster = reel.poster && filled(reel.poster.src) ? reel.poster : null;
  return { root, reel, hasLoop, poster };
}

/** <link rel=preload> for the hero image (poster of the loop, or the still poster). */
function heroPreload(vm) {
  const { root, hasLoop, poster } = heroParts(vm);
  if (!poster) return '';
  if (hasLoop) {
    return `<link rel="preload" as="image" fetchpriority="high"${attrs({ href: pickSrc(root, poster, 1280) })}>`;
  }
  const srcset = srcsetOf(root, poster);
  return `<link rel="preload" as="image" fetchpriority="high"${attrs({
    href: assetUrl(root, poster.src),
    imagesrcset: srcset || null,
    imagesizes: srcset ? '100vw' : null,
  })}>`;
}

function hero(vm) {
  const site = vm.site || {};
  const h = site.hero || {};
  const { root, reel, hasLoop, poster } = heroParts(vm);
  const lines = arr(h.title).filter(filled);
  const title = lines.length ? lines : [site.brand?.name || 'TONECRAFT'];

  let media;
  let variant;
  if (hasLoop) {
    variant = 'reel';
    media = `<video class="hero__video" data-hero-video muted loop playsinline preload="none" aria-hidden="true" tabindex="-1"${attrs({
      poster: poster ? pickSrc(root, poster, 1280) : null,
      'data-src': assetUrl(root, reel.loop.src),
      'data-fps': Number(reel.fps) > 0 ? Number(reel.fps) : 24,
      width: int(reel.loop.w) || 1280,
      height: int(reel.loop.h) || 720,
    })}></video>`;
  } else if (poster) {
    variant = 'poster';
    const srcset = srcsetOf(root, poster);
    media = `<img class="hero__poster"${attrs({
      src: assetUrl(root, poster.src),
      srcset: srcset || null,
      sizes: srcset ? '100vw' : null,
      alt: '',
      fetchpriority: 'high',
      decoding: 'async',
      width: int(poster.w) || 1920,
      height: int(poster.h) || 1080,
    })}>`;
  } else {
    variant = 'graphic';
    media = `<div class="hero__graphic" aria-hidden="true">
      ${vectorscope('trace', 'hero__scope')}
      <span class="hero__crop hero__crop--tl"></span><span class="hero__crop hero__crop--tr"></span><span class="hero__crop hero__crop--bl"></span><span class="hero__crop hero__crop--br"></span>
    </div>`;
  }

  // Reel CTA — only when there is something to open.
  const embed = reel.embed && filled(reel.embed.embedUrl) ? reel.embed : null;
  const full = reel.full && filled(reel.full.src) ? reel.full : null;
  let reelCta = '';
  if (embed || full) {
    const reelLabel = filled(h.reelCta?.label) ? h.reelCta.label : '쇼릴 보기';
    const a = embed
      ? { href: embed.pageUrl || embed.embedUrl, ...externalAttrs(embed.pageUrl || embed.embedUrl), 'data-video-embed': embed.embedUrl }
      : { href: assetUrl(root, full.src), 'data-video-src': assetUrl(root, full.src) };
    reelCta = `<a${attrs({
      class: 'button button--ghost button--reel',
      ...a,
      'data-video-open': true,
      'data-video-poster': poster ? pickSrc(root, poster, 1280) : null,
      'data-video-title': filled(reel.title) ? reel.title : null,
      'data-track': 'reel_open',
    })}><span class="button__icon">${icons.play()}</span>${esc(reelLabel)}${reel.full?.duration ? `<span class="button__meta">${esc(formatDuration(reel.full.duration))}</span>` : ''}</a>`;
  }

  // Without a reel, offer a second path into the work itself.
  if (!reelCta && arr(vm.works).length) {
    reelCta = `<a class="button button--ghost"${attrs({ href: `${root}#works` })} data-track="hero_works">작업 보기${icons.arrowDown()}</a>`;
  }

  const primary = h.primaryCta || {};
  const primaryHref = linkHref(root, filled(primary.href) ? primary.href : '#contact');
  const primaryCta = `<a${attrs({ class: 'button button--primary', href: primaryHref, ...externalAttrs(primaryHref) })} data-track="cta_contact">${esc(filled(primary.label) ? primary.label : '프로젝트 문의하기')}${icons.arrowRight()}</a>`;

  const meta = hasLoop
    ? `<div class="hero__meta">
      <p class="hero__tc"><span class="hero__tc-label" aria-hidden="true">TC</span><span class="timecode" data-timecode aria-hidden="true">00:00:00:00</span></p>
      <button class="hero__toggle" type="button" data-hero-toggle aria-pressed="true" aria-label="배경 영상 일시정지">${icons.pause('hero__icon-pause')}${icons.play('hero__icon-play')}</button>
    </div>`
    : variant === 'graphic'
      ? `<div class="hero__readout label" aria-hidden="true"><span>VECTORSCOPE</span><span>REC.709</span><span>75%</span></div>`
      : '';

  return `<section${attrs({ class: `hero hero--${variant}` })} data-hero data-state="paused"${attrs({ 'aria-label': variant === 'reel' ? '쇼릴' : '인트로' })}>
  <div class="hero__media">
    ${media}
  </div>
  <div class="hero__content">
    <div class="hero__inner">
      ${heroEyebrow(h.eyebrow)}
      <h1 class="hero__title">${title.map((line) => `<span class="hero__line">${esc(line)}</span>`).join(' ')}</h1>
      ${filled(h.lead) ? `<p class="hero__lead">${krText(h.lead)}</p>` : ''}
      <div class="hero__actions">
        ${primaryCta}
        ${reelCta}
      </div>
    </div>
  </div>
  ${meta}
</section>`;
}

function heroEyebrow(eyebrow) {
  const text = filled(eyebrow) ? eyebrow : 'COLOR GRADING · DI';
  return `<p class="${labelClass(text, 'hero__eyebrow label')}"${langAttr(text)}><span class="hero__dot" aria-hidden="true"></span>${esc(text)}</p>`;
}

function formatDuration(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (!s) return '';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

const sectionCopy = (vm, key, fallbackEyebrow) => {
  const s = vm.site?.sections?.[key] || {};
  return { eyebrow: filled(s.eyebrow) ? s.eyebrow : fallbackEyebrow, title: s.title || '', lead: s.lead || '' };
};

/** Works empty state (0 published works — the launch state). Copy: site.sections.works.empty { title, body, cta }. */
const WORKS_EMPTY = {
  title: '작업물을 정리하고 있습니다.',
  body: '공개 동의를 받은 작업부터 차례로 올리고 있습니다. 프로젝트에 맞는 참고 자료가 필요하시면 문의해 주세요.',
  cta: '문의하기',
};

function worksEmptyCopy(vm) {
  const e = vm.site?.sections?.works?.empty || {};
  const pick = (key) => (filled(e[key]) ? e[key] : WORKS_EMPTY[key]);
  return { title: pick('title'), body: pick('body'), cta: pick('cta') };
}

function worksSection(vm, num) {
  const root = vm.paths?.root ?? '';
  const works = arr(vm.works);
  const cats = arr(vm.categories).filter((c) => c && Number(c.count) > 0);
  const copy = sectionCopy(vm, 'works', 'WORKS');
  const aside = works.length ? `${pad2(works.length)} ${works.length === 1 ? 'PROJECT' : 'PROJECTS'}` : '';
  let body;
  if (!works.length) {
    copy.lead = ''; // the lead describes the list ('장르별로 정리한 …'), which the empty state contradicts
    const empty = worksEmptyCopy(vm);
    body = `<div class="works-empty" data-reveal>
      <div class="works-empty__frame" aria-hidden="true">
        <span class="works-empty__corner works-empty__corner--tl"></span><span class="works-empty__corner works-empty__corner--tr"></span><span class="works-empty__corner works-empty__corner--bl"></span><span class="works-empty__corner works-empty__corner--br"></span>
        <span class="label">COMING SOON</span>
      </div>
      <div class="works-empty__text">
        <p class="works-empty__title">${krText(empty.title)}</p>
        <p>${krText(empty.body)}</p>
        <a class="button button--primary"${attrs({ href: `${root}#contact` })} data-track="cta_contact">${esc(empty.cta)}${icons.arrowRight()}</a>
      </div>
    </div>`;
  } else {
    const filters =
      cats.length >= 2
        ? `<div class="filters" data-filters role="group" aria-label="카테고리 필터">
      <button class="filter" type="button" data-filter="all" aria-pressed="true">전체 <span class="filter__count">${esc(works.length)}</span></button>
      ${cats
        .map(
          (c) =>
            `<button class="filter" type="button"${attrs({ 'data-filter': c.id })} aria-pressed="false">${esc(c.label)} <span class="filter__count">${esc(c.count)}</span></button>`,
        )
        .join('\n      ')}
    </div>
    <p class="sr-only" data-filter-status aria-live="polite"></p>`
        : '';
    const spans = workSpans(works);
    const lone = loneInPairs(spans.map((span) => span === 12)); // the 2-column tier (640–1099px)
    body = `${filters}
    <ul class="work-grid" data-work-grid>
      ${works.map((w, i) => workCard(root, w, spans[i], { mdFull: lone[i] })).join('\n      ')}
    </ul>`;
  }
  return `<section class="section section--works" id="works" aria-labelledby="works-title">
  <div class="container">
    ${sectionHead({ id: 'works', num, ...copy, aside })}
    ${body}
  </div>
</section>`;
}

function compareSection(vm, num) {
  const root = vm.paths?.root ?? '';
  const picks = arr(vm.comparisons).filter((p) => p && p.work && p.comparison);
  const copy = sectionCopy(vm, 'compare', 'BEFORE / AFTER');
  // Full-row ("wide") items: the first pick, and every pick that is not landscape (9:16, 4:3 …) — next to a
  // 16:9 pair it would make a ragged row with captions at different heights. Landscape picks pair up in
  // DOM order; one left alone between wide items is widened too.
  const ars = picks.map(({ comparison }) => {
    const size = comparison.after || comparison.before || {};
    return (int(size.w) || 1920) / (int(size.h) || 1080);
  });
  const fullRow = picks.map((p, i) => i === 0 || ars[i] < 1.5);
  const lone = loneInPairs(fullRow);
  const items = picks
    .map((p, i) => {
      const wide = fullRow[i] || lone[i];
      const sizes = wide ? '(min-width: 1440px) 1344px, 94vw' : '(min-width: 1440px) 660px, (min-width: 900px) 46vw, 94vw';
      const w = p.work;
      const caption = `<span class="compare__index label">${esc(pad2(i + 1))}</span>
      <span class="compare__text"><span class="compare__work">${esc(w.title)}</span>${filled(p.comparison.caption) ? `<span class="compare__desc">${esc(p.comparison.caption)}</span>` : ''}</span>
      <a class="compare__link"${attrs({ href: `${root}${w.url || ''}` })}>작업 보기${icons.arrowRight()}<span class="sr-only">: ${esc(w.title)}</span></a>`;
      return `<div${attrs({ class: `compare-list__item${wide ? ' compare-list__item--wide' : ''}` })} data-reveal>
      ${compareFigure(root, p.comparison, { title: w.title, sizes, captionHtml: caption })}
    </div>`;
    })
    .join('\n    ');
  return `<section class="section section--compare" id="compare" aria-labelledby="compare-title">
  <div class="container">
    ${sectionHead({ id: 'compare', num, ...copy, aside: 'DRAG TO COMPARE' })}
    <div class="compare-list">
    ${items}
    </div>
  </div>
</section>`;
}

function servicesSection(vm, num) {
  const services = arr(vm.site?.services).filter((s) => s && filled(s.title));
  const copy = sectionCopy(vm, 'services', 'SERVICES');
  const items = services
    .map(
      (s, i) => `<li class="service" data-reveal>
        <div class="service__index"><span class="service__num label">${esc(pad2(i + 1))}</span>${filled(s.en) ? `<span class="${labelClass(s.en, 'service__en label')}"${langAttr(s.en)}>${esc(s.en)}</span>` : ''}</div>
        <div class="service__main">
          <h3 class="service__title">${esc(s.title)}</h3>
          ${filled(s.summary) ? `<p class="service__summary">${krText(s.summary)}</p>` : ''}
        </div>
        ${bulletList(s.points, 'service__points bullets')}
      </li>`,
    )
    .join('\n      ');
  return `<section class="section section--services" id="services" aria-labelledby="services-title">
  <div class="container">
    ${sectionHead({ id: 'services', num, ...copy })}
    <ol class="services">
      ${items}
    </ol>
  </div>
</section>`;
}

/** Columns for the process timeline on wide screens: all in one row up to 5, then balanced rows. */
function processCols(n) {
  if (n <= 5) return Math.max(1, n);
  if (n === 6 || n === 9) return 3;
  return 4;
}

function processSection(vm, num) {
  const steps = arr(vm.site?.process).filter((s) => s && filled(s.title));
  const copy = sectionCopy(vm, 'process', 'PROCESS');
  const items = steps
    .map(
      (s, i) => `<li class="process__step" data-reveal>
        <p class="process__num label"><span lang="en">STEP</span> ${esc(pad2(i + 1))}</p>
        <h3 class="process__title">${esc(s.title)}</h3>
        ${filled(s.body) ? `<p class="process__body">${krText(s.body)}</p>` : ''}
      </li>`,
    )
    .join('\n      ');
  return `<section class="section section--process" id="process" aria-labelledby="process-title">
  <div class="container">
    ${sectionHead({ id: 'process', num, ...copy })}
    <ol${attrs({ class: 'process', style: `--cols: ${processCols(steps.length)}` })}>
      ${items}
    </ol>
  </div>
</section>`;
}

function formatsSection(vm, num) {
  const groups = arr(vm.site?.formats?.groups).filter((g) => g && (filled(g.title) || arr(g.items).length));
  const copy = sectionCopy(vm, 'formats', 'WORKFLOW');
  const items = groups
    .map(
      (g, i) => `<div class="formats__group" data-reveal>
        <dt class="formats__title"><span class="formats__num label">${esc(pad2(i + 1))}</span>${esc(g.title)}</dt>
        <dd class="formats__items"><ul class="chips">${arr(g.items)
          .filter(filled)
          .map((t) => `<li class="${hasHangul(t) ? 'chip chip--ko' : 'chip'}">${esc(t)}</li>`)
          .join('')}</ul></dd>
      </div>`,
    )
    .join('\n      ');
  return `<section class="section section--formats" id="formats" aria-labelledby="formats-title">
  <div class="container">
    ${sectionHead({ id: 'formats', num, ...copy })}
    <dl class="formats">
      ${items}
    </dl>
  </div>
</section>`;
}

function packagesSection(vm, num) {
  const root = vm.paths?.root ?? '';
  const packages = arr(vm.site?.packages).filter((p) => p && filled(p.name));
  const copy = sectionCopy(vm, 'packages', 'PRICING');
  const items = packages
    .map(
      (p, i) => `<li class="package" data-reveal>
        <p class="package__index label">${esc(pad2(i + 1))}</p>
        <h3 class="package__name">${esc(p.name)}</h3>
        ${filled(p.summary) ? `<p class="package__summary">${krText(p.summary)}</p>` : ''}
        ${filled(p.price) ? `<p class="package__price">${esc(p.price)}</p>` : ''}
        ${bulletList(p.includes, 'package__includes checks')}
        ${filled(p.note) ? `<p class="package__note">${krText(p.note)}</p>` : ''}
        <a class="button button--ghost button--sm package__cta"${attrs({ href: `${root}#contact` })} data-track="package_inquiry">이 구성으로 문의${icons.arrowRight()}</a>
      </li>`,
    )
    .join('\n      ');
  return `<section class="section section--packages" id="packages" aria-labelledby="packages-title">
  <div class="container">
    ${sectionHead({ id: 'packages', num, ...copy })}
    <ul${attrs({ class: `packages${packages.length === 1 ? ' packages--single' : ''}` })}>
      ${items}
    </ul>
  </div>
</section>`;
}

function aboutSection(vm, num) {
  const root = vm.paths?.root ?? '';
  const about = vm.site?.about || {};
  const brand = vm.site?.brand || {};
  const paragraphs = arr(about.paragraphs).filter(filled);
  const facts = arr(about.facts).filter((f) => f && (filled(f.label) || filled(f.value)));
  const copy = sectionCopy(vm, 'about', 'ABOUT');
  const portrait = filled(about.portrait)
    ? `<figure class="about__portrait"><img${attrs({
        src: assetUrl(root, about.portrait),
        alt: joinParts([brand.person, brand.role], ' — ') || '프로필 사진',
        loading: 'lazy',
        decoding: 'async',
        width: 960,
        height: 1200,
      })}></figure>`
    : '';
  const name = filled(brand.person)
    ? `<p class="about__name"><span class="about__person">${esc(brand.person)}</span>${filled(brand.role) ? `<span class="${labelClass(brand.role, 'about__role label')}">${esc(brand.role)}</span>` : ''}</p>`
    : '';
  return `<section class="section section--about" id="about" aria-labelledby="about-title">
  <div class="container">
    ${sectionHead({ id: 'about', num, ...copy })}
    <div${attrs({ class: `about${portrait ? ' about--portrait' : ''}` })}>
      ${portrait || name ? `<div class="about__id" data-reveal>${portrait}${name}</div>` : ''}
      <div class="about__text" data-reveal>
        ${paragraphs.map((p) => `<p>${krText(p)}</p>`).join('\n        ')}
      </div>
      ${
        facts.length
          ? `<dl class="facts" data-reveal>
        ${facts.map((f) => `<div class="facts__row"><dt class="${labelClass(f.label)}"${langAttr(f.label)}>${esc(f.label)}</dt><dd>${krText(f.value)}</dd></div>`).join('\n        ')}
      </dl>`
          : ''
      }
    </div>
  </div>
</section>`;
}

/** Plain text with blank-line paragraphs and single-line breaks → escaped HTML. */
function richText(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${para.split('\n').map(krText).join('<br>')}</p>`)
    .join('');
}

function faqSection(vm, num) {
  const faq = arr(vm.site?.faq).filter((f) => f && filled(f.q));
  const copy = sectionCopy(vm, 'faq', 'FAQ');
  const items = faq
    .map(
      (f, i) => `<details class="faq__item" data-reveal>
        <summary class="faq__q"><span class="faq__num label" aria-hidden="true">Q${esc(pad2(i + 1))}</span><span class="faq__text">${krText(f.q)}</span><span class="faq__icon" aria-hidden="true">${icons.plus()}</span></summary>
        <div class="faq__a">${richText(f.a)}</div>
      </details>`,
    )
    .join('\n      ');
  return `<section class="section section--faq" id="faq" aria-labelledby="faq-title">
  <div class="container">
    ${sectionHead({ id: 'faq', num, ...copy })}
    <div class="faq">
      ${items}
    </div>
  </div>
</section>`;
}

// ---------------------------------------------------------------------------------------------
// Contact + inquiry form
// ---------------------------------------------------------------------------------------------

function field({ name, label, type = 'text', required = false, half = false, autocomplete = null, placeholder = null, options = null, inputmode = null, hint = null }) {
  const id = `inq-${name}`;
  const describedBy = [hint ? `${id}-hint` : null, required ? `${id}-error` : null].filter(Boolean).join(' ') || null;
  const common = {
    id,
    name,
    required,
    'aria-describedby': describedBy,
    'data-label': label,
  };
  let control;
  if (options) {
    control = `<div class="field__select"><select${attrs({ class: 'field__input', ...common })}>
          <option value="">선택해 주세요</option>
          ${arr(options)
            .filter(filled)
            .map((o) => `<option${attrs({ value: o })}>${esc(o)}</option>`)
            .join('')}
        </select></div>`;
  } else if (type === 'textarea') {
    control = `<textarea${attrs({ class: 'field__input field__input--area', rows: 6, placeholder, ...common })}></textarea>`;
  } else {
    control = `<input${attrs({ class: 'field__input', type, autocomplete, placeholder, inputmode, ...common })}>`;
  }
  return `<div${attrs({ class: `field${half ? ' field--half' : ''}` })}>
        <label class="field__label"${attrs({ for: id })}>${esc(label)}${required ? '<span class="field__req" aria-hidden="true">필수</span>' : ''}</label>
        ${control}
        ${hint ? `<p class="field__hint"${attrs({ id: `${id}-hint` })}>${esc(hint)}</p>` : ''}
        ${required ? `<p class="field__error"${attrs({ id: `${id}-error`, 'data-field-error': name })} hidden></p>` : ''}
      </div>`;
}

export function inquiryForm(vm) {
  const site = vm.site || {};
  const contact = site.contact || {};
  const inquiry = site.inquiry || {};
  const endpoint = filled(contact.formEndpoint) ? contact.formEndpoint : '';
  const email = contact.email || '';
  // Without JS the form still works: POST to the endpoint, or a mailto: fallback.
  const fallback = endpoint
    ? { action: endpoint, method: 'post' }
    : filled(email)
      ? { action: `mailto:${email}`, method: 'post', enctype: 'text/plain' }
      : {};
  const fields = [
    field({ name: 'name', label: '성함 / 회사명', required: true, half: true, autocomplete: 'name', placeholder: '홍길동 / 회사명' }),
    field({ name: 'reply', label: '회신받을 연락처', required: true, half: true, autocomplete: 'email', placeholder: '이메일 또는 전화번호' }),
    field({ name: 'type', label: '프로젝트 유형', half: true, options: inquiry.projectTypes }),
    field({ name: 'runtime', label: '러닝타임 · 분량', half: true, placeholder: '예: 30초 광고 2편, 4분 뮤직비디오' }),
    field({ name: 'source', label: '촬영 카메라 · 소스', half: true, placeholder: '예: Sony FX3 S-Log3, ARRI ProRes' }),
    field({ name: 'deadline', label: '희망 납품일', type: 'date', half: true }),
    field({ name: 'budget', label: '예산 범위', half: true, options: inquiry.budgets }),
    field({ name: 'reference', label: '레퍼런스 링크', half: true, placeholder: 'https://', inputmode: 'url', autocomplete: 'off' }),
    field({
      name: 'message',
      label: '프로젝트 내용',
      type: 'textarea',
      required: true,
      placeholder: '원하시는 톤과 분위기, 납품 포맷(유튜브·SNS·방송 등), 현재 편집 단계를 알려주시면 더 정확한 견적을 드릴 수 있습니다.',
    }),
  ];
  return `<form${attrs({
    class: 'inquiry',
    'data-inquiry': true,
    'data-email': email,
    'data-subject-prefix': inquiry.subjectPrefix || '',
    'data-endpoint': endpoint || null,
    novalidate: true,
    ...fallback,
  })}>
    <div class="inquiry__head">
      <p class="label" lang="en">PROJECT BRIEF</p>
      <p class="inquiry__legend"><span class="field__req">필수</span> 표시 항목만 채워도 충분합니다.</p>
    </div>
    <div class="inquiry__grid">
      ${fields.join('\n      ')}
    </div>
    <div class="inquiry__actions">
      <button class="button button--primary" type="submit" data-track="inquiry_submit">${endpoint ? '문의 보내기' : '메일로 문의 보내기'}${icons.arrowRight()}</button>
      <button class="button button--ghost" type="button" data-inquiry-copy>${icons.copy()}문의 내용 복사</button>
    </div>
    ${
      endpoint
        ? ''
        : `<p class="inquiry__note">보내기를 누르면 사용 중인 메일 앱이 열리고, 작성하신 내용이 자동으로 채워집니다.${filled(email) ? ` 메일 앱이 없다면 내용을 복사해 <strong>${esc(email)}</strong> 주소로 보내주세요.` : ''}</p>`
    }
    <p class="inquiry__status" data-inquiry-status role="status" aria-live="polite"></p>
  </form>`;
}

function contactSection(vm, num) {
  const site = vm.site || {};
  const contact = site.contact || {};
  const inquiry = site.inquiry || {};
  const copy = sectionCopy(vm, 'contact', 'CONTACT');
  const kmong = kmongButton(vm);
  return `<section class="section section--contact" id="contact" aria-labelledby="contact-title">
  <div class="container">
    ${sectionHead({ id: 'contact', num, ...copy })}
    <div class="contact">
      <div class="contact__aside" data-reveal>
        ${filled(inquiry.intro) ? `<p class="contact__intro">${krText(inquiry.intro)}</p>` : ''}
        <div class="contact__direct">
          <p class="label" lang="en">DIRECT</p>
          ${contactLinks(vm, { variant: 'contact' })}
          ${filled(contact.responseNote) ? `<p class="contact__note"><span class="contact__note-dot" aria-hidden="true"></span>${esc(contact.responseNote)}</p>` : ''}
        </div>
        ${kmong ? `<div class="contact__kmong"><p class="label" lang="en">KMONG</p>${kmong}</div>` : ''}
      </div>
      <div class="contact__form" data-reveal>
        ${inquiryForm(vm)}
      </div>
    </div>
  </div>
</section>`;
}

// ---------------------------------------------------------------------------------------------

const SECTIONS = [
  ['works', () => true, worksSection],
  ['compare', (vm) => arr(vm.comparisons).some((p) => p && p.work && p.comparison), compareSection],
  ['services', (vm) => arr(vm.site?.services).some((s) => s && filled(s.title)), servicesSection],
  ['process', (vm) => arr(vm.site?.process).some((s) => s && filled(s.title)), processSection],
  ['formats', (vm) => arr(vm.site?.formats?.groups).some((g) => g && (filled(g.title) || arr(g.items).length)), formatsSection],
  ['packages', (vm) => arr(vm.site?.packages).some((p) => p && filled(p.name)), packagesSection],
  [
    'about',
    (vm) => arr(vm.site?.about?.paragraphs).some(filled) || arr(vm.site?.about?.facts).some((f) => f && (filled(f.label) || filled(f.value))),
    aboutSection,
  ],
  ['faq', (vm) => arr(vm.site?.faq).some((f) => f && filled(f.q)), faqSection],
  ['contact', () => true, contactSection],
];

export function renderHome(vm) {
  let n = 0;
  const sections = SECTIONS.filter(([, has]) => has(vm))
    .map(([, , render]) => render(vm, ++n))
    .join('\n');
  return documentShell(vm, {
    page: 'home',
    head: heroPreload(vm),
    main: `${hero(vm)}\n${sections}`,
  });
}
