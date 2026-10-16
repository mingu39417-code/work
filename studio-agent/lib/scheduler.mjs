// 작업 대기열 처리기 — 몇 초마다 실행할 때가 된 작업을 하나씩 꺼내 처리합니다.
// 일시정지 · API 키 없음 · 예산 초과일 때는 쉬고, 실패한 작업은 간격을 늘려 가며 3번까지 다시 시도합니다.

import { runAccountManager, runSales } from './agent.mjs';
import { runDesignJob } from './designer.mjs';
import { runFinalFiles } from './finals.mjs';
import { composeSocialPost, publishSocialPost, syncSocial, composeCarousel } from './social.mjs';
import { composeBlogPost, checkPublished } from './blog.mjs';
import { publishToWordPress } from './wordpress.mjs';
import { runKickoff, runStandup, runRetro, maintenance } from './pm.mjs';
import { enqueueAgent } from './actions.mjs';
import { BudgetError, MissingKeyError, RefusalError } from './claude.mjs';

const MAX_ATTEMPTS = 3;

const HANDLERS = {
  agent: (ctx, p) => runAccountManager(ctx, p),
  design: (ctx, p) => runDesignJob(ctx, p),
  final_files: (ctx, p) => runFinalFiles(ctx, p),
  social_compose: (ctx, p) => composeSocialPost(ctx, p),
  social_publish: (ctx, p) => publishSocialPost(ctx, p),
  social_sync: (ctx) => syncSocial(ctx),
  ig_post: (ctx, p) => composeCarousel(ctx, p),
  blog_compose: (ctx, p) => composeBlogPost(ctx, p),
  blog_check: (ctx) => checkPublished(ctx),
  wp_publish: (ctx, p) => publishToWordPress(ctx, p),
  sales: (ctx, p) => runSales(ctx, p),
  kickoff: (ctx, p) => runKickoff(ctx, p),
  standup: (ctx) => runStandup(ctx),
  retro: (ctx, p) => runRetro(ctx, p),
};

// 작업 줄(레인): 오래 걸리는 디자인 작업이 고객 응대 · 일정 · 정산을 막지 않도록 두 줄로 나눠 동시에 돌립니다.
// 실제 회사에서 디자이너가 시안을 만드는 동안 AM이 다른 고객에게 답하는 것과 같습니다.
export const LANES = { studio: ['design', 'final_files'], office: null };
export function laneOf(kind) {
  return LANES.studio.includes(kind) ? 'studio' : 'office';
}

export function nextJob(store, now = Date.now(), lane = null) {
  return store
    .all('jobs')
    .filter((j) => j.status === 'queued' && Date.parse(j.runAt) <= now && (!lane || laneOf(j.kind) === lane))
    .sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt))[0] ?? null;
}

export async function runJob(ctx, job) {
  const { store } = ctx;
  const prev = job.attempts;
  const attempts = prev + 1;
  store.update('jobs', job.id, { status: 'running', startedAt: new Date().toISOString(), attempts });
  try {
    await HANDLERS[job.kind](ctx, job.payload);
    store.update('jobs', job.id, { status: 'done', finishedAt: new Date().toISOString() });
  } catch (err) {
    const meta = { projectId: job.payload.projectId ?? null, leadId: job.payload.leadId ?? null };
    if (err instanceof BudgetError || err instanceof MissingKeyError) {
      // 작업은 그대로 두고 30분 뒤에 다시 봅니다.
      store.update('jobs', job.id, { status: 'queued', attempts: prev, runAt: new Date(Date.now() + 30 * 60e3).toISOString() });
      if (!store.findOne('alerts', (a) => !a.dismissed && a.code === err.name)) store.alert('urgent', err.message, { code: err.name });
      return;
    }
    const permanent = err instanceof RefusalError || attempts >= MAX_ATTEMPTS;
    store.log('error', `작업 실패 (${job.kind}, ${attempts}회째): ${err.message}`, meta);
    if (!permanent) {
      store.update('jobs', job.id, { status: 'queued', error: err.message, runAt: new Date(Date.now() + 2 ** attempts * 60e3).toISOString() });
      return;
    }
    store.update('jobs', job.id, { status: 'failed', error: err.message, finishedAt: new Date().toISOString() });
    store.alert('urgent', `자동 처리 실패 — 확인이 필요합니다: ${err.message}`, meta);
    if (job.kind === 'design') enqueueAgent(store, job.payload.projectId, { kind: 'design_failed', error: err.message });
    if (job.kind === 'final_files') store.update('designs', job.payload.designId, { finalStatus: 'failed', finalError: err.message });
  }
}

export function startScheduler(ctx, { intervalMs = 3000 } = {}) {
  const { store } = ctx;
  // 서버가 작업 도중 꺼졌다면 다시 대기 상태로 돌립니다.
  for (const j of store.find('jobs', (j) => j.status === 'running')) store.update('jobs', j.id, { status: 'queued', attempts: j.attempts - 1 });

  const busy = { studio: false, office: false };
  ctx.runningJobs = {};
  let lastMaintenance = 0;
  const runLane = async (lane) => {
    if (busy[lane]) return;
    const job = nextJob(store, Date.now(), lane);
    if (!job) return;
    busy[lane] = true;
    ctx.runningJobs[lane] = job;
    ctx.running = ctx.runningJobs.office ?? ctx.runningJobs.studio ?? null;
    store.emit('change', { collection: 'agent' });
    try {
      await runJob(ctx, job);
    } finally {
      busy[lane] = false;
      delete ctx.runningJobs[lane];
      ctx.running = ctx.runningJobs.office ?? ctx.runningJobs.studio ?? null;
      store.emit('change', { collection: 'agent' });
    }
  };
  const tick = async () => {
    if (store.settings.paused || !store.settings.apiKey) return;
    // 1분마다 일정 지연 · 연체 · 스탠드업 시간을 점검합니다(Claude 호출 없음).
    if (Date.now() - lastMaintenance > 60e3) {
      lastMaintenance = Date.now();
      try { maintenance(store); } catch (err) { store.log('error', `정기 점검 실패: ${err.message}`); }
    }
    await Promise.all([runLane('office'), runLane('studio')]);
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), tick };
}
