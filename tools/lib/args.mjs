// Minimal CLI argument parser with Korean error messages (no dependencies; util.parseArgs differs across Node 18/22).

export class ArgError extends Error {}

/**
 * parseArgs(argv, { flags: { preview: 'boolean', root: 'string', port: 'number' }, allowPositionals })
 * Supports --flag, --flag value, --flag=value. Returns { values, positionals }.
 */
export function parseArgs(argv, { flags = {}, allowPositionals = false } = {}) {
  const values = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      let name = arg.slice(2);
      let inline;
      const eq = name.indexOf('=');
      if (eq !== -1) {
        inline = name.slice(eq + 1);
        name = name.slice(0, eq);
      }
      const type = flags[name];
      if (!type) throw new ArgError(`알 수 없는 옵션: --${name}`);
      if (type === 'boolean') {
        if (inline !== undefined) throw new ArgError(`--${name} 옵션은 값을 받지 않습니다.`);
        values[name] = true;
        continue;
      }
      let v = inline;
      if (v === undefined) {
        v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) throw new ArgError(`--${name} 옵션에 값이 필요합니다.`);
        i++;
      }
      if (type === 'number') {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new ArgError(`--${name} 값은 숫자여야 합니다: ${v}`);
        values[name] = n;
      } else values[name] = v;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) throw new ArgError(`알 수 없는 옵션: ${arg}`);
    if (!allowPositionals) throw new ArgError(`알 수 없는 인자: ${arg}`);
    positionals.push(arg);
  }
  return { values, positionals };
}

/** Exit early on unsupported Node versions (the tools use Node >= 18.17 APIs). */
export function checkNodeVersion(min = [18, 17]) {
  const [maj, minor] = process.versions.node.split('.').map(Number);
  if (maj < min[0] || (maj === min[0] && minor < min[1])) {
    process.stderr.write(
      `Node.js ${min.join('.')} 이상이 필요합니다 (현재 ${process.versions.node}). https://nodejs.org 에서 LTS 버전을 설치하세요.\n`,
    );
    process.exit(1);
  }
}
