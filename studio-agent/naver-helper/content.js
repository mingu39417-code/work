// 네이버 블로그 글쓰기 화면에서만 동작합니다. 네이버 편집기는 스크립트 입력을 막으므로,
// 대표가 버튼으로 복사 → Ctrl+V 두 번(제목 · 본문) → '발행' 하도록 돕습니다. 발행은 절대 대신 누르지 않습니다.
(() => {
  if (window.__ongyeolHelper) return;
  window.__ongyeolHelper = true;

  const $ = (sel, root = document) => root.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ask = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r ?? { ok: false, error: chrome.runtime.lastError?.message })));
  const titleEl = () => $('.se-documentTitle .se-text-paragraph') || $('.se-title-text .se-text-paragraph');
  const bodyWrap = () => $('.se-components-wrap') || $('.se-content');

  let box;
  function panel(html, buttons = []) {
    if (!box) {
      box = document.createElement('div');
      box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:340px;background:#2b211b;color:#fff;font:14px/1.5 sans-serif;padding:14px 16px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.3)';
      document.body.appendChild(box);
    }
    box.innerHTML = `<div style="font-weight:700;margin-bottom:6px">온결 스튜디오 블로그 도우미</div><div>${html}</div>`;
    for (const b of buttons) {
      const el = document.createElement('button');
      el.textContent = b.label;
      el.style.cssText = 'margin:10px 8px 0 0;padding:6px 12px;border:0;border-radius:8px;background:#e9b79a;color:#2b211b;font-weight:700;cursor:pointer';
      el.onclick = b.onClick;
      box.appendChild(el);
    }
  }

  async function bodyHtml(post) {
    let html = '';
    let n = 0;
    for (const b of post.blocks) {
      if (b.type === 'img') { const r = await ask({ op: 'image', path: `/helper/blog/${post.id}/images/${n++}.png` }); if (r.ok) html += `<p><img src="${r.data}"></p>`; } else html += b.html;
    }
    return `${html}<p>${post.tags.map((x) => `#${x}`).join(' ')}</p>`;
  }

  function guide(post) {
    panel(`<b>${post.title}</b><br>① <b>제목 복사</b> → 제목 칸 클릭 → Ctrl+V<br>② <b>본문 복사</b> → 본문 칸 클릭 → Ctrl+V (이미지 포함)<br>③ 확인 후 오른쪽 위 <b>발행</b>`, [
      { label: '제목 복사', onClick: async () => { await navigator.clipboard.writeText(post.title); titleEl()?.scrollIntoView({ block: 'center' }); panel('제목을 복사했어요. 제목 칸을 클릭하고 Ctrl+V 하세요.', [{ label: '다음: 본문 복사', onClick: () => copyBody(post) }]); } },
      { label: '본문 복사', onClick: () => copyBody(post) },
    ]);
  }

  async function copyBody(post) {
    panel('본문을 준비하는 중…');
    const html = await bodyHtml(post);
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([post.plain], { type: 'text/plain' }) })]);
    await ask({ op: 'post', path: `/helper/blog/${post.id}/filled`, body: { ok: true, report: ['copy:ok'] } });
    panel('본문을 복사했어요. 본문 칸을 클릭하고 Ctrl+V 하세요. 이미지가 올라가면 <b>발행</b>을 누르면 끝이에요.', [{ label: '제목 다시 복사', onClick: async () => { await navigator.clipboard.writeText(post.title); panel('제목을 다시 복사했어요.'); } }]);
  }

  async function start() {
    for (let i = 0; i < 80 && !(titleEl() && bodyWrap()); i++) await sleep(500);
    if (!(titleEl() && bodyWrap())) return;
    const r = await ask({ op: 'get', path: '/helper/blog/pending' });
    if (!r.ok) { panel(`스튜디오 에이전트에 연결하지 못했어요. 프로그램이 켜져 있는지 확인해 주세요. (${r.error})`); return; }
    if (r.data?.post) return guide(r.data.post);
    panel('발행 대기 글을 여기서 바로 붙여 넣을 수 있어요.', [{
      label: '다음 글 가져오기',
      onClick: async () => { const n = await ask({ op: 'get', path: '/helper/blog/next' }); if (n.ok && n.data?.post) guide(n.data.post); else panel('준비된 글이 없어요.'); },
    }]);
  }
  start();
})();