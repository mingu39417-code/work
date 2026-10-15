// 납품 파일 — 고객이 최종 확정한 시안으로 실제로 쓸 수 있는 원본 파일 세트를 만듭니다.
// 시안은 발표용 시트(목업 · 설명 포함)라서 그대로 넘기면 간판 업체나 인쇄소가 쓸 수 없습니다.
// 1) 디자이너가 확정 시안에서 납품용 SVG(심볼 · 조합 · 단색 · 반전 등)를 따로 그리고, AD가 남긴 마감 지적도 이때 반영합니다.
// 2) 코드가 각 SVG를 실제로 렌더링해 깨지거나 비어 있지 않은지 검사하고, PNG(투명 배경)로 변환합니다.
// 3) 고객은 정산이 끝나면 포털에서 ZIP 하나로 받습니다. AI(일러스트레이터) 파일은 만들 수 없으므로 약속하지 않습니다.

import zlib from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { postMessage, short, emailClient, emailSubject } from './actions.mjs';
import { pickDesigner, modelFor, staffBlock } from './staff.mjs';
import { designerSystem } from './prompts.mjs';
import { jsonOf } from './claude.mjs';
import { briefText } from './designer.mjs';

// 실제로 납품하는 형식 — 고객 안내 문구도 이 목록만 말합니다.
export const DELIVERY_FORMATS = 'SVG(벡터) · PNG(투명 배경)';
export const PNG_WIDTHS = [512, 2048];
const MAX_FILES = 10;
const FENCE = '```';

const FINAL_SCHEMA = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          purpose: { type: 'string' },
          svg: { type: 'string' },
        },
        required: ['name', 'purpose', 'svg'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string' },
  },
  required: ['files', 'notes'],
  additionalProperties: false,
};

// PNG 렌더링에 쓸 한글 기본 글꼴(운영체제마다 기본으로 깔린 글꼴)
function defaultKoreanFont() {
  if (process.platform === 'win32') return 'Malgun Gothic';
  if (process.platform === 'darwin') return 'Apple SD Gothic Neo';
  return 'Noto Sans CJK KR';
}

export function renderPng(svg, width) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true, defaultFontFamily: defaultKoreanFont() } });
  const img = r.render();
  return { png: img.asPng(), pixels: img.pixels, width: img.width, height: img.height };
}

// 납품 파일 검사: 형식이 맞고, 실제로 그려지며, 보이는 픽셀이 있고, 외부 자원을 쓰지 않아야 합니다.
export function checkFinalSvg(svg) {
  if (typeof svg !== 'string' || !/<svg[\s>]/i.test(svg) || !/<\/svg>/i.test(svg)) return '올바른 SVG가 아닙니다';
  if (!/viewBox\s*=/.test(svg)) return 'viewBox가 없습니다';
  if (/<script|<foreignObject|(?:href|src)\s*=\s*["'](?:https?:|\/\/)/i.test(svg)) return '스크립트나 외부 자원이 들어 있습니다';
  let out;
  try {
    out = renderPng(svg, 256);
  } catch (err) {
    return `렌더링 실패: ${err.message}`;
  }
  let visible = 0;
  for (let i = 3; i < out.pixels.length; i += 4) if (out.pixels[i] > 16) visible++;
  if (visible / (out.width * out.height) < 0.005) return '그려진 내용이 거의 없습니다(빈 파일)';
  return null;
}

export const safeName = (s) => String(s).replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'file';

export async function runFinalFiles(ctx, { projectId, designId }) {
  const { store, llm } = ctx;
  const s = store.settings;
  const project = store.get('projects', projectId);
  const design = store.get('designs', designId);
  if (!project || !design || design.projectId !== project.id) return;
  store.update('designs', design.id, { finalStatus: 'working', finalError: null });

  // 웹페이지(HTML) 결과물은 그 문서 자체가 납품물입니다.
  if (design.format !== 'svg') {
    store.update('designs', design.id, { finalStatus: 'ready', finalFiles: [{ name: safeName(design.title), purpose: '최종 파일', html: design.code }], finalAt: new Date().toISOString() });
    return afterReady(ctx, project.id, design.id);
  }

  const designer = pickDesigner(store, project);
  const nits = design.review?.issues?.length ? design.review.issues.map((x) => `- ${x}`).join('\n') : '(none)';
  const ask = (extra) => llm.stream({
    model: modelFor(store, designer),
    system: [{ type: 'text', text: designerSystem(s, store.all('lessons')) + staffBlock(designer, s), cache_control: { type: 'ephemeral' } }],
    max_tokens: 64000,
    output_config: { effort: s.designEffort, format: { type: 'json_schema', schema: FINAL_SCHEMA } },
    messages: [{
      role: 'user',
      content: `${briefText(store, project, { instructions: '(final production files)' })}

# The client gave final approval to this presentation sheet
${FENCE}svg
${design.code}
${FENCE}

# Art director's remaining finishing notes on it (fix every one that applies to the files below)
${nits}

Now produce the production files the client will hand to sign makers, printers and social media. These are NOT presentation sheets: no mockups, no labels, no measurements, no captions, no artboard background.
- One standalone SVG per file, tightly cropped to the artwork with a small even margin, transparent background, with viewBox, width and height.
- For a logo: the symbol alone, the main combination, the other combination (horizontal/vertical) if the sheet has one, a one-color version and a reversed version (light artwork meant for dark backgrounds; still transparent). Keep shapes, colors and proportions exactly as approved.
- For other deliverables (poster, banner, social post, card…): the final artwork itself at its real size, cleaned of presentation notes, plus size variants only if the sheet shows them.
- At most ${MAX_FILES} files. "name" is a short English file name without extension (e.g. "momo-symbol-color"). "purpose" is one short Korean phrase (e.g. "심볼 단독 · 컬러"). Keep each file compact (reuse with <defs>/<use>, coordinates to 1 decimal).
- Text: keep the approved fonts as font-family stacks ending in a Korean-capable sans-serif.
"notes" is 1-2 Korean sentences for the client about which file to use where.${extra}`,
    }],
  }, 'final_files', { projectId: project.id, staffId: designer?.id });

  let msg = await ask('');
  if (msg.stop_reason === 'max_tokens') {
    store.log('design', '납품 파일 응답이 너무 길어 잘렸습니다 — 더 간결하게 다시 만듭니다', { projectId: project.id });
    msg = await ask('\n\nYour last attempt was cut off because it was far too long. Produce fewer, more compact files.');
  }
  const out = jsonOf(msg);

  // 코드로 검사 — 통과한 파일만 납품합니다. 하나도 통과하지 못하면 실패로 처리해 다시 시도합니다.
  const files = [];
  const rejected = [];
  const used = new Set();
  for (const f of out.files.slice(0, MAX_FILES)) {
    const why = checkFinalSvg(f.svg);
    if (why) { rejected.push(`${f.name}: ${why}`); continue; }
    let name = safeName(f.name);
    while (used.has(name)) name += '_2';
    used.add(name);
    files.push({ name, purpose: String(f.purpose).slice(0, 60), svg: f.svg });
  }
  if (!files.length) throw new Error(`납품 파일이 검사를 하나도 통과하지 못했습니다 (${rejected.join(' / ')})`);

  store.update('designs', design.id, { finalStatus: 'ready', finalFiles: files, finalNotes: String(out.notes ?? '').slice(0, 500), finalRejected: rejected, finalAt: new Date().toISOString() });
  await postMessage(ctx, store.get('projects', project.id), {
    from: 'staff', staffId: designer?.id ?? null, internal: true,
    text: `[납품 파일] 「${design.title}」 원본 ${files.length}개를 만들었습니다 (${files.map((f) => f.purpose).join(', ')}). AD 마감 지적 ${design.review?.issues?.length ?? 0}건을 반영해 다시 그렸습니다.${rejected.length ? ` 검사에서 빠진 파일: ${rejected.join(' / ')}` : ''}`,
  });
  store.log('delivery', `납품 파일 ${files.length}개 준비 — ${short(project.title, 40)}`, { projectId: project.id });
  return afterReady(ctx, project.id, design.id);
}

// 이미 정산이 끝났는데 파일이 늦게 준비됐다면, 고객에게 알리고 메일로도 보냅니다.
async function afterReady(ctx, projectId, designId) {
  const { store } = ctx;
  const project = store.get('projects', projectId);
  if (project.status !== 'completed' || !store.get('designs', designId).approved) return;
  await postMessage(ctx, project, { from: 'system', text: '납품 파일이 준비되었습니다. 이 페이지에서 원본(ZIP)을 받으실 수 있습니다.' });
  await emailDelivery(ctx, project);
}

// 정산 완료 시(또는 파일이 늦게 준비됐을 때) 납품 메일을 보냅니다. 파일이 아직 없으면 보내지 않습니다.
export async function emailDelivery(ctx, project) {
  const { store } = ctx;
  const finals = store.find('designs', (d) => d.projectId === project.id && d.approved && d.finalStatus === 'ready');
  if (!finals.length) return { sent: false, reason: '납품 파일 준비 전' };
  if (project.deliveryEmailedAt) return { sent: false, reason: '이미 보냄' };
  const attachments = finals.map((d) => ({ filename: `${safeName(d.title)}.zip`, content: packageZip(store, d), contentType: 'application/zip' }));
  try {
    const r = await emailClient(ctx, project, {
      subject: emailSubject(store.settings, project, '최종 파일 납품'),
      text: `작업이 모두 마무리되었습니다. 감사합니다!\n최종 원본(${DELIVERY_FORMATS})을 ZIP으로 첨부했습니다. 프로젝트 페이지에서도 언제든 받으실 수 있습니다.\n(첨부 파일은 생성형 AI를 활용해 제작되었습니다.)`,
      attachments,
    });
    if (r.sent) store.update('projects', project.id, { deliveryEmailedAt: new Date().toISOString() });
    store.log('delivery', `${r.sent ? '납품 메일 발송' : '정산 완료 (메일 미발송)'} — ZIP ${attachments.length}개 — ${project.title}`, { projectId: project.id });
    return r;
  } catch (err) {
    store.log('error', `납품 메일 발송 실패: ${err.message}`, { projectId: project.id });
    return { sent: false, reason: err.message };
  }
}

// ── ZIP 묶기 ──────────────────────────────────────────────────────
export function packageZip(store, design) {
  const s = store.settings;
  const entries = [];
  const files = design.finalFiles ?? [];
  for (const f of files) {
    if (f.html) { entries.push({ name: `${f.name}.html`, data: Buffer.from(f.html) }); continue; }
    entries.push({ name: `SVG/${f.name}.svg`, data: Buffer.from(f.svg) });
    for (const w of PNG_WIDTHS) entries.push({ name: `PNG/${f.name}_${w}px.png`, data: renderPng(f.svg, w).png });
  }
  entries.push({ name: `presentation/${safeName(design.title)}.${design.format}`, data: Buffer.from(design.code) });
  const readme = [
    `${s.profile.studioName || '디자인 스튜디오'} — 최종 납품 파일`,
    `확정 시안: ${design.title}`,
    '',
    '포함된 파일',
    ...files.map((f) => `- ${f.name}: ${f.purpose}`),
    '',
    'SVG 폴더: 크기를 키워도 깨지지 않는 벡터 원본입니다. 간판 · 인쇄 업체에는 이 파일을 전달하세요.',
    `PNG 폴더: 투명 배경 이미지입니다(가로 ${PNG_WIDTHS.join(' / ')}px). SNS · 웹 · 문서에 쓰세요.`,
    'presentation 폴더: 확정하신 시안 발표 시트입니다(목업 · 사용 규칙 참고용).',
    '',
    'SVG 안의 글자는 글꼴 정보로 들어 있어, 해당 글꼴이 없는 컴퓨터에서는 비슷한 글꼴로 보일 수 있습니다.',
    '업체에서 글자를 윤곽선(아웃라인)으로 바꾼 파일을 요청하면 말씀해 주세요.',
    ...(design.finalNotes ? ['', design.finalNotes] : []),
    '',
    '이 파일들은 생성형 AI를 활용해 제작되었습니다.',
  ].join('\r\n');
  entries.push({ name: 'README.txt', data: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(readme)]) });
  return zip(entries);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 표준 ZIP(deflate). 파일 이름을 UTF-8로 표시해 한글 이름도 깨지지 않습니다.
export function zip(entries) {
  const parts = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = zlib.deflateRawSync(e.data);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}