// Claude API 연결 — 모든 호출은 여기를 거칩니다.
// - 대시보드에 입력한 API 키로 클라이언트를 만듭니다(키가 바뀌면 새로 만듦).
// - 호출마다 토큰 사용량과 비용을 기록하고, 하루 예산을 넘으면 호출을 막습니다.
// - 안전 분류기가 요청을 거절하면 서버 측 대체 모델(fallbacks: "default")이 이어서 처리합니다.

import Anthropic from '@anthropic-ai/sdk';

// 1M 토큰당 달러 (입력 / 출력 / 캐시 읽기). 캐시 쓰기는 입력 단가의 1.25배.
export const MODELS = {
  'claude-opus-5-5': { label: 'Claude Opus 5.5 (기본 · 최고 품질)', input: 4, output: 20, cacheRead: 0.2, fallback: true },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5 (빠르고 저렴)', input: 2, output: 10, cacheRead: 0.2, fallback: true },
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5 (가장 저렴)', input: 0.1, output: 0.5, cacheRead: 0.01, fallback: false },
};

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class BudgetError extends Error {
  constructor(spent, limit) {
    super(`오늘 API 예산을 모두 썼습니다 ($${spent.toFixed(2)} / $${limit})`);
    this.name = 'BudgetError';
  }
}

export class RefusalError extends Error {
  constructor(details) {
    super(`Claude가 요청을 거절했습니다${details?.category ? ` (${details.category})` : ''}`);
    this.name = 'RefusalError';
    this.details = details;
  }
}

export class MissingKeyError extends Error {
  constructor() {
    super('Claude API 키가 설정되지 않았습니다. 대시보드 → 설정에서 입력하세요.');
    this.name = 'MissingKeyError';
  }
}

export function costOf(model, usage) {
  const p = MODELS[model] ?? MODELS['claude-opus-5-5'];
  const inTok = usage.input_tokens ?? 0;
  const outTok = usage.output_tokens ?? 0;
  const cw = usage.cache_creation_input_tokens ?? 0;
  const cr = usage.cache_read_input_tokens ?? 0;
  return (inTok * p.input + cw * p.input * 1.25 + cr * p.cacheRead + outTok * p.output) / 1e6;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// factory는 테스트에서 가짜 클라이언트를 넣을 때 씁니다.
export function createLLM(store, { factory } = {}) {
  let cached = { key: null, client: null };

  function client() {
    const key = store.settings.apiKey;
    if (!key) throw new MissingKeyError();
    if (cached.key !== key) {
      cached = { key, client: factory ? factory(key) : new Anthropic({ apiKey: key, maxRetries: 3 }) };
    }
    return cached.client;
  }

  function spentToday() {
    const d = today();
    return store.all('usage').filter((u) => u.day === d).reduce((s, u) => s + u.cost, 0);
  }

  function assertBudget() {
    const limit = Number(store.settings.dailyBudgetUsd) || 0;
    if (limit <= 0) return;
    const spent = spentToday();
    if (spent >= limit) throw new BudgetError(spent, limit);
  }

  function prepare(body) {
    const model = body.model ?? store.settings.model;
    const req = { ...body, model };
    if (MODELS[model]?.fallback) {
      req.betas = [...(req.betas ?? []), FALLBACK_BETA];
      req.fallbacks = 'default';
    }
    return req;
  }

  function record(msg, purpose, meta) {
    const model = msg.model ?? store.settings.model;
    const cost = costOf(model, msg.usage ?? {});
    store.insert('usage', {
      day: today(),
      purpose,
      model,
      projectId: meta.projectId ?? null,
      leadId: meta.leadId ?? null,
      staffId: meta.staffId ?? null,
      inputTokens: msg.usage?.input_tokens ?? 0,
      outputTokens: msg.usage?.output_tokens ?? 0,
      cacheRead: msg.usage?.cache_read_input_tokens ?? 0,
      cacheWrite: msg.usage?.cache_creation_input_tokens ?? 0,
      cost,
    });
    if (msg.stop_reason === 'refusal') throw new RefusalError(msg.stop_details);
    return msg;
  }

  return {
    spentToday,
    assertBudget,

    // 짧은 응답(고객 응대 · 영업) — 일반 요청
    async create(body, purpose, meta = {}) {
      assertBudget();
      const msg = await client().beta.messages.create(prepare(body));
      return record(msg, purpose, meta);
    },

    // 긴 출력(디자인 코드) — 시간 초과를 막기 위해 스트리밍으로 받고 완성본만 씁니다.
    async stream(body, purpose, meta = {}) {
      assertBudget();
      const msg = await client().beta.messages.stream(prepare(body)).finalMessage();
      return record(msg, purpose, meta);
    },

    async testKey(key) {
      const c = factory ? factory(key) : new Anthropic({ apiKey: key, maxRetries: 0 });
      const m = await c.models.retrieve(store.settings.model);
      return m.id;
    },
  };
}

export function textOf(msg) {
  return (msg.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

// 구조화 출력(JSON) 응답을 읽습니다.
export function jsonOf(msg) {
  if (msg.stop_reason === 'max_tokens') throw new Error('응답이 너무 길어 중간에 잘렸습니다 (max_tokens)');
  const t = textOf(msg);
  try {
    return JSON.parse(t);
  } catch {
    throw new Error('Claude 응답을 JSON으로 읽지 못했습니다');
  }
}
