// Inline SVG icons + brand mark + the decorative vectorscope graticule.
// All icons are decorative (aria-hidden) — the accessible name lives on the control.

const svg = (cls, viewBox, body, size = 20) =>
  `<svg class="icon ${cls.trim()}" viewBox="${viewBox}" width="${size}" height="${size}" aria-hidden="true" focusable="false">${body}</svg>`;

const stroke = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

export const icons = {
  arrowRight: (cls = '') => svg(`icon--arrow ${cls}`, '0 0 20 20', `<path ${stroke} d="M4 10h11M11 5.5 15.5 10 11 14.5"/>`),
  arrowLeft: (cls = '') => svg(`icon--arrow-left ${cls}`, '0 0 20 20', `<path ${stroke} d="M16 10H5M9 5.5 4.5 10 9 14.5"/>`),
  arrowUpRight: (cls = '') => svg(`icon--external ${cls}`, '0 0 20 20', `<path ${stroke} d="M6 14 14 6M7.5 6H14v6.5"/>`),
  arrowUp: (cls = '') => svg(`icon--up ${cls}`, '0 0 20 20', `<path ${stroke} d="M10 16V4.5M5.5 9 10 4.5 14.5 9"/>`),
  arrowDown: (cls = '') => svg(`icon--down ${cls}`, '0 0 20 20', `<path ${stroke} d="M10 4v11.5M5.5 11 10 15.5 14.5 11"/>`),
  play: (cls = '') => svg(`icon--play ${cls}`, '0 0 20 20', '<path fill="currentColor" d="M6.5 4.2v11.6a.6.6 0 0 0 .9.5l9.1-5.8a.6.6 0 0 0 0-1L7.4 3.7a.6.6 0 0 0-.9.5Z"/>'),
  pause: (cls = '') => svg(`icon--pause ${cls}`, '0 0 20 20', '<rect x="5.5" y="4" width="3" height="12" rx=".6" fill="currentColor"/><rect x="11.5" y="4" width="3" height="12" rx=".6" fill="currentColor"/>'),
  close: (cls = '') => svg(`icon--close ${cls}`, '0 0 20 20', `<path ${stroke} d="m5 5 10 10M15 5 5 15"/>`),
  copy: (cls = '') => svg(`icon--copy ${cls}`, '0 0 20 20', `<rect ${stroke} x="7" y="7" width="9" height="9" rx="1.5"/><path ${stroke} d="M13 4.5V4.4A1.4 1.4 0 0 0 11.6 3H4.4A1.4 1.4 0 0 0 3 4.4v7.2A1.4 1.4 0 0 0 4.4 13h.1"/>`),
  mail: (cls = '') => svg(`icon--mail ${cls}`, '0 0 20 20', `<rect ${stroke} x="2.8" y="4.5" width="14.4" height="11" rx="1.6"/><path ${stroke} d="m3.5 5.5 6.5 5 6.5-5"/>`),
  check: (cls = '') => svg(`icon--check ${cls}`, '0 0 20 20', `<path ${stroke} d="m4.5 10.5 3.5 3.5 7.5-8"/>`),
  plus: (cls = '') => svg(`icon--plus ${cls}`, '0 0 20 20', `<path ${stroke} d="M10 4v12M4 10h12"/>`),
  chevrons: (cls = '') =>
    svg(`icon--chevrons ${cls}`, '0 0 24 24', '<path fill="currentColor" d="M9.6 7.2v9.6L4.4 12zM14.4 7.2v9.6l5.2-4.8z"/>', 22),
};

/** Brand mark — same geometry as site/assets/img/mark.svg (ring + skin-tone I-line + centre dot). */
export function brandMark(cls = 'brand__mark', size = 28) {
  return `<svg class="${cls}" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="2"/><line class="mark-line" x1="16" y1="16" x2="10.01" y2="6.77" stroke="#e3a46f" stroke-width="2.25" stroke-linecap="round"/><circle cx="16" cy="16" r="2.1" fill="currentColor"/></svg>`;
}

// ---------------------------------------------------------------------------------------------
// Vectorscope graticule (decorative). Deterministic output — seeded PRNG, fixed rounding.
// Angles are the real Rec.709 vectorscope positions (degrees counter-clockwise from +Cb axis):
//   R ≈103°, MG ≈50°, B ≈355°, CY ≈283°, G ≈230°, YL ≈175° (computed from BT.709 Cb/Cr), skin-tone line 123°.
// ---------------------------------------------------------------------------------------------

const C = 500; // centre in a 1000×1000 viewBox
const R = 440; // 100 % ring

const toXY = (deg, r) => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.cos(a), C - r * Math.sin(a)];
};
const f = (n) => (Math.round(n * 10) / 10).toString();

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  // Box–Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Rec.709 colour-bar targets: angle + magnitude relative to the 100 % ring (75 % bars shown).
const TARGETS = [
  { id: 'R', deg: 102.9, mag: 0.513 },
  { id: 'MG', deg: 49.7, mag: 0.596 },
  { id: 'B', deg: -5.2, mag: 0.502 },
  { id: 'CY', deg: 282.9, mag: 0.513 },
  { id: 'G', deg: 229.7, mag: 0.596 },
  { id: 'YL', deg: 174.8, mag: 0.502 },
];
const MAG_FULL = 0.62; // magnitude that maps onto the outer ring

function graticulePaths() {
  // Degree ticks around the ring: every 5°, long every 30°
  let ticks = '';
  for (let d = 0; d < 360; d += 5) {
    const long = d % 30 === 0;
    const [x1, y1] = toXY(d, R);
    const [x2, y2] = toXY(d, R - (long ? 18 : 8));
    ticks += `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;
  }
  // 10 % ticks along the crosshair axes
  let axis = '';
  for (let i = 1; i < 10; i++) {
    const r = (R * i) / 10;
    const s = i === 5 ? 9 : 5;
    axis += `M${f(C + r)} ${f(C - s)}V${f(C + s)}M${f(C - r)} ${f(C - s)}V${f(C + s)}`;
    axis += `M${f(C - s)} ${f(C + r)}H${f(C + s)}M${f(C - s)} ${f(C - r)}H${f(C + s)}`;
  }
  return { ticks, axis };
}

function targetBoxes() {
  let boxes = '';
  let labels = '';
  for (const t of TARGETS) {
    const r = ((t.mag * 0.75) / MAG_FULL) * R;
    const [x, y] = toXY(t.deg, r);
    const s = 15;
    boxes += `<rect x="${f(x - s)}" y="${f(y - s)}" width="${s * 2}" height="${s * 2}" transform="rotate(${f(-t.deg)} ${f(x)} ${f(y)})"/>`;
    const [lx, ly] = toXY(t.deg, r + 44);
    labels += `<text x="${f(lx)}" y="${f(ly)}">${t.id}</text>`;
  }
  return { boxes, labels };
}

function tracePath() {
  // Orange/teal-style trace: a cluster along the skin-tone line, a neutral core and a teal shadow lobe.
  const rand = mulberry32(20260927);
  let d = '';
  const add = (deg, rr) => {
    const r = Math.min(Math.abs(rr), 0.62) * R;
    const [x, y] = toXY(deg, r);
    d += `M${Math.round(x)} ${Math.round(y)}h0`;
  };
  for (let i = 0; i < 300; i++) add(123 + gauss(rand) * 6.5, 0.05 + Math.abs(gauss(rand)) * 0.17);
  for (let i = 0; i < 140; i++) add(rand() * 360, Math.abs(gauss(rand)) * 0.045);
  for (let i = 0; i < 110; i++) add(303 + gauss(rand) * 9, 0.04 + Math.abs(gauss(rand)) * 0.11);
  return d;
}

let cachedScope = null;

/**
 * Decorative vectorscope. variant 'trace' (hero, with a graded-footage trace) or 'empty' (404: no signal).
 */
export function vectorscope(variant = 'trace', cls = '') {
  if (!cachedScope) {
    const { ticks, axis } = graticulePaths();
    const { boxes, labels } = targetBoxes();
    const [sx, sy] = toXY(123, R);
    cachedScope = {
      base:
        `<circle class="scope__ring" cx="${C}" cy="${C}" r="${R}"/>` +
        `<circle class="scope__ring scope__ring--75" cx="${C}" cy="${C}" r="${f(R * 0.75)}"/>` +
        `<path class="scope__cross" d="M${C - R} ${C}H${C + R}M${C} ${C - R}V${C + R}"/>` +
        `<path class="scope__ticks" d="${ticks}"/>` +
        `<path class="scope__axis" d="${axis}"/>` +
        `<g class="scope__targets">${boxes}</g>` +
        `<g class="scope__labels">${labels}</g>` +
        `<line class="scope__skin" x1="${C}" y1="${C}" x2="${f(sx)}" y2="${f(sy)}"/>`,
      trace: `<path class="scope__trace" d="${tracePath()}"/>`,
    };
  }
  const trace = variant === 'trace' ? cachedScope.trace : `<circle class="scope__dot" cx="${C}" cy="${C}" r="7"/>`;
  return `<svg class="scope ${cls}" viewBox="0 0 1000 1000" aria-hidden="true" focusable="false">${cachedScope.base}${trace}</svg>`;
}
