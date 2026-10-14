(() => {
  const token = location.pathname.split('/').pop();
  const base = `/api/portal/${token}`;
  const KIND = { deposit: '계약금', final: '잔금', extra_revision: '추가 수정', extra: '추가 작업' };
  let state = null;
  let lastCount = -1;

  function designCard(d) {
    return `<div class="card stack">
      <iframe class="design-frame" sandbox="" loading="lazy" title="${esc(d.title)}" src="${base}/designs/${d.id}/raw"></iframe>
      <div><strong>${esc(d.title)}</strong> <span class="badge">${d.round}차</span> <span class="badge" title="생성형 AI로 제작한 시안입니다">AI 생성</span> ${d.approved ? '<span class="badge ok">최종 선택</span>' : ''}</div>
      <p class="muted" style="margin:0">${esc(d.rationale)}</p>
      <div class="row" style="gap:6px">
        <a class="btn small" href="${base}/designs/${d.id}/raw" target="_blank" rel="noopener">크게 보기</a>
        ${state.canDownload ? `<a class="btn small" href="${base}/designs/${d.id}/download">원본 받기</a>` : ''}
        ${!d.approved && !['delivered', 'completed'].includes(state.project.status) ? `<button class="btn small primary" data-approve="${d.id}">이 시안으로 확정</button>` : ''}
      </div>
    </div>`;
  }

  function quoteCard(q) {
    const cur = state.studio.currency;
    return `<div class="card doc">
      <h3>견적서 ${q.status === 'accepted' ? '<span class="badge ok">수락함</span>' : ''}</h3>
      <table>${q.items.map((i) => `<tr><td>${esc(i.name)}${i.description ? `<br><small>${esc(i.description)}</small>` : ''}</td><td>${money(i.price, cur)}</td></tr>`).join('')}
      <tr><td><strong>합계</strong></td><td><strong>${money(q.total, cur)}</strong></td></tr></table>
      <p class="muted" style="margin-top:8px">작업 기간 ${q.timelineDays ?? '-'}일 · 수정 ${q.revisions}회 포함${q.terms ? `<br>${esc(q.terms)}` : ''}</p>
      ${q.status === 'sent' ? `<button class="btn primary" data-accept="${q.id}">견적 수락하기</button>` : ''}
    </div>`;
  }

  function invoiceCard(i) {
    const cur = state.studio.currency;
    const badge = i.status === 'paid' ? '<span class="badge ok">입금 확인</span>' : i.clientNotified ? '<span class="badge warn">확인 중</span>' : '<span class="badge bad">미결제</span>';
    return `<div class="card doc">
      <h3>청구서 · ${KIND[i.kind] ?? i.kind} ${badge}</h3>
      <table><tr><td>${esc(i.description)}</td><td><strong>${money(i.amount, cur)}</strong></td></tr></table>
      <p class="muted" style="margin-top:8px">납부 기한 ${esc(i.dueDate)}</p>
      ${i.status === 'sent' && !i.clientNotified ? `<button class="btn" data-paid="${i.id}">입금했어요</button>` : ''}
    </div>`;
  }

  function bubble(m) {
    const cls = m.from === 'client' ? 'me' : m.from === 'system' ? 'system' : 'them';
    const who = m.from === 'client' ? '나' : m.from === 'system' ? '' : state.studio.studioName;
    const imgs = (m.attachments ?? []).map((a) => `<img class="attach" src="${base}/uploads/${a.file}" alt="${esc(a.name)}">`).join('');
    const refs = (m.designIds?.length ? ` · 시안 ${m.designIds.length}개` : '') + (m.quoteId ? ' · 견적서' : '') + (m.invoiceId ? ' · 청구서' : '');
    return `<div class="bubble ${cls}">${cls !== 'system' ? `<span class="meta">${esc(who)} · ${when(m.at)}${refs}</span>` : ''}${esc(m.text)}${imgs}</div>`;
  }

  function render() {
    document.title = `${state.project.title} — ${state.studio.studioName}`;
    $('#studio').textContent = state.studio.studioName;
    $('#title').textContent = state.project.title;
    $('#status').textContent = state.project.statusLabel;
    $('#ai-notice').textContent = state.studio.aiNotice;
    $('#sim-banner').classList.toggle('hidden', !state.simulation);
    const docs = [...state.quotes.filter((q) => q.status !== 'superseded').map(quoteCard), ...state.invoices.map(invoiceCard)];
    $('#docs').innerHTML = docs.join('');
    $('#designs-wrap').classList.toggle('hidden', !state.designs.length);
    // iframe은 새로 그리면 깜빡이므로 시안 목록이 바뀔 때만 다시 그립니다.
    const sig = JSON.stringify(state.designs) + state.canDownload + state.project.status;
    if ($('#designs').dataset.sig !== sig) {
      $('#designs').dataset.sig = sig;
      $('#designs').innerHTML = state.designs.slice().reverse().map(designCard).join('');
    }
    $('#thread').innerHTML = state.messages.map(bubble).join('') || '<div class="empty">아직 메시지가 없습니다</div>';
    if (state.messages.length !== lastCount) {
      lastCount = state.messages.length;
      window.scrollTo({ top: document.body.scrollHeight });
    }
  }

  async function load() {
    try {
      state = await api(base);
      render();
    } catch (err) {
      $('#title').textContent = err.status === 404 ? '프로젝트를 찾을 수 없습니다' : err.message;
    }
  }

  async function act(url, okMsg) {
    try {
      await api(url, { method: 'POST', body: {} });
      toast(okMsg);
      await load();
    } catch (err) {
      toast(err.message);
    }
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.accept && confirm('이 견적으로 진행할까요?')) act(`${base}/quotes/${t.dataset.accept}/accept`, '견적을 수락했습니다');
    if (t.dataset.approve && confirm('이 시안으로 최종 확정할까요?')) act(`${base}/designs/${t.dataset.approve}/approve`, '최종 시안을 확정했습니다');
    if (t.dataset.paid && confirm('입금을 마치셨나요? 확인 후 진행됩니다.')) act(`${base}/invoices/${t.dataset.paid}/paid`, '알려 주셔서 감사합니다');
  });

  $('#images').addEventListener('change', () => {
    $('#files').textContent = [...$('#images').files].map((f) => f.name).join(', ');
  });

  $('#composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#text').value.trim();
    if (!text && !$('#images').files.length) return;
    $('#send').disabled = true;
    try {
      const images = await readImages($('#images'));
      await api(`${base}/messages`, { method: 'POST', body: { text, images } });
      $('#text').value = '';
      $('#images').value = '';
      $('#files').textContent = '';
      await load();
    } catch (err) {
      toast(err.message);
    } finally {
      $('#send').disabled = false;
    }
  });

  $('#text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#composer').requestSubmit();
  });

  load();
  setInterval(() => { if (!document.hidden) load(); }, 8000);
})();
