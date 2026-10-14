// 스튜디오 에이전트 서버
//   /            고객용 문의 양식 (공개)
//   /p/<토큰>     고객 포털 — 대화 · 견적 수락 · 시안 확인 · 입금 알림 (링크를 아는 고객만)
//   /admin       대표용 대시보드 (비밀번호)
// 실행: npm start   (PORT · HOST · DATA_DIR 환경 변수로 바꿀 수 있음)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.mjs';
import { createLLM, MODELS } from './lib/claude.mjs';
import { startScheduler } from './lib/scheduler.mjs';
import {
  STATUSES, ACTIVE_STATUSES, AUTONOMY_LABELS, createInquiry, postMessage, enqueue, enqueueAgent,
  executeAction, acceptQuoteByClient, approveDesignByClient, markInvoicePaid, canDownload,
  studioName, portalUrl, short,
} from './lib/actions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, 'public');
const MAX_BODY = 12 * 1024 * 1024;
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ── 비밀번호 · 세션 ──────────────────────────────────────────────
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

function checkPassword(pw, stored) {
  const [salt, key] = String(stored).split(':');
  if (!salt || !key) return false;
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32);
  return crypto.timingSafeEqual(got, Buffer.from(key, 'hex'));
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2));
}

// ── 응답 도우미 ────────────────────────────────────────────────
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readJson(req) {
  if (!String(req.headers['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'JSON으로 보내 주세요');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, '용량이 너무 큽니다');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'JSON 형식 오류');
  }
}

function serveFile(res, file, extra = {}) {
  if (!fs.existsSync(file)) return send(res, 404, 'Not found');
  send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', ...extra });
}

// 시안(Claude가 만든 SVG/HTML)은 스크립트가 절대 실행되지 않도록 샌드박스로 내보냅니다.
const DESIGN_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

function serveDesign(res, design, download) {
  const ext = design.format === 'svg' ? 'svg' : 'html';
  const name = `${design.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'design'}.${ext}`;
  send(res, 200, design.code, {
    'Content-Type': ext === 'svg' ? 'image/svg+xml; charset=utf-8' : 'text/html; charset=utf-8',
    'Content-Security-Policy': DESIGN_CSP,
    ...(download ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } : {}),
  });
}

// 간단한 요청 수 제한(공개 양식 · 포털 남용 방지)
const hits = new Map();
function rateLimit(req, key, limit = 30) {
  const k = `${key}:${req.socket.remoteAddress}`;
  const now = Date.now();
  const arr = (hits.get(k) ?? []).filter((t) => now - t < 60e3);
  arr.push(now);
  hits.set(k, arr);
  if (arr.length > limit) throw new HttpError(429, '잠시 후 다시 시도해 주세요');
}

function saveImages(store, list) {
  const out = [];
  for (const a of (Array.isArray(list) ? list : []).slice(0, 4)) {
    const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(String(a?.dataUrl ?? ''));
    if (!m || !IMAGE_TYPES[m[1]]) continue;
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 5 * 1024 * 1024) throw new HttpError(413, '이미지는 한 장에 5MB까지 올릴 수 있습니다');
    const file = `${crypto.randomBytes(12).toString('hex')}.${IMAGE_TYPES[m[1]]}`;
    fs.writeFileSync(path.join(store.uploadsDir, file), buf);
    out.push({ file, type: m[1], name: String(a.name ?? file).slice(0, 120) });
  }
  return out;
}

// ── 화면용 데이터 ──────────────────────────────────────────────
function publicSettings(s) {
  return {
    studioName: studioName(s),
    ownerName: s.profile.ownerName,
    title: s.profile.title,
    bio: s.profile.bio,
    specialties: s.profile.specialties,
    services: s.services.map(({ id, name, description, basePrice, days }) => ({ id, name, description, basePrice, days })),
    currency: s.policy.currency,
  };
}

function portalView(store, project) {
  const s = store.settings;
  const dl = canDownload(store, project);
  return {
    studio: publicSettings(s),
    project: { title: project.title, status: project.status, statusLabel: STATUSES[project.status], deadline: project.deadline },
    canDownload: dl,
    messages: store
      .find('messages', (m) => m.projectId === project.id && !m.internal)
      .map((m) => ({ id: m.id, from: m.from === 'client' ? 'client' : m.from === 'system' ? 'system' : 'studio', text: m.text, at: m.createdAt, designIds: m.designIds, quoteId: m.quoteId, invoiceId: m.invoiceId, attachments: m.attachments })),
    designs: store.find('designs', (d) => d.projectId === project.id && d.shared).map((d) => ({ id: d.id, title: d.title, rationale: d.rationale, format: d.format, round: d.round, approved: d.approved })),
    quotes: store.find('quotes', (q) => q.projectId === project.id && q.status !== 'superseded').map(({ id, items, total, timelineDays, revisions, terms, status }) => ({ id, items, total, timelineDays, revisions, terms, status })),
    invoices: store.find('invoices', (i) => i.projectId === project.id && i.status !== 'cancelled').map(({ id, kind, amount, description, dueDate, status, clientNotified }) => ({ id, kind, amount, description, dueDate, status, clientNotified: Boolean(clientNotified) })),
  };
}

function maskedSettings(s) {
  const { auth, ...rest } = structuredClone(s);
  rest.apiKey = s.apiKey ? `${s.apiKey.slice(0, 10)}…${s.apiKey.slice(-4)}` : '';
  rest.hasApiKey = Boolean(s.apiKey);
  rest.smtp.pass = s.smtp.pass ? '••••••••' : '';
  return rest;
}

function overview(ctx) {
  const { store, llm } = ctx;
  const s = store.settings;
  const projects = store.all('projects');
  const month = new Date().toISOString().slice(0, 7);
  const paid = store.find('invoices', (i) => i.status === 'paid' && (i.paidAt ?? '').startsWith(month));
  const outstanding = store.find('invoices', (i) => i.status === 'sent');
  const pipeline = store.find('quotes', (q) => q.status === 'sent');
  const usageMonth = store.find('usage', (u) => u.day.startsWith(month));
  const byStatus = Object.fromEntries(Object.keys(STATUSES).map((k) => [k, projects.filter((p) => p.status === k).length]));
  return {
    studioName: studioName(s),
    agent: {
      paused: s.paused,
      hasApiKey: Boolean(s.apiKey),
      running: ctx.running ? { kind: ctx.running.kind, projectId: ctx.running.payload.projectId ?? null } : null,
      queued: store.find('jobs', (j) => j.status === 'queued').length,
      nextRun: store.find('jobs', (j) => j.status === 'queued').map((j) => j.runAt).sort()[0] ?? null,
      model: s.model,
    },
    kpi: {
      activeProjects: projects.filter((p) => ACTIVE_STATUSES.includes(p.status) && p.status !== 'inquiry').length,
      newInquiries: byStatus.inquiry,
      pendingApprovals: store.find('approvals', (a) => a.status === 'pending').length,
      openAlerts: store.find('alerts', (a) => !a.dismissed).length,
      revenueMonth: paid.reduce((t, i) => t + i.amount, 0),
      outstanding: outstanding.reduce((t, i) => t + i.amount, 0),
      pipeline: pipeline.reduce((t, q) => t + q.total, 0),
      spentToday: llm.spentToday(),
      spentMonth: usageMonth.reduce((t, u) => t + u.cost, 0),
      dailyBudget: s.dailyBudgetUsd,
      leads: store.all('leads').length,
    },
    byStatus,
    currency: s.policy.currency,
  };
}

function projectSummary(store, p) {
  const client = store.get('clients', p.clientId);
  const last = store.find('messages', (m) => m.projectId === p.id && !m.internal).at(-1);
  return {
    ...p,
    client: client ? { name: client.name, company: client.company, email: client.email } : null,
    lastMessage: last ? { from: last.from, text: short(last.text, 100), at: last.createdAt } : null,
    pendingApprovals: store.find('approvals', (a) => a.projectId === p.id && a.status === 'pending').length,
    unpaid: store.find('invoices', (i) => i.projectId === p.id && i.status === 'sent').length,
  };
}

function projectDetail(store, p) {
  const s = store.settings;
  return {
    project: projectSummary(store, p),
    client: store.get('clients', p.clientId),
    portalUrl: portalUrl(s, p),
    messages: store.find('messages', (m) => m.projectId === p.id),
    designs: store.find('designs', (d) => d.projectId === p.id).map(({ code, ...d }) => ({ ...d, size: code.length })),
    quotes: store.find('quotes', (q) => q.projectId === p.id),
    invoices: store.find('invoices', (i) => i.projectId === p.id),
    approvals: store.find('approvals', (a) => a.projectId === p.id),
    jobs: store.find('jobs', (j) => j.payload.projectId === p.id).slice(-20),
    usage: store.find('usage', (u) => u.projectId === p.id).reduce((t, u) => t + u.cost, 0),
  };
}

// ── 앱 ────────────────────────────────────────────────────────
export function createApp({ dataDir, llmFactory, schedulerInterval = 3000, startWorker = true } = {}) {
  const store = new Store(dataDir ?? process.env.DATA_DIR ?? path.join(here, 'data'));
  const llm = createLLM(store, { factory: llmFactory });
  const ctx = { store, llm, running: null };
  const sessions = new Map();
  const scheduler = startWorker ? startScheduler(ctx, { intervalMs: schedulerInterval }) : null;
  const sseClients = new Set();

  const broadcast = (type, data) => {
    const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) res.write(line);
  };
  store.on('activity', (row) => broadcast('activity', row));
  store.on('change', (e) => { if (e.collection !== 'activity' && e.collection !== 'usage') broadcast('change', e); });
  const ping = setInterval(() => {
    for (const res of sseClients) res.write(': ping\n\n');
    const now = Date.now();
    for (const [k, arr] of hits) if (!arr.some((t) => now - t < 60e3)) hits.delete(k);
  }, 25e3);
  ping.unref();

  function authed(req) {
    const sid = cookies(req).sid;
    const sess = sid && sessions.get(sid);
    return Boolean(sess && sess.expires > Date.now());
  }

  function projectByToken(token) {
    const p = store.findOne('projects', (x) => x.portalToken === token);
    if (!p) throw new HttpError(404, '프로젝트를 찾을 수 없습니다');
    return p;
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    const m = req.method;
    let g;

    // ── 정적 페이지 ──
    if (m === 'GET' && (p === '/' || p === '/inquiry')) return serveFile(res, path.join(PUBLIC, 'inquiry.html'));
    if (m === 'GET' && /^\/p\/[\w-]+$/.test(p)) return serveFile(res, path.join(PUBLIC, 'portal.html'));
    if (m === 'GET' && (p === '/admin' || p === '/admin/')) return serveFile(res, path.join(PUBLIC, 'dashboard.html'));
    if (m === 'GET' && (g = /^\/assets\/([\w.-]+)$/.exec(p))) return serveFile(res, path.join(PUBLIC, g[1]));

    // ── 공개 API ──
    if (m === 'GET' && p === '/api/public/studio') return send(res, 200, publicSettings(store.settings));
    if (m === 'POST' && p === '/api/public/inquiry') {
      rateLimit(req, 'inquiry', 5);
      const b = await readJson(req);
      if (b.website) return send(res, 200, { ok: true }); // 스팸 봇용 숨은 칸
      if (!String(b.email ?? '').includes('@')) throw new HttpError(400, '이메일을 확인해 주세요');
      if (String(b.description ?? '').trim().length < 5) throw new HttpError(400, '요청 내용을 조금 더 적어 주세요');
      const project = await createInquiry(ctx, {
        name: String(b.name ?? '').slice(0, 80), email: String(b.email).slice(0, 120), company: String(b.company ?? '').slice(0, 120),
        phone: String(b.phone ?? '').slice(0, 40), serviceId: b.serviceId, budget: String(b.budget ?? '').slice(0, 80),
        deadline: String(b.deadline ?? '').slice(0, 80), description: String(b.description).slice(0, 5000),
        attachments: saveImages(store, b.images), source: 'website',
      });
      return send(res, 200, { ok: true, portalUrl: `/p/${project.portalToken}` });
    }

    if ((g = /^\/api\/portal\/([\w-]+)(\/.*)?$/.exec(p))) {
      rateLimit(req, 'portal', 120);
      const project = projectByToken(g[1]);
      const sub = g[2] ?? '';
      let h;
      if (m === 'GET' && sub === '') return send(res, 200, portalView(store, project));
      if (m === 'POST' && sub === '/messages') {
        rateLimit(req, 'portal-msg', 20);
        const b = await readJson(req);
        const text = String(b.text ?? '').trim().slice(0, 5000);
        const attachments = saveImages(store, b.images);
        if (!text && !attachments.length) throw new HttpError(400, '내용을 입력해 주세요');
        await postMessage(ctx, project, { from: 'client', text, attachments });
        store.log('message', `고객 메시지: ${short(text)} — ${project.title}`, { projectId: project.id });
        // 연달아 보내는 메시지를 모아서 답하도록 20초 기다립니다.
        enqueueAgent(store, project.id, { kind: 'client_message' }, { delayMs: 20e3 });
        return send(res, 200, { ok: true });
      }
      if (m === 'POST' && (h = /^\/quotes\/(\w+)\/accept$/.exec(sub))) {
        if (!(await acceptQuoteByClient(ctx, project, h[1]))) throw new HttpError(409, '수락할 수 없는 견적입니다');
        return send(res, 200, { ok: true });
      }
      if (m === 'POST' && (h = /^\/designs\/(\w+)\/approve$/.exec(sub))) {
        if (!(await approveDesignByClient(ctx, project, h[1]))) throw new HttpError(409, '선택할 수 없는 시안입니다');
        return send(res, 200, { ok: true });
      }
      if (m === 'POST' && (h = /^\/invoices\/(\w+)\/paid$/.exec(sub))) {
        const inv = store.get('invoices', h[1]);
        if (!inv || inv.projectId !== project.id || inv.status !== 'sent') throw new HttpError(409, '해당 청구서가 없습니다');
        if (!inv.clientNotified) {
          store.update('invoices', inv.id, { clientNotified: new Date().toISOString() });
          await postMessage(ctx, project, { from: 'system', text: '고객이 입금했다고 알렸습니다. 대표가 확인하면 진행됩니다.' });
          store.alert('urgent', `입금 확인 요청: ${project.title} — 대시보드에서 '입금 확인'을 눌러 주세요`, { projectId: project.id });
          enqueueAgent(store, project.id, { kind: 'client_paid_notice', invoiceId: inv.id });
        }
        return send(res, 200, { ok: true });
      }
      if (m === 'GET' && (h = /^\/designs\/(\w+)\/(raw|download)$/.exec(sub))) {
        const d = store.get('designs', h[1]);
        if (!d || d.projectId !== project.id || !d.shared) throw new HttpError(404, '없음');
        if (h[2] === 'download' && !canDownload(store, project)) throw new HttpError(403, '원본 파일은 잔금 정산 후 받을 수 있습니다');
        return serveDesign(res, d, h[2] === 'download');
      }
      if (m === 'GET' && (h = /^\/uploads\/([\w.]+)$/.exec(sub))) {
        const owned = store.find('messages', (x) => x.projectId === project.id).some((x) => x.attachments?.some((a) => a.file === h[1]));
        if (!owned) throw new HttpError(404, '없음');
        return serveFile(res, path.join(store.uploadsDir, h[1]));
      }
      throw new HttpError(404, '없음');
    }

    // 외부 채널(메일 전달 서비스, 카카오 채널 봇, Zapier 등)에서 들어오는 메시지
    if (m === 'POST' && p === '/api/inbound') {
      const token = req.headers['x-inbound-token'];
      const expected = store.settings.inboundToken;
      if (!token || token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) throw new HttpError(401, '토큰 오류');
      const b = await readJson(req);
      const email = String(b.email ?? '').trim().toLowerCase();
      const text = String(b.text ?? '').trim().slice(0, 10000);
      if (!text) throw new HttpError(400, 'text가 필요합니다');
      const client = email && store.findOne('clients', (c) => c.email === email);
      const open = client && store.find('projects', (x) => x.clientId === client.id && ACTIVE_STATUSES.includes(x.status)).at(-1);
      if (open) {
        await postMessage(ctx, open, { from: 'client', text });
        enqueueAgent(store, open.id, { kind: 'client_message' }, { delayMs: 20e3 });
        return send(res, 200, { ok: true, projectId: open.id });
      }
      const project = await createInquiry(ctx, { name: b.name, email, company: b.company, description: text, source: b.source ?? 'inbound' });
      return send(res, 200, { ok: true, projectId: project.id });
    }

    // ── 대시보드 인증 ──
    if (p === '/api/auth/status' && m === 'GET') return send(res, 200, { setup: !store.settings.auth.passwordHash, authed: authed(req) });
    if (p === '/api/auth/setup' && m === 'POST') {
      if (store.settings.auth.passwordHash) throw new HttpError(409, '이미 설정되었습니다');
      const b = await readJson(req);
      if (String(b.password ?? '').length < 8) throw new HttpError(400, '비밀번호는 8자 이상');
      store.updateSettings({ auth: { passwordHash: hashPassword(b.password) } });
      return login(res);
    }
    if (p === '/api/auth/login' && m === 'POST') {
      rateLimit(req, 'login', 10);
      const b = await readJson(req);
      if (!checkPassword(String(b.password ?? ''), store.settings.auth.passwordHash)) throw new HttpError(401, '비밀번호가 다릅니다');
      return login(res);
    }
    if (p === '/api/auth/logout' && m === 'POST') {
      sessions.delete(cookies(req).sid);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
    }

    if (!p.startsWith('/api/')) throw new HttpError(404, '페이지가 없습니다');
    if (!authed(req)) throw new HttpError(401, '로그인이 필요합니다');
    return admin(req, res, url, p, m);
  }

  function login(res) {
    const sid = crypto.randomBytes(24).toString('base64url');
    sessions.set(sid, { expires: Date.now() + 30 * 864e5 });
    return send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30 * 86400}` });
  }

  // ── 대시보드 API ──
  async function admin(req, res, url, p, m) {
    let g;
    if (m === 'GET' && p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': hello\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (m === 'GET' && p === '/api/meta') return send(res, 200, { statuses: STATUSES, autonomy: AUTONOMY_LABELS, models: Object.fromEntries(Object.entries(MODELS).map(([k, v]) => [k, v.label])) });
    if (m === 'GET' && p === '/api/overview') return send(res, 200, overview(ctx));

    if (m === 'POST' && p === '/api/agent/pause') { store.updateSettings({ paused: true }); store.log('agent', '대표가 에이전트를 일시정지했습니다'); return send(res, 200, { ok: true }); }
    if (m === 'POST' && p === '/api/agent/resume') { store.updateSettings({ paused: false }); store.log('agent', '에이전트 다시 시작'); return send(res, 200, { ok: true }); }

    // 설정
    if (m === 'GET' && p === '/api/settings') return send(res, 200, maskedSettings(store.settings));
    if (m === 'PUT' && p === '/api/settings') {
      const b = await readJson(req);
      delete b.auth;
      delete b.hasApiKey;
      if (typeof b.apiKey === 'string' && (b.apiKey.includes('…') || b.apiKey === '')) delete b.apiKey;
      if (b.apiKey) b.apiKey = b.apiKey.trim();
      if (b.smtp && b.smtp.pass === '••••••••') delete b.smtp.pass;
      if (b.model && !MODELS[b.model]) throw new HttpError(400, '지원하지 않는 모델');
      if (Array.isArray(b.services)) {
        b.services = b.services.map((x, i) => ({
          id: String(x.id || `svc${i + 1}`).replace(/[^\w-]/g, '').slice(0, 30) || `svc${i + 1}`,
          name: String(x.name ?? '').slice(0, 80), description: String(x.description ?? '').slice(0, 300),
          basePrice: Math.max(0, Number(x.basePrice) || 0), minPrice: Math.max(0, Number(x.minPrice) || 0),
          days: Math.max(1, Number(x.days) || 1), revisions: Math.max(0, Number(x.revisions) || 0),
        }));
      }
      store.updateSettings(b);
      store.log('settings', '설정을 저장했습니다');
      return send(res, 200, maskedSettings(store.settings));
    }
    if (m === 'POST' && p === '/api/settings/test-key') {
      const b = await readJson(req);
      const key = b.apiKey && !b.apiKey.includes('…') ? b.apiKey.trim() : store.settings.apiKey;
      if (!key) throw new HttpError(400, 'API 키를 입력하세요');
      try {
        const id = await llm.testKey(key);
        return send(res, 200, { ok: true, model: id });
      } catch (err) {
        return send(res, 200, { ok: false, error: err.message });
      }
    }
    if (m === 'POST' && p === '/api/settings/password') {
      const b = await readJson(req);
      if (!checkPassword(String(b.current ?? ''), store.settings.auth.passwordHash)) throw new HttpError(401, '현재 비밀번호가 다릅니다');
      if (String(b.next ?? '').length < 8) throw new HttpError(400, '새 비밀번호는 8자 이상');
      store.updateSettings({ auth: { passwordHash: hashPassword(b.next) } });
      return send(res, 200, { ok: true });
    }

    // 프로젝트
    if (m === 'GET' && p === '/api/projects') {
      return send(res, 200, store.all('projects').map((x) => projectSummary(store, x)).sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)));
    }
    if (m === 'POST' && p === '/api/projects') {
      const b = await readJson(req);
      const project = await createInquiry(ctx, { ...b, source: 'owner' });
      return send(res, 200, { id: project.id });
    }
    if ((g = /^\/api\/projects\/(\w+)(\/\w+)?$/.exec(p))) {
      const project = store.get('projects', g[1]);
      if (!project) throw new HttpError(404, '프로젝트 없음');
      const sub = g[2] ?? '';
      if (m === 'GET' && sub === '') return send(res, 200, projectDetail(store, project));
      if (m === 'PATCH' && sub === '') {
        const b = await readJson(req);
        const patch = {};
        if (typeof b.autopilot === 'boolean') patch.autopilot = b.autopilot;
        if (b.status && STATUSES[b.status]) patch.status = b.status;
        if (Number.isFinite(b.extraRounds)) patch.extraRounds = Math.max(0, b.extraRounds);
        for (const k of ['title', 'brief', 'deadline']) if (typeof b[k] === 'string') patch[k] = b[k];
        store.update('projects', project.id, patch);
        store.log('owner', `대표가 프로젝트 수정 (${Object.keys(patch).join(', ')}) — ${project.title}`, { projectId: project.id });
        return send(res, 200, { ok: true });
      }
      if (m === 'POST' && sub === '/message') {
        const b = await readJson(req);
        if (!String(b.text ?? '').trim()) throw new HttpError(400, '내용을 입력하세요');
        await postMessage(ctx, project, { from: 'owner', text: b.text });
        store.log('owner', `대표가 직접 답장: ${short(b.text)}`, { projectId: project.id });
        return send(res, 200, { ok: true });
      }
      if (m === 'POST' && sub === '/instruct') {
        const b = await readJson(req);
        if (!String(b.text ?? '').trim()) throw new HttpError(400, '지시 내용을 입력하세요');
        await postMessage(ctx, project, { from: 'owner', internal: true, text: b.text });
        enqueueAgent(store, project.id, { kind: 'owner_instruction', text: b.text });
        store.log('owner', `대표 지시: ${short(b.text)}`, { projectId: project.id });
        return send(res, 200, { ok: true });
      }
    }

    if (m === 'GET' && (g = /^\/api\/designs\/(\w+)\/(raw|download)$/.exec(p))) {
      const d = store.get('designs', g[1]);
      if (!d) throw new HttpError(404, '없음');
      return serveDesign(res, d, g[2] === 'download');
    }
    if (m === 'GET' && (g = /^\/api\/uploads\/([\w.]+)$/.exec(p))) return serveFile(res, path.join(store.uploadsDir, g[1]));

    // 청구서
    if (m === 'POST' && (g = /^\/api\/invoices\/(\w+)\/(paid|cancel)$/.exec(p))) {
      const inv = store.get('invoices', g[1]);
      if (!inv) throw new HttpError(404, '청구서 없음');
      if (g[2] === 'paid') await markInvoicePaid(ctx, inv.id);
      else {
        store.update('invoices', inv.id, { status: 'cancelled' });
        store.log('owner', `청구서 취소 ${inv.id}`, { projectId: inv.projectId });
      }
      return send(res, 200, { ok: true });
    }

    // 승인 대기열
    if (m === 'GET' && p === '/api/approvals') {
      const list = store.all('approvals').slice().reverse().slice(0, 200).map((a) => ({
        ...a,
        project: a.projectId ? store.get('projects', a.projectId)?.title : null,
        lead: a.leadId ? (store.get('leads', a.leadId)?.company || store.get('leads', a.leadId)?.name) : null,
      }));
      return send(res, 200, list);
    }
    if (m === 'POST' && (g = /^\/api\/approvals\/(\w+)\/(approve|reject)$/.exec(p))) {
      const ap = store.get('approvals', g[1]);
      if (!ap || ap.status !== 'pending') throw new HttpError(409, '이미 처리된 항목입니다');
      const b = await readJson(req);
      if (g[2] === 'approve') {
        const action = { ...ap.action };
        // 대표가 문구를 고쳐서 승인할 수 있습니다.
        for (const k of ['message', 'subject', 'body']) if (typeof b[k] === 'string' && b[k].trim()) action[k] = b[k];
        const result = await executeAction(ctx, action);
        store.update('approvals', ap.id, { status: result.startsWith('실패') ? 'failed' : 'approved', result, action, decidedAt: new Date().toISOString() });
        store.log('owner', `승인: ${ap.summary} → ${short(result)}`, { projectId: ap.projectId, leadId: ap.leadId });
        return send(res, 200, { ok: true, result });
      }
      store.update('approvals', ap.id, { status: 'rejected', feedback: b.feedback ?? '', decidedAt: new Date().toISOString() });
      store.log('owner', `반려: ${ap.summary}${b.feedback ? ` — ${short(b.feedback)}` : ''}`, { projectId: ap.projectId, leadId: ap.leadId });
      if (ap.projectId && b.redo !== false) enqueueAgent(store, ap.projectId, { kind: 'approval_rejected', summary: ap.summary, feedback: b.feedback ?? '' });
      if (ap.leadId && b.redo !== false && b.feedback) enqueue(store, 'sales', { leadId: ap.leadId, instruction: `Your previous draft was rejected. Feedback: ${b.feedback}` });
      return send(res, 200, { ok: true });
    }

    // 영업 리드
    if (m === 'GET' && p === '/api/leads') return send(res, 200, store.all('leads').slice().reverse());
    if (m === 'POST' && p === '/api/leads') {
      const b = await readJson(req);
      if (!b.company && !b.name) throw new HttpError(400, '회사명이나 이름을 입력하세요');
      const lead = store.insert('leads', {
        name: String(b.name ?? ''), company: String(b.company ?? ''), email: String(b.email ?? '').trim().toLowerCase(),
        website: String(b.website ?? ''), notes: String(b.notes ?? ''), status: 'new', agentNotes: [],
      });
      store.log('sales', `리드 추가: ${lead.company || lead.name}`, { leadId: lead.id });
      if (b.autoOutreach) enqueue(store, 'sales', { leadId: lead.id }, { dedupe: `sales:${lead.id}` });
      return send(res, 200, lead);
    }
    if ((g = /^\/api\/leads\/(\w+)(\/outreach)?$/.exec(p))) {
      const lead = store.get('leads', g[1]);
      if (!lead) throw new HttpError(404, '리드 없음');
      if (m === 'PATCH' && !g[2]) {
        const b = await readJson(req);
        const patch = {};
        for (const k of ['name', 'company', 'email', 'website', 'notes', 'status']) if (typeof b[k] === 'string') patch[k] = b[k];
        store.update('leads', lead.id, patch);
        return send(res, 200, { ok: true });
      }
      if (m === 'POST' && g[2]) {
        const b = await readJson(req);
        enqueue(store, 'sales', { leadId: lead.id, instruction: b.instruction ?? '' }, { dedupe: `sales:${lead.id}` });
        return send(res, 200, { ok: true });
      }
      if (m === 'POST' && !g[2]) throw new HttpError(405, '');
    }

    // 기록 · 알림 · 작업
    if (m === 'GET' && p === '/api/activity') {
      const pid = url.searchParams.get('projectId');
      const rows = store.all('activity').filter((a) => !pid || a.projectId === pid);
      return send(res, 200, rows.slice(-300).reverse());
    }
    if (m === 'GET' && p === '/api/alerts') return send(res, 200, store.find('alerts', (a) => !a.dismissed).reverse());
    if (m === 'POST' && (g = /^\/api\/alerts\/(\w+)\/dismiss$/.exec(p))) { store.update('alerts', g[1], { dismissed: true }); return send(res, 200, { ok: true }); }
    if (m === 'GET' && p === '/api/jobs') return send(res, 200, store.all('jobs').slice(-100).reverse());
    if (m === 'POST' && (g = /^\/api\/jobs\/(\w+)\/(retry|cancel)$/.exec(p))) {
      const j = store.get('jobs', g[1]);
      if (!j) throw new HttpError(404, '작업 없음');
      store.update('jobs', j.id, g[2] === 'retry' ? { status: 'queued', attempts: 0, runAt: new Date().toISOString() } : { status: 'cancelled' });
      return send(res, 200, { ok: true });
    }
    if (m === 'GET' && p === '/api/usage') {
      const days = {};
      for (const u of store.all('usage')) {
        days[u.day] ??= { day: u.day, cost: 0, calls: 0 };
        days[u.day].cost += u.cost;
        days[u.day].calls += 1;
      }
      return send(res, 200, Object.values(days).sort((a, b) => a.day.localeCompare(b.day)).slice(-30));
    }

    throw new HttpError(404, '없는 API');
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      if (res.headersSent) return res.end();
      const status = err.status ?? 500;
      if (status >= 500) console.error(err);
      send(res, status, { error: err.message || '서버 오류' });
    });
  });

  return {
    server,
    ctx,
    close() {
      scheduler?.stop();
      clearInterval(ping);
      for (const r of sseClients) r.end();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 4300;
  const host = process.env.HOST || '127.0.0.1';
  const app = createApp();
  app.server.listen(port, host, () => {
    console.log(`\n  스튜디오 에이전트 실행 중`);
    console.log(`  대시보드   http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/admin`);
    console.log(`  문의 양식   http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/\n`);
  });
}
