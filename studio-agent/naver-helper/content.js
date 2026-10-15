// 네이버 블로그 글쓰기 화면에서만 동작합니다. 글을 채우기만 하고, '발행'은 절대 누르지 않습니다(대표가 직접).
(() => {
  if (window.__ongyeolHelper) return;
  window.__ongyeolHelper = true;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ask = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => resolve(r ?? { ok: false, error: chrome.runtime.lastError?.message })));

  const titleEl = () => $('.se-documentTitle .se-text-paragraph') || $('.se-title-text .se-text-paragraph');
  const bodyWrap = () => $('.se-components-wrap') || $('.se-content');
  const bodyText = () => $$('.se-component:not(.se-documentTitle) .se-text-paragraph').map((p) => p.textContent).join('\n').trim();
  const imageCount = () => $$('.se-component.se-image, .se-component.se-imageStrip').length;

  // ── 화면 안내(오른쪽 아래) ──
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

  // ── 붙여넣기(사람이 Ctrl+V 할 때와 같은 경로) ──
  function pasteInto(target, { html, text, file }) {
    const dt = new DataTransfer();
    if (html) dt.setData('text/html', html);
    if (text) dt.setData('text/plain', text);
    if (file) dt.items.add(file);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    (document.activeElement && document.activeElement !== document.body ? document.activeElement : target).dispatchEvent(ev);
  }
  function caretToEnd(el) {
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  function lastParagraph() {
    const ps = $$('.se-component:not(.se-documentTitle) .se-text-paragraph');
    return ps[ps.length - 1];
  }
  async function dataUrlToFile(url, name) {
    const blob = await (await fetch(url)).blob();
    return new File([blob], name, { type: 'image/png' });
  }

  async function fill(post) {
    const report = [];
    $('.se-help-panel-close-button')?.click();
    if ($$('.se-popup-alert-confirm, .se-popup-container').some((p) => /작성 중|이어서/.test(p.textContent))) {
      panel("작성 중이던 글을 이어 쓸지 묻는 창이 떠 있어요. 그 창에서 '취소'를 누른 뒤 아래 버튼을 다시 눌러 주세요.", [{ label: '다시 채우기', onClick: () => fill(post) }]);
      return;
    }
    panel(`'${post.title}' 채우는 중… 화면을 누르지 말고 잠시만 기다려 주세요.`);

    // 제목
    const t = titleEl();
    if (t) {
      t.click(); caretToEnd(t);
      document.execCommand('insertText', false, post.title);
      await sleep(300);
      if (!t.textContent.includes(post.title.slice(0, 8))) { pasteInto(t, { text: post.title }); await sleep(300); }
      report.push(`title:${t.textContent.includes(post.title.slice(0, 8)) ? 'ok' : 'fail'}`);
    } else report.push('title:not-found');

    // 본문
    const first = lastParagraph();
    if (!first) { report.push('body:not-found'); return fallback(post, report); }
    first.click(); caretToEnd(first);
    let imgN = 0;
    for (const b of post.blocks) {
      if (b.type === 'img') {
        const r = await ask({ op: 'image', path: `/helper/blog/${post.id}/images/${imgN}.png` });
        imgN++;
        if (!r.ok) { report.push(`img${imgN}:${r.error}`); continue; }
        const before = imageCount();
        pasteInto(bodyWrap(), { file: await dataUrlToFile(r.data, `ongyeol-${imgN}.png`) });
        for (let i = 0; i < 40 && imageCount() === before; i++) await sleep(500); // 업로드 기다림
        report.push(`img${imgN}:${imageCount() > before ? 'ok' : 'timeout'}`);
        await sleep(600);
        const lp = lastParagraph(); if (lp) { lp.click(); caretToEnd(lp); }
      } else {
        pasteInto(bodyWrap(), { html: b.html, text: b.text });
        await sleep(350);
      }
    }
    // 태그: 본문 마지막 줄의 #태그는 네이버가 태그로 등록합니다.
    if (post.tags?.length) { pasteInto(bodyWrap(), { text: post.tags.map((x) => `#${x}`).join(' ') }); await sleep(300); }

    const textOk = bodyText().length >= Math.min(200, post.textLength * 0.5);
    report.push(`body:${textOk ? 'ok' : 'empty'}`, `images:${imageCount()}/${post.imageCount}`);
    if (!textOk) return fallback(post, report);
    await ask({ op: 'post', path: `/helper/blog/${post.id}/filled`, body: { ok: true, report } });
    panel(`다 채웠어요. 내용을 훑어보고 오른쪽 위 <b>발행</b>을 눌러 주세요.${imageCount() < post.imageCount ? '<br>(이미지 일부가 올라가지 않았어요 — 대시보드에서 내려받아 넣을 수 있어요)' : ''}`);
  }

  // 자동 입력이 막혔을 때: 버튼 한 번으로 본문(이미지 포함)을 복사 → 본문 칸에 Ctrl+V
  async function fallback(post, report) {
    await ask({ op: 'post', path: `/helper/blog/${post.id}/filled`, body: { ok: false, report } });
    panel("네이버 편집기가 자동 입력을 막았어요. 아래 버튼을 누른 뒤 본문 칸을 클릭하고 <b>Ctrl+V</b> 하세요.", [{
      label: '본문 복사',
      onClick: async () => {
        let html = '';
        let n = 0;
        for (const b of post.blocks) {
          if (b.type === 'img') { const r = await ask({ op: 'image', path: `/helper/blog/${post.id}/images/${n++}.png` }); if (r.ok) html += `<p><img src="${r.data}"></p>`; } else html += b.html;
        }
        html += `<p>${post.tags.map((x) => `#${x}`).join(' ')}</p>`;
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([post.plain], { type: 'text/plain' }) })]);
        panel('복사했어요. 본문 칸을 클릭하고 Ctrl+V 하세요. 그다음 <b>발행</b>을 누르면 됩니다.');
      },
    }]);
  }

  async function start() {
    // 편집기가 있는 화면(프레임)에서만
    for (let i = 0; i < 80 && !(titleEl() && bodyWrap()); i++) await sleep(500);
    if (!(titleEl() && bodyWrap())) return;
    const r = await ask({ op: 'get', path: '/helper/blog/pending' });
    if (!r.ok) { panel(`스튜디오 에이전트에 연결하지 못했어요. 프로그램이 켜져 있는지 확인해 주세요. (${r.error})`); return; }
    if (r.data?.post) return fill(r.data.post);
    panel('대시보드 블로그 화면에서 <b>발행하러 가기</b>를 누르면 이 창에 글이 자동으로 채워져요.', [{
      label: '다음 글 채우기',
      onClick: async () => { const n = await ask({ op: 'get', path: '/helper/blog/next' }); if (n.ok && n.data?.post) fill(n.data.post); else panel('준비된 글이 없어요.'); },
    }]);
  }
  start();
})();