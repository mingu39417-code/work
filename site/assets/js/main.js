/*!
 * TONECRAFT — site behaviours
 *
 * Plain JavaScript: no dependencies, no build step, no modules. Loaded as a classic
 * <script defer>. Every component binds only to the data-* hooks of the markup
 * contract (spec §5) and quietly does nothing when its hooks are missing, so the
 * same file serves the home page, work pages and the 404 page.
 *
 * Components (one init function each, run in isolation so one failure never
 * breaks the rest):
 *   file:// link fix · analytics clicks · header + mobile nav · scroll-spy ·
 *   reveal-on-scroll · hero reel · video dialog · work filters · hover previews ·
 *   before/after compare (stills + video canvas) · embed facade · copy buttons ·
 *   inquiry form
 */
(() => {
  'use strict';

  const doc = document;
  const root = doc.documentElement;

  if (window.__tonecraftBooted) return; // guard against the script being included twice
  window.__tonecraftBooted = true;

  /* ======================================================================== *
   * Constants
   * ======================================================================== */

  const MQ_MOBILE_NAV = '(max-width: 899.98px)'; // must match the CSS breakpoint (mobile nav below 900px)
  const MQ_REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
  const MQ_FINE_HOVER = '(hover: hover) and (pointer: fine)';
  const SCROLLED_OFFSET = 24;
  const DRAFT_KEY = 'tonecraft:inquiry-draft';
  const DRAFT_MAX_AGE = 1000 * 60 * 60 * 24 * 30; // forget drafts after 30 days
  // Phones and tablets hand mailto: to a mail app with no practical URL limit. On desktop, some
  // Windows mail handlers silently drop long mailto: URLs, and web handlers (Gmail etc.) turn the
  // whole URL into a GET request, so stay short there. iPadOS reports itself as a Mac.
  const MOBILE_DEVICE = (() => {
    try {
      const nav = window.navigator;
      return !!(
        (nav.userAgentData && nav.userAgentData.mobile) ||
        /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '') ||
        (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
      );
    } catch (err) {
      return false;
    }
  })();
  const MAILTO_MAX = MOBILE_DEVICE ? 8000 : 2000;
  const MAILTO_FIELD_MAX = 80; // code points kept per field (and subject) when not even the message's start fits
  const ENDPOINT_TIMEOUT = 12000;
  const IFRAME_ALLOW = 'autoplay; fullscreen; picture-in-picture; encrypted-media';

  const TEXT = {
    copied: '복사했습니다',
    copyFailed: '복사하지 못했습니다. 직접 선택해 주세요',
    heroFailed: '배경 영상을 불러오지 못했습니다.',
    compareFailed: '비교 영상을 불러오지 못했습니다.',
    compareValue: (before, after, pos) => `${before} ${pos}% · ${after} ${100 - pos}%`,
    videoFallbackTitle: '영상',
    videoError: '영상을 불러오지 못했습니다.',
    videoErrorLink: '파일로 열기',
    playerTitle: '영상 플레이어',
    filterAll: '전체',
    filterStatus: (label, n) => `${label} 작업 ${n}개`,
    inquiryDefaultType: '프로젝트 문의',
    inquiryFooter: '— tonecraft 웹사이트 문의 양식에서 보냄',
    inquiryRecipient: '받는 사람',
    inquirySubject: '제목',
    inquirySending: '보내는 중입니다…',
    inquirySent: '문의가 전송되었습니다. 곧 연락드리겠습니다.',
    inquirySendFailed: '온라인 전송에 실패해 메일 앱으로 연결합니다.',
    // The particle attaches to 주소, not to the address itself (".com로" would be a typo).
    inquiryMailto: (email) => `메일 앱이 열리지 않았다면 '문의 내용 복사'를 누른 뒤 ${email} 주소로 보내주세요.`,
    // Every character here costs 3–9 characters of the capped mailto: URL — keep it short.
    inquiryTruncatedNote: '※ 일부만 담겼습니다. 전체 내용은 웹사이트에서 복사해 붙여넣어 주세요.',
    inquiryTruncatedCopied: '문의 내용이 길어 전체 내용을 클립보드에 복사해 두었습니다. 메일 본문에 붙여넣어 주세요.',
    inquiryCopied: (email) => `문의 내용을 복사했습니다. 메일 본문에 붙여넣어 ${email} 주소로 보내주세요.`,
    inquiryCopiedNoEmail: '문의 내용을 복사했습니다.',
    inquiryCopyFailed: '복사하지 못했습니다. 내용을 직접 선택해 복사해 주세요.',
    inquiryInvalid: (n) => `필수 항목 ${n}개를 확인해 주세요.`,
    inquiryRequired: (label) => `${label}${josa(label, '을', '를')} 입력해 주세요.`,
    inquiryRequiredSelect: (label) => `${label}${josa(label, '을', '를')} 선택해 주세요.`,
    inquiryEmailFormat: '이메일 주소 형식을 확인해 주세요.',
    inquiryDraftRestored: '작성 중이던 내용을 불러왔습니다.',
    inquiryNoEmail: '받는 메일 주소가 설정되지 않았습니다. 문의 내용을 복사해 보내주세요.',
  };

  /* ======================================================================== *
   * Small utilities
   * ======================================================================== */

  const qs = (selector, context) => (context || doc).querySelector(selector);
  const qsa = (selector, context) => Array.from((context || doc).querySelectorAll(selector));
  const passive = { passive: true };
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const attr = (el, name) => ((el && el.getAttribute(name)) || '').trim();

  /** `closest()` that also accepts text nodes / non-elements as the start point. */
  function closest(target, selector) {
    let el = target;
    if (el && el.nodeType !== 1) el = el.parentElement;
    return el && typeof el.closest === 'function' ? el.closest(selector) : null;
  }

  function mediaQuery(query) {
    try {
      return typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
    } catch (err) {
      return null;
    }
  }

  function onMediaChange(mql, handler) {
    if (!mql) return;
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', handler);
    else if (typeof mql.addListener === 'function') mql.addListener(handler);
  }

  const reducedMotionQuery = mediaQuery(MQ_REDUCED_MOTION);
  const prefersReducedMotion = () => !!(reducedMotionQuery && reducedMotionQuery.matches);

  function connection() {
    return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  }

  /** True when the visitor asked to save data or the network is very slow. */
  function constrainedNetwork(includeThreeG) {
    const c = connection();
    if (!c) return false;
    if (c.saveData) return true;
    const type = c.effectiveType;
    return type === 'slow-2g' || type === '2g' || (includeThreeG && type === '3g');
  }

  const raf = (cb) =>
    typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(cb) : window.setTimeout(cb, 16);
  const cancelRaf = (id) =>
    typeof window.cancelAnimationFrame === 'function' ? window.cancelAnimationFrame(id) : window.clearTimeout(id);

  /** Run `fn` at most once per animation frame. */
  function rafThrottle(fn) {
    let queued = false;
    return () => {
      if (queued) return;
      queued = true;
      raf(() => {
        queued = false;
        fn();
      });
    };
  }

  function debounce(fn, wait) {
    let timer = 0;
    const invoke = () => {
      timer = 0;
      fn();
    };
    const debounced = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(invoke, wait);
    };
    debounced.flush = () => {
      if (!timer) return;
      window.clearTimeout(timer);
      invoke();
    };
    debounced.cancel = () => {
      window.clearTimeout(timer);
      timer = 0;
    };
    return debounced;
  }

  function focusElement(el, preventScroll = true) {
    if (!el || typeof el.focus !== 'function') return;
    try {
      el.focus({ preventScroll });
    } catch (err) {
      try {
        el.focus();
      } catch (err2) {
        /* not focusable — ignore */
      }
    }
  }

  const FOCUSABLE =
    'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

  function isRendered(el) {
    if (!el.getClientRects().length) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden';
  }

  /**
   * Call before hiding `control`: if it holds keyboard focus, move focus to the nearest
   * focusable element before it inside `scope`, so focus never falls back to <body>.
   * @returns {boolean} whether `control` had focus
   */
  function handOffFocus(control, scope) {
    if (!control || !control.contains(doc.activeElement)) return false;
    const before = qsa(FOCUSABLE, scope).filter(
      (el) =>
        !control.contains(el) &&
        // eslint-disable-next-line no-bitwise
        el.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING &&
        isRendered(el)
    );
    focusElement(before[before.length - 1]);
    return true;
  }

  /**
   * video.play() that never throws and never leaves an unhandled rejection.
   * Resolves with '' on success or the DOMException name on failure.
   */
  function playVideo(video) {
    let result;
    try {
      result = video.play();
    } catch (err) {
      return Promise.resolve((err && err.name) || 'Error');
    }
    if (!result || typeof result.then !== 'function') return Promise.resolve('');
    return result.then(
      () => '',
      (err) => (err && err.name) || 'Error'
    );
  }

  function pauseVideo(video) {
    try {
      if (video && !video.paused) video.pause();
    } catch (err) {
      /* ignore */
    }
  }

  /** Muted, inline, looping background-style video element. */
  function createMutedVideo(className) {
    const video = doc.createElement('video');
    if (className) video.className = className;
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('loop', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.setAttribute('disablepictureinpicture', '');
    video.setAttribute('disableremoteplayback', '');
    return video;
  }

  /** Stop a video and release its network connection / decoder. */
  function unloadVideo(video) {
    if (!video) return;
    try {
      video.pause();
      video.removeAttribute('src');
      qsa('source', video).forEach((s) => s.remove());
      video.load();
    } catch (err) {
      /* ignore */
    }
  }

  /**
   * Observe whether `el` intersects the viewport. Calls back with a boolean.
   * Without IntersectionObserver the element is treated as always visible.
   */
  function observeInView(el, callback, options) {
    if (!('IntersectionObserver' in window)) {
      callback(true);
      return () => {};
    }
    const io = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) callback(entry.isIntersecting);
    }, options || { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }

  function isInViewport(el) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || root.clientHeight;
    const vw = window.innerWidth || root.clientWidth;
    return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
  }

  /** localStorage wrapper — storage can be missing, full or throw (private mode, blocked cookies). */
  const storage = {
    get(key) {
      try {
        return window.localStorage ? window.localStorage.getItem(key) : null;
      } catch (err) {
        return null;
      }
    },
    set(key, value) {
      try {
        if (!window.localStorage) return false;
        window.localStorage.setItem(key, value);
        return true;
      } catch (err) {
        return false;
      }
    },
    remove(key) {
      try {
        if (window.localStorage) window.localStorage.removeItem(key);
      } catch (err) {
        /* ignore */
      }
    },
  };

  /** Korean object particle: 을 after a final consonant (batchim), 를 otherwise. */
  function josa(word, withBatchim, withoutBatchim) {
    const text = String(word || '').trim();
    const code = text.charCodeAt(text.length - 1);
    if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 ? withBatchim : withoutBatchim;
    return `${withBatchim}(${withoutBatchim})`;
  }

  /** Replace lone UTF-16 surrogates so encodeURIComponent() can never throw. */
  function wellFormed(value) {
    const s = String(value);
    if (typeof s.toWellFormed === 'function') return s.toWellFormed();
    let out = '';
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = s.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          out += s[i] + s[i + 1];
          i += 1;
        } else out += '�';
      } else if (c >= 0xdc00 && c <= 0xdfff) out += '�';
      else out += s[i];
    }
    return out;
  }

  /* ------------------------------------------------------------------------ *
   * Clipboard + toast
   * ------------------------------------------------------------------------ */

  function legacyCopy(text) {
    const active = doc.activeElement;
    const selection = window.getSelection ? window.getSelection() : null;
    const ranges = [];
    if (selection) for (let i = 0; i < selection.rangeCount; i += 1) ranges.push(selection.getRangeAt(i));

    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.tabIndex = -1;
    // 16px keeps iOS from zooming; fixed + transparent keeps the page from scrolling or flashing.
    area.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;margin:0;padding:0;border:0;opacity:0;font-size:16px;pointer-events:none;';
    (doc.body || root).appendChild(area);
    let ok = false;
    try {
      focusElement(area);
      area.select();
      area.setSelectionRange(0, area.value.length);
      ok = typeof doc.execCommand === 'function' && doc.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    area.remove();
    if (selection) {
      try {
        selection.removeAllRanges();
        ranges.forEach((r) => selection.addRange(r));
      } catch (err) {
        /* ignore */
      }
    }
    if (active && active !== doc.body) focusElement(active);
    return !!ok;
  }

  /** Copy text; resolves true/false. Async Clipboard API first, execCommand fallback. */
  function copyText(text) {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext !== false) {
        return navigator.clipboard.writeText(text).then(
          () => true,
          () => legacyCopy(text)
        );
      }
    } catch (err) {
      /* fall through to the legacy path */
    }
    return Promise.resolve(legacyCopy(text));
  }

  let toastTimer = 0;
  let toastTextTimer = 0;
  function showToast(message) {
    const toast = qs('[data-toast]');
    if (!toast) return;
    window.clearTimeout(toastTimer);
    window.clearTimeout(toastTextTimer);
    toast.hidden = false;
    toast.textContent = '';
    // Change the text in a separate task so screen readers announce it even when the
    // live region was hidden a moment ago (or the same message repeats).
    toastTextTimer = window.setTimeout(() => {
      toast.textContent = message;
    }, 50);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
      toast.textContent = '';
    }, 3200);
  }

  /* ======================================================================== *
   * file:// support — make directory links open their index.html
   * ======================================================================== */

  function toFileIndexHref(href) {
    const raw = String(href).trim();
    // Leave absolute URLs, protocol-relative/root-relative paths and pure fragments/queries alone.
    if (/^[a-z][a-z\d+.-]*:/i.test(raw) || /^[/#?]/.test(raw)) return href;
    const match = raw.match(/^([^?#]*)(.*)$/);
    const path = match[1];
    const rest = match[2];
    if (path === '') return `index.html${rest}`;
    if (path === '.' || path === '..' || /\/\.\.?$/.test(path)) return `${path}/index.html${rest}`;
    if (path.endsWith('/')) return `${path}index.html${rest}`;
    return href;
  }

  function initFileLinks() {
    if (window.location.protocol !== 'file:') return;
    qsa('a[href]').forEach((link) => {
      const href = link.getAttribute('href');
      const next = toFileIndexHref(href);
      if (next !== href) link.setAttribute('href', next);
    });
  }

  /* ======================================================================== *
   * Analytics — [data-track="event_name"] → gtag('event', name)
   * ======================================================================== */

  function initTracking() {
    doc.addEventListener(
      'click',
      (event) => {
        const el = closest(event.target, '[data-track]');
        if (!el || typeof window.gtag !== 'function') return;
        const name = attr(el, 'data-track');
        if (!name) return;
        try {
          window.gtag('event', name);
        } catch (err) {
          /* analytics must never break the page */
        }
      },
      true
    );
  }

  /* ======================================================================== *
   * Header — scrolled state + mobile navigation sheet
   * ======================================================================== */

  function initHeader() {
    const header = qs('[data-header]');
    if (!header) return;

    let scrolled = null;
    const updateScrolled = () => {
      const next = (window.scrollY || window.pageYOffset || 0) > SCROLLED_OFFSET;
      if (next === scrolled) return;
      scrolled = next;
      header.setAttribute('data-scrolled', String(next));
    };
    updateScrolled();
    const onScroll = rafThrottle(updateScrolled);
    window.addEventListener('scroll', onScroll, passive);
    window.addEventListener('pageshow', updateScrolled);

    const toggle = qs('[data-nav-toggle]', header) || qs('[data-nav-toggle]');
    const nav = qs('[data-nav]', header) || qs('[data-nav]');
    header.setAttribute('data-nav-open', 'false');
    if (toggle && nav) setupNavSheet(header, toggle, nav);
  }

  function setupNavSheet(header, toggle, nav) {
    const mobile = mediaQuery(MQ_MOBILE_NAV);
    let open = false;
    let inerted = [];

    toggle.setAttribute('aria-expanded', 'false');

    // While the sheet is open everything outside the header is inert (not focusable, hidden from AT).
    const setBackgroundInert = (on) => {
      if (!on) {
        inerted.forEach((el) => el.removeAttribute('inert'));
        inerted = [];
        return;
      }
      let node = header;
      while (node && node.parentElement && node !== doc.body) {
        Array.from(node.parentElement.children).forEach((sibling) => {
          if (sibling === node || sibling.hasAttribute('inert')) return;
          if (/^(SCRIPT|STYLE|LINK|TEMPLATE|DIALOG)$/.test(sibling.tagName)) return;
          if (sibling.matches('[data-toast], [aria-live]')) return;
          sibling.setAttribute('inert', '');
          inerted.push(sibling);
        });
        node = node.parentElement;
      }
    };

    // Move focus into the sheet. If its open transition makes the link unfocusable for a moment,
    // retry — but never once the sheet closed or focus already moved inside it (no focus stealing).
    const focusFirstLink = () => {
      const target = qs('[data-nav-link]', nav) || qsa(FOCUSABLE, nav)[0];
      if (!target) return;
      const attempt = () => {
        if (open && !nav.contains(doc.activeElement)) focusElement(target);
      };
      attempt();
      raf(attempt);
      window.setTimeout(attempt, 360);
    };

    const setOpen = (next, restoreFocus) => {
      if (next === open) return;
      open = next;
      header.setAttribute('data-nav-open', String(open));
      toggle.setAttribute('aria-expanded', String(open));
      root.classList.toggle('nav-open', open);
      setBackgroundInert(open);
      if (open) {
        focusFirstLink();
      } else if (restoreFocus) {
        focusElement(toggle);
      }
    };

    toggle.addEventListener('click', () => setOpen(!open, false));

    // Any link inside the header (nav items, CTA, brand) closes the sheet before navigating.
    header.addEventListener('click', (event) => {
      if (open && closest(event.target, 'a[href]')) setOpen(false, false);
    });

    doc.addEventListener('keydown', (event) => {
      if (!open) return;
      if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault();
        setOpen(false, true);
        return;
      }
      if (event.key !== 'Tab') return;
      // Keep Tab focus inside the header while the full-screen sheet is open.
      const items = qsa(FOCUSABLE, header).filter(isRendered);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = doc.activeElement;
      const outside = !header.contains(active);
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        focusElement(last);
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        focusElement(first);
      }
    });

    onMediaChange(mobile, () => {
      if (mobile && !mobile.matches) setOpen(false, false);
    });
    window.addEventListener('pagehide', () => setOpen(false, false));
  }

  /* ======================================================================== *
   * Scroll-spy — aria-current on the nav link of the section in view (home)
   * ======================================================================== */

  function initScrollSpy() {
    const pairs = [];
    qsa('[data-nav-link]').forEach((link) => {
      const href = link.getAttribute('href') || '';
      if (href.charAt(0) !== '#' || href.length < 2) return;
      let target = null;
      try {
        target = doc.getElementById(decodeURIComponent(href.slice(1)));
      } catch (err) {
        target = null;
      }
      if (target) pairs.push({ link, target });
    });
    if (!pairs.length) return;
    // eslint-disable-next-line no-bitwise
    pairs.sort((a, b) => (a.target.compareDocumentPosition(b.target) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

    let current = null;
    const update = () => {
      const vh = window.innerHeight || root.clientHeight;
      const probe = vh * 0.3;
      let next = null;
      const visible = [];
      pairs.forEach((pair) => {
        const rect = pair.target.getBoundingClientRect();
        if (!rect.width && !rect.height) return; // not rendered
        visible.push({ pair, rect });
        if (rect.top <= probe) next = pair;
      });
      // At the very bottom short final sections (contact) never reach the probe line.
      const scrollBottom = (window.scrollY || window.pageYOffset || 0) + vh;
      if (scrollBottom >= root.scrollHeight - 2) {
        for (let i = visible.length - 1; i >= 0; i -= 1) {
          if (visible[i].rect.top < vh && visible[i].rect.bottom > 0) {
            next = visible[i].pair;
            break;
          }
        }
      }
      if (next === current) return;
      if (current) current.link.removeAttribute('aria-current');
      current = next;
      if (current) current.link.setAttribute('aria-current', 'true');
    };

    const schedule = rafThrottle(update);
    window.addEventListener('scroll', schedule, passive);
    window.addEventListener('resize', schedule, passive);
    window.addEventListener('hashchange', schedule);
    window.addEventListener('load', schedule);
    update();
  }

  /* ======================================================================== *
   * Reveal on scroll — [data-reveal] → data-revealed="true" when ≥15% visible
   * ======================================================================== */

  function initReveal() {
    const elements = qsa('[data-reveal]');
    if (!elements.length) return;
    const reveal = (el) => el.setAttribute('data-revealed', 'true');

    if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
      elements.forEach(reveal);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const rootHeight = entry.rootBounds ? entry.rootBounds.height : window.innerHeight;
          // Very tall blocks can never be 15% visible, so also accept "fills 15% of the viewport".
          if (entry.intersectionRatio >= 0.15 || entry.intersectionRect.height >= rootHeight * 0.15) {
            reveal(entry.target);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: [0, 0.02, 0.05, 0.1, 0.15] }
    );
    elements.forEach((el) => {
      if (el.getAttribute('data-revealed') !== 'true') io.observe(el);
    });

    onMediaChange(reducedMotionQuery, () => {
      if (!prefersReducedMotion()) return;
      io.disconnect();
      elements.forEach(reveal);
    });
    // Printing should never leave blocks invisible.
    window.addEventListener('beforeprint', () => elements.forEach(reveal));
  }

  /* ======================================================================== *
   * Hero reel — muted background loop, toggle, timecode
   * ======================================================================== */

  function formatTimecode(seconds, fps) {
    const nominal = Math.max(1, Math.round(fps));
    const t = Math.max(0, Number(seconds) || 0);
    const whole = Math.floor(t);
    const frames = Math.min(nominal - 1, Math.floor((t - whole) * fps + 1e-6));
    const hh = Math.floor(whole / 3600);
    const mm = Math.floor((whole % 3600) / 60);
    const ss = whole % 60;
    return [hh, mm, ss, frames].map((n) => String(n).padStart(2, '0')).join(':');
  }

  /** @returns {{ suspend(on: boolean): void } | null} controller used by the video dialog */
  function initHero() {
    const hero = qs('[data-hero]');
    if (!hero) return null;
    const video = qs('[data-hero-video]', hero);
    const toggle = qs('[data-hero-toggle]', hero);
    const timecode = qs('[data-timecode]', hero);
    if (!video || typeof video.play !== 'function') return null;

    const src = attr(video, 'data-src') || attr(video, 'src');
    const fpsAttr = parseFloat(attr(video, 'data-fps'));
    const fps = fpsAttr > 0 && fpsAttr <= 240 ? fpsAttr : 24;

    let userWants = null; // null → follow the autoplay policy; true/false → explicit user choice
    let blocked = false; // the browser refused muted autoplay (e.g. iOS Low Power Mode)
    let failed = false;
    let playing = false;
    let inView = !('IntersectionObserver' in window); // with IntersectionObserver, wait for its first report
    // Landing on a #fragment (e.g. a work page's "프로젝트 문의하기" → ../../#contact): the observer's
    // first report still sees the top of the page, and the browser scrolls to the fragment only
    // around `load`, smoothly. Once play() has run the reel keeps downloading, so nothing starts
    // until that scroll has settled.
    let settled = !(window.location.hash.length > 1);
    let suspended = false; // video dialog open
    let loaded = false;

    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;

    const policyAllows = () => !prefersReducedMotion() && !constrainedNetwork(true);
    const wants = () => (userWants !== null ? userWants : policyAllows() && !blocked);
    const shouldPlay = () => settled && wants() && inView && !doc.hidden && !suspended && !failed;

    /* --- timecode ------------------------------------------------------- */
    let clockId = 0;
    let clockKind = '';
    let lastCode = '';
    const drawTimecode = (time) => {
      if (!timecode) return;
      const code = formatTimecode(time, fps);
      if (code !== lastCode) {
        lastCode = code;
        timecode.textContent = code;
      }
    };
    const stopClock = () => {
      if (!clockId) return;
      if (clockKind === 'vfc' && typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(clockId);
      else if (clockKind === 'raf') cancelRaf(clockId);
      clockId = 0;
    };
    const scheduleClock = () => {
      if (!timecode || !playing) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        clockKind = 'vfc';
        clockId = video.requestVideoFrameCallback((now, meta) => {
          clockId = 0;
          drawTimecode(meta && typeof meta.mediaTime === 'number' ? meta.mediaTime : video.currentTime);
          scheduleClock();
        });
      } else {
        clockKind = 'raf';
        clockId = raf(() => {
          clockId = 0;
          drawTimecode(video.currentTime);
          scheduleClock();
        });
      }
    };

    /* --- state ---------------------------------------------------------- */
    // The toggle follows what is on screen, like its icon (CSS keys ▶/❚❚ on data-state): while the
    // loop is still loading, or the browser paused it, it shows ▶ and a press means "play".
    // Its name stays "배경 영상 일시정지"; aria-pressed="true" means paused.
    const showsPlaying = () => wants() && playing;
    const render = () => {
      hero.setAttribute('data-state', playing ? 'playing' : 'paused');
      if (toggle) toggle.setAttribute('aria-pressed', String(!showsPlaying()));
    };

    const load = () => {
      if (loaded || !src) return;
      loaded = true;
      if (video.getAttribute('src') !== src) video.src = src;
    };

    const fail = () => {
      if (failed) return;
      failed = true;
      playing = false;
      stopClock();
      pauseVideo(video);
      // Never leave dead controls on screen: the poster stays, the controls go.
      if (toggle) {
        const hadFocus = handOffFocus(toggle, hero);
        toggle.hidden = true;
        if (hadFocus || userWants === true) showToast(TEXT.heroFailed);
      }
      if (timecode) timecode.hidden = true;
      render();
    };

    const sync = () => {
      if (shouldPlay()) {
        load();
        if (video.paused && loaded) {
          playVideo(video).then((error) => {
            if (!error || error === 'AbortError') return; // AbortError: paused again before it started
            if (error === 'NotSupportedError') {
              fail();
              return;
            }
            if (userWants === true) userWants = false;
            else blocked = true;
            render();
          });
        }
      } else {
        pauseVideo(video);
      }
      render();
    };

    video.addEventListener('playing', () => {
      playing = true;
      blocked = false;
      render();
      stopClock();
      scheduleClock();
    });
    const onStop = () => {
      playing = false;
      stopClock();
      drawTimecode(video.currentTime);
      render();
    };
    video.addEventListener('pause', onStop);
    video.addEventListener('ended', onStop);
    video.addEventListener('emptied', onStop);
    video.addEventListener('timeupdate', () => {
      if (!clockId) drawTimecode(video.currentTime);
    });
    video.addEventListener('error', () => {
      if (video.error) fail();
    });

    if (toggle) {
      toggle.addEventListener('click', () => {
        userWants = !showsPlaying();
        blocked = false;
        settled = true; // an explicit choice needs no waiting
        sync();
      });
    }

    observeInView(hero, (visible) => {
      inView = visible;
      sync();
    });
    if (!settled) {
      const settle = debounce(() => {
        window.removeEventListener('scroll', settle, passive);
        settled = true;
        if ('IntersectionObserver' in window) inView = isInViewport(hero);
        sync();
      }, 250);
      const arm = () => {
        window.addEventListener('scroll', settle, passive);
        settle();
      };
      if (doc.readyState === 'complete') arm();
      else window.addEventListener('load', arm, { once: true });
    }
    doc.addEventListener('visibilitychange', sync);
    window.addEventListener('pageshow', sync);
    onMediaChange(reducedMotionQuery, sync);

    sync();

    return {
      suspend(on) {
        suspended = !!on;
        sync();
      },
    };
  }

  /* ======================================================================== *
   * Video dialog — self-hosted video or embed iframe in a modal <dialog>
   * ======================================================================== */

  function initVideoDialog(hero) {
    const dialog = qs('[data-video-dialog]');
    // Without <dialog> support (iOS < 15.4) the trigger links simply open the file / page.
    if (!dialog || typeof dialog.showModal !== 'function') return;
    const stage = qs('[data-video-dialog-stage]', dialog);
    if (!stage) return;
    const titleEl = qs('[data-video-dialog-title]', dialog);
    const closeButton = qs('[data-video-dialog-close]', dialog);

    let trigger = null;
    let pointerDownOnBackdrop = false;

    const buildIframe = (src, title) => {
      const iframe = doc.createElement('iframe');
      iframe.className = 'video-dialog__iframe';
      iframe.src = src;
      iframe.setAttribute('allow', IFRAME_ALLOW);
      iframe.setAttribute('allowfullscreen', '');
      iframe.title = title;
      return iframe;
    };

    const buildVideo = (src, poster, title) => {
      const video = doc.createElement('video');
      video.className = 'video-dialog__video';
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute('controls', '');
      video.setAttribute('autoplay', '');
      video.setAttribute('playsinline', '');
      video.preload = 'auto';
      if (poster) video.poster = poster;
      video.setAttribute('aria-label', title);
      video.addEventListener('error', () => {
        if (!video.error || !video.isConnected) return;
        const note = doc.createElement('p');
        note.className = 'video-dialog__error';
        note.append(`${TEXT.videoError} `);
        const link = doc.createElement('a');
        link.href = src;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = TEXT.videoErrorLink;
        note.append(link);
        video.replaceWith(note);
      });
      video.src = src;
      return video;
    };

    const cleanup = () => {
      unloadVideo(qs('video', stage));
      stage.textContent = '';
      if (titleEl) titleEl.textContent = '';
      root.classList.remove('dialog-open');
      if (hero) hero.suspend(false);
    };

    const open = (link) => {
      const src = attr(link, 'data-video-src');
      const embed = attr(link, 'data-video-embed');
      const title =
        attr(link, 'data-video-title') || (link.textContent || '').replace(/\s+/g, ' ').trim() || TEXT.videoFallbackTitle;

      if (dialog.open) return true; // a trigger inside the open dialog — nothing to do
      unloadVideo(qs('video', stage));
      stage.textContent = '';
      if (titleEl) titleEl.textContent = title;
      const media = embed ? buildIframe(embed, title) : buildVideo(src, attr(link, 'data-video-poster'), title);
      stage.appendChild(media);
      trigger = link;
      if (hero) hero.suspend(true);

      try {
        dialog.showModal();
      } catch (err) {
        cleanup();
        return false;
      }
      root.classList.add('dialog-open');
      if (media.tagName === 'VIDEO') playVideo(media); // still inside the click gesture
      return true;
    };

    doc.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // new tab / window
      const link = closest(event.target, '[data-video-open]');
      if (!link || (!attr(link, 'data-video-src') && !attr(link, 'data-video-embed'))) return;
      event.preventDefault();
      if (!open(link) && link.href) window.location.href = link.href;
    });

    if (closeButton) closeButton.addEventListener('click', () => dialog.close());

    // Backdrop click: the click lands on the <dialog> itself. Require the press to start there
    // too, so a drag that begins inside the player and ends outside does not close it.
    dialog.addEventListener('pointerdown', (event) => {
      pointerDownOnBackdrop = event.target === dialog;
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog && pointerDownOnBackdrop) dialog.close();
      pointerDownOnBackdrop = false;
    });

    dialog.addEventListener('close', () => {
      // 'close' is queued as a task: if another trigger re-opened the dialog in the meantime,
      // the stage already holds the new player — leave it alone.
      if (dialog.open) return;
      cleanup();
      const back = trigger;
      trigger = null;
      if (back && back.isConnected) focusElement(back);
    });
  }

  /* ======================================================================== *
   * Works filters
   * ======================================================================== */

  function filterLabel(button) {
    const explicit = attr(button, 'data-filter-label');
    if (explicit) return explicit;
    const clone = button.cloneNode(true);
    qsa('.filter__count, [data-filter-count]', clone).forEach((n) => n.remove());
    const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    return text.replace(/\s*\d+$/, '') || text;
  }

  function initFilters() {
    qsa('[data-filters]').forEach((group) => {
      const buttons = qsa('[data-filter]', group);
      if (!buttons.length) return;
      const scope = group.closest('section') || doc;
      let items = qsa('[data-work-item]', scope);
      if (!items.length) items = qsa('[data-work-item]');
      const status = qs('[data-filter-status]', scope) || qs('[data-filter-status]');

      const apply = (button, announce) => {
        const id = attr(button, 'data-filter') || 'all';
        buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
        let count = 0;
        items.forEach((item) => {
          const show = id === 'all' || attr(item, 'data-category') === id;
          item.hidden = !show;
          if (show) {
            count += 1;
          } else {
            // Stop hover previews inside cards that just disappeared.
            qsa('video', item).forEach(pauseVideo);
            qsa('[data-preview]', item).forEach((card) => card.setAttribute('data-preview', 'idle'));
          }
        });
        if (status && announce) {
          status.textContent = TEXT.filterStatus(id === 'all' ? filterLabel(button) || TEXT.filterAll : filterLabel(button), count);
        }
      };

      group.addEventListener('click', (event) => {
        const button = closest(event.target, '[data-filter]');
        if (button && group.contains(button)) apply(button, true);
      });

      const pressed = buttons.find((b) => b.getAttribute('aria-pressed') === 'true');
      if (pressed && attr(pressed, 'data-filter') !== 'all') apply(pressed, false);
    });
  }

  /* ======================================================================== *
   * Hover previews on work cards (fine pointers only)
   * ======================================================================== */

  function initHoverPreviews() {
    const cards = qsa('[data-preview-src]');
    if (!cards.length) return;
    const hoverQuery = mediaQuery(MQ_FINE_HOVER);
    const enabled = () => !!(hoverQuery && hoverQuery.matches) && !prefersReducedMotion() && !constrainedNetwork(false);

    cards.forEach((card) => {
      const host = qs('[data-preview-host]', card);
      const src = attr(card, 'data-preview-src');
      if (!host || !src) return;
      let video = null;
      let want = false;
      let failed = false;
      let timer = 0;

      const begin = () => {
        if (!want || failed) return;
        if (!video) {
          video = createMutedVideo('work-card__preview');
          video.preload = 'auto';
          video.addEventListener('playing', () => {
            // The card may have been filtered out (hidden) while the clip was starting.
            if (want && !card.closest('[hidden]')) card.setAttribute('data-preview', 'playing');
            else pauseVideo(video);
          });
          video.addEventListener('error', () => {
            if (!video || !video.error) return;
            failed = true;
            card.setAttribute('data-preview', 'idle');
            video.remove();
            video = null;
          });
          video.src = src;
          host.appendChild(video);
        }
        playVideo(video);
      };

      const start = () => {
        if (failed || !enabled()) return;
        want = true;
        window.clearTimeout(timer);
        // Small hover-intent delay so sweeping the mouse across the grid doesn't load every clip.
        timer = window.setTimeout(begin, video ? 0 : 120);
      };

      const stop = () => {
        want = false;
        window.clearTimeout(timer);
        if (card.hasAttribute('data-preview') || video) card.setAttribute('data-preview', 'idle');
        pauseVideo(video);
      };

      card.addEventListener('pointerenter', (event) => {
        if (event.pointerType !== 'touch') start();
      });
      card.addEventListener('pointerleave', stop);
      card.addEventListener('focus', start);
      card.addEventListener('blur', stop);
    });

    doc.addEventListener('visibilitychange', () => {
      if (!doc.hidden) return;
      cards.forEach((card) => {
        qsa('video', card).forEach(pauseVideo);
      });
    });
  }

  /* ======================================================================== *
   * Before / after compare
   * ======================================================================== */

  function initCompare() {
    qsa('[data-compare]').forEach(setupCompare);
  }

  function setupCompare(figure) {
    const frame = qs('[data-compare-frame]', figure);
    if (!frame) return;
    const range = qs('[data-compare-range]', frame) || qs('[data-compare-range]', figure);
    const labelText = (selector, fallback) => {
      const el = qs(selector, figure);
      return (el && el.textContent.trim()) || fallback;
    };
    const beforeLabel = labelText('.compare__label--before', 'BEFORE');
    const afterLabel = labelText('.compare__label--after', 'AFTER');

    let pos = 50;
    let videoLayer = null;

    const setState = (value) => {
      if (value) frame.setAttribute('data-compare-state', value);
      else frame.removeAttribute('data-compare-state');
    };

    const setPos = (value, fromRange) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return;
      pos = clamp(n, 0, 100);
      frame.style.setProperty('--pos', `${Math.round(pos * 1000) / 1000}%`);
      if (range) {
        if (!fromRange) range.value = String(pos);
        range.setAttribute('aria-valuetext', TEXT.compareValue(beforeLabel, afterLabel, Math.round(pos)));
      }
      if (videoLayer) videoLayer.redraw();
    };

    /* --- pointer drag --------------------------------------------------- */
    let drag = null; // { id, touch, startX, startY, active }

    const posFromClientX = (clientX) => {
      const rect = frame.getBoundingClientRect();
      return rect.width ? ((clientX - rect.left) / rect.width) * 100 : pos;
    };

    const beginDrag = (event) => {
      drag.active = true;
      try {
        frame.setPointerCapture(drag.id);
      } catch (err) {
        /* capture is an optimisation */
      }
      // Keep "video" while the canvas is showing so it stays visible during the drag.
      if (!(videoLayer && videoLayer.isActive())) setState('dragging');
      setPos(posFromClientX(event.clientX));
    };

    const endDrag = (event, commitTap) => {
      if (!drag || (event && event.pointerId !== drag.id)) return;
      const { active, touch, id } = drag;
      drag = null;
      if (!active && touch && commitTap) setPos(posFromClientX(event.clientX)); // tap to jump
      try {
        if (frame.hasPointerCapture && frame.hasPointerCapture(id)) frame.releasePointerCapture(id);
      } catch (err) {
        /* ignore */
      }
      if (frame.getAttribute('data-compare-state') === 'dragging') setState('');
    };

    frame.addEventListener('pointerdown', (event) => {
      if (drag || event.isPrimary === false) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (closest(event.target, '[data-compare-play], a, button, select, textarea')) return;
      drag = {
        id: event.pointerId,
        touch: event.pointerType === 'touch',
        startX: event.clientX,
        startY: event.clientY,
        active: false,
      };
      if (drag.touch) return; // wait to see whether the finger moves sideways (drag) or vertically (scroll)
      event.preventDefault(); // no native image drag / text selection
      if (range) focusElement(range);
      beginDrag(event);
    });

    frame.addEventListener(
      'pointermove',
      (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        if (!drag.active) {
          const dx = Math.abs(event.clientX - drag.startX);
          const dy = Math.abs(event.clientY - drag.startY);
          if (dy > 10 && dy > dx) {
            drag = null; // vertical intent — let the page scroll (touch-action: pan-y)
            return;
          }
          if (dx < 6 || dx < dy) return;
          beginDrag(event);
          return;
        }
        setPos(posFromClientX(event.clientX));
      },
      passive
    );
    frame.addEventListener('pointerup', (event) => endDrag(event, true));
    frame.addEventListener('pointercancel', (event) => endDrag(event, false));
    // Only our own capture on the frame counts: touch pointers are implicitly captured by the
    // element under the finger, and that implicit capture's lostpointercapture bubbles up here
    // the moment we move the capture to the frame.
    frame.addEventListener('lostpointercapture', (event) => {
      if (event.target === frame) endDrag(event, false);
    });

    frame.addEventListener('dblclick', (event) => {
      if (closest(event.target, '[data-compare-play]')) return;
      setPos(50);
    });

    // Suppress the native image drag ghost in browsers that ignore pointerdown.preventDefault().
    frame.addEventListener('dragstart', (event) => event.preventDefault());

    if (range) {
      range.addEventListener('input', () => setPos(range.value, true));
      range.addEventListener('change', () => setPos(range.value, true));
      // The markup's fine step (0.5) suits the value, not the keyboard: arrows move 2%, with Shift 10%,
      // snapping to that grid. Home/End/PageUp/PageDown keep their native behaviour.
      range.addEventListener('keydown', (event) => {
        const dir = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
        if (!dir || event.altKey || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 2;
        const index = dir > 0 ? Math.floor(pos / step + 1e-6) + 1 : Math.ceil(pos / step - 1e-6) - 1;
        setPos(index * step, false);
      });
    }

    /* --- video variant ---------------------------------------------------- */
    const videoSrc = attr(figure, 'data-compare-video');
    const canvas = qs('[data-compare-canvas]', frame);
    const playButton = qs('[data-compare-play]', frame) || qs('[data-compare-play]', figure);
    if (videoSrc && canvas && playButton) {
      videoLayer = setupCompareVideo({ figure, frame, canvas, button: playButton, src: videoSrc, getPos: () => pos, setState });
    }
    if (playButton && !videoLayer) playButton.hidden = true; // never leave a dead control

    // The browser may restore a previous range value on back/forward navigation.
    setPos(range ? range.value : 50, false);
  }

  /**
   * Stacked comparison video: [BEFORE | AFTER] side by side in one file. Each frame is
   * drawn into the canvas: the AFTER half full-frame, then the BEFORE half clipped to `pos`.
   */
  function setupCompareVideo({ figure, frame, canvas, button, src, getPos, setState }) {
    let ctx = null;
    try {
      ctx = canvas.getContext('2d');
    } catch (err) {
      ctx = null;
    }
    if (!ctx) return null;

    let video = null;
    let active = false;
    let drawn = false;
    let failed = false;
    let inView = isInViewport(figure);
    let loopId = 0;
    let loopKind = '';

    button.setAttribute('aria-pressed', 'false');

    const sizeCanvas = () => {
      const half = video.videoWidth / 2;
      const height = video.videoHeight;
      if (!half || !height) return false;
      const cssWidth = frame.clientWidth || canvas.clientWidth || half;
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      const w = Math.max(1, Math.round(Math.min(half, cssWidth * dpr)));
      const h = Math.max(1, Math.round((w * height) / half));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      return true;
    };

    const draw = () => {
      if (!active || !video || video.readyState < 2 || !sizeCanvas()) return;
      const half = video.videoWidth / 2;
      const vh = video.videoHeight;
      const cw = canvas.width;
      const ch = canvas.height;
      const p = clamp(getPos(), 0, 100) / 100;
      try {
        ctx.drawImage(video, half, 0, half, vh, 0, 0, cw, ch); // AFTER (right half)
        if (p > 0) ctx.drawImage(video, 0, 0, half * p, vh, 0, 0, cw * p, ch); // BEFORE (left half)
      } catch (err) {
        return;
      }
      if (!drawn) {
        drawn = true;
        setState('video');
      }
    };

    const stopLoop = () => {
      if (!loopId) return;
      if (loopKind === 'vfc' && video && typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(loopId);
      else if (loopKind === 'raf') cancelRaf(loopId);
      loopId = 0;
    };

    const loop = () => {
      loopId = 0;
      if (!active || !video || video.paused) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        loopKind = 'vfc';
        loopId = video.requestVideoFrameCallback(() => {
          loopId = 0;
          draw();
          loop();
        });
      } else {
        loopKind = 'raf';
        loopId = raf(() => {
          loopId = 0;
          draw();
          loop();
        });
      }
    };

    const fail = () => {
      failed = true;
      deactivate();
      unloadVideo(video);
      if (video) video.remove();
      video = null;
      handOffFocus(button, figure); // → the slider, which still works on the stills
      button.hidden = true;
      showToast(TEXT.compareFailed);
    };

    const ensureVideo = () => {
      if (video) return video;
      video = createMutedVideo('compare__source');
      video.preload = 'auto';
      // Rendered (so every browser keeps decoding frames) but invisible and out of the way.
      video.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
      video.addEventListener('loadeddata', draw);
      video.addEventListener('seeked', draw);
      video.addEventListener('playing', () => {
        stopLoop();
        draw();
        loop();
      });
      video.addEventListener('pause', stopLoop);
      video.addEventListener('error', () => {
        if (video && video.error) fail();
      });
      video.src = src;
      frame.appendChild(video);
      return video;
    };

    const resume = () => {
      if (!active || !video || !inView || doc.hidden) return;
      playVideo(video).then((error) => {
        if (!error || error === 'AbortError') return;
        if (error === 'NotSupportedError') fail();
        else deactivate();
      });
    };

    function activate() {
      if (failed) return;
      active = true;
      button.setAttribute('aria-pressed', 'true');
      ensureVideo();
      draw(); // re-activation: show the current frame immediately
      resume();
    }

    function deactivate() {
      active = false;
      drawn = false;
      stopLoop();
      pauseVideo(video);
      button.setAttribute('aria-pressed', 'false');
      if (frame.getAttribute('data-compare-state') === 'video') setState('');
    }

    button.addEventListener('click', () => (active ? deactivate() : activate()));

    observeInView(figure, (visible) => {
      inView = visible;
      if (!active || !video) return;
      if (visible) resume();
      else pauseVideo(video);
    });
    doc.addEventListener('visibilitychange', () => {
      if (!active || !video) return;
      if (doc.hidden) pauseVideo(video);
      else resume();
    });

    if ('ResizeObserver' in window) {
      new ResizeObserver(() => draw()).observe(frame);
    } else {
      window.addEventListener('resize', rafThrottle(draw), passive);
    }

    return {
      redraw: draw,
      isActive: () => active,
    };
  }

  /* ======================================================================== *
   * Embed facade (work pages) — poster link → player iframe on click
   * ======================================================================== */

  function initEmbedFacades() {
    const preconnected = new Set();
    const preconnect = (src) => {
      let origin = '';
      try {
        origin = new URL(src, window.location.href).origin;
      } catch (err) {
        return;
      }
      if (!/^https:/.test(origin) || preconnected.has(origin)) return;
      preconnected.add(origin);
      const link = doc.createElement('link');
      link.rel = 'preconnect';
      link.href = origin;
      doc.head.appendChild(link);
    };

    qsa('[data-embed-facade]').forEach((facade) => {
      const src = attr(facade, 'data-embed-src');
      if (!src) return;
      const warm = () => preconnect(src);
      facade.addEventListener('pointerenter', warm, { once: true, passive: true });
      facade.addEventListener('focus', warm, { once: true });

      facade.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        const iframe = doc.createElement('iframe');
        iframe.className = 'work-player__iframe';
        iframe.src = src;
        iframe.setAttribute('allow', IFRAME_ALLOW);
        iframe.setAttribute('allowfullscreen', '');
        iframe.title = attr(facade, 'data-embed-title') || TEXT.playerTitle;
        facade.replaceWith(iframe);
        focusElement(iframe);
      });
    });
  }

  /* ======================================================================== *
   * Copy buttons — [data-copy="text"]
   * ======================================================================== */

  function initCopyButtons() {
    doc.addEventListener('click', (event) => {
      const button = closest(event.target, '[data-copy]');
      if (!button) return;
      const text = button.getAttribute('data-copy');
      if (!text) return;
      event.preventDefault();
      copyText(text).then((ok) => showToast(ok ? TEXT.copied : TEXT.copyFailed));
    });
  }

  /* ======================================================================== *
   * Inquiry form — validation, mail composition, endpoint POST / mailto, draft
   * ======================================================================== */

  function initInquiry() {
    qsa('form[data-inquiry]').forEach(setupInquiry);
  }

  function setupInquiry(form) {
    const email = attr(form, 'data-email');
    const prefix = attr(form, 'data-subject-prefix');
    const endpoint = attr(form, 'data-endpoint');
    const status = qs('[data-inquiry-status]', form);
    const copyButton = qs('[data-inquiry-copy]', form);
    let busy = false;
    let lastMailto = 0;
    form.noValidate = true; // this script shows its own (Korean) messages

    const setStatus = (text) => {
      if (status) status.textContent = text;
    };
    const setFormState = (state) => {
      if (state) form.setAttribute('data-state', state);
      else form.removeAttribute('data-state');
    };

    /* --- fields ----------------------------------------------------------- */
    const controls = () =>
      Array.from(form.elements).filter(
        (el) =>
          el.name &&
          !el.disabled &&
          /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) &&
          !/^(submit|button|reset|image|file|password)$/i.test(el.type || '')
      );
    const labelOf = (el) => attr(el, 'data-label') || el.name;
    const displayValue = (el) => {
      if (el.tagName === 'SELECT') {
        const option = el.options[el.selectedIndex];
        return option && option.value !== '' ? wellFormed((option.text || option.value).trim()) : '';
      }
      return wellFormed(String(el.value || '').replace(/\r\n?/g, '\n').trim());
    };

    /** Values in DOM order; checkbox/radio groups are joined. */
    const collect = () => {
      const list = [];
      const byName = {};
      controls().forEach((el) => {
        if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
        const value = displayValue(el);
        const existing = byName[el.name];
        if (existing) {
          if (value) existing.value = existing.value ? `${existing.value}, ${value}` : value;
          return;
        }
        const entry = {
          name: el.name,
          label: labelOf(el),
          value,
          inBody: el.type !== 'hidden',
        };
        byName[el.name] = entry;
        list.push(entry);
      });
      return { list, byName };
    };

    const compose = () => {
      const { list, byName } = collect();
      const get = (name) => (byName[name] ? byName[name].value : '');
      const name = get('name');
      const type = get('type') || TEXT.inquiryDefaultType;
      const core = name ? `${name} — ${type}` : type;
      const subject = wellFormed(prefix ? `${prefix} ${core}` : core);
      const message = byName.message || null;
      const lines = list.filter((f) => f !== message && f.inBody && f.value).map((f) => `${f.label}: ${f.value}`);
      return {
        subject,
        lines,
        message: message ? message.value : '',
        messageLabel: message ? message.label : '',
        fields: list,
        reply: get('reply'),
      };
    };

    const buildBody = (c, message, note) => {
      const blocks = [];
      if (c.lines.length) blocks.push(c.lines.join('\n'));
      if (message) blocks.push(c.messageLabel ? `${c.messageLabel}:\n${message}` : message);
      if (note) blocks.push(note);
      blocks.push(TEXT.inquiryFooter);
      return blocks.join('\n\n');
    };

    const mailtoUrl = (subject, body) =>
      `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\r?\n/g, '\r\n'))}`;

    /** First `max` code points of `text` (never splitting a surrogate pair), marked with … when cut. */
    const clip = (text, max) => {
      const chars = Array.from(text);
      return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : text;
    };

    /** The mailto: URL with the longest message prefix that fits within MAILTO_MAX, or ''. */
    const fitMessage = (c) => {
      const chars = Array.from(c.message); // code points — never split a surrogate pair
      let lo = 0;
      let hi = chars.length - 1;
      let fitted = '';
      while (lo <= hi) {
        const mid = (lo + hi) >> 1; // eslint-disable-line no-bitwise
        const url = mailtoUrl(c.subject, buildBody(c, `${chars.slice(0, mid).join('').trimEnd()}…`, TEXT.inquiryTruncatedNote));
        if (url.length <= MAILTO_MAX) {
          fitted = url;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return fitted;
    };

    /**
     * Build the mailto: URL within MAILTO_MAX: shorten the message first; if not even its start
     * fits, clip the subject and every other field too, and as a last resort send only the
     * subject and the note. The full text is always available through the copy button.
     */
    const fitMailto = (c) => {
      const body = buildBody(c, c.message, '');
      const url = mailtoUrl(c.subject, body);
      if (url.length <= MAILTO_MAX) return { body, url, truncated: false };
      let fitted = fitMessage(c);
      if (!fitted) {
        const clipped = Object.assign({}, c, {
          subject: clip(c.subject, MAILTO_FIELD_MAX),
          lines: c.lines.map((line) => clip(line, MAILTO_FIELD_MAX)),
        });
        fitted = fitMessage(clipped) || mailtoUrl(clipped.subject, buildBody({ lines: [] }, '', TEXT.inquiryTruncatedNote));
      }
      return { body, url: fitted, truncated: true };
    };

    const copyPayload = (c) => {
      const head = [];
      if (email) head.push(`${TEXT.inquiryRecipient}: ${email}`);
      head.push(`${TEXT.inquirySubject}: ${c.subject}`);
      return `${head.join('\n')}\n\n${buildBody(c, c.message, '')}`;
    };

    /* --- validation --------------------------------------------------------- */
    const errorSlot = (el) => qsa('[data-field-error]', form).find((slot) => slot.getAttribute('data-field-error') === el.name) || null;

    const fieldError = (el) => {
      const label = labelOf(el);
      if (el.type === 'checkbox' || el.type === 'radio') {
        const group = controls().filter((c) => c.name === el.name);
        return group.some((c) => c.checked) ? '' : TEXT.inquiryRequiredSelect(label);
      }
      const value = String(el.value || '').trim();
      if (!value) return el.tagName === 'SELECT' ? TEXT.inquiryRequiredSelect(label) : TEXT.inquiryRequired(label);
      if (el.type === 'email' && el.validity && el.validity.typeMismatch) return TEXT.inquiryEmailFormat;
      return '';
    };

    const showFieldError = (el, message) => {
      const slot = errorSlot(el);
      if (message) {
        el.setAttribute('aria-invalid', 'true');
        if (slot) {
          slot.textContent = message;
          slot.hidden = false;
        }
      } else {
        el.removeAttribute('aria-invalid');
        if (slot) {
          slot.textContent = '';
          slot.hidden = true;
        }
      }
    };

    const requiredControls = () => {
      const seen = new Set();
      return controls().filter((el) => {
        if (!(el.required || el.getAttribute('aria-required') === 'true')) return false;
        if (seen.has(el.name)) return false; // one error per radio/checkbox group
        seen.add(el.name);
        return true;
      });
    };

    const validate = () => {
      let first = null;
      let count = 0;
      requiredControls().forEach((el) => {
        const message = fieldError(el);
        showFieldError(el, message);
        if (message) {
          count += 1;
          if (!first) first = el;
        }
      });
      if (!first) return true;
      setFormState('error');
      setStatus(TEXT.inquiryInvalid(count));
      focusElement(first, false);
      return false;
    };

    const clearErrors = () => controls().forEach((el) => showFieldError(el, ''));

    // Re-check a flagged field as soon as it is corrected.
    const recheck = (event) => {
      const el = event.target;
      if (!el || el.getAttribute('aria-invalid') !== 'true') return;
      if (fieldError(el)) return;
      showFieldError(el, '');
      if (!qs('[aria-invalid="true"]', form) && form.getAttribute('data-state') === 'error') {
        setFormState('');
        setStatus('');
      }
    };
    form.addEventListener('input', recheck);
    form.addEventListener('change', recheck);

    /* --- draft autosave ------------------------------------------------------ */
    const saveDraft = () => {
      const fields = {};
      let hasContent = false;
      controls().forEach((el) => {
        if (el.type === 'hidden') return;
        if (el.type === 'checkbox' || el.type === 'radio') {
          if (!el.checked) return;
          fields[el.name] = (fields[el.name] || []).concat(el.value);
          hasContent = true;
          return;
        }
        const value = String(el.value || '');
        fields[el.name] = value;
        if (value.trim()) hasContent = true;
      });
      if (hasContent) storage.set(DRAFT_KEY, JSON.stringify({ v: 1, t: Date.now(), fields }));
      else storage.remove(DRAFT_KEY);
    };
    const scheduleSave = debounce(saveDraft, 400);
    const clearDraft = () => {
      scheduleSave.cancel();
      storage.remove(DRAFT_KEY);
    };

    const restoreDraft = () => {
      const raw = storage.get(DRAFT_KEY);
      if (!raw) return 0;
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch (err) {
        data = null;
      }
      if (!data || typeof data !== 'object' || !data.fields || typeof data.fields !== 'object') {
        storage.remove(DRAFT_KEY);
        return 0;
      }
      if (typeof data.t === 'number' && Date.now() - data.t > DRAFT_MAX_AGE) {
        storage.remove(DRAFT_KEY);
        return 0;
      }
      let restored = 0;
      controls().forEach((el) => {
        if (el.type === 'hidden' || !Object.prototype.hasOwnProperty.call(data.fields, el.name)) return;
        const saved = data.fields[el.name];
        if (el.type === 'checkbox' || el.type === 'radio') {
          if (Array.isArray(saved) && saved.indexOf(el.value) !== -1 && !el.checked) {
            el.checked = true;
            restored += 1;
          }
          return;
        }
        if (typeof saved !== 'string' || !saved.trim() || String(el.value || '').trim()) return; // never overwrite
        if (el.tagName === 'SELECT' && !Array.from(el.options).some((o) => o.value === saved)) return;
        el.value = saved;
        restored += 1;
      });
      return restored;
    };

    form.addEventListener('input', scheduleSave);
    form.addEventListener('change', scheduleSave);
    window.addEventListener('pagehide', scheduleSave.flush);
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) scheduleSave.flush();
    });
    if (restoreDraft() > 0) setStatus(TEXT.inquiryDraftRestored);

    /* --- sending ------------------------------------------------------------- */
    const openMail = (c, afterFailure) => {
      if (!email) {
        setFormState('error');
        setStatus(TEXT.inquiryNoEmail);
        return;
      }
      const mail = fitMailto(c);
      const detail = { subject: c.subject, body: mail.body, mailto: mail.url, truncated: mail.truncated };
      let proceed = true;
      try {
        proceed = form.dispatchEvent(new CustomEvent('tonecraft:inquiry', { detail, bubbles: true, cancelable: true }));
      } catch (err) {
        proceed = true;
      }
      const copied = mail.truncated ? copyText(copyPayload(c)) : null;
      // A double click must not open two compose windows.
      if (proceed && Date.now() - lastMailto > 1500) {
        lastMailto = Date.now();
        try {
          window.location.href = mail.url;
        } catch (err) {
          /* the status message below explains the manual route */
        }
      }
      setFormState('');
      const base = TEXT.inquiryMailto(email);
      setStatus(afterFailure ? `${TEXT.inquirySendFailed} ${base}` : base);
      if (copied) {
        copied.then((ok) => {
          if (ok) setStatus(`${TEXT.inquiryTruncatedCopied} ${base}`);
        });
      }
    };

    const sendToEndpoint = (c) => {
      busy = true;
      form.setAttribute('aria-busy', 'true');
      setFormState('');
      setStatus(TEXT.inquirySending);

      const payload = {};
      c.fields.forEach((f) => {
        payload[f.name] = f.value;
      });
      payload._subject = c.subject;
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.reply)) payload._replyto = c.reply;

      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? window.setTimeout(() => controller.abort(), ENDPOINT_TIMEOUT) : 0;
      let request;
      try {
        request = window.fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'omit',
          signal: controller ? controller.signal : undefined,
        });
      } catch (err) {
        request = Promise.reject(err);
      }
      return request
        .then(
          (response) => !!(response && response.ok),
          () => false
        )
        .then((ok) => {
          window.clearTimeout(timer);
          busy = false;
          form.removeAttribute('aria-busy');
          return ok;
        });
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (busy || !validate()) return;
      scheduleSave.flush();
      const c = compose();
      if (endpoint && typeof window.fetch === 'function') {
        sendToEndpoint(c).then((ok) => {
          if (!ok) {
            openMail(c, true);
            return;
          }
          clearDraft();
          form.reset();
          clearErrors();
          setFormState('sent');
          setStatus(TEXT.inquirySent);
        });
      } else {
        openMail(c, false);
      }
    });

    if (copyButton) {
      copyButton.addEventListener('click', () => {
        if (!validate()) return;
        const c = compose();
        copyText(copyPayload(c)).then((ok) => {
          setFormState(ok ? 'copied' : 'error');
          if (ok) setStatus(email ? TEXT.inquiryCopied(email) : TEXT.inquiryCopiedNoEmail);
          else setStatus(TEXT.inquiryCopyFailed);
        });
      });
    }
  }

  /* ======================================================================== *
   * Boot
   * ======================================================================== */

  function run(init, arg) {
    try {
      return init(arg);
    } catch (err) {
      if (window.console && typeof window.console.error === 'function') window.console.error('[tonecraft]', err);
      return null;
    }
  }

  function boot() {
    // The inline <head> snippet normally does this; repeat it in case that snippet was blocked.
    root.classList.remove('no-js');
    root.classList.add('js');

    run(initFileLinks);
    run(initTracking);
    run(initHeader);
    run(initScrollSpy);
    run(initReveal);
    const hero = run(initHero);
    run(initVideoDialog, hero);
    run(initFilters);
    run(initHoverPreviews);
    run(initCompare);
    run(initEmbedFacades);
    run(initCopyButtons);
    run(initInquiry);
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
