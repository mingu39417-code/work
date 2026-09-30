#!/usr/bin/env node
// npm run marketer [-- <명령>] — 크몽 전담 마케터 (README 15장)
//
//   (없음)            현황: 점검 점수 · 최근 주 퍼널 · 가장 급한 할 일
//   audit             판매 페이지 항목별 점검
//   log               주간 통계 기록 (--impressions --clicks --inquiries --orders --revenue [--week 날짜])
//   note "내용"        바꾼 것 기록 (제목 교체, 가격 조정 …) — 효과를 나중에 비교
//   report            주간 퍼널 추이와 병목 진단
//   export            크몽 편집기에 붙여 넣을 원고 → marketing/out/kmong-listing.txt
//   brief <작업>       Claude에게 줄 요청서 → marketing/out/brief-<작업>.md
import path from 'node:path';
import fsp from 'node:fs/promises';
import { checkNodeVersion, parseArgs, ArgError } from './lib/args.mjs';

checkNodeVersion();

const { c } = await import('./lib/log.mjs');
const { loadContent } = await import('./lib/content.mjs');
const K = await import('./lib/kmong.mjs');

const HELP = `사용법: npm run marketer -- [명령] [옵션]

  (명령 없음)        현황 요약: 점검 점수, 최근 주 퍼널, 가장 급한 할 일 3가지
  audit              크몽 판매 페이지 점검 (제목 규칙, 연락처 금지, 패키지, 포트폴리오 …)
  log                주간 통계 기록 — 크몽 판매자 통계에서 본 숫자를 넣습니다
                       --impressions 노출  --clicks 클릭  --inquiries 문의  --orders 주문  --revenue 매출(원)
                       --week 2026-09-21   (그 주의 아무 날짜. 생략하면 지난주)
  note "내용"         바꾼 것 기록 (예: "메인 이미지를 비포·애프터로 교체")  [--date 2026-09-30]
  report             주간 추이와 병목 진단 (어디서 의뢰인을 놓치는지 + 할 일)
  export             크몽 편집기에 붙여 넣을 원고 → marketing/out/kmong-listing.txt  [--stdout]
  brief <작업>        Claude에게 붙여 넣을 요청서 → marketing/out/brief-<작업>.md  [--input 파일] [--stdout]
                       작업: ${Object.entries(K.BRIEF_TASKS).map(([k, v]) => `${k}(${v.label})`).join(', ')}

  공통 옵션: --json (결과를 JSON으로, Claude Code용)  --root <폴더>

  통계·원고·요청서는 marketing/ 폴더에 저장되며 git에 올라가지 않습니다.`;

let args;
try {
  args = parseArgs(process.argv.slice(2), {
    allowPositionals: true,
    flags: {
      help: 'boolean',
      json: 'boolean',
      stdout: 'boolean',
      root: 'string',
      week: 'string',
      date: 'string',
      input: 'string',
      impressions: 'string',
      clicks: 'string',
      inquiries: 'string',
      orders: 'string',
      revenue: 'string',
    },
  });
} catch (err) {
  if (err instanceof ArgError) {
    process.stderr.write(`${err.message}\n\n${HELP}\n`);
    process.exit(2);
  }
  throw err;
}

const { values: opt, positionals } = args;
if (opt.help) {
  process.stdout.write(`${HELP}\n`);
  process.exit(0);
}

const root = opt.root ? path.resolve(opt.root) : process.cwd();
const [cmd = 'status', ...rest] = positionals;
const out = (...lines) => process.stdout.write(`${lines.join('\n')}\n`);
const fail = (msg, code = 1) => {
  process.stderr.write(`${c.red('✗')} ${msg}\n`);
  process.exit(code);
};
const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, '/') || '.';

async function context() {
  const { gig, error } = await K.loadGig(root);
  if (error) fail(error);
  const content = await loadContent(root);
  const site = content.errors.length ? null : content.site;
  const audit = await K.auditGig(gig, { site, works: content.works, root });
  const stats = await K.loadStats(root).catch((err) => fail(err.message));
  return { gig, site, works: content.works, contentErrors: content.errors, audit, stats };
}

function parseCount(name, raw) {
  if (raw === undefined) return undefined;
  const cleaned = String(raw).replace(/[,\s원회건]/g, '');
  const n = Number(cleaned);
  if (cleaned === '' || !Number.isFinite(n) || n < 0) fail(`--${name} 값은 0 이상의 숫자여야 합니다: ${raw}`, 2);
  return n;
}

function parseDateOpt(name, raw, fallback) {
  if (raw === undefined) return fallback;
  if (!K.isDate(raw)) fail(`--${name} 은 2026-09-30 형식의 날짜로 적으세요: ${raw}`, 2);
  return raw;
}

const LEVEL = {
  ok: () => c.green('✓'),
  warn: () => c.yellow('!'),
  fail: () => c.red('✗'),
  tip: () => c.cyan('·'),
};

function scoreColor(score) {
  return score >= 85 ? c.green : score >= 60 ? c.yellow : c.red;
}

function printFixes(items) {
  const fixes = K.topFixes(items);
  if (!fixes.length) {
    out(`${c.green('✓')} 판매 페이지 점검 항목을 모두 통과했습니다.`);
    return;
  }
  fixes.forEach((f, i) => {
    out(`  ${i + 1}. ${LEVEL[f.level]()} ${f.msg}`);
    if (f.fix) out(`     ${c.dim(`→ ${f.fix}`)}`);
  });
}

function printFunnel(d) {
  const w = d.latest;
  const ch = (k) => (d.change[k] === undefined ? '' : c.dim(` (${d.change[k] >= 0 ? '+' : ''}${k === 'revenue' ? K.formatWon(d.change[k]) : d.change[k].toLocaleString('ko-KR')})`));
  const v = (k) => (Number.isFinite(w[k]) ? (k === 'revenue' ? K.formatWon(w[k]) : w[k].toLocaleString('ko-KR')) : '-');
  out(`  ${d.week} 주 · 노출 ${v('impressions')}${ch('impressions')} → 클릭 ${v('clicks')}${ch('clicks')} → 문의 ${v('inquiries')}${ch('inquiries')} → 주문 ${v('orders')}${ch('orders')} · 매출 ${v('revenue')}${ch('revenue')}`);
  out(`  클릭률 ${K.formatPct(d.rates.ctr)} · 문의율 ${K.formatPct(d.rates.inquiryRate)} · 주문율 ${K.formatPct(d.rates.orderRate)}${d.rates.aov !== null ? ` · 건당 ${K.formatWon(d.rates.aov)}` : ''}`);
}

async function writeOut(name, text) {
  const file = path.join(root, K.OUT_DIR, name);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, text);
  return file;
}

// ---------------------------------------------------------------------------------------------

async function status() {
  const ctx = await context();
  const d = K.diagnose(ctx.stats, ctx.gig.benchmarks);
  if (opt.json) {
    out(JSON.stringify({ score: ctx.audit.score, fixes: K.topFixes(ctx.audit.items), diagnosis: d }, null, 2));
    return;
  }
  out(c.bold('TONECRAFT 크몽 마케터'));
  if (ctx.contentErrors.length) out(`${c.yellow('!')} content/site.mjs·works.mjs 오류로 일부 점검을 건너뜁니다 — npm run check 로 확인하세요.`);
  out('');
  out(`판매 페이지 점수  ${scoreColor(ctx.audit.score)(c.bold(`${ctx.audit.score}점`))} / 100`);
  out('');
  out(c.bold('지금 가장 급한 것'));
  printFixes(ctx.audit.items);
  out('');
  out(c.bold('최근 성과'));
  if (!d) {
    out(`  기록된 통계가 없습니다. 크몽 판매자 통계를 보고 지난주 숫자를 넣어 주세요:`);
    out(c.dim('  npm run marketer -- log --impressions 850 --clicks 30 --inquiries 3 --orders 1 --revenue 150000'));
  } else {
    printFunnel(d);
    if (d.findings.length) out(`  ${c.yellow('!')} 병목: ${d.findings[0].title} — ${d.findings[0].detail}`);
    else out(`  ${c.green('✓')} 기준에 미달하는 단계가 없습니다.`);
  }
  out('');
  out(c.dim('자세히: audit(점검) · report(진단) · export(크몽 원고) · brief <작업>(Claude 요청서) · --help'));
}

async function audit() {
  const ctx = await context();
  if (opt.json) {
    out(JSON.stringify(ctx.audit, null, 2));
    return;
  }
  out(`${c.bold('크몽 판매 페이지 점검')}  ${scoreColor(ctx.audit.score)(c.bold(`${ctx.audit.score}점`))} / 100`);
  let area = '';
  for (const i of ctx.audit.items) {
    if (i.area !== area) {
      area = i.area;
      out('', c.bold(`[${area}]`));
    }
    out(`  ${LEVEL[i.level]()} ${i.msg}`);
    if (i.fix && i.level !== 'ok') out(`    ${c.dim(`→ ${i.fix}`)}`);
  }
  const fails = ctx.audit.items.filter((i) => i.level === 'fail').length;
  const warns = ctx.audit.items.filter((i) => i.level === 'warn').length;
  out('', `필수 ${fails}개 · 권장 ${warns}개. 고칠 곳: content/kmong.mjs`);
}

async function log() {
  const values = {};
  for (const k of K.METRICS) {
    const v = parseCount(k, opt[k]);
    if (v !== undefined) values[k] = v;
  }
  if (!Object.keys(values).length) fail('기록할 숫자가 없습니다. 예: npm run marketer -- log --impressions 850 --clicks 30 --inquiries 3 --orders 1 --revenue 150000', 2);
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  const inWeek = parseDateOpt('week', opt.week, K.ymd(lastWeek));
  const [y, m, dd] = inWeek.split('-').map(Number);
  const week = K.weekStart(new Date(y, m - 1, dd));
  if (values.clicks !== undefined && values.impressions !== undefined && values.clicks > values.impressions) {
    process.stderr.write(`${c.yellow('!')} 클릭수가 노출수보다 많습니다 — 숫자를 바꿔 적지 않았는지 확인하세요.\n`);
  }
  const stats = K.upsertWeek(await K.loadStats(root), week, values);
  await K.saveStats(root, stats);
  const saved = stats.weeks.find((w) => w.week === week);
  if (opt.json) {
    out(JSON.stringify(saved, null, 2));
    return;
  }
  out(`${c.green('✓')} ${week} 주(월요일 시작) 기록: ${K.METRICS.filter((k) => saved[k] !== undefined).map((k) => `${K.METRIC_LABELS[k]} ${k === 'revenue' ? K.formatWon(saved[k]) : saved[k].toLocaleString('ko-KR')}`).join(' · ')}`);
  out(c.dim(`  저장 위치: ${rel(path.join(root, K.STATS_FILE))} (git에 올라가지 않음) · 다른 주라면 --week 날짜 를 붙이세요`));
  out(c.dim('  진단 보기: npm run marketer -- report'));
}

async function note() {
  const text = rest.join(' ').trim();
  if (!text) fail('기록할 내용을 따옴표 안에 적으세요. 예: npm run marketer -- note "메인 이미지를 비포·애프터로 교체"', 2);
  const date = parseDateOpt('date', opt.date, K.ymd(new Date()));
  await K.saveStats(root, K.addNote(await K.loadStats(root), date, text));
  if (opt.json) out(JSON.stringify({ date, text }));
  else out(`${c.green('✓')} ${date} 변경 기록: ${text}`);
}

async function report() {
  const ctx = await context();
  const d = K.diagnose(ctx.stats, ctx.gig.benchmarks);
  if (opt.json) {
    out(JSON.stringify({ weeks: ctx.stats.weeks.map((w) => ({ ...w, ...K.funnel(w) })), notes: ctx.stats.notes, diagnosis: d, benchmarks: ctx.gig.benchmarks }, null, 2));
    return;
  }
  if (!d) {
    out('기록된 통계가 없습니다. 먼저 log 로 주간 숫자를 넣어 주세요 (npm run marketer -- --help).');
    return;
  }
  out(c.bold('주간 추이'), '');
  out(c.dim('  주 시작        노출     클릭   문의   주문           매출   클릭률  문의율  주문율'));
  for (const w of ctx.stats.weeks.slice(-12)) {
    const f = K.funnel(w);
    const n = (v, width) => String(Number.isFinite(v) ? v.toLocaleString('ko-KR') : '-').padStart(width);
    out(`  ${w.week}  ${n(w.impressions, 7)}  ${n(w.clicks, 6)}  ${n(w.inquiries, 5)}  ${n(w.orders, 5)}  ${(Number.isFinite(w.revenue) ? K.formatWon(w.revenue) : '-').padStart(13)}  ${K.formatPct(f.ctr).padStart(6)}  ${K.formatPct(f.inquiryRate).padStart(6)}  ${K.formatPct(f.orderRate).padStart(6)}`);
    const notes = ctx.stats.notes.filter((x) => x.date >= w.week && x.date < nextWeek(w.week));
    notes.forEach((x) => out(c.cyan(`      ↳ ${x.date} ${x.text}`)));
  }
  out('', c.bold('이번 주 진단'));
  printFunnel(d);
  d.lowSample.forEach((x) => out(c.dim(`  · ${x}`)));
  out('');
  if (!d.findings.length) {
    out(`${c.green('✓')} 기준에 미달하는 단계가 없습니다. 지금 방식을 유지하면서 한 번에 하나씩만 바꿔 보세요 (바꾼 것은 note 로 기록).`);
  } else {
    d.findings.forEach((f, i) => {
      out(`${i === 0 ? c.red('●') : c.yellow('●')} ${c.bold(f.title)}`);
      out(`  ${f.detail}`);
      f.actions.slice(0, i === 0 ? 5 : 2).forEach((a) => out(`  - ${a}`));
      out('');
    });
    out(c.dim('한 번에 한 가지만 바꾸고, 바꾼 날을 note 로 남기면 다음 주에 효과를 비교할 수 있습니다.'));
  }
  out(c.dim(`기준값(크몽 공식 수치 아님): 노출 ${ctx.gig.benchmarks.minImpressions}회/주 · 클릭률 ${K.formatPct(ctx.gig.benchmarks.ctr)} · 문의율 ${K.formatPct(ctx.gig.benchmarks.inquiryRate)} · 주문율 ${K.formatPct(ctx.gig.benchmarks.orderRate)} — content/kmong.mjs 의 benchmarks 에서 조정`));
}

function nextWeek(week) {
  const [y, m, d] = week.split('-').map(Number);
  return K.ymd(new Date(y, m - 1, d + 7));
}

async function exportListing() {
  const ctx = await context();
  const text = K.renderListing(ctx.gig, ctx.site);
  if (opt.stdout) {
    process.stdout.write(text);
    return;
  }
  const file = await writeOut('kmong-listing.txt', text);
  out(`${c.green('✓')} 크몽 원고를 만들었습니다: ${rel(file)}`);
  out(c.dim('  크몽 서비스 편집 화면에 항목별로 복사해 붙여 넣으세요.'));
  const fails = ctx.audit.items.filter((i) => i.level === 'fail');
  if (fails.length) out(`${c.yellow('!')} 아직 필수 항목 ${fails.length}개가 남아 있습니다 (npm run marketer -- audit).`);
}

async function brief() {
  const task = rest[0];
  if (!task || !K.BRIEF_TASKS[task]) fail(`작업을 고르세요: ${Object.keys(K.BRIEF_TASKS).join(', ')}  (예: npm run marketer -- brief title)`, 2);
  let input = '';
  if (opt.input) {
    try {
      input = (await fsp.readFile(path.resolve(opt.input), 'utf8')).trim();
    } catch (err) {
      fail(`--input 파일을 읽지 못했습니다: ${err.message}`);
    }
  }
  const ctx = await context();
  const text = K.buildBrief(task, { ...ctx, input });
  if (opt.stdout) {
    process.stdout.write(text);
    return;
  }
  const file = await writeOut(`brief-${task}.md`, text);
  out(`${c.green('✓')} 요청서를 만들었습니다: ${rel(file)}`);
  out(c.dim('  파일 내용을 통째로 Claude(claude.ai)에 붙여 넣거나, Claude Code에서 /kmong-marketer 로 바로 요청하세요.'));
  if (['reply', 'competitor'].includes(task) && !input) out(c.dim('  문의·경쟁 서비스 내용은 파일 맨 아래 「붙여 넣기」 자리에 넣거나 --input 파일 로 지정하세요.'));
}

const COMMANDS = { status, audit, log, note, report, export: exportListing, brief };
if (!COMMANDS[cmd]) fail(`알 수 없는 명령: ${cmd}\n\n${HELP}`, 2);
try {
  await COMMANDS[cmd]();
} catch (err) {
  fail(`예기치 않은 오류: ${err?.stack || err}`);
}
