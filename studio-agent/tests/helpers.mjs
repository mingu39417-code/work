// 테스트 도구 — 실제 API 대신 미리 정한 대로 답하는 가짜 Claude를 씁니다(비용 0, 결과 고정).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.mjs';
import { createLLM } from '../lib/claude.mjs';

let n = 0;
export const toolUse = (name, input) => ({ type: 'tool_use', id: `tu_${++n}`, name, input });
export const text = (t) => ({ type: 'text', text: t });

export function msg(content, stop_reason = content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn') {
  return {
    id: `msg_${++n}`,
    model: 'claude-opus-5-5',
    content,
    stop_reason,
    usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

export const json = (obj) => msg([text(JSON.stringify(obj))]);

export function kindOf(body) {
  const tools = (body.tools ?? []).map((t) => t.name);
  if (tools.includes('reply_to_client')) return 'account';
  if (tools.includes('draft_outreach')) return 'sales';
  const props = Object.keys(body.output_config?.format?.schema?.properties ?? {});
  if (props.includes('directions')) return 'directions';
  if (props.includes('copies')) return 'copy';
  if (props.includes('code')) return 'make';
  if (props.includes('files')) return 'final';
  if (props.includes('instagram') && props.includes('hashtags')) return 'social';
  if (props.includes('items')) return 'triage';
  if (props.includes('decision')) return 'review';
  if (props.includes('milestones')) return 'kickoff';
  if (props.includes('went_well')) return 'retro';
  if (/project manager/.test(body.system?.[0]?.text ?? '')) return 'standup';
  return 'unknown';
}

// respond(body, kind, callIndexForKind) → message
export function fakeFactory(respond) {
  const calls = [];
  const counts = {};
  const handle = async (body) => {
    const kind = kindOf(body);
    counts[kind] = (counts[kind] ?? 0) + 1;
    calls.push({ kind, body: structuredClone(body) });
    return respond(body, kind, counts[kind] - 1);
  };
  const factory = () => ({
    beta: {
      messages: {
        create: handle,
        stream: (body) => ({ finalMessage: () => handle(body) }),
      },
    },
    models: { retrieve: async (id) => ({ id }) },
  });
  return { factory, calls };
}

export function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'studio-agent-'));
}

export function makeCtx(respond, settings = {}) {
  const store = new Store(tmpDir());
  store.updateSettings({ apiKey: 'sk-ant-test', ...settings });
  const fake = fakeFactory(respond);
  const llm = createLLM(store, { factory: fake.factory });
  return { ctx: { store, llm, running: null }, calls: fake.calls };
}

// 납품 파일용 — 배경 없이 그림만 있는 SVG
export const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><circle cx="100" cy="100" r="80" fill="#e7a07a"/><text x="100" y="110" text-anchor="middle" font-size="28" font-family="Pretendard, sans-serif">모모</text></svg>';
export const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600"><rect width="800" height="600" fill="#fff"/><text x="40" y="80">Logo</text></svg>';
