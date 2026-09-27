#!/usr/bin/env node
// npm run media → process raw/ → media/ (incremental).
//   node tools/media.mjs [slug ...] [--reel] [--force] [--dry-run] [--root <dir>]
import path from 'node:path';
import { checkNodeVersion, parseArgs, ArgError } from './lib/args.mjs';

checkNodeVersion();

const HELP = `사용법: node tools/media.mjs [slug ...] [--reel] [--force] [--dry-run] [--root <폴더>]
  (인자 없음)   raw/ 의 쇼릴과 모든 작업을 처리 (바뀐 것만)
  slug ...      지정한 작업만 처리 (예: node tools/media.mjs brand-film-2026)
  --reel        쇼릴만 처리 (slug와 함께 쓰면 둘 다)
  --force       이미 만든 결과도 모두 다시 만들기
  --dry-run     무엇을 할지 보여주기만 함 (파일을 쓰지 않음)
  --root <폴더> 다른 프로젝트 폴더 (예: .demo)
ffmpeg 경로 지정: FFMPEG_PATH / FFPROBE_PATH 환경 변수`;

let args;
try {
  args = parseArgs(process.argv.slice(2), {
    flags: { root: 'string', reel: 'boolean', force: 'boolean', 'dry-run': 'boolean', quiet: 'boolean', help: 'boolean' },
    allowPositionals: true,
  });
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

const { runMedia } = await import('./lib/media-pipeline.mjs');
const { REPO_ROOT } = await import('./lib/build-site.mjs');

let interrupted = false;
process.on('SIGINT', () => {
  if (interrupted) process.exit(130);
  interrupted = true;
  process.stderr.write('\n중단합니다 — 진행 중이던 파일은 저장되지 않습니다. 다시 실행하면 이어서 처리합니다.\n');
  process.exit(130);
});

try {
  const result = await runMedia({
    root: args.values.root ? path.resolve(args.values.root) : REPO_ROOT,
    slugs: args.positionals,
    reel: args.values.reel,
    force: args.values.force,
    dryRun: args.values['dry-run'],
    quiet: args.values.quiet,
  });
  process.exitCode = result.ok ? 0 : 1;
} catch (err) {
  process.stderr.write(`미디어 처리 중 예기치 않은 오류: ${err?.stack || err}\n`);
  process.exitCode = 1;
}
