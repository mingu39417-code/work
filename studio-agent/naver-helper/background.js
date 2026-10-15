// 확장 프로그램 뒤쪽 — 이 컴퓨터의 스튜디오 에이전트(127.0.0.1:4300)와만 이야기합니다.
const BASE = 'http://127.0.0.1:4300';

async function call(msg) {
  if (msg.op === 'get') {
    const r = await fetch(BASE + msg.path);
    if (!r.ok) throw new Error(`스튜디오 에이전트 응답 오류 ${r.status}`);
    return r.json();
  }
  if (msg.op === 'image') {
    const r = await fetch(BASE + msg.path);
    if (!r.ok) throw new Error(`이미지를 받지 못했습니다 ${r.status}`);
    const buf = new Uint8Array(await r.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(bin)}`;
  }
  if (msg.op === 'post') {
    const r = await fetch(BASE + msg.path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg.body ?? {}) });
    return r.ok;
  }
  throw new Error('알 수 없는 요청');
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  call(msg).then((data) => reply({ ok: true, data }), (err) => reply({ ok: false, error: String(err.message || err) }));
  return true;
});