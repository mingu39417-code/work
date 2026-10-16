// 워드프레스닷컴(WordPress.com) — 공식 API로 글쓰기 · 이미지 업로드 · 발행까지 사람 손 없이 진행합니다(완전 자동).
// 네이버는 글쓰기 API가 없어 반자동(복사 · 붙여넣기)으로 두고, 완전 자동 발행은 이쪽에서 합니다.
// 1) 대표가 WordPress.com 개발자 앱을 한 번 만들고 대시보드에서 '연결'(OAuth) → 토큰을 암호화해 저장
// 2) 정해진 요일 수 · 시간에 발행 대기 글을 하나씩: 이미지 업로드 → 본문(HTML) · 태그 · 대표 이미지로 발행
// 3) 연결이 끊기면(토큰 만료 등) 자동 발행을 멈추고 대표에게 '다시 연결'을 알립니다.

import crypto from 'node:crypto';
import { blogImagePng } from './blog.mjs';
import { kstNow } from './calendar.mjs';

export const WP_API = 'https://public-api.wordpress.com';
const fetchOf = (ctx) => ctx.fetch ?? globalThis.fetch;

export function redirectUri(settings) {
  return 'http://localhost:4300/oauth/wpcom/callback';
}

// ── 연결(OAuth) ─────────────────────────────────────────────────────
export function authorizeUrl(store) {
  const wp = store.settings.wp ?? {};
  if (!wp.clientId) throw new Error('먼저 WordPress.com 앱의 Client ID와 Client Secret을 저장하세요');
  const state = crypto.randomBytes(16).toString('base64url');
  store.updateSettings({ wp: { oauthState: state, oauthStateUntil: new Date(Date.now() + 15 * 60e3).toISOString() } });
  const u = new URL(`${WP_API}/oauth2/authorize`);
  u.searchParams.set('client_id', wp.clientId);
  u.searchParams.set('redirect_uri', redirectUri(store.settings));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'posts media');
  u.searchParams.set('state', state);
  return u.toString();
}

export async function finishOAuth(ctx, { code, state }) {
  const { store } = ctx;
  const wp = store.settings.wp ?? {};
  if (!state || state !== wp.oauthState || Date.parse(wp.oauthStateUntil) < Date.now()) throw new Error('연결 요청이 만료됐거나 올바르지 않습니다. 대시보드에서 다시 연결을 눌러 주세요.');
  const res = await fetchOf(ctx)(`${WP_API}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: wp.clientId, client_secret: store.vault.decrypt(wp.clientSecret), redirect_uri: redirectUri(store.settings), code: String(code), grant_type: 'authorization_code' }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`연결 실패: ${j.error_description || j.error || res.status}`);
  store.updateSettings({ wp: {
    token: store.vault.encrypt(j.access_token), siteId: String(j.blog_id ?? ''), siteUrl: j.blog_url ?? '',
    tokenExpiresAt: j.expires_in ? new Date(Date.now() + Number(j.expires_in) * 1000).toISOString() : null,
    status: 'ok', lastError: '', connectedAt: new Date().toISOString(), oauthState: null,
  } });
  store.log('settings', `WordPress.com 연결: ${j.blog_url ?? j.blog_id}`);
  return store.settings.wp;
}

async function wpCall(ctx, method, path, body) {
  const { store } = ctx;
  const wp = store.settings.wp ?? {};
  if (!wp.token) throw new Error('WordPress.com이 연결되어 있지 않습니다');
  const res = await fetchOf(ctx)(`${WP_API}/rest/v1.1/sites/${encodeURIComponent(wp.siteId)}${path}`, {
    method, headers: { Authorization: `Bearer ${store.vault.decrypt(wp.token)}` }, body,
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403 || j.error === 'invalid_token' || j.error === 'authorization_required') {
    store.updateSettings({ wp: { status: 'expired', lastError: j.message || '연결이 끊겼습니다' } });
    store.alert('urgent', 'WordPress.com 연결이 끊겨 자동 발행을 멈췄습니다. 블로그 화면에서 \'다시 연결\'을 눌러 주세요.');
    throw new Error('WordPress.com 연결이 끊겼습니다(다시 연결 필요)');
  }
  if (!res.ok || j.error) throw new Error(`WordPress.com 오류: ${j.message || j.error || res.status}`);
  return j;
}

// ── 글 → 워드프레스 HTML ─────────────────────────────────────────────
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function wpHtml(post, imageUrls) {
  let n = 0;
  return post.blocks.map((b) => {
    if (b.type === 'img') {
      const url = imageUrls[n++];
      return url ? `<figure class="wp-block-image"><img src="${esc(url)}" alt="${esc(post.title)}"/></figure>` : '';
    }
    if (b.type === 'h') return `<h2>${esc(b.text)}</h2>`;
    return String(b.text).split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  }).join('\n');
}

export async function publishToWordPress(ctx, { postId }) {
  const { store } = ctx;
  const post = store.get('blog_posts', postId);
  if (!post || post.wp?.url) return;
  try {
    // 이미지 업로드
    const urls = [];
    const ids = [];
    const imgs = post.blocks.filter((b) => b.type === 'img');
    for (let i = 0; i < imgs.length; i++) {
      const png = blogImagePng(store, post, i);
      if (!png) { urls.push(null); ids.push(null); continue; }
      const form = new FormData();
      form.append('media[]', new Blob([png], { type: 'image/png' }), `ongyeol-${post.id}-${i}.png`);
      const m = await wpCall(ctx, 'POST', '/media/new', form);
      urls.push(m.media?.[0]?.URL ?? null);
      ids.push(m.media?.[0]?.ID ?? null);
    }
    const form = new URLSearchParams({ title: post.title, content: wpHtml(post, urls), tags: post.tags.join(','), status: 'publish', format: 'standard' });
    if (ids[0]) form.set('featured_image', String(ids[0]));
    const r = await wpCall(ctx, 'POST', '/posts/new', form);
    store.update('blog_posts', post.id, { wp: { id: r.ID, url: r.URL, at: new Date().toISOString() } });
    store.updateSettings({ wp: { lastPublishedAt: new Date().toISOString(), status: 'ok', lastError: '' } });
    store.log('blog', `WordPress.com 자동 발행: ${post.title} — ${r.URL}`, { projectId: post.projectId });
  } catch (err) {
    store.update('blog_posts', post.id, { wp: { error: err.message, at: new Date().toISOString() } });
    store.log('error', `WordPress.com 발행 실패: ${err.message}`);
    throw err;
  }
}

// ── 일정: 주 N회, 정한 시각 이후에 하나씩 (정기 점검에서 호출) ─────────────
export function wpDue(store, now = Date.now()) {
  const wp = store.settings.wp ?? {};
  if (!wp.token || wp.status === 'expired' || wp.autoPublish === false) return null;
  const perWeek = Math.min(14, Math.max(1, Number(wp.perWeek) || 3));
  const gap = (7 / perWeek) * 864e5 * 0.9;
  if (wp.lastPublishedAt && now - Date.parse(wp.lastPublishedAt) < gap) return null;
  if (kstNow(now).getUTCHours() < (Number(wp.publishHour) || 10)) return null;
  if (store.findOne('jobs', (j) => j.kind === 'wp_publish' && ['queued', 'running'].includes(j.status))) return null;
  return store.find('blog_posts', (x) => x.status !== 'archived' && !x.wp?.url && !x.wp?.error).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0] ?? null;
}