#!/usr/bin/env node
// npm run demo → generate a complete demo project in .demo/ (synthetic footage, DEMO works),
// process its media and build it. Then: node tools/serve.mjs --root .demo
//   node tools/demo.mjs [--root <dir>] [--force]
import path from 'node:path';
import { checkNodeVersion, parseArgs, ArgError } from './lib/args.mjs';

checkNodeVersion();

const HELP = `사용법: node tools/demo.mjs [--force] [--root <폴더>]
  데모용 합성 영상으로 작업 8개(공개 6 · 비공개 1 · 동의 대기 1)와 쇼릴을 만들고,
  미디어 처리와 빌드까지 한 번에 실행합니다. 결과는 .demo/ 폴더 (git에 올라가지 않음).
  --force       이미 만든 데모 원본·미디어도 모두 다시 만들기
  --root <폴더> 데모 프로젝트 위치 (기본 .demo)`;

let args;
try {
  args = parseArgs(process.argv.slice(2), { flags: { root: 'string', force: 'boolean', quiet: 'boolean', help: 'boolean' } });
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

const { REPO_ROOT, buildSite } = await import('./lib/build-site.mjs');
const { runMedia } = await import('./lib/media-pipeline.mjs');
const { generateDemoProject } = await import('./lib/demo.mjs');
const { findFfmpeg, FFMPEG_HELP } = await import('./lib/ffmpeg.mjs');
const { createLogger, c, formatDuration } = await import('./lib/log.mjs');

const t0 = Date.now();
const log = createLogger({ quiet: args.values.quiet });
const root = args.values.root ? path.resolve(args.values.root) : path.join(REPO_ROOT, '.demo');
const rel = path.relative(process.cwd(), root) || '.';
const shown = rel.startsWith('..') ? root : rel;

const tools = await findFfmpeg();
if (!tools) {
  log.error(FFMPEG_HELP);
  process.exit(1);
}

try {
  log.info(c.bold(`TONECRAFT 데모 프로젝트 → ${shown}`));
  log.step('1/3 데모 원본 영상 만들기 (ffmpeg 합성)');
  const gen = await generateDemoProject({ root, repoRoot: REPO_ROOT, ffmpeg: tools.ffmpeg, force: args.values.force, log: (s) => log.info(c.gray(`  ${s}`)) });
  if (gen.skipped) log.info(c.gray(`  이미 있는 원본 ${gen.skipped}개는 그대로 사용 (--force 로 다시 생성)`));

  log.step('2/3 미디어 처리');
  const media = await runMedia({ root, tools, force: args.values.force, preset: process.env.TONECRAFT_X264_PRESET || 'veryfast', concurrency: 3, logger: log });
  if (!media.ok) throw new Error('미디어 처리 실패');

  log.step('3/3 빌드');
  const prod = await buildSite({ root, logger: log });
  const prev = prod.ok ? await buildSite({ root, preview: true, logger: createLogger({ quiet: true }) }) : null;
  log.info('');
  if (!prod.ok) {
    log.error('데모 빌드에 실패했습니다 (위 오류 참고). 미디어는 준비되어 있습니다.');
    process.exitCode = 1;
  } else {
    log.ok(c.bold(`데모 완료 (${formatDuration(Date.now() - t0)})`));
    log.info(`  배포본 보기      node tools/serve.mjs --root ${shown}`);
    if (prev?.ok) log.info(`  비공개 포함 보기 node tools/serve.mjs --root ${shown} --preview`);
  }
} catch (err) {
  log.error(`데모 생성 실패: ${err?.message || err}`);
  process.exitCode = 1;
}
