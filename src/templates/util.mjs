// Shared helpers for the HTML templates.
// Every interpolated value in the templates goes through escapeHtml (text and attributes).
// Templates are pure functions of the view model (vm) — no I/O, no globals, no Date.now().

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

/** Escape a value for use in HTML text or a double-quoted attribute. null/undefined/false → ''. */
export function escapeHtml(value) {
  if (value === null || value === undefined || value === false) return '';
  return String(value).replace(/[&<>"'`]/g, (c) => ESCAPES[c]);
}

export const esc = escapeHtml;

/** true for a non-empty (after trim) string */
export function filled(value) {
  return typeof value === 'string' ? value.trim() !== '' : value !== null && value !== undefined && value !== false;
}

/** Array guard: returns the array or [] */
export function arr(value) {
  return Array.isArray(value) ? value : [];
}

/** Positive integer or null (for width/height attributes). */
export function int(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Build an attribute string from an object.
 *   attrs({ href: 'a', hidden: true, title: '', 'data-x': null }) → ' href="a" hidden'
 * null / undefined / false / '' are skipped (except alt=""); true renders a bare attribute; everything else is escaped.
 */
const KEEP_EMPTY = new Set(['alt']); // alt="" marks decorative images — must be rendered

export function attrs(obj) {
  let out = '';
  for (const [name, value] of Object.entries(obj)) {
    if (value === '' && KEEP_EMPTY.has(name)) {
      out += ` ${name}=""`;
      continue;
    }
    if (value === null || value === undefined || value === false || value === '') continue;
    out += value === true ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`;
  }
  return out;
}

/** Absolute URL / special scheme (not to be prefixed with paths.root). */
export function isAbsoluteUrl(href) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(String(href || ''));
}

export function isExternalUrl(href) {
  return /^(?:https?:)?\/\//i.test(String(href || ''));
}

/** Percent-encode each path segment (keeps '/', leaves already-encoded sequences intact). */
export function encodePath(path) {
  return String(path || '')
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

/**
 * Root-relative site path (e.g. 'media/works/x/poster.jpg') → URL usable from the current page.
 * Absolute URLs are returned unchanged.
 */
export function assetUrl(root, path) {
  if (!filled(path)) return '';
  const p = String(path);
  if (isAbsoluteUrl(p)) return p;
  return `${root || ''}${encodePath(p.replace(/^\.?\//, ''))}`;
}

/**
 * Content href (from site.mjs, e.g. '#contact', 'works/x/', 'https://…', 'mailto:…') → URL for the current page.
 * Hash links and relative paths are prefixed with root; absolute URLs are kept.
 */
export function linkHref(root, href) {
  const h = String(href || '').trim();
  if (!h) return root || './';
  // defense in depth (content.mjs already validates): never render a script / data URL as a link
  if (/^(?:javascript|vbscript|data|file):/i.test(h.replace(/[\u0000- ]/g, ''))) return `${root || ''}#contact`;
  if (isAbsoluteUrl(h)) return h;
  if (h.startsWith('#')) return `${root || ''}${h}`;
  return `${root || ''}${h.replace(/^\.\//, '')}`;
}

/** Attributes for an external link: target + rel */
export function externalAttrs(href) {
  return isExternalUrl(href) ? { target: '_blank', rel: 'noopener' } : {};
}

/** srcset string from a media image object { src, w, srcset: [{src, w}] } */
export function srcsetOf(root, image) {
  if (!image) return '';
  const list = arr(image.srcset).filter((s) => s && filled(s.src) && int(s.w));
  if (!list.length) return '';
  const seen = new Set();
  return list
    .slice()
    .sort((a, b) => int(a.w) - int(b.w))
    .filter((s) => {
      const key = int(s.w);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((s) => `${assetUrl(root, s.src)} ${int(s.w)}w`)
    .join(', ');
}

/**
 * Pick one URL from an image object, preferring the smallest variant ≥ target width
 * (falls back to the largest available). Used where only a single URL is possible (video poster).
 * On equal widths the srcset variant (WebP) wins over the full-size JPEG — e.g. a 1080×1920 vertical
 * poster, whose 'poster-1280.webp' is also 1080 wide.
 */
export function pickSrc(root, image, target = 1280) {
  if (!image) return '';
  const candidates = arr(image.srcset).filter((s) => s && filled(s.src) && int(s.w));
  if (filled(image.src)) candidates.push({ src: image.src, w: int(image.w) || 1920 });
  if (!candidates.length) return '';
  candidates.sort((a, b) => int(a.w) - int(b.w)); // stable: srcset entries stay ahead of image.src
  const widest = int(candidates[candidates.length - 1].w);
  const hit = candidates.find((c) => int(c.w) >= target) || candidates.find((c) => int(c.w) === widest);
  return assetUrl(root, hit.src);
}

/** CSS aspect-ratio value from w/h ("1920 / 1080"); fallback 16 / 9 */
export function ratio(w, h, fallback = '16 / 9') {
  const W = int(w);
  const H = int(h);
  return W && H ? `${W} / ${H}` : fallback;
}

/** Serialize a JSON-LD object for a <script> element (escapes '<' so '</script>' cannot break out). */
export function jsonLdScript(obj) {
  const json = JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<script type="application/ld+json">${json}</script>`;
}

/** Two-digit index: 1 → '01' */
export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Join non-empty parts with a separator (parts are raw strings; escape the result). */
export function joinParts(parts, sep = ' · ') {
  return parts.filter((p) => p !== null && p !== undefined && String(p).trim() !== '').join(sep);
}

/**
 * Escaped Korean prose with two line-break fixes that `word-break: keep-all` cannot express:
 *  - a ' · ' list separator stays with the word before it (a line never starts with '·'):
 *    '그레이딩 · 카메라 매칭 · 룩 개발 · 리터치'
 *  - a particle after a closing bracket stays attached (WORD JOINER): '(XML·EDL·AAF 등)와' never breaks before '와'
 * Use for body text / leads / list items instead of esc().
 */
export function krText(value) {
  return escapeHtml(value)
    .replace(/ ·(?= )/g, '&nbsp;·')
    .replace(/([)\]\u300d\u300f\u3009\u300b])(?=[\uac00-\ud7af])/g, '$1&#8288;');
}

/** true when the text contains Hangul (used to relax letter-spacing on mono labels) */
export function hasHangul(text) {
  return /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(String(text || ''));
}

/**
 * ' lang="en"' for an English-only label ('WORKS', 'GRADE NOTES', 'COLOR GRADING · DI'), '' otherwise.
 * The page is lang="ko": without it a Korean voice reads (or spells out) the English words (WCAG 3.1.2).
 */
export function langAttr(text) {
  const t = String(text ?? '');
  return /[A-Za-z]/.test(t) && !hasHangul(t) ? ' lang="en"' : '';
}

/** class list for a mono label; adds 'label--ko' when the text contains Hangul */
export function labelClass(text, base = 'label') {
  return hasHangul(text) ? `${base} label--ko` : base;
}

/**
 * Metadata parts ('광고', 2026) → escaped HTML with a drawn separator.
 * The separator text is ', ' so screen readers pause; CSS renders it as a short rule.
 * Each separator is wrapped together with the part after it (.meta__part), so when a long client name
 * wraps, the rule moves with it instead of hanging at the end of a line.
 */
export function metaHtml(parts) {
  return parts
    .filter((p) => p !== null && p !== undefined && String(p).trim() !== '')
    .map((p, i) => (i === 0 ? `<span>${krText(p)}</span>` : `<span class="meta__part"><span class="sep">, </span><span>${krText(p)}</span></span>`))
    .join('');
}

/** Strip whitespace between tags where safe and collapse blank lines (cosmetic). */
export function tidy(html) {
  return html.replace(/\n\s*\n+/g, '\n');
}
