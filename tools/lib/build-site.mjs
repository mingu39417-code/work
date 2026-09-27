// Site build (spec §7): content + media → site/ (production) or .preview/ (drafts included).
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadContent } from './content.mjs';
import { loadManifest, manifestIndex, resolveWorkMedia, resolveReel, hiddenReasons, referencedMediaFiles } from './media-resolve.mjs';
import { buildViewModels, withUrl } from './vm.mjs';
import { sitemapXml, robotsTxt, webManifest, isAbsoluteUrl } from './seo.mjs';
import { addMarker, cleanStalePages, syncMedia } from './sync.mjs';
import { copyDir, dirSize, hashFile, isFile, isDir, joinRel, writeFileIfChanged } from './fsutil.mjs';
import { createLogger, c, formatBytes, formatDuration } from './log.mjs';

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const TEMPLATES_ENTRY = path.join(REPO_ROOT, 'src', 'templates', 'index.mjs');

export const LIMIT_CLOUDFLARE = 25 * 1024 * 1024;
export const LIMIT_GITHUB = 95 * 1024 * 1024;

// icon-192/512 are full-bleed with the mark inside the 80 % safe zone, so they double as maskable icons.
const ICONS = [
  { file: 'assets/img/icon-192.png', sizes: '192x192', type: 'image/png' },
  { file: 'assets/img/icon-512.png', sizes: '512x512', type: 'image/png' },
  { file: 'assets/img/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
  { file: 'assets/img/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  { file: 'assets/img/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
];

function displayPath(p) {
  const rel = path.relative(process.cwd(), p);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : p;
}

async function loadTemplates(entry) {
  if (!(await isFile(entry))) {
    throw new Error(`템플릿 파일이 없습니다: ${entry}\n  src/templates/index.mjs 가 필요합니다 (renderHome / renderWork / render404).`);
  }
  const mod = await import(pathToFileURL(entry).href);
  for (const fn of ['renderHome', 'renderWork', 'render404']) {
    if (typeof mod[fn] !== 'function') throw new Error(`템플릿에 ${fn} 함수가 없습니다 (${entry}).`);
  }
  return mod;
}

function renderPage(fn, vm, label) {
  let html;
  try {
    html = fn(vm);
  } catch (err) {
    const e = new Error(`${label} 렌더링 실패: ${err?.message || err}`);
    e.cause = err;
    throw e;
  }
  if (typeof html !== 'string' || !html.trim()) throw new Error(`${label} 렌더링 결과가 비어 있습니다.`);
  return addMarker(html);
}

/**
 * Build the site.
 * @param {object} o
 * @param {string} [o.root]      project root (content/, media/, site/)
 * @param {boolean} [o.preview]  include drafts, write to <root>/.preview/
 * @param {boolean} [o.check]    validate + report only (no writes)
 * @param {boolean} [o.quiet]
 * @param {Date}    [o.now]
 * @param {string}  [o.templates] path to the templates entry (tests)
 * @returns {Promise<object>} result summary (ok, errors, warnings, published, hidden, ...)
 */
export async function buildSite(o = {}) {
  const t0 = Date.now();
  const root = path.resolve(o.root || REPO_ROOT);
  const preview = Boolean(o.preview);
  const check = Boolean(o.check);
  const log = o.logger || createLogger({ quiet: o.quiet });
  const now = o.now || new Date();
  const result = { ok: false, root, preview, check, errors: [], warnings: [], published: [], hidden: [], written: [], removedPages: [], sync: null, outDir: null };

  const modeLabel = check ? '검사 (--check, 파일을 쓰지 않음)' : preview ? '미리보기 (.preview/, 비공개 작업 포함)' : '프로덕션 (site/)';
  log.info(c.bold(`TONECRAFT 빌드 — ${modeLabel}`));
  if (root !== REPO_ROOT) log.info(c.gray(`  프로젝트 폴더: ${root}`));

  // 1. content
  const content = await loadContent(root);
  result.errors.push(...content.errors);
  result.warnings.push(...content.warnings);
  if (content.errors.length) {
    log.error(`콘텐츠 오류 ${content.errors.length}개 — 고친 뒤 다시 실행하세요:`);
    for (const e of content.errors) log.error(`  ${e}`);
    return result;
  }
  const { site } = content;

  // 2. media
  const mediaDir = path.join(root, 'media');
  const manifest = await loadManifest(mediaDir);
  const index = manifestIndex(manifest);
  const all = [];
  for (const work of content.works) {
    const media = await resolveWorkMedia({ mediaDir, work, index });
    all.push({ work: withUrl(work, media), reasons: hiddenReasons(work, media) });
  }
  const publishedWorks = all.filter((x) => !x.reasons.length).map((x) => x.work);
  const hidden = all.filter((x) => x.reasons.length);
  result.published = publishedWorks.map((w) => w.slug);
  result.hidden = hidden.map((x) => ({ slug: x.work.slug, title: x.work.title, reasons: x.reasons }));
  const rendered = preview ? all.map((x) => x.work) : publishedWorks;
  const reel = await resolveReel({ mediaDir, site, index });

  // 3. asset checks (portrait / og image)
  const siteDirs = [path.join(root, 'site'), ...(root !== REPO_ROOT ? [path.join(REPO_ROOT, 'site')] : [])];
  const findAsset = async (rel) => {
    for (const d of siteDirs) if (await isFile(joinRel(d, rel))) return true;
    return false;
  };
  if (site.about.portrait && !isAbsoluteUrl(site.about.portrait) && !(await findAsset(site.about.portrait))) {
    result.warnings.push(`site.about.portrait "${site.about.portrait}" 파일이 site/ 안에 없어 사진을 표시하지 않습니다.`);
    site.about.portrait = null;
  }
  if (site.seo.ogImage && !isAbsoluteUrl(site.seo.ogImage) && !(await findAsset(site.seo.ogImage))) {
    result.warnings.push(`site.seo.ogImage "${site.seo.ogImage}" 파일이 없습니다 — 링크 공유 미리보기 이미지가 깨집니다.`);
  }
  for (const x of all) {
    const w = x.work;
    if (w.publish && w.consent !== 'pending' && !w.media.poster) {
      result.warnings.push(`${w.slug}: 공개로 설정했지만 미디어가 없습니다 — raw/works/${w.slug}/ 에 원본을 넣고 npm run media 를 실행하세요.`);
    }
  }
  if (site.reel.publish && !reel.loop && !reel.full && !reel.embed) {
    result.warnings.push('쇼릴 미디어가 없습니다 — 히어로는 기본 그래픽으로 표시됩니다 (raw/reel/ 에 영상을 넣고 npm run media).');
  }

  // report: works
  log.ok(`공개 작업 ${publishedWorks.length}개${publishedWorks.length ? c.gray(` — ${publishedWorks.map((w) => w.slug).join(', ')}`) : ''}`);
  if (hidden.length) {
    log.warn(`${preview ? '비공개 작업 (미리보기에만 표시)' : '숨김 작업'} ${hidden.length}개:`);
    for (const x of hidden) log.info(c.gray(`    - ${x.work.slug} "${x.work.title}" — ${x.reasons.join(', ')}`));
  }
  for (const w of result.warnings) log.warn(w);

  if (check) {
    // what a production build would upload: flag files over the hosting limits now
    const files = new Set();
    for (const w of publishedWorks) for (const f of referencedMediaFiles(w.media)) files.add(f);
    for (const f of referencedMediaFiles(reel)) files.add(f);
    let total = 0;
    for (const f of files) {
      const st = await fsp.stat(joinRel(root, f)).catch(() => null);
      if (!st) continue;
      total += st.size;
      if (st.size > LIMIT_CLOUDFLARE) {
        const msg = `${f} (${formatBytes(st.size)}) — 25 MB 초과: Cloudflare Pages에 올릴 수 없습니다${st.size > LIMIT_GITHUB ? ', 95 MB 초과: GitHub에도 올릴 수 없습니다' : ''}.`;
        result.warnings.push(msg);
        log.warn(msg);
      }
    }
    result.mediaBytes = total;
    log.info(`  배포될 미디어 ${files.size}개 · ${formatBytes(total)}`);
    result.ok = true;
    log.ok(`검사 완료 — 오류 없음 (${formatDuration(Date.now() - t0)})`);
    return result;
  }

  // 4. templates
  let tpl;
  try {
    tpl = await loadTemplates(o.templates || TEMPLATES_ENTRY);
  } catch (err) {
    result.errors.push(err.message);
    log.error(err.message);
    return result;
  }

  // 5. output dirs + assets
  const siteDir = path.join(root, 'site');
  const outDir = preview ? path.join(root, '.preview') : siteDir;
  result.outDir = outDir;
  const repoAssets = path.join(REPO_ROOT, 'site', 'assets');
  let assetsDir = path.join(siteDir, 'assets');
  if (root !== REPO_ROOT) {
    assetsDir = path.join(outDir, 'assets');
    if (await isDir(repoAssets)) await copyDir(repoAssets, assetsDir, { mirror: true });
  }
  const assetVersion = {
    css: await hashFile(path.join(assetsDir, 'css', 'main.css')),
    js: await hashFile(path.join(assetsDir, 'js', 'main.js')),
  };
  const build = { preview, year: now.getFullYear(), generatedAt: now.toISOString(), assetVersion };

  // 6. render
  const vms = buildViewModels({ site, works: rendered, reel, build });
  const pages = [];
  try {
    pages.push({ rel: 'index.html', html: renderPage(tpl.renderHome, vms.home, '홈') });
    for (const p of vms.pages) {
      pages.push({ rel: `works/${p.slug}/index.html`, html: renderPage(tpl.renderWork, p.vm, `작업 페이지 ${p.slug}`) });
    }
    pages.push({ rel: '404.html', html: renderPage(tpl.render404, vms.notFound, '404') });
  } catch (err) {
    result.errors.push(err.message);
    log.error(err.message);
    if (err.cause?.stack) log.error(c.gray(err.cause.stack.split('\n').slice(0, 4).join('\n')));
    return result;
  }

  // consent guard: in production no hidden work may be referenced by any generated text file
  const textFiles = [...pages];
  if (!preview) {
    if (site.siteUrl) textFiles.push({ rel: 'sitemap.xml', text: sitemapXml(site, publishedWorks) });
    textFiles.push({ rel: 'robots.txt', text: robotsTxt(site) });
    const icons = [];
    for (const ic of ICONS) if (await isFile(joinRel(outDir, ic.file))) icons.push({ src: ic.file, sizes: ic.sizes, type: ic.type, ...(ic.purpose ? { purpose: ic.purpose } : {}) });
    textFiles.push({ rel: 'site.webmanifest', text: webManifest(site, icons) });
    const leaks = [];
    for (const x of hidden) {
      const needle = `works/${x.work.slug}/`;
      for (const f of textFiles) if ((f.html ?? f.text).includes(needle)) leaks.push(`${f.rel} → ${needle}`);
    }
    if (leaks.length) {
      const msg = `비공개 작업 경로가 생성 파일에 포함되어 빌드를 중단합니다 (동의 보호):\n    ${leaks.join('\n    ')}`;
      result.errors.push(msg);
      log.error(msg);
      return result;
    }
  }

  let changed = 0;
  for (const f of textFiles) {
    const did = await writeFileIfChanged(joinRel(outDir, f.rel), f.html ?? f.text);
    if (did) changed++;
    result.written.push(f.rel);
  }
  const stale = await cleanStalePages({ outDir, keepSlugs: rendered.map((w) => w.slug) });
  result.removedPages = stale.removed;
  log.ok(`페이지 ${pages.length}개 생성 (파일 변경 ${changed}개)${stale.removed.length ? ` · 이전 페이지 삭제 ${stale.removed.length}개 (${stale.removed.join(', ')})` : ''}`);
  for (const f of stale.foreign) {
    const msg = `site/works/${f}/ 는 빌드가 만든 폴더가 아니라서 지우지 않았습니다 — 필요 없으면 직접 삭제하세요.`;
    result.warnings.push(msg);
    log.warn(msg);
  }

  if (preview) {
    log.ok(`미리보기 빌드 완료 → ${displayPath(outDir)} ${c.gray(`(${formatDuration(Date.now() - t0)})`)}`);
    log.info(c.gray('  비공개 작업이 포함되어 있습니다 — .preview/ 는 업로드하지 마세요. 확인: node tools/serve.mjs --preview'));
    result.ok = true;
    return result;
  }

  if (!site.siteUrl) await fsp.rm(path.join(outDir, 'sitemap.xml'), { force: true });

  // 7. media sync
  const files = new Set();
  for (const w of publishedWorks) for (const f of referencedMediaFiles(w.media)) files.add(f);
  for (const f of referencedMediaFiles(reel)) files.add(f);
  const sync = await syncMedia({ mediaDir, siteMediaDir: path.join(outDir, 'media'), files: [...files] });
  result.sync = sync;
  log.ok(`미디어 동기화 — 복사 ${sync.copied.length} · 삭제 ${sync.deleted.length} · 유지 ${sync.unchanged}`);

  // 8. size report
  const { total, files: all2 } = await dirSize(outDir);
  result.totalBytes = total;
  const media = all2.filter((f) => f.rel.startsWith('media/')).sort((a, b) => b.size - a.size);
  result.largest = media.slice(0, 5);
  log.info(`  site/ 전체 용량 ${c.bold(formatBytes(total))} (파일 ${all2.length}개)`);
  if (media.length) {
    log.info(c.gray('  큰 미디어 파일:'));
    for (const f of media.slice(0, 5)) log.info(c.gray(`    ${formatBytes(f.size).padStart(8)}  ${f.rel}`));
  }
  const overCf = all2.filter((f) => f.size > LIMIT_CLOUDFLARE);
  const overGh = all2.filter((f) => f.size > LIMIT_GITHUB);
  result.overCloudflare = overCf.map((f) => f.rel);
  result.overGithub = overGh.map((f) => f.rel);
  for (const f of overCf) {
    const msg = `${f.rel} (${formatBytes(f.size)}) — 25 MB 초과: Cloudflare Pages에 올릴 수 없습니다${f.size > LIMIT_GITHUB ? ', 95 MB 초과: GitHub에도 올릴 수 없습니다' : ''}. Vimeo/YouTube 임베드(video: { type, id })를 고려하세요.`;
    result.warnings.push(msg);
    log.warn(msg);
  }

  result.ok = true;
  log.ok(`빌드 완료 ${c.gray(`(${formatDuration(Date.now() - t0)})`)} — site/ 폴더를 그대로 업로드하면 됩니다.`);
  return result;
}

