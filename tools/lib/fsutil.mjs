// Small filesystem helpers (Node built-ins only, Windows-safe).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function statOrNull(p) {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

export async function isFile(p) {
  const st = await statOrNull(p);
  return Boolean(st && st.isFile());
}

export async function isDir(p) {
  const st = await statOrNull(p);
  return Boolean(st && st.isDirectory());
}

export async function readJson(p, fallback = null) {
  try {
    const text = await fsp.readFile(p, 'utf8');
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return fallback;
  }
}

/** Write via a temp file + rename so readers never see a half-written file. */
export async function writeFileAtomic(p, data) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const tmp = path.join(path.dirname(p), `.${path.basename(p)}.${process.pid}.${Date.now()}.tmp`);
  await fsp.writeFile(tmp, data);
  await renameWithRetry(tmp, p);
}

/** Write only when the content differs (keeps mtimes stable for upload/sync tools). Returns true if written. */
export async function writeFileIfChanged(p, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  try {
    const cur = await fsp.readFile(p);
    if (cur.equals(buf)) return false;
  } catch {
    /* missing → write */
  }
  await writeFileAtomic(p, buf);
  return true;
}

/** fs.rename with a few retries (Windows: file briefly locked by AV / an open browser stream). */
export async function renameWithRetry(from, to, tries = 6) {
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      if (i >= tries - 1 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      await new Promise((r) => setTimeout(r, 80 * (i + 1)));
    }
  }
}

export async function rmrf(p) {
  await fsp.rm(p, { recursive: true, force: true, maxRetries: 3 });
}

/**
 * Recursively list files under dir. Returns paths relative to dir with '/' separators, sorted.
 * Missing dir → [].
 */
export async function walkFiles(dir, { skipDirs = [] } = {}) {
  const out = [];
  async function rec(abs, rel) {
    let entries;
    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const childAbs = path.join(abs, e.name);
      if (e.isDirectory()) {
        if (skipDirs.includes(e.name)) continue;
        await rec(childAbs, childRel);
      } else if (e.isFile()) {
        out.push(childRel);
      }
    }
  }
  await rec(dir, '');
  return out.sort();
}

/** Remove empty directories below (not including) dir. */
export async function removeEmptyDirs(dir) {
  async function rec(abs) {
    let entries;
    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch {
      return false;
    }
    let empty = true;
    for (const e of entries) {
      if (e.isDirectory()) {
        const childEmpty = await rec(path.join(abs, e.name));
        if (childEmpty) {
          await fsp.rmdir(path.join(abs, e.name)).catch(() => {});
        } else empty = false;
      } else empty = false;
    }
    return empty;
  }
  await rec(dir);
}

/** Copy a file and give the copy the source mtime (so later size+mtime comparisons can skip it). */
export async function copyFilePreserve(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  const tmp = path.join(path.dirname(to), `.${path.basename(to)}.${process.pid}.tmp`);
  await fsp.copyFile(from, tmp);
  const st = await fsp.stat(from);
  await fsp.utimes(tmp, st.atime, st.mtime);
  await renameWithRetry(tmp, to);
}

/**
 * Copy a directory tree (files only), skipping files whose size+mtime already match.
 * mirror: also delete files in `to` that are not in `from`.
 */
export async function copyDir(from, to, { mirror = false } = {}) {
  const files = await walkFiles(from);
  let copied = 0;
  for (const rel of files) {
    const src = path.join(from, ...rel.split('/'));
    const dst = path.join(to, ...rel.split('/'));
    if (await sameFile(src, dst)) continue;
    await copyFilePreserve(src, dst);
    copied++;
  }
  if (mirror) {
    const keep = new Set(files);
    for (const rel of await walkFiles(to)) {
      if (!keep.has(rel)) await fsp.rm(path.join(to, ...rel.split('/')), { force: true });
    }
    await removeEmptyDirs(to);
  }
  return copied;
}

/** true when both exist with equal size and equal mtime (1 s resolution — FAT/exFAT/FTP safe). */
export async function sameFile(a, b) {
  const [sa, sb] = await Promise.all([statOrNull(a), statOrNull(b)]);
  if (!sa || !sb || !sa.isFile() || !sb.isFile()) return false;
  return sa.size === sb.size && Math.trunc(sa.mtimeMs / 1000) === Math.trunc(sb.mtimeMs / 1000);
}

export async function dirSize(dir) {
  const files = await walkFiles(dir);
  let total = 0;
  const list = [];
  for (const rel of files) {
    const st = await statOrNull(path.join(dir, ...rel.split('/')));
    if (!st) continue;
    total += st.size;
    list.push({ rel, size: st.size });
  }
  return { total, files: list };
}

export function hashString(text, len = 8) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, len);
}

export async function hashFile(p, len = 8) {
  try {
    const buf = await fsp.readFile(p);
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, len);
  } catch {
    return '';
  }
}

/** Relative path with forward slashes (for display and manifest keys). */
export function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** Join a '/'-separated relative path onto a base directory (Windows-safe). */
export function joinRel(base, rel) {
  return path.join(base, ...String(rel).split('/').filter(Boolean));
}

export function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export { fs, fsp };
