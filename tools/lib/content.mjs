// Content loading, validation and normalization (spec §2.3).
// Templates receive only normalized data: every string is a string, every list an array — never undefined.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isFile } from './fsutil.mjs';

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CATEGORY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CONSENT_VALUES = ['granted', 'pending', 'not-required'];
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const DEFAULT_SECTIONS = {
  works: 'WORKS',
  compare: 'BEFORE / AFTER',
  services: 'SERVICES',
  process: 'PROCESS',
  formats: 'WORKFLOW',
  packages: 'PRICING',
  about: 'ABOUT',
  faq: 'FAQ',
  contact: 'CONTACT',
};

// ---------------------------------------------------------------------------------------------
// primitive coercions

function str(v, d = '') {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return d;
}

function strOr(v, d) {
  const s = str(v);
  return s === '' ? d : s;
}

function bool(v, d = false) {
  return typeof v === 'boolean' ? v : d;
}

function list(v) {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined || v === '') return [];
  return [v];
}

function strList(v) {
  return list(v).map((x) => str(x)).filter(Boolean);
}

function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function isHttpsUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && Boolean(u.hostname);
  } catch {
    return false;
  }
}

export function isValidEmail(s) {
  return typeof s === 'string' && EMAIL_RE.test(s);
}

// ---------------------------------------------------------------------------------------------
// embeds

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** Parse a YouTube/Vimeo id or full URL. Returns { type, id, hash } or null. */
export function parseEmbedRef(type, rawId) {
  const t = String(type || '').toLowerCase();
  let id = String(rawId ?? '').trim();
  let hash = '';
  if (!id) return null;
  if (/^https?:\/\//i.test(id)) {
    let u;
    try {
      u = new URL(id);
    } catch {
      return null;
    }
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (t === 'youtube') {
      if (host === 'youtu.be') id = u.pathname.split('/')[1] || '';
      else if (u.searchParams.get('v')) id = u.searchParams.get('v');
      else {
        const m = u.pathname.match(/\/(?:embed|shorts|live|v)\/([^/?#]+)/);
        id = m ? m[1] : '';
      }
    } else if (t === 'vimeo') {
      const parts = u.pathname.split('/').filter(Boolean);
      const i = parts.findIndex((p) => /^\d+$/.test(p));
      id = i >= 0 ? parts[i] : '';
      const next = i >= 0 ? parts[i + 1] : '';
      hash = u.searchParams.get('h') || (next && /^[0-9a-f]{6,}$/i.test(next) ? next : '');
    } else return null;
  } else if (t === 'vimeo') {
    // '123456789' or unlisted '123456789/abcdef1234' or '123456789:abcdef1234'
    const m = id.match(/^(\d+)(?:[/:?]h?=?([0-9a-f]{6,}))?$/i);
    if (!m) return null;
    id = m[1];
    hash = m[2] || '';
  }
  if (t === 'youtube') return YT_ID.test(id) ? { type: 'youtube', id, hash: '' } : null;
  if (t === 'vimeo') return /^\d+$/.test(id) ? { type: 'vimeo', id, hash: hash.toLowerCase() } : null;
  return null;
}

/** Build the normalized embed object { type, id, embedUrl, pageUrl } (+ hash for unlisted Vimeo). */
export function makeEmbed({ type, id, hash = '' }) {
  if (type === 'vimeo') {
    return {
      type,
      id,
      hash,
      embedUrl: `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1&title=0&byline=0&portrait=0${hash ? `&h=${hash}` : ''}`,
      pageUrl: hash ? `https://vimeo.com/${id}/${hash}` : `https://vimeo.com/${id}`,
    };
  }
  return {
    type,
    id,
    hash: '',
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`,
    pageUrl: `https://www.youtube.com/watch?v=${id}`,
  };
}

/** Normalize an embed field (object or URL string). Pushes errors on invalid input. */
export function normalizeEmbed(v, where, issues) {
  if (v === null || v === undefined || v === '' || v === false) return null;
  let type;
  let id;
  if (typeof v === 'string') {
    if (/vimeo\.com/i.test(v)) type = 'vimeo';
    else if (/youtu\.?be/i.test(v)) type = 'youtube';
    else {
      issues.errors.push(`${where}: 영상 주소를 알아볼 수 없습니다 → { type: 'vimeo' | 'youtube', id: '...' } 형식으로 적어 주세요.`);
      return null;
    }
    id = v;
  } else if (typeof v === 'object') {
    type = String(v.type || '').toLowerCase();
    id = v.hash ? `${v.id}/${v.hash}` : v.id;
  } else {
    issues.errors.push(`${where}: 영상 정보 형식이 올바르지 않습니다.`);
    return null;
  }
  if (type !== 'vimeo' && type !== 'youtube') {
    issues.errors.push(`${where}.type "${str(v.type)}" — 'vimeo' 또는 'youtube'만 사용할 수 있습니다.`);
    return null;
  }
  const ref = parseEmbedRef(type, id);
  if (!ref) {
    issues.errors.push(
      `${where}.id "${str(typeof v === 'object' ? v.id : v)}" — ${type === 'vimeo' ? 'Vimeo 영상 번호(숫자)' : 'YouTube 영상 ID(11자)'} 또는 영상 주소를 적어 주세요.`,
    );
    return null;
  }
  return makeEmbed(ref);
}

// ---------------------------------------------------------------------------------------------
// site.mjs

function normUrlField(v, where, issues, { trimSlash = false } = {}) {
  let s = str(v);
  if (!s) return '';
  if (!isHttpsUrl(s)) {
    issues.errors.push(`${where} "${s}" — https:// 로 시작하는 전체 주소여야 합니다 (비워 두려면 '').`);
    return '';
  }
  if (trimSlash) {
    const u = new URL(s);
    u.hash = '';
    u.search = '';
    s = u.toString().replace(/\/+$/, '');
  }
  return s;
}

export function normalizeSite(raw, issues = { errors: [], warnings: [] }) {
  const r = obj(raw);
  const brand = obj(r.brand);
  const contact = obj(r.contact);
  const business = obj(r.business);
  const hero = obj(r.hero);
  const reel = obj(r.reel);
  const sections = obj(r.sections);
  const formats = obj(r.formats);
  const about = obj(r.about);
  const inquiry = obj(r.inquiry);
  const seo = obj(r.seo);
  const analytics = obj(r.analytics);

  const siteUrl = normUrlField(r.siteUrl, 'site.siteUrl', issues, { trimSlash: true });

  const email = str(contact.email);
  if (!email) issues.errors.push('site.contact.email — 문의 받을 이메일 주소가 비어 있습니다.');
  else if (!isValidEmail(email)) issues.errors.push(`site.contact.email "${email}" — 이메일 형식이 올바르지 않습니다.`);

  const primaryCta = obj(hero.primaryCta);
  const reelCta = obj(hero.reelCta);

  const outSections = {};
  for (const [key, eyebrow] of Object.entries(DEFAULT_SECTIONS)) {
    const s = obj(sections[key]);
    outSections[key] = { eyebrow: strOr(s.eyebrow, eyebrow), title: str(s.title), lead: str(s.lead) };
  }

  const categories = [];
  const seenCat = new Set();
  list(r.categories).forEach((c, i) => {
    const o = obj(c);
    const id = str(o.id);
    if (!id || !CATEGORY_ID_RE.test(id)) {
      issues.errors.push(`site.categories[${i}].id "${id}" — 소문자 영문·숫자·하이픈만 사용할 수 있습니다 (예: 'music-video').`);
      return;
    }
    if (seenCat.has(id)) {
      issues.errors.push(`site.categories — id "${id}"가 중복되었습니다.`);
      return;
    }
    seenCat.add(id);
    categories.push({ id, label: strOr(o.label, id) });
  });

  const services = list(r.services)
    .map(obj)
    .map((s, i) => ({
      id: strOr(s.id, `service-${i + 1}`),
      title: str(s.title),
      en: str(s.en),
      summary: str(s.summary),
      points: strList(s.points),
    }))
    .filter((s) => s.title);

  const packages = list(r.packages)
    .map(obj)
    .map((p) => ({
      name: str(p.name),
      summary: str(p.summary),
      price: str(p.price) || null,
      includes: strList(p.includes),
      note: str(p.note),
    }))
    .filter((p) => p.name);

  const reelEmbed = normalizeEmbed(reel.embed, 'site.reel.embed', issues);
  const fps = numOrNull(reel.fps);

  const site = {
    siteUrl,
    brand: {
      name: strOr(brand.name, 'TONECRAFT'),
      person: str(brand.person),
      role: str(brand.role),
      tagline: str(brand.tagline),
    },
    contact: {
      email,
      kmongUrl: normUrlField(contact.kmongUrl, 'site.contact.kmongUrl', issues),
      kmongLabel: strOr(contact.kmongLabel, '크몽에서 의뢰하기'),
      responseNote: str(contact.responseNote),
      formEndpoint: normUrlField(contact.formEndpoint, 'site.contact.formEndpoint', issues),
    },
    business: {
      name: str(business.name),
      owner: str(business.owner),
      regNo: str(business.regNo),
      mailOrderNo: str(business.mailOrderNo),
      address: str(business.address),
    },
    hero: {
      eyebrow: str(hero.eyebrow),
      title: strList(hero.title).slice(0, 3),
      lead: str(hero.lead),
      primaryCta: { label: strOr(primaryCta.label, '프로젝트 문의하기'), href: strOr(primaryCta.href, '#contact') },
      reelCta: { label: strOr(reelCta.label, '쇼릴 보기') },
    },
    reel: {
      publish: reel.publish !== false,
      title: strOr(reel.title, `${strOr(brand.name, 'TONECRAFT')} Showreel`),
      embed: reelEmbed,
      fps: fps && fps > 0 && fps <= 120 ? fps : 24,
    },
    sections: outSections,
    categories,
    services,
    process: list(r.process)
      .map(obj)
      .map((p) => ({ title: str(p.title), body: str(p.body) }))
      .filter((p) => p.title),
    formats: {
      groups: list(formats.groups)
        .map(obj)
        .map((g) => ({ title: str(g.title), items: strList(g.items) }))
        .filter((g) => g.title || g.items.length),
    },
    packages,
    about: {
      paragraphs: strList(about.paragraphs),
      facts: list(about.facts)
        .map(obj)
        .map((f) => ({ label: str(f.label), value: str(f.value) }))
        .filter((f) => f.label || f.value),
      portrait: str(about.portrait) || null,
    },
    faq: list(r.faq)
      .map(obj)
      .map((f) => ({ q: str(f.q), a: str(f.a) }))
      .filter((f) => f.q),
    inquiry: {
      intro: str(inquiry.intro),
      subjectPrefix: strOr(inquiry.subjectPrefix, `[${strOr(brand.name, 'TONECRAFT')} 문의]`),
      projectTypes: strList(inquiry.projectTypes),
      budgets: strList(inquiry.budgets),
    },
    seo: {
      title: str(seo.title),
      description: str(seo.description),
      keywords: strList(seo.keywords),
      ogImage: strOr(seo.ogImage, 'assets/img/og-default.jpg'),
      googleVerification: str(seo.googleVerification),
      naverVerification: str(seo.naverVerification),
    },
    analytics: { ga4Id: str(analytics.ga4Id) },
  };

  if (site.analytics.ga4Id && !/^G-[A-Z0-9]{4,20}$/i.test(site.analytics.ga4Id)) {
    issues.warnings.push(`site.analytics.ga4Id "${site.analytics.ga4Id}" — GA4 측정 ID는 보통 'G-XXXXXXX' 형식입니다.`);
  }
  if (!site.seo.title) site.seo.title = [site.brand.name, site.brand.role].filter(Boolean).join(' — ');
  if (!siteUrl) {
    issues.warnings.push(
      'site.siteUrl이 비어 있습니다 — 공유 미리보기 이미지(카카오톡/페이스북)와 canonical·사이트맵이 절대 주소 없이 만들어집니다. 배포 주소가 정해지면 입력하세요. (GitHub Pages처럼 하위 폴더 주소에 배포할 때는 404 페이지의 디자인·링크도 siteUrl이 있어야 정상 표시됩니다)',
    );
  }
  if (!site.contact.kmongUrl) issues.warnings.push('site.contact.kmongUrl이 비어 있어 크몽 버튼이 숨겨집니다.');
  if (!categories.length) issues.errors.push('site.categories — 카테고리가 하나 이상 필요합니다.');
  return site;
}

// ---------------------------------------------------------------------------------------------
// works.mjs

const WORK_DEFAULT_ROLE = '컬러 그레이딩';

export function normalizeWorks(rawList, site, issues = { errors: [], warnings: [] }) {
  if (!Array.isArray(rawList)) {
    issues.errors.push('content/works.mjs — export default 는 배열이어야 합니다 ([ { slug, title, ... } ]).');
    return [];
  }
  const catLabel = new Map(site.categories.map((c) => [c.id, c.label]));
  const seen = new Set();
  const out = [];
  rawList.forEach((raw, i) => {
    const w = obj(raw);
    const slug = str(w.slug);
    const where = `works[${i}]${slug ? ` (${slug})` : ''}`;
    let bad = false;
    if (!slug) {
      issues.errors.push(`${where}: slug가 없습니다.`);
      bad = true;
    } else if (!SLUG_RE.test(slug)) {
      issues.errors.push(`${where}: slug "${slug}" — 소문자 영문·숫자·하이픈만 사용할 수 있습니다 (예: 'brand-film-2026').`);
      bad = true;
    } else if (seen.has(slug)) {
      issues.errors.push(`${where}: slug "${slug}"가 중복되었습니다.`);
      bad = true;
    }
    if (slug) seen.add(slug);
    const title = str(w.title);
    if (!title) {
      issues.errors.push(`${where}: title(작품 제목)이 없습니다.`);
      bad = true;
    }
    const category = str(w.category);
    if (!catLabel.has(category)) {
      issues.errors.push(
        `${where}: category "${category}" — site.mjs의 categories에 있는 id여야 합니다 (${[...catLabel.keys()].join(', ') || '없음'}).`,
      );
      bad = true;
    }
    const consentRaw = w.consent === undefined || w.consent === null || w.consent === '' ? 'pending' : w.consent;
    const consent = str(consentRaw);
    if (!CONSENT_VALUES.includes(consent)) {
      issues.errors.push(`${where}: consent "${consent}" — 'granted' | 'pending' | 'not-required' 중 하나여야 합니다.`);
      bad = true;
    }
    const errCount = issues.errors.length;
    const video = normalizeEmbed(w.video, `${where}.video`, issues);
    if (issues.errors.length > errCount) bad = true;

    let date = str(w.date);
    let dateYear = null;
    if (date) {
      const m = date.match(DATE_RE);
      const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
      if (!m || !d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
        issues.warnings.push(`${where}: date "${date}" — 'YYYY-MM-DD' 형식이 아니라서 무시합니다.`);
        date = '';
      } else dateYear = +m[1];
    }
    let year = numOrNull(w.year);
    if (w.year !== undefined && w.year !== null && w.year !== '' && (year === null || !Number.isInteger(year) || year < 1900 || year > 2200)) {
      issues.warnings.push(`${where}: year "${w.year}" — 연도(숫자)가 아니라서 무시합니다.`);
      year = null;
    }
    if (year === null && dateYear) year = dateYear;

    const comparisons = list(w.comparisons).map((cmp) => {
      const o = typeof cmp === 'string' ? { caption: cmp } : obj(cmp);
      return {
        caption: str(o.caption),
        beforeLabel: strOr(o.beforeLabel, 'BEFORE'),
        afterLabel: strOr(o.afterLabel, 'AFTER'),
      };
    });

    const posNum = (v) => {
      const n = numOrNull(v);
      return n !== null && n >= 0 ? n : null;
    };
    const posDur = (v, d) => {
      const n = numOrNull(v);
      return n !== null && n > 0 ? n : d;
    };

    const work = {
      slug,
      title,
      client: str(w.client),
      category,
      categoryLabel: catLabel.get(category) || category,
      year,
      date,
      role: strOr(w.role, WORK_DEFAULT_ROLE),
      summary: str(w.summary),
      notes: strList(w.notes),
      credits: list(w.credits)
        .map(obj)
        .map((cr) => ({ role: str(cr.role), name: str(cr.name) }))
        .filter((cr) => cr.name),
      camera: str(w.camera),
      featured: bool(w.featured),
      order: numOrNull(w.order) ?? 0,
      publish: w.publish === true,
      consent,
      video,
      comparisons,
      alt: strOr(w.alt, `${title} 컬러 그레이딩 장면`),
      posterTime: posNum(w.posterTime),
      previewStart: posNum(w.previewStart),
      previewDuration: posDur(w.previewDuration, 6),
      baTimes: list(w.baTimes).map(posNum),
      baVideo: bool(w.baVideo),
      baVideoStart: posNum(w.baVideoStart),
      baVideoDuration: posDur(w.baVideoDuration, 8),
    };
    if (!bad) out.push(work);
  });
  return sortWorks(out);
}

/** order ascending, then year descending (unknown last), then title (Korean collation). */
export function sortWorks(works) {
  return works.slice().sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    const ya = a.year ?? -Infinity;
    const yb = b.year ?? -Infinity;
    if (ya !== yb) return yb - ya;
    return a.title.localeCompare(b.title, 'ko');
  });
}

// ---------------------------------------------------------------------------------------------
// loading

async function importFresh(file) {
  const url = `${pathToFileURL(file).href}?t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const mod = await import(url);
  return mod.default;
}

/**
 * Load + validate + normalize <root>/content/site.mjs and works.mjs.
 * Returns { site, works, errors, warnings }. Never throws for content problems.
 */
export async function loadContent(root) {
  const issues = { errors: [], warnings: [] };
  const siteFile = path.join(root, 'content', 'site.mjs');
  const worksFile = path.join(root, 'content', 'works.mjs');
  let rawSite = null;
  let rawWorks = [];
  if (!(await isFile(siteFile))) {
    issues.errors.push(`content/site.mjs 파일이 없습니다 (${siteFile}).`);
  } else {
    try {
      rawSite = await importFresh(siteFile);
    } catch (err) {
      issues.errors.push(`content/site.mjs를 읽지 못했습니다 — ${describeImportError(err, siteFile)}`);
    }
  }
  if (await isFile(worksFile)) {
    try {
      rawWorks = await importFresh(worksFile);
    } catch (err) {
      issues.errors.push(`content/works.mjs를 읽지 못했습니다 — ${describeImportError(err, worksFile)}`);
      rawWorks = [];
    }
  } else {
    issues.warnings.push('content/works.mjs 파일이 없어 작업 목록이 비어 있습니다.');
  }
  const site = normalizeSite(rawSite || {}, issues);
  const works = normalizeWorks(rawWorks ?? [], site, issues);
  return { site, works, errors: issues.errors, warnings: issues.warnings };
}

/**
 * Human-friendly description of an import failure: line number, the offending line and a hint.
 * A SyntaxError from a dynamic import carries no location, so the file is re-checked with `node --check`
 * (which prints "file:LINE", the source line and a caret). Runtime errors (e.g. unquoted Korean text →
 * ReferenceError) carry an "at file:///…/works.mjs?t=…:LINE:COL" frame.
 */
export function describeImportError(err, file) {
  const msg = String(err?.message || err).split('\n')[0];
  const base = path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let line = null;
  let code = '';
  let caret = '';
  if (err?.name === 'SyntaxError') {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
    const out = String(r.stderr || '').split(/\r?\n/);
    const i = out.findIndex((l) => new RegExp(`${base}:(\\d+)\\s*$`).test(l));
    if (i !== -1) {
      line = Number(out[i].match(/:(\d+)\s*$/)[1]);
      code = out[i + 1] || '';
      caret = /^\s*\^+\s*$/.test(out[i + 2] || '') ? out[i + 2] : '';
    }
  } else {
    const frame = String(err?.stack || '').match(new RegExp(`${base}(?:\\?[^:\\s]*)?:(\\d+):(\\d+)`));
    if (frame) line = Number(frame[1]);
  }
  let hint = '';
  if (/Unexpected (token|identifier|string|number)|missing \) after|Invalid or unexpected token|Unexpected end of input/.test(msg)) {
    hint = '이 줄이나 바로 앞 줄 끝의 쉼표(,)가 빠졌거나, 따옴표·괄호의 짝이 맞지 않는지 확인하세요.';
  } else if (/is not defined/.test(msg)) {
    hint = "글자는 따옴표로 감싸야 합니다 (예: title: '작품 제목').";
  }
  return [`${line ? `${line}번째 줄: ` : ''}${msg}`, code && `  ${code}`, caret && `  ${caret}`, hint && `→ ${hint}`].filter(Boolean).join('\n    ');
}
