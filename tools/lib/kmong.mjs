// Kmong marketer: listing audit, weekly funnel stats, copy export and Claude briefs.
// Pure functions here; file I/O and printing live in tools/marketer.mjs.
import path from 'node:path';
import fsp from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isFile } from './fsutil.mjs';
import { imageSize } from './imagesize.mjs';

export const KMONG_FILE = path.join('content', 'kmong.mjs');
export const MARKETING_DIR = 'marketing';
export const STATS_FILE = path.join(MARKETING_DIR, 'stats.json');
export const OUT_DIR = path.join(MARKETING_DIR, 'out');

export const TIERS = ['STANDARD', 'DELUXE', 'PREMIUM'];
export const METRICS = ['impressions', 'clicks', 'inquiries', 'orders', 'revenue'];
export const METRIC_LABELS = { impressions: '노출', clicks: '클릭', inquiries: '문의', orders: '주문', revenue: '매출' };

export const DEFAULT_BENCHMARKS = { minImpressions: 300, ctr: 0.02, inquiryRate: 0.05, orderRate: 0.3 };
export const DEFAULT_RULES = { titleMaxChars: 20, mainImage: { width: 652, height: 488 } };

// ---------------------------------------------------------------------------------------------
// normalize

const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const strList = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export function normalizeGig(raw) {
  const g = obj(raw);
  const d = obj(g.description);
  const t = obj(g.templates);
  const b = obj(g.benchmarks);
  const r = obj(g.rules);
  const img = obj(r.mainImage);
  return {
    url: str(g.url),
    category: str(g.category),
    title: str(g.title),
    titleCandidates: strList(g.titleCandidates),
    keywords: strList(g.keywords),
    mainImage: str(g.mainImage),
    description: {
      intro: str(d.intro),
      recommendFor: strList(d.recommendFor),
      strengths: strList(d.strengths),
      process: strList(d.process),
      deliverables: strList(d.deliverables),
      prepare: strList(d.prepare),
      notice: strList(d.notice),
    },
    packages: (Array.isArray(g.packages) ? g.packages : []).map((p) => {
      const o = obj(p);
      return {
        tier: str(o.tier).toUpperCase(),
        name: str(o.name),
        summary: str(o.summary),
        runtime: str(o.runtime),
        price: num(o.price),
        days: num(o.days),
        revisions: num(o.revisions),
        includes: strList(o.includes),
      };
    }),
    faq: (Array.isArray(g.faq) ? g.faq : []).map((f) => ({ q: str(obj(f).q), a: str(obj(f).a) })).filter((f) => f.q && f.a),
    portfolio: strList(g.portfolio),
    templates: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, str(v)]).filter(([, v]) => v)),
    benchmarks: {
      minImpressions: num(b.minImpressions) ?? DEFAULT_BENCHMARKS.minImpressions,
      ctr: num(b.ctr) ?? DEFAULT_BENCHMARKS.ctr,
      inquiryRate: num(b.inquiryRate) ?? DEFAULT_BENCHMARKS.inquiryRate,
      orderRate: num(b.orderRate) ?? DEFAULT_BENCHMARKS.orderRate,
    },
    rules: {
      titleMaxChars: num(r.titleMaxChars) ?? DEFAULT_RULES.titleMaxChars,
      mainImage: { width: num(img.width) ?? DEFAULT_RULES.mainImage.width, height: num(img.height) ?? DEFAULT_RULES.mainImage.height },
    },
  };
}

/** Load content/kmong.mjs → { gig, error } (error is a Korean message when the file is missing or broken). */
export async function loadGig(root) {
  const file = path.join(root, KMONG_FILE);
  if (!(await isFile(file))) return { gig: normalizeGig({}), error: `${KMONG_FILE.replace(/\\/g, '/')} 파일이 없습니다.` };
  try {
    const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
    return { gig: normalizeGig(mod.default), error: null };
  } catch (err) {
    return { gig: normalizeGig({}), error: `content/kmong.mjs 를 읽지 못했습니다 — ${String(err?.message || err).split('\n')[0]}` };
  }
}

// ---------------------------------------------------------------------------------------------
// title & text rules

/** Kmong counts title length without spaces. */
export function titleLength(title) {
  return Array.from(String(title).replace(/\s/g, '')).length;
}

/** Characters Kmong rejects in titles (special characters, emoji): anything but Hangul, Latin letters, digits and spaces. */
export function titleBadChars(title) {
  return [...new Set(Array.from(String(title)).filter((ch) => !/[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9\s]/.test(ch)))];
}

const EMAIL_RE = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi;
const CONTACT_PATTERNS = [
  { re: /(?:\+82[-\s.]?|0)1[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/, label: '휴대폰 번호' },
  { re: /https?:\/\/|www\.|[a-z0-9-]\.(?:com|co\.kr|kr|net|io|me)\b/i, label: '외부 링크' },
  { re: /카카오톡|카톡|오픈\s*채팅|kakao|텔레그램|인스타\s*DM|디엠/i, label: '메신저 연락처' },
];

/** Contact info / external links Kmong forbids in listings and messages → [{ label, match }] */
export function findContactInfo(text) {
  const found = [];
  const emails = String(text).match(EMAIL_RE);
  if (emails) found.push({ label: '이메일 주소', match: emails[0] });
  const rest = String(text).replace(EMAIL_RE, ' '); // an email's domain is not a separate link
  for (const { re, label } of CONTACT_PATTERNS) {
    const m = rest.match(re);
    if (m) found.push({ label, match: m[0] });
  }
  return found;
}

const HYPE_RE = /최고|최저가|1위|업계\s*최초|국내\s*유일|무조건|100\s*%|완벽/g;

/** Superlatives that need proof under Korean advertising law → unique matches */
export function findHype(text) {
  return [...new Set(String(text).match(HYPE_RE) || [])];
}

export function formatWon(n) {
  return n === null || n === undefined ? '-' : `${Math.round(n).toLocaleString('ko-KR')}원`;
}

export function formatPct(r) {
  return r === null || r === undefined || !Number.isFinite(r) ? '-' : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`;
}

// ---------------------------------------------------------------------------------------------
// audit

/**
 * Listing checks. ctx = { site, works, root } (site/works from loadContent; works may include private ones — only
 * public ones count). Returns { items, score } with items = [{ id, area, level: 'ok'|'warn'|'fail'|'tip', weight, msg, fix }].
 * Score = weighted share of passing checks (tips don't count).
 */
export async function auditGig(gig, { site = null, works = [], root = process.cwd() } = {}) {
  const items = [];
  const add = (id, area, level, weight, msg, fix = '') => items.push({ id, area, level, weight, msg, fix });
  const publicWorks = works.filter((w) => w.publish === true && w.consent !== 'pending');
  const publicSlugs = new Set(publicWorks.map((w) => w.slug));
  const faq = gig.faq.length ? gig.faq : site?.faq || [];

  // --- 서비스 주소
  if (!gig.url) add('url', '기본', 'warn', 1, '크몽 서비스 주소(url)가 비어 있습니다.', '등록 후 content/kmong.mjs 의 url 에 붙여 넣으세요.');
  else if (!/^https:\/\/(www\.)?kmong\.com\/gig\/\d+/.test(gig.url)) add('url', '기본', 'warn', 1, `서비스 주소 형식이 이상합니다: ${gig.url}`, 'https://kmong.com/gig/숫자 형식으로 적으세요.');
  else add('url', '기본', 'ok', 1, '크몽 서비스 주소 등록됨');
  if (site) {
    const siteUrl = site.contact?.kmongUrl || '';
    if (gig.url && siteUrl !== gig.url) add('site-link', '기본', 'warn', 1, '홈페이지(site.mjs)의 크몽 버튼 주소가 크몽 서비스 주소와 다릅니다.', 'content/site.mjs 의 contact.kmongUrl 에 같은 주소를 넣고 다시 빌드하세요. 홈페이지 방문자가 크몽으로 바로 넘어갑니다.');
    else if (gig.url) add('site-link', '기본', 'ok', 1, '홈페이지 크몽 버튼 연결됨');
  }

  // --- 제목
  const max = gig.rules.titleMaxChars;
  if (!gig.title) add('title', '제목', 'fail', 3, '제목이 비어 있습니다.');
  else {
    const len = titleLength(gig.title);
    const bad = titleBadChars(gig.title);
    if (len > max) add('title-length', '제목', 'fail', 3, `제목이 ${len}자입니다 (띄어쓰기 제외 ${max}자 이내).`, '뒤쪽의 덜 중요한 말부터 줄이세요.');
    else add('title-length', '제목', 'ok', 3, `제목 길이 ${len}/${max}자`);
    if (bad.length) add('title-chars', '제목', 'fail', 2, `제목에 크몽이 허용하지 않는 문자가 있습니다: ${bad.join(' ')}`, '특수문자·이모지를 빼세요.');
    else add('title-chars', '제목', 'ok', 2, '제목에 특수문자 없음');
    const main = gig.keywords.slice(0, 3);
    const flat = gig.title.replace(/\s/g, '');
    const hit = main.filter((k) => flat.includes(k.replace(/\s/g, '')));
    if (!main.length) add('title-keyword', '제목', 'warn', 2, '핵심 키워드가 없어 제목을 점검할 수 없습니다.', 'keywords 에 검색어를 적으세요.');
    else if (!hit.length) add('title-keyword', '제목', 'warn', 2, `제목에 핵심 키워드(${main.join(', ')})가 하나도 없습니다.`, '의뢰인이 검색하는 말이 제목 앞쪽에 오게 하세요.');
    else add('title-keyword', '제목', 'ok', 2, `제목에 핵심 키워드 포함: ${hit.join(', ')}`);
  }
  for (const cand of gig.titleCandidates) {
    const len = titleLength(cand);
    const bad = titleBadChars(cand);
    if (len > max || bad.length) add('title-candidate', '제목', 'tip', 0, `제목 후보 「${cand}」 는 그대로 쓸 수 없습니다 (${len}자${bad.length ? `, 특수문자 ${bad.join(' ')}` : ''}).`);
  }

  // --- 키워드
  const dupKw = gig.keywords.filter((k, i) => gig.keywords.indexOf(k) !== i);
  if (gig.keywords.length < 5) add('keywords', '검색', 'warn', 2, `검색 키워드가 ${gig.keywords.length}개입니다.`, '의뢰인이 칠 만한 말을 5개 이상 적으세요 (예: 색보정, 컬러그레이딩, 뮤직비디오 색보정).');
  else add('keywords', '검색', 'ok', 2, `검색 키워드 ${gig.keywords.length}개`);
  if (dupKw.length) add('keywords-dup', '검색', 'tip', 0, `중복 키워드: ${[...new Set(dupKw)].join(', ')}`);

  // --- 메인 이미지
  const { width: iw, height: ih } = gig.rules.mainImage;
  if (!gig.mainImage) add('image', '메인 이미지', 'warn', 2, '메인 이미지 파일이 지정되지 않아 점검하지 못했습니다.', `${iw}×${ih}px 이미지를 만들고 mainImage 에 경로를 적으세요. 목록에서 클릭을 가르는 1순위 요소입니다.`);
  else {
    const file = path.resolve(root, gig.mainImage);
    const size = (await isFile(file)) ? await imageSize(file).catch(() => null) : null;
    if (!size) add('image', '메인 이미지', 'fail', 2, `메인 이미지를 읽지 못했습니다: ${gig.mainImage}`, '경로와 파일 형식(JPG/PNG)을 확인하세요.');
    else if (size.type !== 'jpeg' && size.type !== 'png') add('image', '메인 이미지', 'fail', 2, `메인 이미지가 ${size.type.toUpperCase()} 형식입니다.`, '크몽은 JPG 또는 PNG만 받습니다.');
    else if (size.w === iw && size.h === ih) add('image', '메인 이미지', 'ok', 2, `메인 이미지 ${iw}×${ih}px`);
    else if (Math.abs(size.w / size.h - iw / ih) < 0.01) add('image', '메인 이미지', 'warn', 2, `메인 이미지가 ${size.w}×${size.h}px 입니다 (비율은 맞음).`, `${iw}×${ih}px 로 저장하면 흐려지거나 잘리지 않습니다.`);
    else add('image', '메인 이미지', 'fail', 2, `메인 이미지가 ${size.w}×${size.h}px 로 4:3 비율이 아닙니다.`, `${iw}×${ih}px 로 다시 만드세요. 중요한 글자는 가장자리에서 50px 안쪽에.`);
  }

  // --- 설명
  const d = gig.description;
  if (d.intro.length < 80) add('intro', '설명', 'warn', 2, `첫 문단이 짧습니다 (${d.intro.length}자).`, '무엇을·누구에게·어떻게를 2~4문장으로 적으세요.');
  else add('intro', '설명', 'ok', 2, '첫 문단 작성됨');
  const lists = [
    ['recommendFor', '이런 분께 추천', 3],
    ['strengths', '강점', 3],
    ['deliverables', '납품물', 1],
    ['prepare', '의뢰 전 준비물', 2],
    ['notice', '안내·주의사항', 1],
  ];
  for (const [key, label, min] of lists) {
    if (d[key].length < min) add(key, '설명', 'warn', 1, `「${label}」 항목이 ${d[key].length}개입니다.`, `${min}개 이상 적으세요.`);
    else add(key, '설명', 'ok', 1, `「${label}」 ${d[key].length}개`);
  }

  // --- 규정: 연락처·과장 표현
  const texts = listingTexts(gig, site);
  const contacts = texts.flatMap(({ where, text }) => findContactInfo(text).map((c) => `${where}: ${c.label} (${c.match})`));
  if (contacts.length) add('contact', '규정', 'fail', 3, `판매 문구에 연락처·외부 링크가 있습니다 — ${contacts.join(' / ')}`, '크몽은 외부 연락처·직거래 유도를 금지합니다. 모두 빼세요 (적발 시 노출 제한·페널티).');
  else add('contact', '규정', 'ok', 3, '판매 문구에 외부 연락처 없음');
  const hype = [...new Set(texts.flatMap(({ text }) => findHype(text)))];
  if (hype.length) add('hype', '규정', 'warn', 1, `근거가 필요한 과장 표현: ${hype.join(', ')}`, '증명할 수 없다면 빼거나 구체적인 사실로 바꾸세요.');
  else add('hype', '규정', 'ok', 1, '과장 표현 없음');

  // --- 패키지
  const pk = gig.packages;
  const tiers = pk.map((p) => p.tier);
  if (pk.length < 3) add('packages', '가격', 'warn', 2, `패키지가 ${pk.length}개입니다.`, 'STANDARD·DELUXE·PREMIUM 세 가지를 두면 가운데(DELUXE)가 잘 팔립니다.');
  else if (TIERS.some((t) => !tiers.includes(t))) add('packages', '가격', 'warn', 2, `패키지 이름(tier)이 ${tiers.join('·')} 입니다.`, 'tier 를 STANDARD·DELUXE·PREMIUM 으로 적으세요.');
  else add('packages', '가격', 'ok', 2, '패키지 3단 구성');
  const noPrice = pk.filter((p) => p.price === null).map((p) => p.tier || p.name);
  if (noPrice.length) add('price', '가격', 'fail', 3, `가격이 정해지지 않은 패키지: ${noPrice.join(', ')}`, '크몽에 올리려면 가격이 필요합니다. price 에 숫자로 적으세요 (예: 150000).');
  else if (pk.length) add('price', '가격', 'ok', 3, `가격: ${pk.map((p) => `${p.tier} ${formatWon(p.price)}`).join(' / ')}`);
  const priced = pk.filter((p) => p.price !== null);
  if (priced.length >= 2 && priced.some((p, i) => i > 0 && p.price <= priced[i - 1].price)) {
    add('price-order', '가격', 'fail', 2, '패키지 가격이 위 단계로 갈수록 올라가지 않습니다.', 'STANDARD < DELUXE < PREMIUM 순으로 가격을 두세요.');
  } else if (priced.length >= 2) add('price-order', '가격', 'ok', 2, '가격이 단계별로 올라감');
  const noDays = pk.filter((p) => p.days === null).map((p) => p.tier || p.name);
  if (noDays.length) add('days', '가격', 'warn', 1, `작업일이 비어 있는 패키지: ${noDays.join(', ')}`, 'days 에 작업일 수를 적으세요.');
  else if (pk.length) add('days', '가격', 'ok', 1, '작업일 설정됨');
  const noRev = pk.filter((p) => p.revisions === null).map((p) => p.tier || p.name);
  if (noRev.length) add('revisions', '가격', 'warn', 1, `수정 횟수가 비어 있는 패키지: ${noRev.join(', ')}`, 'revisions 에 수정 횟수를 적으세요. 분쟁을 줄입니다.');
  else if (pk.length) add('revisions', '가격', 'ok', 1, '수정 횟수 설정됨');
  const byTier = Object.fromEntries(pk.map((p) => [p.tier, p]));
  if (byTier.STANDARD?.price && byTier.DELUXE?.price) {
    const ratio = byTier.DELUXE.price / byTier.STANDARD.price;
    if (ratio > 3) add('price-gap', '가격', 'tip', 0, `DELUXE가 STANDARD의 ${ratio.toFixed(1)}배입니다. 간격이 크면 대부분 STANDARD만 고릅니다.`);
    if (ratio < 1.3) add('price-gap', '가격', 'tip', 0, `DELUXE가 STANDARD의 ${ratio.toFixed(1)}배뿐입니다. 올려 받을 여지가 있거나, 두 패키지 차이가 잘 안 보입니다.`);
  }
  for (let i = 1; i < pk.length; i++) {
    if (pk[i].includes.length <= pk[i - 1].includes.length) add('includes', '가격', 'tip', 0, `${pk[i].tier} 의 포함 항목이 ${pk[i - 1].tier} 보다 많지 않습니다 — 위 단계에서 무엇이 더 좋은지 한눈에 보이게 하세요.`);
  }

  // --- FAQ
  if (faq.length < 5) add('faq', '신뢰', 'warn', 1, `FAQ가 ${faq.length}개입니다.`, '견적·기간·수정·파일 전달처럼 문의에서 매번 받는 질문을 5개 이상 적으세요.');
  else add('faq', '신뢰', 'ok', 1, `FAQ ${faq.length}개${gig.faq.length ? '' : ' (site.mjs 에서 가져옴)'}`);

  // --- 포트폴리오 (공개 동의 규칙)
  const blocked = gig.portfolio.filter((s) => !publicSlugs.has(s));
  if (blocked.length) add('portfolio-consent', '신뢰', 'fail', 3, `포트폴리오에 공개 확정되지 않은 작업이 있습니다: ${blocked.join(', ')}`, 'content/works.mjs 에서 publish: true + 동의 완료인 작업만 크몽에 올리세요.');
  if (publicWorks.length < 3) add('portfolio', '신뢰', 'warn', 2, `공개 가능한 작업이 ${publicWorks.length}개입니다.`, '공개 동의를 받은 작업이 3개 이상이면 문의 전환이 크게 오릅니다. 동의 요청부터 진행하세요 (README 9장).');
  else if (!gig.portfolio.length) add('portfolio', '신뢰', 'warn', 2, `공개 가능한 작업이 ${publicWorks.length}개 있지만 크몽 포트폴리오(portfolio)가 비어 있습니다.`, `portfolio 에 slug 를 적고 크몽 포트폴리오에도 올리세요: ${publicWorks.slice(0, 5).map((w) => w.slug).join(', ')}`);
  else if (!blocked.length) add('portfolio', '신뢰', 'ok', 2, `포트폴리오 ${gig.portfolio.length}개`);

  // --- 응대 템플릿
  for (const [key, label] of [
    ['inquiryReply', '첫 문의 답장'],
    ['delivery', '납품·리뷰 요청'],
  ]) {
    if (!gig.templates[key]) add(`tpl-${key}`, '응대', 'warn', 1, `「${label}」 템플릿이 없습니다.`, '빠른 응답과 리뷰는 크몽 노출 순위에 영향을 줍니다. templates 에 적어 두세요.');
    else {
      const c = findContactInfo(gig.templates[key]);
      if (c.length) add(`tpl-${key}`, '응대', 'fail', 1, `「${label}」 템플릿에 외부 연락처가 있습니다: ${c.map((x) => x.match).join(', ')}`, '크몽 메시지에서 외부 연락처는 금지입니다.');
      else add(`tpl-${key}`, '응대', 'ok', 1, `「${label}」 템플릿 준비됨`);
    }
  }

  const scored = items.filter((i) => i.level !== 'tip');
  const total = scored.reduce((s, i) => s + i.weight, 0);
  const got = scored.filter((i) => i.level === 'ok').reduce((s, i) => s + i.weight, 0);
  return { items, score: total ? Math.round((got / total) * 100) : 0 };
}

/** Most urgent fixes first: fails, then warns, heavier checks first. */
export function topFixes(items, n = 3) {
  const rank = { fail: 0, warn: 1 };
  return items
    .filter((i) => i.level === 'fail' || i.level === 'warn')
    .sort((a, b) => rank[a.level] - rank[b.level] || b.weight - a.weight)
    .slice(0, n);
}

/** Every text that ends up on the Kmong listing → [{ where, text }] */
export function listingTexts(gig, site) {
  const d = gig.description;
  const out = [
    { where: '제목', text: gig.title },
    { where: '첫 문단', text: d.intro },
  ];
  for (const key of ['recommendFor', 'strengths', 'process', 'deliverables', 'prepare', 'notice']) d[key].forEach((t) => out.push({ where: key, text: t }));
  gig.packages.forEach((p) => out.push({ where: `패키지 ${p.tier}`, text: [p.name, p.summary, p.runtime, ...p.includes].join(' ') }));
  (gig.faq.length ? gig.faq : site?.faq || []).forEach((f, i) => out.push({ where: `FAQ ${i + 1}`, text: `${f.q} ${f.a}` }));
  return out;
}

// ---------------------------------------------------------------------------------------------
// stats (marketing/stats.json — local only)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Monday of the week containing date (local time) → 'YYYY-MM-DD' */
export function weekStart(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(d);
}

export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function emptyStats() {
  return { weeks: [], notes: [] };
}

export async function loadStats(root) {
  const file = path.join(root, STATS_FILE);
  let raw;
  try {
    raw = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return emptyStats();
    throw new Error(`${STATS_FILE} 를 읽지 못했습니다 — ${err.message}`);
  }
  const weeks = (Array.isArray(raw?.weeks) ? raw.weeks : []).filter((w) => w && isDate(w.week));
  const notes = (Array.isArray(raw?.notes) ? raw.notes : []).filter((n) => n && isDate(n.date) && typeof n.text === 'string');
  return { weeks: sortBy(weeks, 'week'), notes: sortBy(notes, 'date') };
}

export async function saveStats(root, stats) {
  const file = path.join(root, STATS_FILE);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify({ weeks: sortBy(stats.weeks, 'week'), notes: sortBy(stats.notes, 'date') }, null, 2)}\n`);
}

function sortBy(list, key) {
  return [...list].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));
}

/** Insert or merge one week's numbers (only the given metrics change). Returns a new stats object. */
export function upsertWeek(stats, week, values) {
  const weeks = stats.weeks.filter((w) => w.week !== week);
  const prev = stats.weeks.find((w) => w.week === week) || { week };
  const next = { ...prev };
  for (const k of METRICS) if (values[k] !== undefined) next[k] = values[k];
  return { ...stats, weeks: sortBy([...weeks, next], 'week') };
}

export function addNote(stats, date, text) {
  return { ...stats, notes: sortBy([...stats.notes, { date, text }], 'date') };
}

const ratio = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null);

/** Conversion rates for one week. */
export function funnel(w) {
  return {
    ctr: ratio(w.clicks, w.impressions),
    inquiryRate: ratio(w.inquiries, w.clicks),
    orderRate: ratio(w.orders, w.inquiries),
    aov: ratio(w.revenue, w.orders),
  };
}

const STAGES = [
  {
    key: 'impressions',
    title: '노출이 부족합니다 (의뢰인에게 서비스가 잘 안 보임)',
    actions: [
      '제목 앞쪽과 검색 키워드에 의뢰인이 실제로 검색하는 말(색보정, 컬러그레이딩 등)을 넣으세요.',
      '카테고리가 맞는지 확인하세요 — 영상 편집 쪽 하위 카테고리 중 색보정과 가장 가까운 곳.',
      '메시지 응답률·응답 시간을 관리하세요 (크몽 노출 순위에 반영). 첫 문의 답장 템플릿으로 바로 답하기.',
      '리뷰가 쌓일 때까지 크몽 광고를 소액으로 1~2주 시험해 보고, 광고 기간의 노출·클릭을 따로 기록하세요.',
      '홈페이지·인스타그램·유튜브 쇼츠에 비포·애프터를 올리고 크몽 링크로 연결하세요 (npm run marketer -- brief sns).',
    ],
  },
  {
    key: 'ctr',
    title: '노출 대비 클릭이 적습니다 (목록에서 눈에 안 띔)',
    actions: [
      '메인 이미지를 비포·애프터가 한눈에 보이는 컷으로 바꾸세요 (색보정은 전후 비교가 가장 강력합니다).',
      '메인 이미지 글자는 짧고 크게 — "LOG → 완성 톤" 처럼 결과가 보이는 한 줄.',
      '제목에서 결과(무엇이 좋아지는지)가 보이게 바꿔 보세요. 바꾼 날은 note 로 기록.',
      'STANDARD 가격이 목록에서 비교됩니다 — 비슷한 서비스보다 진입 가격이 높지 않은지 확인하세요.',
    ],
  },
  {
    key: 'inquiryRate',
    title: '클릭 대비 문의가 적습니다 (상세 페이지에서 설득이 안 됨)',
    actions: [
      '상세 설명 맨 위에 비포·애프터 이미지나 영상을 두세요.',
      '공개 동의 받은 작업을 크몽 포트폴리오에 3개 이상 올리세요.',
      '「이런 분께 추천」을 의뢰인 상황 중심으로 다듬으세요 (npm run marketer -- brief description).',
      '패키지 차이를 분명히 하고, 가격이 애매하면 "소스 확인 후 맞춤 견적" 안내를 첫 문단에 넣으세요.',
      'FAQ에 견적·기간·수정·파일 전달 질문이 있는지 확인하세요.',
    ],
  },
  {
    key: 'orderRate',
    title: '문의 대비 주문이 적습니다 (상담에서 놓침)',
    actions: [
      '문의가 오면 가능한 한 빨리 첫 답장을 보내세요 (templates.inquiryReply).',
      '소스를 받으면 대표 컷 1~2장으로 룩 테스트를 보여주는 것을 검토하세요.',
      '견적을 보낼 때 범위·일정·수정 횟수를 한 번에 정리해 보내세요 (templates.quote).',
      '주문으로 이어지지 않은 문의의 이유(가격, 일정, 범위)를 note 로 남겨 패턴을 보세요.',
    ],
  },
];

/**
 * Where the funnel leaks. Uses the latest week; compares to benchmarks and (when ≥ 4 earlier weeks exist)
 * to the owner's own median. Rates from too few events are skipped and listed in lowSample.
 * Returns { week, latest, prev, rates, change, findings: [{ key, title, detail, actions, severity }], lowSample }.
 */
export function diagnose(stats, benchmarks = DEFAULT_BENCHMARKS) {
  const weeks = stats.weeks;
  if (!weeks.length) return null;
  const latest = weeks[weeks.length - 1];
  const prev = weeks.length > 1 ? weeks[weeks.length - 2] : null;
  const rates = funnel(latest);
  const history = weeks.slice(0, -1).slice(-8).map(funnel);
  const median = (key) => {
    const v = history.map((h) => h[key]).filter((x) => x !== null).sort((a, b) => a - b);
    return v.length >= 4 ? v[Math.floor(v.length / 2)] : null;
  };
  const findings = [];
  const push = (stage, detail, severity) => findings.push({ key: stage.key, title: stage.title, detail, actions: stage.actions, severity });
  const [sImp, sCtr, sInq, sOrd] = STAGES;

  if (Number.isFinite(latest.impressions) && latest.impressions < benchmarks.minImpressions) {
    push(sImp, `이번 주 노출 ${latest.impressions.toLocaleString('ko-KR')}회 (기준 ${benchmarks.minImpressions.toLocaleString('ko-KR')}회)`, 3);
  }
  const lowSample = [];
  for (const [stage, key, label, base, min] of [
    [sCtr, 'ctr', '클릭률', 'impressions', 100],
    [sInq, 'inquiryRate', '문의율', 'clicks', 20],
    [sOrd, 'orderRate', '주문율', 'inquiries', 5],
  ]) {
    const r = rates[key];
    if (r === null) continue;
    // a rate from a handful of events is noise: 0 inquiries from 2 clicks says nothing about the page
    if ((latest[base] ?? 0) < min) {
      lowSample.push(`${label}: ${METRIC_LABELS[base]} ${latest[base] ?? 0}회로 판단하기엔 적음 (${min}회 이상부터)`);
      continue;
    }
    const target = benchmarks[key];
    const med = median(key);
    if (r < target) push(stage, `${label} ${formatPct(r)} (기준 ${formatPct(target)}${med !== null ? `, 최근 중앙값 ${formatPct(med)}` : ''})`, r < target / 2 ? 3 : 2);
    else if (med !== null && r < med * 0.7) push(stage, `${label} ${formatPct(r)} — 최근 중앙값 ${formatPct(med)} 보다 크게 떨어졌습니다`, 1);
  }
  findings.sort((a, b) => b.severity - a.severity || STAGES.findIndex((s) => s.key === a.key) - STAGES.findIndex((s) => s.key === b.key));
  const change = {};
  if (prev) for (const k of METRICS) if (Number.isFinite(latest[k]) && Number.isFinite(prev[k])) change[k] = latest[k] - prev[k];
  return { week: latest.week, latest, prev, rates, change, findings, lowSample };
}

/** Notes (changes made) that fall between the previous logged week and the latest one. */
export function notesSince(stats, fromWeek) {
  return stats.notes.filter((n) => !fromWeek || n.date >= fromWeek);
}

// ---------------------------------------------------------------------------------------------
// export: copy-paste listing text

export function renderListing(gig, site) {
  const d = gig.description;
  const process = d.process.length ? d.process : (site?.process || []).map((p) => (p.body ? `${p.title} — ${p.body}` : p.title));
  const faq = gig.faq.length ? gig.faq : site?.faq || [];
  const lines = [];
  const h = (t) => lines.push('', `■ ${t}`, '');
  const bullets = (list) => list.forEach((t) => lines.push(`· ${t}`));

  lines.push('==================== 제목 ====================', gig.title, `(띄어쓰기 제외 ${titleLength(gig.title)}자 / ${gig.rules.titleMaxChars}자)`);
  lines.push('', '==================== 검색 키워드 ====================', gig.keywords.join(', '));
  lines.push('', '==================== 서비스 설명 ====================');
  if (d.intro) lines.push('', d.intro);
  if (d.recommendFor.length) {
    h('이런 분께 추천합니다');
    bullets(d.recommendFor);
  }
  if (d.strengths.length) {
    h('TONECRAFT 작업 방식');
    bullets(d.strengths);
  }
  if (process.length) {
    h('진행 과정');
    process.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  }
  if (d.deliverables.length) {
    h('납품물');
    bullets(d.deliverables);
  }
  if (d.prepare.length) {
    h('의뢰 전 준비해 주세요');
    bullets(d.prepare);
  }
  if (d.notice.length) {
    h('안내 사항');
    bullets(d.notice);
  }
  if (gig.packages.length) {
    lines.push('', '==================== 패키지 ====================');
    for (const p of gig.packages) {
      lines.push('', `[${p.tier}] ${p.name}`);
      if (p.summary) lines.push(`설명: ${p.summary}`);
      if (p.runtime) lines.push(`분량: ${p.runtime}`);
      lines.push(`가격: ${formatWon(p.price)}   작업일: ${p.days ?? '-'}일   수정: ${p.revisions ?? '-'}회`);
      if (p.includes.length) lines.push(`포함: ${p.includes.join(' / ')}`);
    }
  }
  if (faq.length) {
    lines.push('', '==================== FAQ ====================');
    faq.forEach((f) => lines.push('', `Q. ${f.q}`, `A. ${f.a}`));
  }
  if (Object.keys(gig.templates).length) {
    lines.push('', '==================== 메시지 템플릿 (크몽 자주 쓰는 문구에 등록) ====================');
    for (const [k, v] of Object.entries(gig.templates)) lines.push('', `[${TEMPLATE_LABELS[k] || k}]`, v);
  }
  return `${lines.join('\n').trim()}\n`;
}

export const TEMPLATE_LABELS = {
  inquiryReply: '첫 문의 답장',
  quote: '견적 안내',
  orderStart: '주문 시작',
  review: '리뷰 영상 전달',
  delivery: '납품 · 리뷰 요청',
};

// ---------------------------------------------------------------------------------------------
// brief: a self-contained prompt for Claude (claude.ai, Claude Code, …)

export const BRIEF_TASKS = {
  title: {
    label: '제목·키워드 후보',
    ask: `크몽 서비스 제목 후보 10개와 검색 키워드 10개를 제안해줘.
- 제목은 띄어쓰기를 뺀 {titleMax}자 이내, 특수문자·이모지 금지. 후보마다 글자 수를 괄호로 적어줘.
- 의뢰인이 크몽 검색창에 실제로 칠 만한 말을 제목 앞쪽에 둘 것.
- 후보를 방향별로 묶어줘: 검색형(키워드 중심) / 결과형(무엇이 좋아지는지) / 대상형(광고·뮤직비디오 등).
- 마지막에 지금 제목과 비교해 1순위 후보와 이유를 한 줄로.`,
  },
  description: {
    label: '상세 설명 다듬기',
    ask: `지금 상세 설명을 크몽 의뢰인이 문의하고 싶어지도록 다듬어줘.
- 첫 문단(intro)은 2~4문장, 의뢰인의 문제 → 해결 → 진행 방식 순서.
- 「이런 분께 추천」은 의뢰인이 처한 상황으로, 5개 이내.
- 제공하지 않는 서비스나 적혀 있지 않은 사실(경력, 건수, 클라이언트, 수상)을 새로 만들지 말 것.
- 결과는 content/kmong.mjs 의 description 형식(자바스크립트 객체)으로 줘서 바로 붙여 넣을 수 있게.`,
  },
  packages: {
    label: '패키지·가격 전략',
    ask: `STANDARD·DELUXE·PREMIUM 패키지 구성을 점검하고 개선안을 줘.
- 가운데(DELUXE)가 가장 합리적으로 보이도록 단계별 차이를 분명하게.
- 가격이 비어 있으면 금액을 지어내지 말고, 정할 때 고려할 기준(분량, 컷 수, 소스, 작업일, 수정 횟수)과 질문 목록을 줘.
- 각 패키지에 무엇이 포함·제외되는지 의뢰인 입장에서 오해가 없게.`,
  },
  reply: {
    label: '문의 답장 초안',
    ask: `아래 의뢰인 문의에 보낼 크몽 메시지 답장 초안을 써줘.
- 친절하고 간결하게. 정해지지 않은 가격·일정을 약속하지 말고, 필요한 정보를 질문으로.
- 이메일·전화·카카오톡·외부 링크 등 외부 연락처는 절대 넣지 말 것 (크몽 규정).
- 답장 뒤에 "다음에 할 일" 한 줄.

[의뢰인 문의]
{input}`,
  },
  sns: {
    label: '홍보 콘텐츠',
    ask: `공개된 작업을 활용한 홍보 콘텐츠 계획과 초안을 줘.
- 인스타그램 게시물 3개 (비포·애프터 캐러셀 기준, 캡션 + 해시태그 10개)
- 유튜브 쇼츠/릴스 대본 2개 (15~30초, 첫 2초 훅)
- 네이버 블로그 글 제목 5개 + 1개 개요 (검색 키워드 포함)
- 모든 콘텐츠는 "크몽에서 의뢰하기"로 연결. 공개 목록에 없는 작업·클라이언트 이름은 쓰지 말 것.`,
  },
  weekly: {
    label: '주간 점검',
    ask: `기록된 통계와 점검 결과를 보고 이번 주 마케팅 계획을 세워줘.
- 퍼널(노출 → 클릭 → 문의 → 주문)에서 가장 막힌 곳 한 곳을 고르고 이유를 숫자로.
- 이번 주에 할 일 3개 (각각 30분~2시간 안에 끝나는 크기, 우선순위 순).
- 지난번 바꾼 것(변경 기록)이 효과가 있었는지 판단. 표본이 작으면 작다고 말할 것.
- 다음 주에 무엇을 기록해서 확인할지.`,
  },
  competitor: {
    label: '경쟁 서비스 비교',
    ask: `아래 경쟁 크몽 서비스와 내 서비스를 비교해줘.
- 표: 제목 / 진입 가격 / 패키지 구성 / 강조점 / 리뷰 수 / 메인 이미지 방식
- 내 서비스가 이길 수 있는 지점 3개, 따라 할 만한 점 2개, 따라 하면 안 되는 점.
- 경쟁 서비스 문구를 베끼지 말고, 내 사실에 맞는 차별화 문장을 제안해줘.

[경쟁 서비스 내용 — 크몽 페이지에서 복사해 붙여 넣기]
{input}`,
  },
};

/**
 * Build a Korean markdown brief: role, rules, context (brand, gig, public works, audit, recent stats), and the task.
 * Only public works are included — the brief may be pasted into other tools.
 */
export function buildBrief(task, { gig, site, works = [], audit, stats, input = '' }) {
  const t = BRIEF_TASKS[task];
  if (!t) throw new Error(`알 수 없는 작업: ${task}`);
  const publicWorks = works.filter((w) => w.publish === true && w.consent !== 'pending');
  const brand = site?.brand || {};
  const cat = Object.fromEntries((site?.categories || []).map((c) => [c.id, c.label]));
  const out = [];
  out.push(`# TONECRAFT 크몽 마케터 — ${t.label}`, '');
  out.push(
    `너는 컬러리스트 ${brand.person || ''}(${brand.name || 'TONECRAFT'})의 크몽 서비스를 잘 팔리게 만드는 전담 마케터야.`,
    '아래 자료만 근거로 삼고, 적혀 있지 않은 사실(경력 연수, 작업 건수, 클라이언트 이름, 수상, 가격, 기간)은 지어내지 마. 필요하면 질문으로 남겨.',
    '크몽 규칙: 제목은 띄어쓰기 제외 ' + gig.rules.titleMaxChars + '자 이내·특수문자 금지 / 판매 페이지와 메시지에 외부 연락처·링크 금지 / 근거 없는 최상급 표현(최고, 1위, 100%) 금지.',
    '공개 동의를 받지 않은 작업은 언급하지 마 (아래 「공개 작업」 목록에 있는 것만 사용).',
    '',
  );
  out.push('## 요청', '', t.ask.replace('{titleMax}', String(gig.rules.titleMaxChars)).replace('{input}', input || '(여기에 붙여 넣기)'), '');
  out.push('## 브랜드', '');
  out.push(`- 이름: ${brand.name || ''} / ${brand.person || ''} · ${brand.role || ''}`);
  if (brand.tagline) out.push(`- 한 줄 소개: ${brand.tagline}`);
  if (site?.services?.length) out.push(`- 서비스: ${site.services.map((s) => `${s.title}${s.summary ? ` — ${s.summary}` : ''}`).join(' / ')}`);
  out.push('');
  out.push('## 지금 크몽 원고', '', '```text', renderListing(gig, site).trim(), '```', '');
  out.push('## 공개 작업', '');
  if (publicWorks.length) publicWorks.forEach((w) => out.push(`- ${w.title} (${cat[w.category] || w.category}${w.year ? `, ${w.year}` : ''})${w.summary ? ` — ${w.summary}` : ''}`));
  else out.push('- 아직 없음 (공개 동의를 받은 작업이 0개)');
  out.push('');
  if (audit) {
    out.push(`## 점검 결과 (${audit.score}점)`, '');
    const bad = audit.items.filter((i) => i.level === 'fail' || i.level === 'warn');
    if (bad.length) bad.forEach((i) => out.push(`- [${i.level === 'fail' ? '필수' : '권장'}] ${i.msg}`));
    else out.push('- 모든 항목 통과');
    out.push('');
  }
  if (stats?.weeks?.length) {
    out.push('## 최근 주간 통계', '', '| 주 시작 | 노출 | 클릭 | 문의 | 주문 | 매출 | 클릭률 | 문의율 | 주문율 |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const w of stats.weeks.slice(-8)) {
      const f = funnel(w);
      out.push(`| ${w.week} | ${w.impressions ?? '-'} | ${w.clicks ?? '-'} | ${w.inquiries ?? '-'} | ${w.orders ?? '-'} | ${w.revenue !== undefined ? formatWon(w.revenue) : '-'} | ${formatPct(f.ctr)} | ${formatPct(f.inquiryRate)} | ${formatPct(f.orderRate)} |`);
    }
    out.push('');
    const d = diagnose(stats, gig.benchmarks);
    if (d?.findings.length) {
      out.push(`## 퍼널 진단 (${d.week} 주, 기준값은 크몽 공식 수치가 아닌 출발점)`, '');
      d.findings.forEach((f) => out.push(`- ${f.title}: ${f.detail}`));
      out.push('');
    }
    const recentNotes = stats.notes.slice(-10);
    if (recentNotes.length) {
      out.push('## 변경 기록', '');
      recentNotes.forEach((n) => out.push(`- ${n.date}: ${n.text}`));
      out.push('');
    }
  }
  return `${out.join('\n').trim()}\n`;
}
