// Console helpers: Korean user-facing output, optional ANSI colors (NO_COLOR / non-TTY aware).

const useColor = (() => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
})();

const wrap = (code, reset) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[${reset}m` : String(s));

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '-';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}초`;
  const m = Math.floor(s / 60);
  return `${m}분 ${Math.round(s - m * 60)}초`;
}

/** A logger that can be silenced (--quiet) and captured in tests. */
export function createLogger({ quiet = false, stream = process.stdout, errStream = process.stderr } = {}) {
  const lines = [];
  const out = (s = '') => {
    lines.push(s);
    if (!quiet) stream.write(`${s}\n`);
  };
  return {
    lines,
    quiet,
    log: out,
    info: (s) => out(s),
    step: (s) => out(`${c.cyan('›')} ${s}`),
    ok: (s) => out(`${c.green('✓')} ${s}`),
    warn: (s) => {
      lines.push(`! ${s}`);
      if (!quiet) stream.write(`${c.yellow('!')} ${s}\n`);
    },
    error: (s) => {
      lines.push(`✗ ${s}`);
      errStream.write(`${c.red('✗')} ${s}\n`);
    },
  };
}
