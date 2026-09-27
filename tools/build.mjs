#!/usr/bin/env node
// npm run build   → production build into site/
// npm run check   → validate + report only (no writes)
// npm run preview → drafts included, into .preview/ (then served by tools/serve.mjs --preview)
//
// Options: --root <dir>  --preview  --check  --quiet
import path from 'node:path';
import { checkNodeVersion, parseArgs, ArgError } from './lib/args.mjs';

checkNodeVersion();

const HELP = `사용법: node tools/build.mjs [--preview] [--check] [--quiet] [--root <폴더>]
  (옵션 없음)   content/ + media/ → site/ (배포용, 공개 작업만)
  --preview     비공개 작업까지 포함해 .preview/ 에 빌드 (배포 금지)
  --check       내용 검사와 보고만 (파일을 쓰지 않음)
  --quiet       요약 출력 생략 (오류는 표시)
  --root <폴더> 다른 프로젝트 폴더를 빌드 (예: .demo)`;

let args;
try {
  args = parseArgs(process.argv.slice(2), {
    flags: { root: 'string', preview: 'boolean', check: 'boolean', quiet: 'boolean', help: 'boolean' },
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

const { buildSite } = await import('./lib/build-site.mjs');
try {
  const result = await buildSite({
    root: args.values.root ? path.resolve(args.values.root) : undefined,
    preview: args.values.preview,
    check: args.values.check,
    quiet: args.values.quiet,
  });
  process.exitCode = result.ok ? 0 : 1;
} catch (err) {
  process.stderr.write(`빌드 중 예기치 않은 오류: ${err?.stack || err}\n`);
  process.exitCode = 1;
}
