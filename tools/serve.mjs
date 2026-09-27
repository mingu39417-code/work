#!/usr/bin/env node
// npm run serve → serve site/ on http://localhost:4173 (production output)
//   node tools/serve.mjs [--root <dir>] [--port <n>] [--host <h>] [--lan] [--preview]
// --preview overlays .preview/ over site/ and maps /media/* to <root>/media/* (draft media). It holds works without
// publishing consent, so it listens on this computer only unless --lan (or --host) is given.
import path from 'node:path';
import { checkNodeVersion, parseArgs, ArgError } from './lib/args.mjs';

checkNodeVersion();

const HELP = `사용법: node tools/serve.mjs [--preview] [--lan] [--port <번호>] [--host <주소>] [--root <폴더>]
  (옵션 없음)   site/ (배포본)을 http://localhost:4173 에서 보여줌 (같은 와이파이의 휴대폰에서도 접속 가능)
  --preview     .preview/ (비공개 작업 포함) + 원본 media/ 로 미리보기 — 이 컴퓨터에서만 열림
  --lan         미리보기를 같은 네트워크의 휴대폰에서도 열기 (그 네트워크의 모든 기기에 비공개 작업이 보임)
  --port <n>    포트 (기본 4173, 사용 중이면 다음 번호)
  --host <h>    바인드 주소 (기본: 배포본 0.0.0.0, 미리보기 127.0.0.1)
  --root <폴더> 다른 프로젝트 폴더 (예: .demo)`;

let args;
try {
  args = parseArgs(process.argv.slice(2), {
    flags: { root: 'string', port: 'number', host: 'string', lan: 'boolean', preview: 'boolean', quiet: 'boolean', help: 'boolean' },
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

const { createStaticServer, listen, lanAddresses } = await import('./lib/server.mjs');
const { REPO_ROOT } = await import('./lib/build-site.mjs');
const { isFile } = await import('./lib/fsutil.mjs');
const { c } = await import('./lib/log.mjs');

const root = args.values.root ? path.resolve(args.values.root) : REPO_ROOT;
const preview = Boolean(args.values.preview);
const siteDir = path.join(root, 'site');
const previewDir = path.join(root, '.preview');
const layers = preview
  ? [{ dir: path.join(root, 'media'), prefix: '/media/' }, { dir: previewDir }, { dir: siteDir }]
  : [{ dir: siteDir }];
const notFound = preview ? [path.join(previewDir, '404.html'), path.join(siteDir, '404.html')] : [path.join(siteDir, '404.html')];

const out = (s = '') => process.stdout.write(`${s}\n`);
const server = createStaticServer({ layers, notFound, log: args.values.quiet ? null : (line) => out(`  ${line}`) });
// the preview shows unconsented client work: this computer only, unless the owner asks for the LAN explicitly
const lan = Boolean(args.values.lan);
const host = args.values.host || (preview && !lan ? '127.0.0.1' : '0.0.0.0');
const requested = args.values.port ?? 4173;

let port;
try {
  port = await listen(server, { port: requested, host });
} catch (err) {
  process.stderr.write(`서버를 시작하지 못했습니다 (${host}:${requested}) — ${err.message}\n`);
  process.exit(1);
}

out(c.bold(`TONECRAFT 로컬 서버 — ${preview ? '미리보기 (.preview/ + site/, 비공개 작업 포함)' : '배포본 site/'}`));
if (root !== REPO_ROOT) out(c.gray(`  프로젝트 폴더: ${root}`));
if (requested !== 0 && port !== requested) out(c.yellow(`  ${requested}번 포트가 사용 중이라 ${port}번으로 열었습니다.`));
const shownHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
out(`  이 컴퓨터    ${c.cyan(`http://${shownHost}:${port}/`)}`);
if (host === '0.0.0.0' || host === '::') {
  for (const ip of lanAddresses()) out(`  휴대폰(같은 와이파이)  ${c.cyan(`http://${ip}:${port}/`)}`);
  if (preview) out(c.yellow('  ! 비공개 작업이 같은 네트워크의 모든 기기에 보입니다 — 집·사무실처럼 믿을 수 있는 와이파이에서만 쓰고, 확인이 끝나면 Ctrl+C 로 닫으세요.'));
} else if (preview && !args.values.host) {
  out(c.gray('  휴대폰으로 미리보기: npm run preview -- --lan (같은 네트워크의 모든 기기에 비공개 작업이 보입니다 — 집·사무실 와이파이에서만)'));
}
const indexFile = path.join(preview ? previewDir : siteDir, 'index.html');
if (!(await isFile(indexFile))) {
  out(c.yellow(`  ! ${path.relative(process.cwd(), indexFile) || indexFile} 이 없습니다 — 먼저 ${preview ? 'node tools/build.mjs --preview' : 'npm run build'} 를 실행하세요.`));
}
out(c.gray('  종료: Ctrl+C'));
out('');

const stop = () => {
  out(c.gray('\n서버를 종료합니다.'));
  server.close();
  server.closeAllConnections?.();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
