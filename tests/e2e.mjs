#!/usr/bin/env node
// 브라우저 종단 테스트 (Playwright) — 빌드된 사이트를 실제 Chromium으로 열어 동작을 확인합니다.
//
//   NODE_PATH=<playwright가 설치된 node_modules> node tests/e2e.mjs [--root .demo] [--headed]
//   AXE_PATH=<axe.min.js 경로>  를 주면 axe-core 접근성 검사도 함께 실행합니다 (serious/critical 0개여야 통과).
//
// - 기본 대상은 데모 프로젝트(.demo — 먼저 npm run demo). 실제 사이트는 --root . (site/ 배포본).
// - 서버는 스스로 띄웁니다 (tools/lib/server.mjs, 임의 포트).
// - playwright를 불러올 수 없으면 안내만 출력하고 건너뜁니다 (프로젝트 자체는 npm 의존성이 없습니다).
// - 테스트용 Chromium은 H.264를 재생하지 못합니다. 그 경우 ffmpeg로 만든 WebM 사본(임시 폴더에 캐시)을
//   같은 주소로 돌려주어 재생 관련 동작(히어로 영상, 미리보기, 영상 비교)도 검사합니다.
// - `npm test`(node --test)에는 포함되지 않습니다 (브라우저가 필요하기 때문).
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs, ArgError } from '../tools/lib/args.mjs';
import { createStaticServer, listen } from '../tools/lib/server.mjs';
import { findFfmpeg, runFfmpeg } from '../tools/lib/ffmpeg.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELP = `사용법: NODE_PATH=<node_modules> node tests/e2e.mjs [--root <폴더>] [--headed]
  --root <폴더>  검사할 프로젝트 (기본 .demo — 먼저 npm run demo). 실제 사이트: --root .
  --headed       브라우저 창을 띄워서 실행
  환경 변수 AXE_PATH=<axe.min.js>  접근성 검사(axe-core) 포함`;

let args;
try {
  args = parseArgs(process.argv.slice(2), { flags: { root: 'string', headed: 'boolean', help: 'boolean' } });
} catch (err) {
  if (err instanceof ArgError) {
    process.stderr.write(`${err.message}\n\n${HELP}\n`);
    process.exit(2);
  }
  throw err;
}
if (args.values.help) {
  process.stdout.write(`${HELP}\n`);
  process.exit(0);
}

const out = (s = '') => process.stdout.write(`${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// setup

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  out('SKIP e2e: playwright를 불러올 수 없어 브라우저 테스트를 건너뜁니다.');
  out('     실행하려면 playwright가 설치된 node_modules를 NODE_PATH로 지정하세요 (예: NODE_PATH=/opt/node22/lib/node_modules).');
  process.exit(0);
}

const root = args.values.root ? path.resolve(args.values.root) : path.join(REPO_ROOT, '.demo');
const siteDir = path.join(root, 'site');
if (!fs.existsSync(path.join(siteDir, 'index.html'))) {
  out(`e2e: ${path.join(siteDir, 'index.html')} 이 없습니다 — 먼저 ${args.values.root ? 'npm run build' : 'npm run demo'} 를 실행하세요.`);
  process.exit(1);
}

// An absolute siteUrl (canonical link) makes the 404 page load its assets from that origin: map it to the local server.
const siteUrl = (() => {
  const m = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8').match(/<link rel="canonical" href="([^"]+)"/);
  return m ? m[1].replace(/\/+$/, '') : '';
})();
const toLocal = (url) => (siteUrl && url.startsWith(`${siteUrl}/`) ? BASE + url.slice(siteUrl.length) : url);

let axeSource = null;
const axePath = process.env.AXE_PATH || (() => {
  try {
    return require.resolve('axe-core/axe.min.js');
  } catch {
    return '';
  }
})();
if (axePath && fs.existsSync(axePath)) axeSource = fs.readFileSync(axePath, 'utf8');

const server = createStaticServer({ layers: [{ dir: siteDir }], notFound: [path.join(siteDir, '404.html')] });
const port = await listen(server, { port: 0, host: '127.0.0.1' });
const BASE = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: !args.values.headed });

// ---------------------------------------------------------------------------------------------
// problem collection (console errors, page errors, failed requests) — attributed to the running test

const problems = [];
const expectedStatus = new Map(); // url → expected HTTP status (the deliberate 404 checks)

function watchContext(context, label) {
  context.on('page', (page) => {
    page.on('pageerror', (err) => problems.push(`[${label}] 스크립트 오류: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const where = msg.location()?.url || '';
      if (/status of \d{3}/.test(msg.text()) && (expectedStatus.has(where) || expectedStatus.has(page.url()))) return;
      problems.push(`[${label}] console.error: ${msg.text()}${where ? ` (${where})` : ''}`);
    });
  });
  context.on('requestfailed', (req) => {
    const text = req.failure()?.errorText || '';
    // ERR_ABORTED = the page itself cancelled the request (video src swapped, navigation) — not a failure.
    if (text === 'net::ERR_ABORTED') return;
    problems.push(`[${label}] 요청 실패: ${req.url()} — ${text}`);
  });
  context.on('response', (res) => {
    const want = expectedStatus.get(res.url());
    if (want !== undefined) {
      if (res.status() !== want) problems.push(`[${label}] ${res.url()} — HTTP ${res.status()} (기대값 ${want})`);
      return;
    }
    if (res.status() >= 400) problems.push(`[${label}] HTTP ${res.status()}: ${res.url()}`);
  });
}

// ---------------------------------------------------------------------------------------------
// H.264 → WebM stand-ins for browsers without proprietary codecs

async function listFiles(dir, ext) {
  const found = [];
  const walk = async (d) => {
    let entries = [];
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.toLowerCase().endsWith(ext)) found.push(p);
    }
  };
  await walk(dir);
  return found;
}

async function prepareWebmStandIns() {
  const tools = await findFfmpeg();
  if (!tools) return null;
  const cacheDir = path.join(os.tmpdir(), 'tonecraft-e2e-webm');
  await fsp.mkdir(cacheDir, { recursive: true });
  const files = await listFiles(path.join(siteDir, 'media'), '.mp4');
  const map = new Map(); // absolute mp4 path → webm path
  const jobs = [];
  for (const file of files) {
    const st = await fsp.stat(file);
    const key = crypto.createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16);
    const webm = path.join(cacheDir, `${key}.webm`);
    map.set(path.resolve(file), webm);
    if (!fs.existsSync(webm)) jobs.push({ file, webm });
  }
  if (jobs.length) out(`  테스트 브라우저가 H.264를 재생하지 못해 WebM 사본 ${jobs.length}개를 만듭니다 (ffmpeg, 한 번만)…`);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const tmp = `${job.webm}.part.webm`;
      await runFfmpeg(tools.ffmpeg, ['-i', job.file, '-an', '-vf', "scale='min(1280,iw)':-2", '-c:v', 'libvpx', '-b:v', '1500k', '-deadline', 'realtime', '-cpu-used', '8', tmp]);
      await fsp.rename(tmp, job.webm);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return map;
}

async function routeWebm(context, map) {
  await context.route(
    (url) => url.pathname.toLowerCase().endsWith('.mp4'),
    async (route) => {
      let rel;
      try {
        rel = decodeURIComponent(new URL(route.request().url()).pathname);
      } catch {
        return route.continue();
      }
      const webm = map.get(path.resolve(path.join(siteDir, ...rel.split('/').filter(Boolean))));
      if (!webm) return route.continue();
      const body = await fsp.readFile(webm);
      const headers = { 'content-type': 'video/webm', 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
      const m = /^bytes=(\d*)-(\d*)$/.exec(route.request().headers().range || '');
      if (m && (m[1] || m[2])) {
        let start = m[1] ? Number(m[1]) : body.length - Number(m[2]);
        let end = m[1] && m[2] ? Number(m[2]) : body.length - 1;
        start = Math.max(0, start);
        end = Math.min(end, body.length - 1);
        if (start > end) return route.fulfill({ status: 416, headers: { 'content-range': `bytes */${body.length}` } });
        return route.fulfill({ status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${body.length}` }, body: body.subarray(start, end + 1) });
      }
      return route.fulfill({ status: 200, headers, body });
    },
  );
}

// ---------------------------------------------------------------------------------------------
// tiny test runner

const results = [];
let currentGroup = '';
const skip = (why) => ({ skip: why });

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function near(actual, expected, tol, msg) {
  assert(Math.abs(actual - expected) <= tol, `${msg}: ${actual} (기대 ${expected} ± ${tol})`);
}

async function test(name, fn) {
  const before = problems.length;
  const label = `${currentGroup} ${name}`;
  try {
    const r = await fn();
    if (r && r.skip) {
      results.push({ name: label, status: 'skip' });
      out(`  - ${name} — 건너뜀: ${r.skip}`);
      return;
    }
    await sleep(80); // let late console / network events land in this test
    const extra = problems.slice(before);
    if (extra.length) throw new Error(extra.join('\n        '));
    results.push({ name: label, status: 'pass' });
    out(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name: label, status: 'fail', error: err });
    out(`  ✗ ${name}\n        ${String(err?.message || err).split('\n').join('\n        ')}`);
  }
}

// ---------------------------------------------------------------------------------------------
// page helpers

async function open(page, url, opts = {}) {
  const res = await page.goto(BASE + url, { waitUntil: 'load', ...opts });
  await page.waitForFunction(() => document.documentElement.classList.contains('js'));
  return res;
}

/** Scroll through the whole page (triggers reveals + lazy images), then back to the top. */
async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.round(window.innerHeight * 0.6));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 50));
  });
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete), null, { timeout: 15000 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
}

async function checkLayout(page) {
  const r = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    broken: Array.from(document.images)
      .filter((img) => img.getClientRects().length && img.complete && !img.naturalWidth)
      .map((img) => img.currentSrc || img.src),
    hiddenReveals: Array.from(document.querySelectorAll('[data-reveal]')).filter((el) => el.getAttribute('data-revealed') !== 'true' && el.getClientRects().length).length,
  }));
  assert(r.overflow <= 0, `가로 스크롤이 생깁니다 (scrollWidth가 ${r.overflow}px 넘침)`);
  assert(!r.broken.length, `깨진 이미지: ${r.broken.join(', ')}`);
  assert(!r.hiddenReveals, `스크롤 후에도 나타나지 않은 블록 ${r.hiddenReveals}개`);
}

async function runAxe(page) {
  if (!axeSource) return skip('AXE_PATH 없음');
  await scrollThrough(page);
  await page.addScriptTag({ content: axeSource });
  const res = await page.evaluate(() =>
    window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }),
  );
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const minor = res.violations.filter((v) => !bad.includes(v));
  assert(!bad.length, bad.map((v) => `${v.impact} ${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`).join('\n'));
  if (minor.length) out(`      (참고: 경미한 axe 항목 ${minor.map((v) => `${v.id}×${v.nodes.length}`).join(', ')})`);
  return null;
}

async function resolves(page, href) {
  const url = toLocal(new URL(href, page.url()).href);
  const res = await page.request.get(url);
  return { url, status: res.status() };
}

// ---------------------------------------------------------------------------------------------
// run

const t0 = Date.now();
out(`TONECRAFT e2e — ${path.relative(process.cwd(), siteDir) || siteDir} (${BASE})`);

let webmMap = null;
let canPlay = false;
{
  const probe = await browser.newPage();
  const h264 = await probe.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"'));
  await probe.close();
  if (!h264) {
    try {
      webmMap = await prepareWebmStandIns();
    } catch (err) {
      out(`  ! WebM 사본을 만들지 못했습니다 — 재생 검사는 건너뜁니다 (${err.message.split('\n')[0]})`);
    }
    if (!webmMap) out('  ! 이 브라우저는 H.264를 재생하지 못하고 ffmpeg도 없어 영상 재생 검사는 건너뜁니다.');
  }
  canPlay = Boolean(h264) || Boolean(webmMap);
}

async function newContext(label, options) {
  const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...options });
  watchContext(context, label);
  if (webmMap) await routeWebm(context, webmMap);
  // Third-party services are stubbed: the test runs offline and never contacts real players / analytics.
  await context.route(/^https:\/\/(player\.vimeo\.com|www\.youtube-nocookie\.com|www\.youtube\.com)\//, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>player stub</title>' }),
  );
  await context.route(/^https:\/\/www\.googletagmanager\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* gtag stub */' }),
  );
  if (siteUrl) {
    await context.route(
      (url) => url.href.startsWith(`${siteUrl}/`),
      async (route) => route.fulfill({ response: await route.fetch({ url: toLocal(route.request().url()) }) }),
    );
  }
  return context;
}

const homeInfo = {};

// ============================ desktop ============================
{
  currentGroup = '[데스크톱]';
  out('\n데스크톱 1440×900');
  const context = await newContext('desktop', { viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await context.newPage();

  await test('홈: 오류 없이 열리고 가로 넘침·깨진 이미지 없음', async () => {
    await open(page, '/');
    assert((await page.getAttribute('body', 'data-page')) === 'home', 'body[data-page=home] 아님');
    await scrollThrough(page);
    await checkLayout(page);
    const external = await page.$$eval('a[href^="http"]', (as) =>
      as.filter((a) => new URL(a.href).origin !== location.origin && (a.target !== '_blank' || !/noopener/.test(a.rel))).map((a) => a.href),
    );
    assert(!external.length, `새 창·noopener 없이 여는 외부 링크: ${external.join(', ')}`);
    Object.assign(
      homeInfo,
      await page.evaluate(() => ({
        works: document.querySelectorAll('[data-work-item]').length,
        hasReel: Boolean(document.querySelector('[data-hero-video]')),
        hasDialogTrigger: Boolean(document.querySelector('[data-video-open]')),
        email: document.querySelector('[data-inquiry]')?.getAttribute('data-email') || '',
        prefix: document.querySelector('[data-inquiry]')?.getAttribute('data-subject-prefix') || '',
      })),
    );
  });

  await test('히어로: 배경 쇼릴 재생 · 타임코드 진행 · 일시정지 버튼', async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    if (!homeInfo.hasReel) {
      assert(await page.$('.hero__graphic, .hero__poster'), '쇼릴이 없을 때의 대체 그래픽/포스터가 없습니다');
      return skip('쇼릴 없음 — 대체 히어로 확인만');
    }
    if (!canPlay) return skip('영상 재생 불가 환경');
    await page.waitForSelector('[data-hero][data-state="playing"]', { timeout: 15000 });
    const tc1 = await page.textContent('[data-timecode]');
    await page.waitForFunction((t) => document.querySelector('[data-timecode]').textContent !== t, tc1, { timeout: 5000 });
    assert(/^\d\d:\d\d:\d\d:\d\d$/.test(await page.textContent('[data-timecode]')), '타임코드 형식이 HH:MM:SS:FF가 아님');
    await page.click('[data-hero-toggle]');
    await page.waitForSelector('[data-hero][data-state="paused"]');
    assert((await page.getAttribute('[data-hero-toggle]', 'aria-pressed')) === 'true', 'aria-pressed가 true가 아님');
    assert((await page.getAttribute('[data-hero-toggle]', 'aria-label')) === '배경 영상 재생', 'aria-label이 "배경 영상 재생"으로 바뀌지 않음');
    assert(await page.$eval('[data-hero-video]', (v) => v.paused), '영상이 멈추지 않음');
    await page.click('[data-hero-toggle]');
    await page.waitForSelector('[data-hero][data-state="playing"]', { timeout: 10000 });
    return null;
  });

  await test('쇼릴 창: 열기 → 재생 → Esc로 닫기 → 포커스 복귀 (배경 영상은 그동안 멈춤)', async () => {
    if (!homeInfo.hasDialogTrigger) return skip('쇼릴 버튼 없음');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.focus('[data-video-open]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-video-dialog][open]');
    const media = await page.$('[data-video-dialog-stage] video, [data-video-dialog-stage] iframe');
    assert(media, '창 안에 영상이 없습니다');
    assert((await page.textContent('[data-video-dialog-title]')).trim(), '창 제목이 비어 있음');
    if (homeInfo.hasReel && canPlay) {
      await page.waitForSelector('[data-hero][data-state="paused"]');
      await page.waitForFunction(() => {
        const v = document.querySelector('[data-video-dialog-stage] video');
        return !v || (v.currentTime > 0.2 && !v.paused);
      }, null, { timeout: 15000 });
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-video-dialog]').open);
    // cleanup runs on the dialog's 'close' event, which the browser dispatches as a separate task
    await page
      .waitForFunction(() => document.querySelector('[data-video-dialog-stage]').childElementCount === 0, null, { timeout: 3000 })
      .catch(() => {
        throw new Error('닫은 뒤에도 플레이어가 남아 있음');
      });
    assert(await page.evaluate(() => document.activeElement?.matches('[data-video-open]')), '닫은 뒤 포커스가 쇼릴 버튼으로 돌아가지 않음');
    assert(!(await page.evaluate(() => document.documentElement.classList.contains('dialog-open'))), 'html.dialog-open이 남아 있음');
    if (homeInfo.hasReel && canPlay) await page.waitForSelector('[data-hero][data-state="playing"]', { timeout: 10000 });
    // close button + backdrop click
    await page.click('[data-video-open]');
    await page.waitForSelector('[data-video-dialog][open]');
    await page.click('[data-video-dialog-close]');
    await page.waitForFunction(() => !document.querySelector('[data-video-dialog]').open);
    await page.click('[data-video-open]');
    await page.waitForSelector('[data-video-dialog][open]');
    await page.mouse.click(8, 8);
    await page.waitForFunction(() => !document.querySelector('[data-video-dialog]').open);
    return null;
  });

  await test('작업 필터: 카테고리별 숨김/표시 + 스크린리더 안내', async () => {
    const buttons = await page.$$('[data-filters] [data-filter]');
    if (buttons.length < 2) return skip('필터 없음 (카테고리 2개 미만)');
    const all = await page.$$eval('[data-work-item]', (els) => els.length);
    for (const btn of buttons.slice(1)) {
      const id = await btn.getAttribute('data-filter');
      const count = Number(await btn.$eval('.filter__count', (e) => e.textContent));
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      const state = await page.evaluate((cat) => {
        const items = Array.from(document.querySelectorAll('[data-work-item]'));
        const shown = items.filter((i) => !i.hidden);
        return {
          shown: shown.length,
          wrong: shown.filter((i) => i.getAttribute('data-category') !== cat).length,
          visibleBoxes: shown.filter((i) => i.getBoundingClientRect().height > 0).length,
          hiddenBoxes: items.filter((i) => i.hidden && i.getBoundingClientRect().height > 0).length,
          status: document.querySelector('[data-filter-status]')?.textContent || '',
          pressed: document.querySelector(`[data-filter="${cat}"]`).getAttribute('aria-pressed'),
        };
      }, id);
      assert(state.pressed === 'true', `${id}: aria-pressed가 true가 아님`);
      assert(state.shown === count && !state.wrong, `${id}: 보이는 작업 ${state.shown}개 (기대 ${count}), 다른 카테고리 ${state.wrong}개`);
      assert(state.visibleBoxes === count && !state.hiddenBoxes, `${id}: 화면 배치가 hidden 상태와 다름`);
      assert(state.status.includes(`${count}개`), `${id}: 안내 문구 "${state.status}"`);
    }
    await buttons[0].click();
    const shown = await page.$$eval('[data-work-item]', (els) => els.filter((e) => !e.hidden).length);
    assert(shown === all, `전체로 돌아가도 ${shown}/${all}개만 보임`);
    return null;
  });

  await test('작업 카드: 마우스를 올리면 미리보기 영상 재생, 벗어나면 정지', async () => {
    const card = await page.$('.work-card[data-preview-src]');
    if (!card) return skip('미리보기 영상이 있는 카드 없음');
    if (!canPlay) return skip('영상 재생 불가 환경');
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await page.waitForFunction((el) => el.getAttribute('data-preview') === 'playing', card, { timeout: 10000 });
    assert(await card.$eval('video.work-card__preview', (v) => !v.paused && v.muted), '미리보기 영상이 재생 중이 아니거나 음소거가 아님');
    await page.mouse.move(2, 450);
    await page.waitForFunction((el) => el.getAttribute('data-preview') === 'idle', card);
    assert(await card.$eval('video.work-card__preview', (v) => v.paused), '마우스를 치운 뒤에도 미리보기가 재생 중');
    return null;
  });

  await test('비포·애프터(이미지): 드래그 · 키보드 · 더블클릭으로 기준선 이동', async () => {
    const figures = await page.$$('[data-compare]:not([data-compare-video])');
    if (!figures.length) return skip('비교 이미지 없음');
    const fig = figures[0];
    await fig.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await sleep(300);
    const frame = await fig.$('[data-compare-frame]');
    const box = await frame.boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.5, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.35, y, { steps: 4 });
    await page.mouse.move(box.x + box.width * 0.25, y, { steps: 4 });
    assert((await frame.getAttribute('data-compare-state')) === 'dragging', '드래그 중 data-compare-state="dragging"이 아님');
    await page.mouse.up();
    const pos = await frame.evaluate((el) => parseFloat(el.style.getPropertyValue('--pos')));
    near(pos, 25, 1.5, '드래그 후 --pos');
    assert((await frame.getAttribute('data-compare-state')) === null, '드래그가 끝났는데 data-compare-state가 남음');
    near(Number(await fig.$eval('[data-compare-range]', (r) => r.value)), 25, 1.5, '드래그 후 range 값');
    // the BEFORE layer is really clipped at the divider
    const clip = await fig.$eval('[data-compare-before]', (el) => {
      const r = el.getBoundingClientRect();
      const f = el.closest('[data-compare-frame]').getBoundingClientRect();
      const x = f.left + f.width * 0.6;
      const hit = document.elementFromPoint(x, f.top + f.height / 2);
      return { clipPath: getComputedStyle(el).clipPath, width: r.width, hitBefore: Boolean(hit && hit.closest('[data-compare-before]')) };
    });
    assert(clip.clipPath && clip.clipPath !== 'none', 'BEFORE 레이어에 clip-path가 없음');
    // keyboard (native range)
    const range = await fig.$('[data-compare-range]');
    await range.focus();
    await page.keyboard.press('End');
    near(await frame.evaluate((el) => parseFloat(el.style.getPropertyValue('--pos'))), 100, 0.01, 'End 키 후 --pos');
    await page.keyboard.press('Home');
    near(await frame.evaluate((el) => parseFloat(el.style.getPropertyValue('--pos'))), 0, 0.01, 'Home 키 후 --pos');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    near(await frame.evaluate((el) => parseFloat(el.style.getPropertyValue('--pos'))), 1, 0.01, '→ 두 번 후 --pos');
    const focusRing = await page.evaluate(() => {
      const h = document.activeElement.parentElement.querySelector('[data-compare-handle]');
      const g = h.querySelector('.compare__grip') || h;
      const s = getComputedStyle(g);
      return s.outlineStyle !== 'none' || s.boxShadow !== 'none';
    });
    assert(focusRing, '키보드 포커스 시 손잡이에 포커스 표시가 없음');
    await frame.dblclick({ position: { x: box.width * 0.8, y: box.height * 0.5 } });
    near(await frame.evaluate((el) => parseFloat(el.style.getPropertyValue('--pos'))), 50, 0.01, '더블클릭 후 --pos');
    return null;
  });

  await test('비포·애프터(영상): 재생 버튼 → 캔버스에 좌우 비교 영상이 그려짐', async () => {
    const fig = await page.$('[data-compare][data-compare-video]');
    if (!fig) return skip('비교 영상 없음');
    if (!canPlay) return skip('영상 재생 불가 환경');
    await fig.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const button = await fig.$('[data-compare-play]');
    assert(await button.isVisible(), '영상 비교 재생 버튼이 보이지 않음');
    await button.click();
    assert((await button.getAttribute('aria-pressed')) === 'true', 'aria-pressed가 true가 아님');
    const frame = await fig.$('[data-compare-frame]');
    await page.waitForFunction((el) => el.getAttribute('data-compare-state') === 'video', frame, { timeout: 15000 });
    await sleep(400);
    const stats = await fig.$eval('[data-compare-canvas]', (c) => {
      const { width: w, height: h } = c;
      const d = c.getContext('2d').getImageData(0, 0, w, h).data;
      let n = 0;
      let sum = 0;
      let sum2 = 0;
      let lit = 0;
      for (let p = 0; p < d.length; p += 4 * 131) {
        const v = (d[p] + d[p + 1] + d[p + 2]) / 3;
        n++;
        sum += v;
        sum2 += v * v;
        if (v > 12) lit++;
      }
      const mean = sum / n;
      const s = getComputedStyle(c);
      return { w, h, lit: lit / n, sd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), shown: s.visibility !== 'hidden' && Number(s.opacity) > 0.5 && s.display !== 'none' };
    });
    assert(stats.w > 0 && stats.h > 0, `캔버스 크기 ${stats.w}×${stats.h}`);
    assert(stats.lit > 0.2 && stats.sd > 3, `캔버스가 비어 있음 (밝은 픽셀 ${(stats.lit * 100).toFixed(0)}%, 표준편차 ${stats.sd.toFixed(1)})`);
    assert(stats.shown, '캔버스가 화면에 표시되지 않음');
    // dragging while the video runs keeps the canvas visible and redraws at the new position
    const box = await frame.boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4, { steps: 4 });
    assert((await frame.getAttribute('data-compare-state')) === 'video', '영상 재생 중 드래그하면 캔버스가 사라짐');
    await page.mouse.up();
    await button.click();
    assert((await button.getAttribute('aria-pressed')) === 'false', '다시 누르면 aria-pressed가 false여야 함');
    assert((await frame.getAttribute('data-compare-state')) === null, '정지 후 data-compare-state가 남음');
    return null;
  });

  await test('스크롤 위치에 맞춰 메뉴 항목 강조 (aria-current)', async () => {
    const target = (await page.$('#services')) ? 'services' : 'contact';
    await page.evaluate((id) => document.getElementById(id).scrollIntoView({ block: 'start', behavior: 'instant' }), target);
    await page.waitForFunction((id) => document.querySelector(`[data-nav-link][aria-current="true"]`)?.getAttribute('href') === `#${id}`, target, { timeout: 3000 });
    const count = await page.$$eval('[data-nav-link][aria-current="true"]', (els) => els.length);
    assert(count === 1, `aria-current 항목이 ${count}개`);
  });

  await test('이메일 복사 버튼 → 클립보드 + 안내 토스트', async () => {
    const btn = await page.$('.site-footer [data-copy]');
    if (!btn) return skip('복사 버튼 없음');
    const text = await btn.getAttribute('data-copy');
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await page.waitForFunction(() => document.querySelector('[data-toast]')?.textContent === '복사했습니다', null, { timeout: 3000 });
    assert(!(await page.$eval('[data-toast]', (t) => t.hidden)), '토스트가 보이지 않음');
    assert((await page.evaluate(() => navigator.clipboard.readText())) === text, '클립보드 내용이 이메일과 다름');
    return null;
  });

  await test('문의 양식: 필수 항목 검사 (aria-invalid · 오류 문구 · 첫 칸 포커스)', async () => {
    const form = await page.$('form[data-inquiry]');
    if (!form) return skip('문의 양식 없음');
    await page.evaluate(() => localStorage.removeItem('tonecraft:inquiry-draft'));
    await page.evaluate(() => document.getElementById('contact').scrollIntoView({ behavior: 'instant' }));
    await page.click('form[data-inquiry] [type="submit"]');
    const s = await page.evaluate(() => {
      const f = document.querySelector('form[data-inquiry]');
      return {
        invalid: Array.from(f.querySelectorAll('[aria-invalid="true"]')).map((e) => e.name),
        errors: Array.from(f.querySelectorAll('[data-field-error]')).filter((e) => !e.hidden && e.textContent.trim()).map((e) => e.getAttribute('data-field-error')),
        focus: document.activeElement?.name || '',
        state: f.getAttribute('data-state'),
        status: f.querySelector('[data-inquiry-status]').textContent,
        errorVisible: Array.from(f.querySelectorAll('[data-field-error]')).every((e) => e.hidden || e.getBoundingClientRect().height > 0),
      };
    });
    assert(s.invalid.join() === 'name,reply,message', `aria-invalid 필드: ${s.invalid.join(',')}`);
    assert(s.errors.join() === 'name,reply,message', `오류 문구 표시 필드: ${s.errors.join(',')}`);
    assert(s.errorVisible, '오류 문구가 화면에 보이지 않음');
    assert(s.focus === 'name', `첫 오류 칸에 포커스가 가지 않음 (${s.focus})`);
    assert(s.state === 'error' && /3개/.test(s.status), `상태: ${s.state} / "${s.status}"`);
    await page.fill('#inq-name', '테스트');
    assert((await page.getAttribute('#inq-name', 'aria-invalid')) === null, '입력 후에도 aria-invalid가 남음');
    return null;
  });

  await test('문의 양식: 메일 제목·본문·mailto 구성 + 내용 복사 + 임시 저장 복원', async () => {
    const form = await page.$('form[data-inquiry]');
    if (!form) return skip('문의 양식 없음');
    const values = {
      name: '홍길동 / DEMO 필름',
      reply: 'client@example.com',
      runtime: '30초 광고 2편',
      source: 'Sony FX3 S-Log3',
      deadline: '2026-12-01',
      reference: 'https://example.com/ref',
      message: '따뜻한 톤의 자동차 광고입니다.\n두 번째 줄 & 특수문자 <테스트> ?=#',
    };
    for (const [name, v] of Object.entries(values)) await page.fill(`#inq-${name}`, v);
    const hasType = (await page.$$eval('#inq-type option', (o) => o.length)) > 1;
    let typeLabel = '프로젝트 문의';
    if (hasType) {
      await page.selectOption('#inq-type', { index: 1 });
      typeLabel = await page.$eval('#inq-type', (s) => s.options[s.selectedIndex].text);
    }
    await page.evaluate(() => {
      window.__inquiry = null;
      document.querySelector('form[data-inquiry]').addEventListener(
        'tonecraft:inquiry',
        (e) => {
          window.__inquiry = e.detail;
          e.preventDefault(); // don't hand off to a mail app during the test
        },
        { once: true },
      );
    });
    // With an online endpoint the mail app is the fallback: make the endpoint fail to exercise that path.
    const endpoint = await page.getAttribute('form[data-inquiry]', 'data-endpoint');
    if (endpoint) {
      expectedStatus.set(endpoint, 500);
      await page.route(endpoint, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"test"}' }));
    }
    const urlBefore = page.url();
    await page.click('form[data-inquiry] [type="submit"]');
    await page.waitForFunction(() => window.__inquiry, null, { timeout: 5000 });
    const d = await page.evaluate(() => window.__inquiry);
    const subject = `${homeInfo.prefix} ${values.name} — ${typeLabel}`.trim();
    assert(d.subject === subject, `제목 "${d.subject}" (기대 "${subject}")`);
    assert(d.mailto.startsWith(`mailto:${homeInfo.email}?subject=`), `mailto 주소: ${d.mailto.slice(0, 60)}`);
    const q = new URLSearchParams(d.mailto.slice(d.mailto.indexOf('?') + 1));
    assert(q.get('subject') === subject, 'mailto subject 인코딩이 원문과 다름');
    const body = q.get('body');
    assert(body === d.body.replace(/\n/g, '\r\n'), 'mailto body가 detail.body(CRLF)와 다름');
    for (const line of ['성함 / 회사명: 홍길동 / DEMO 필름', '회신받을 연락처: client@example.com', '희망 납품일: 2026-12-01', values.message.replace(/\n/g, '\r\n'), '— tonecraft 웹사이트 문의 양식에서 보냄']) {
      assert(body.includes(line), `본문에 "${line.split('\r\n')[0]}" 없음`);
    }
    if (hasType) assert(body.includes(`프로젝트 유형: ${typeLabel}`), '본문에 프로젝트 유형 없음');
    assert(body.indexOf('프로젝트 내용') > body.indexOf('레퍼런스 링크'), '메시지가 마지막에 오지 않음');
    assert(page.url() === urlBefore, '페이지 주소가 바뀜');
    assert((await page.textContent('[data-inquiry-status]')).includes(homeInfo.email), '안내 문구에 이메일 주소가 없음');
    if (endpoint) {
      assert((await page.textContent('[data-inquiry-status]')).includes('온라인 전송에 실패'), '전송 실패 후 메일 앱 안내가 없음');
      await page.unroute(endpoint);
    }
    // copy
    await page.click('[data-inquiry-copy]');
    await page.waitForFunction(() => document.querySelector('form[data-inquiry]').getAttribute('data-state') === 'copied', null, { timeout: 3000 });
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert(clip.startsWith(`받는 사람: ${homeInfo.email}\n제목: ${subject}\n\n`), `복사 내용 머리말: ${clip.slice(0, 80)}`);
    assert(clip.includes(values.message), '복사 내용에 메시지가 없음');
    // draft autosave → restore after reload
    await page.waitForFunction(() => localStorage.getItem('tonecraft:inquiry-draft'), null, { timeout: 3000 });
    await page.reload({ waitUntil: 'load' });
    assert((await page.inputValue('#inq-name')) === values.name, '새로고침 후 작성 중이던 이름이 복원되지 않음');
    assert((await page.inputValue('#inq-message')) === values.message, '새로고침 후 메시지가 복원되지 않음');
    assert((await page.textContent('[data-inquiry-status]')).includes('불러왔습니다'), '복원 안내 문구 없음');
    await page.evaluate(() => localStorage.removeItem('tonecraft:inquiry-draft'));
    return null;
  });

  await test('문의 양식: 온라인 전송(formEndpoint) 성공 → 완료 안내 · 양식 비움 · 임시 저장 삭제', async () => {
    const endpoint = await page.getAttribute('form[data-inquiry]', 'data-endpoint').catch(() => null);
    if (!endpoint) return skip('formEndpoint 없음 (메일 앱 방식)');
    let payload = null;
    expectedStatus.set(endpoint, 200);
    await page.route(endpoint, async (route) => {
      payload = JSON.parse(route.request().postData() || 'null');
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.fill('#inq-name', '온라인 전송 테스트');
    await page.fill('#inq-reply', 'client@example.com');
    await page.fill('#inq-message', '폼 전송 서비스 테스트입니다.');
    await page.click('form[data-inquiry] [type="submit"]');
    await page.waitForFunction(() => document.querySelector('form[data-inquiry]').getAttribute('data-state') === 'sent', null, { timeout: 8000 });
    assert(payload && payload.name === '온라인 전송 테스트' && payload.message === '폼 전송 서비스 테스트입니다.', `전송 내용: ${JSON.stringify(payload)}`);
    assert(payload._replyto === 'client@example.com' && /온라인 전송 테스트/.test(payload._subject), '_replyto / _subject 누락');
    assert((await page.textContent('[data-inquiry-status]')).includes('문의가 전송되었습니다'), '완료 안내 문구 없음');
    assert((await page.inputValue('#inq-name')) === '', '전송 후 양식이 비워지지 않음');
    await sleep(500);
    assert(!(await page.evaluate(() => localStorage.getItem('tonecraft:inquiry-draft'))), '전송 후 임시 저장이 남아 있음');
    await page.unroute(endpoint);
    return null;
  });

  await test('axe 접근성 (홈)', async () => {
    await open(page, '/');
    return runAxe(page);
  });

  // ---- work pages
  const workUrls = await (async () => {
    await open(page, '/');
    return page.$$eval('[data-work-item] a.work-card', (as) => as.map((a) => ({ href: a.getAttribute('href'), title: a.querySelector('h3')?.textContent.trim() })));
  })();

  await test('작업 카드 클릭 → 작업 페이지 (플레이어/포스터, 제목, 링크)', async () => {
    if (!workUrls.length) return skip('공개된 작업 없음');
    await page.click('[data-work-item] a.work-card');
    await page.waitForURL(/\/works\/[a-z0-9-]+\/$/);
    await page.waitForFunction(() => document.documentElement.classList.contains('js'));
    assert((await page.getAttribute('body', 'data-page')) === 'work', 'body[data-page=work] 아님');
    assert((await page.textContent('h1')).trim() === workUrls[0].title, 'h1이 카드 제목과 다름');
    return null;
  });

  await test('모든 작업 페이지: 오류·넘침 없음, 영상/임베드, 이전·다음·목록 링크가 200으로 열림', async () => {
    if (!workUrls.length) return skip('공개된 작업 없음');
    let facadeTested = false;
    for (const w of workUrls) {
      const res = await open(page, `/${w.href.replace(/^\.?\//, '')}`);
      assert(res.status() === 200, `${w.href}: HTTP ${res.status()}`);
      await scrollThrough(page);
      await checkLayout(page).catch((e) => {
        throw new Error(`${w.href}: ${e.message}`);
      });
      const info = await page.evaluate(() => ({
        video: document.querySelector('.work-player__video source')?.getAttribute('src') || '',
        facade: Boolean(document.querySelector('[data-embed-facade]')),
        poster: document.querySelector('.work-player__poster, .work-player__video')?.getAttribute('poster') || document.querySelector('.work-player__poster')?.currentSrc || '',
        links: Array.from(document.querySelectorAll('.work-pager a, .back-link, .work-cta a, .site-nav a, .brand')).map((a) => ({ href: a.getAttribute('href'), title: a.querySelector('.work-pager__title')?.textContent.trim() || '' })),
        h1: document.querySelector('h1')?.textContent.trim(),
        playerRatio: (() => {
          const p = document.querySelector('.work-player');
          const r = p?.getBoundingClientRect();
          return r ? r.width / r.height : 0;
        })(),
      }));
      assert(info.h1 === w.title, `${w.href}: 제목 "${info.h1}"`);
      assert(info.video || info.facade || info.poster, `${w.href}: 영상·임베드·포스터가 모두 없음`);
      assert(info.playerRatio > 1 && info.playerRatio < 3, `${w.href}: 플레이어 비율 ${info.playerRatio.toFixed(2)}`);
      if (info.video) {
        const r = await resolves(page, info.video);
        assert(r.status === 200, `${w.href}: 영상 ${r.url} → HTTP ${r.status}`);
      }
      for (const l of info.links) {
        if (!toLocal(new URL(l.href, page.url()).href).startsWith(BASE)) continue; // external (Kmong …) — checked for target/rel on the home test
        const r = await resolves(page, l.href);
        assert(r.status === 200, `${w.href}: 링크 ${l.href} → ${r.url} HTTP ${r.status}`);
        if (l.title) {
          const html = await (await page.request.get(r.url)).text();
          assert(html.includes(`>${l.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h1>`), `${w.href}: "${l.title}" 링크가 다른 페이지로 연결됨`);
        }
      }
      if (info.facade && !facadeTested) {
        // click-to-load player: route the third-party player to a stub so the test stays offline
        await page.click('[data-embed-facade]');
        await page.waitForSelector('iframe.work-player__iframe');
        facadeTested = true;
      }
    }
    return null;
  });

  await test('axe 접근성 (작업 페이지)', async () => {
    if (!workUrls.length) return skip('공개된 작업 없음');
    await open(page, `/${workUrls[Math.min(2, workUrls.length - 1)].href}`);
    return runAxe(page);
  });

  await test('없는 주소 → 404 페이지 (상태 404, 스타일·링크 정상)', async () => {
    for (const p of ['/no-such-page/', '/works/no-such-work/deeper/page']) {
      expectedStatus.set(BASE + p, 404);
      const res = await page.goto(BASE + p, { waitUntil: 'load' });
      assert(res.status() === 404, `${p}: HTTP ${res.status()}`);
      assert((await page.getAttribute('body', 'data-page')) === '404', `${p}: 404 페이지가 아님`);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert(bg === 'rgb(16, 16, 16)', `${p}: CSS가 적용되지 않음 (배경 ${bg})`);
      await checkLayout(page);
      const hrefs = await page.$$eval('.notfound a', (as) => as.map((a) => a.getAttribute('href')));
      for (const h of hrefs) {
        const r = await resolves(page, h);
        assert(r.status === 200, `${p}: 링크 ${h} → HTTP ${r.status}`);
      }
    }
    return runAxe(page);
  });

  await context.close();
}

// ============================ reduced motion ============================
{
  currentGroup = '[동작 줄이기]';
  out('\n동작 줄이기(prefers-reduced-motion: reduce)');
  const context = await newContext('reduced-motion', { viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const mp4 = [];
  page.on('request', (r) => {
    if (/\.mp4(\?|$)/.test(r.url())) mp4.push(r.url());
  });
  await test('배경 영상 자동 재생 안 함 · 영상 파일도 받지 않음 · 모든 내용 표시', async () => {
    await open(page, '/');
    await sleep(1500);
    const s = await page.evaluate(() => ({
      state: document.querySelector('[data-hero]')?.getAttribute('data-state'),
      src: document.querySelector('[data-hero-video]')?.getAttribute('src') ?? null,
      pressed: document.querySelector('[data-hero-toggle]')?.getAttribute('aria-pressed') ?? null,
      unrevealed: Array.from(document.querySelectorAll('[data-reveal]')).filter((el) => el.getAttribute('data-revealed') !== 'true').length,
      invisible: Array.from(document.querySelectorAll('[data-reveal]')).filter((el) => Number(getComputedStyle(el).opacity) < 1).length,
    }));
    assert(s.state === 'paused', `data-state=${s.state}`);
    assert(s.src === null, '영상 src가 설정됨');
    if (s.pressed !== null) assert(s.pressed === 'true', '일시정지 버튼이 "재생" 상태(aria-pressed=true)를 보여야 함');
    assert(!s.unrevealed && !s.invisible, `숨겨진 블록 ${s.unrevealed}/${s.invisible}개`);
    const card = await page.$('.work-card[data-preview-src]');
    if (card) {
      await card.hover();
      await sleep(500);
      assert(!(await card.$('video')), '동작 줄이기인데 미리보기 영상이 생성됨');
    }
    assert(!mp4.length, `영상 요청이 발생함: ${mp4.join(', ')}`);
    if (homeInfo.hasReel && canPlay) {
      // an explicit click still plays it
      await page.click('[data-hero-toggle]');
      await page.waitForSelector('[data-hero][data-state="playing"]', { timeout: 15000 });
    }
    return null;
  });
  await context.close();
}

// ============================ without JavaScript ============================
{
  currentGroup = '[스크립트 없음]';
  out('\n자바스크립트 꺼짐 / main.js 로드 실패');
  await test('JS 꺼짐: 모든 내용·메뉴가 보이고 필터·복사 버튼은 숨김, 양식은 메일/전송 주소로 동작', async () => {
    const context = await newContext('no-js', { viewport: { width: 1280, height: 800 }, javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'load' });
      const s = await page.evaluate(() => ({
        cls: document.documentElement.className,
        invisible: Array.from(document.querySelectorAll('[data-reveal]')).filter((el) => Number(getComputedStyle(el).opacity) < 1).length,
        navVisible: Array.from(document.querySelectorAll('.site-nav a')).filter((a) => a.getBoundingClientRect().height > 0).length,
        navTotal: document.querySelectorAll('.site-nav [data-nav-link]').length,
        filtersShown: Boolean(document.querySelector('[data-filters]')?.getClientRects().length),
        copyShown: Array.from(document.querySelectorAll('[data-copy], [data-inquiry-copy]')).some((b) => b.getClientRects().length),
        formAction: document.querySelector('form[data-inquiry]')?.getAttribute('action') || '',
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      }));
      assert(/no-js/.test(s.cls), 'html에 no-js 클래스가 없음');
      assert(!s.invisible, `JS 없이 숨겨진 블록 ${s.invisible}개`);
      assert(s.navVisible >= s.navTotal, `메뉴 링크 ${s.navVisible}/${s.navTotal}개만 보임`);
      assert(!s.filtersShown && !s.copyShown, 'JS 없이는 동작하지 않는 필터/복사 버튼이 보임');
      assert(/^(mailto:|https:)/.test(s.formAction), `문의 양식 action: "${s.formAction}"`);
      assert(s.overflow <= 0, `가로 넘침 ${s.overflow}px`);
    } finally {
      await context.close();
    }
  });

  await test('main.js를 못 불러와도 4.5초 뒤 모든 내용 표시 (안전장치)', async () => {
    const context = await newContext('no-main-js', { viewport: { width: 1280, height: 800 } });
    await context.route(/\/assets\/js\/main\.js(\?|$)/, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* disabled by test */' }));
    const page = await context.newPage();
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'load' });
      const hiddenAtStart = await page.evaluate(
        () => Array.from(document.querySelectorAll('[data-reveal]')).filter((el) => Number(getComputedStyle(el).opacity) < 1).length,
      );
      await sleep(5200);
      const hidden = await page.evaluate(
        () => Array.from(document.querySelectorAll('[data-reveal]')).filter((el) => Number(getComputedStyle(el).opacity) < 1).length,
      );
      assert(!hidden, `5초 뒤에도 숨겨진 블록 ${hidden}개 (처음 ${hiddenAtStart}개)`);
    } finally {
      await context.close();
    }
  });
}

// ============================ mobile ============================
{
  currentGroup = '[모바일]';
  out('\n모바일 375×812 (터치)');
  const context = await newContext('mobile', { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  async function swipe(from, to, steps = 10) {
    await touch('touchStart', [{ x: from.x, y: from.y }]);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
      await sleep(16);
    }
    await touch('touchEnd', []);
    await sleep(100);
  }

  await test('홈: 오류 없이 열리고 가로 넘침·깨진 이미지 없음', async () => {
    await open(page, '/');
    await scrollThrough(page);
    await checkLayout(page);
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a, button, input, select, textarea, summary'))
        .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('.sr-only, [hidden], .site-nav, .skip-link'))
        .filter((el) => !(el.tagName === 'A' && el.closest('p, li, dd') && !el.className))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.height < 40 && !el.matches('.compare__range, .work-card');
        })
        .map((el) => `${el.tagName.toLowerCase()}.${el.className || ''} ${Math.round(el.getBoundingClientRect().height)}px`),
    );
    assert(!small.length, `터치 대상이 너무 작음: ${small.slice(0, 6).join(' | ')}`);
  });

  await test('메뉴: 열기 → 첫 링크 포커스 → Esc 닫기(버튼으로 포커스) → 링크 누르면 닫히고 이동', async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const toggle = await page.$('[data-nav-toggle]');
    assert(await toggle.isVisible(), '메뉴 버튼이 보이지 않음');
    await toggle.tap();
    await page.waitForSelector('[data-header][data-nav-open="true"]');
    assert((await toggle.getAttribute('aria-expanded')) === 'true', 'aria-expanded가 true가 아님');
    assert(await page.evaluate(() => document.documentElement.classList.contains('nav-open')), 'html.nav-open 없음');
    await page.waitForFunction(() => document.activeElement?.matches('[data-nav-link]'), null, { timeout: 2000 });
    const sheet = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('[data-nav-link]'));
      const r = links.map((l) => l.getBoundingClientRect());
      return { all: r.every((b) => b.height > 0 && b.bottom <= window.innerHeight && b.left >= 0 && b.right <= window.innerWidth), n: links.length };
    });
    assert(sheet.all, `메뉴 시트 안에 링크 ${sheet.n}개가 모두 보이지 않음`);
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-header][data-nav-open="false"]');
    assert(await page.evaluate(() => document.activeElement?.matches('[data-nav-toggle]')), 'Esc 후 포커스가 메뉴 버튼으로 돌아가지 않음');
    assert(!(await page.evaluate(() => document.documentElement.classList.contains('nav-open'))), 'html.nav-open이 남음');
    await toggle.tap();
    await page.waitForSelector('[data-header][data-nav-open="true"]');
    const link = await page.$('[data-nav-link][href="#contact"]');
    await link.tap();
    await page.waitForSelector('[data-header][data-nav-open="false"]');
    await page.waitForFunction(
      () => {
        const t = document.getElementById('contact').getBoundingClientRect().top;
        return t > -4 && t < 160;
      },
      null,
      { timeout: 4000 },
    );
    return null;
  });

  await test('히어로: 모바일에서도 음소거 배경 영상 인라인 재생', async () => {
    if (!homeInfo.hasReel) return skip('쇼릴 없음');
    if (!canPlay) return skip('영상 재생 불가 환경');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForSelector('[data-hero][data-state="playing"]', { timeout: 15000 });
    return null;
  });

  await test('비포·애프터: 가로 스와이프로 이동, 세로 스와이프는 페이지 스크롤, 탭으로 이동', async () => {
    const fig = await page.$('[data-compare]:not([data-compare-video])');
    if (!fig) return skip('비교 이미지 없음');
    await fig.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await sleep(300);
    const frame = await fig.$('[data-compare-frame]');
    const pos = () => frame.evaluate((el) => parseFloat(el.style.getPropertyValue('--pos')));
    let box = await frame.boundingBox();
    const y = box.y + box.height / 2;
    await swipe({ x: box.x + box.width * 0.5, y }, { x: box.x + box.width * 0.2, y });
    near(await pos(), 20, 3, '가로 스와이프 후 --pos');
    const scrollBefore = await page.evaluate(() => window.scrollY);
    box = await frame.boundingBox();
    await swipe({ x: box.x + box.width * 0.6, y: box.y + box.height * 0.8 }, { x: box.x + box.width * 0.62, y: box.y + box.height * 0.8 - 150 });
    near(await pos(), 20, 3, '세로 스와이프 후 --pos (바뀌면 안 됨)');
    const scrolled = (await page.evaluate(() => window.scrollY)) - scrollBefore;
    assert(scrolled > 40, `세로 스와이프로 페이지가 스크롤되지 않음 (${scrolled}px)`);
    box = await frame.boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.8, box.y + box.height * 0.5);
    await sleep(100);
    near(await pos(), 80, 3, '탭 후 --pos');
    return null;
  });

  await test('axe 접근성 (모바일 홈)', async () => {
    await open(page, '/');
    return runAxe(page);
  });

  await test('작업 페이지: 가로 넘침 없음', async () => {
    const href = await page.$eval('[data-work-item] a.work-card', (a) => a.getAttribute('href')).catch(() => null);
    if (!href) return skip('공개된 작업 없음');
    await open(page, `/${href}`);
    await scrollThrough(page);
    await checkLayout(page);
    return runAxe(page);
  });

  await context.close();
}

// ---------------------------------------------------------------------------------------------

await browser.close();
server.close();
server.closeAllConnections?.();

const passed = results.filter((r) => r.status === 'pass').length;
const failed = results.filter((r) => r.status === 'fail');
const skipped = results.filter((r) => r.status === 'skip').length;
out(`\n결과: 통과 ${passed} · 실패 ${failed.length} · 건너뜀 ${skipped} (${((Date.now() - t0) / 1000).toFixed(1)}초)${axeSource ? '' : ' — axe 검사 제외 (AXE_PATH 없음)'}`);
if (failed.length) {
  out('실패한 항목:');
  for (const f of failed) out(`  - ${f.name}`);
}
process.exitCode = failed.length ? 1 : 0;
