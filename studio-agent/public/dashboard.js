// 대표용 대시보드 — 에이전트가 하는 일을 실시간으로 보고, 승인 · 지시 · 직접 개입 · 설정을 합니다.
(() => {
  let META = { statuses: {}, autonomy: {}, models: {} };
  let OV = null;
  let currentView = null;
  let refreshTimer = null;

  const FINAL_STATUS = { queued: '제작 대기', working: '디자이너가 만드는 중', ready: '준비 완료', failed: '실패' };
  const STATUS_TONE = { inquiry: 'warn', quoted: 'accent', accepted: 'accent', in_progress: 'accent', review: 'warn', revision: 'accent', delivered: 'ok', completed: 'ok', lost: '', on_hold: '' };
  const FROM = { client: '고객', agent: '에이전트', owner: '대표(나)', system: '시스템', staff: '직원' };
  const INV_KIND = { deposit: '계약금', final: '잔금', extra_revision: '추가 수정', extra: '추가 작업' };
  const LEAD_STATUS = { new: '신규', needs_info: '정보 부족', contacted: '연락함', replied: '답장 받음', won: '수주', lost: '실패' };
  const cur = () => OV?.currency ?? 'KRW';
  const statusBadge = (s) => `<span class="badge ${STATUS_TONE[s] ?? ''}">${esc(META.statuses[s] ?? s)}</span>`;

  // ── 로그인 ──
  async function boot() {
    const st = await api('/api/auth/status');
    if (st.authed) return start();
    $('#auth').classList.remove('hidden');
    if (st.setup) {
      $('#auth-title').textContent = '처음 설정';
      $('#auth-help').textContent = '대시보드 비밀번호를 정하세요 (8자 이상). 이 비밀번호로 API 키와 고객 정보를 보호합니다.';
      $('#pw').autocomplete = 'new-password';
    }
    $('#auth-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api(st.setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body: { password: $('#pw').value } });
        $('#auth').classList.add('hidden');
        start();
      } catch (err) {
        $('#auth-err').textContent = err.message;
      }
    };
  }

  async function start() {
    $('#app').classList.remove('hidden');
    META = await api('/api/meta');
    // 꺼 둔 기능은 메뉴에서 숨깁니다(인스타그램 · Threads는 설정에서 다시 켤 수 있음)
    $$('[data-nav="social"]').forEach((a) => (a.style.display = META.features?.social ? '' : 'none'));
    $$('[data-nav="blog"]').forEach((a) => (a.style.display = META.features?.blog === false ? 'none' : ''));
    await refreshOverview();
    window.addEventListener('hashchange', route);
    route();
    connectEvents();
    $('#logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); location.reload(); };
    $('#toggle-agent').onclick = async () => {
      await api(OV.agent.paused ? '/api/agent/resume' : '/api/agent/pause', { method: 'POST', body: {} });
      await refreshOverview();
      if (currentView === 'overview') route();
    };
  }

  async function refreshOverview() {
    OV = await api('/api/overview');
    $('#brand').textContent = OV.studioName;
    const dot = $('#agent-dot');
    dot.className = `dot ${!OV.agent.hasApiKey || OV.agent.paused ? 'off' : OV.agent.running ? 'busy' : 'on'}`;
    dot.title = !OV.agent.hasApiKey ? 'API 키 없음' : OV.agent.paused ? '일시정지' : OV.agent.running ? '작업 중' : '대기 중';
    $('#toggle-agent').textContent = OV.agent.paused ? '다시 시작' : '일시정지';
    $('#nav-approvals').textContent = OV.kpi.pendingApprovals || '';
  }

  function connectEvents() {
    const es = new EventSource('/api/events');
    es.addEventListener('activity', (e) => {
      const row = JSON.parse(e.data);
      const feed = $('#live-feed');
      if (feed) feed.insertAdjacentHTML('afterbegin', feedItem(row));
      scheduleRefresh();
    });
    es.addEventListener('change', scheduleRefresh);
    es.onerror = () => setTimeout(() => { if (es.readyState === 2) connectEvents(); }, 5000);
  }

  // 입력 중일 때는 화면을 다시 그리지 않습니다.
  function busyTyping() {
    const a = document.activeElement;
    if (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && $('#view').contains(a)) return true;
    return $$('#view textarea').some((t) => t.value.trim() && !t.dataset.prefilled);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      await refreshOverview();
      if (currentView === 'practiceDetail') return refreshPracticeSide();
      if (['overview', 'approvals', 'projects', 'project', 'sales', 'activity', 'practice', 'accounts', 'org', 'reports', 'finance'].includes(currentView) && !busyTyping()) route(true);
    }, 700);
  }

  // ── 라우팅 ──
  async function route(soft = false) {
    const hash = location.hash.replace(/^#/, '') || '/';
    const [, a, b] = hash.split('/');
    const view = a === 'projects' && b ? 'project' : a === 'practice' && b ? 'practiceDetail' : a || 'overview';
    currentView = view;
    $$('.side a').forEach((x) => x.classList.toggle('on', x.dataset.nav === ({ project: 'projects', practiceDetail: 'practice' }[view] ?? view)));
    const y = window.scrollY;
    try {
      const fn = { overview, approvals, projects, project: () => projectView(b), sales, activity, settings, accounts, social, blog, practice, practiceDetail: () => practiceDetail(b), org, reports, finance }[view];
      if (fn) await fn();
      else $('#view').innerHTML = '<div class="empty">없는 화면입니다</div>';
    } catch (err) {
      if (err.status === 401) return location.reload();
      $('#view').innerHTML = `<div class="card error-text">${esc(err.message)}</div>`;
    }
    if (soft) window.scrollTo({ top: y });
  }

  const feedItem = (a) => `<div class="item k-${esc(a.kind)}"><span class="t">${when(a.createdAt)}</span><span>${a.projectId ? `<a href="#/projects/${a.projectId}">${esc(a.text)}</a>` : esc(a.text)}</span></div>`;

  // ── 개요 ──
  async function overview() {
    const [projects, alerts, approvals, activity, usage] = await Promise.all([
      api('/api/projects'), api('/api/alerts'), api('/api/approvals'), api('/api/activity'), api('/api/usage'),
    ]);
    const k = OV.kpi;
    const pct = k.dailyBudget ? Math.min(100, (k.spentToday / k.dailyBudget) * 100) : 0;
    const pending = approvals.filter((x) => x.status === 'pending');
    const maxDay = Math.max(0.01, ...usage.map((u) => u.cost));
    const setup = [];
    if (!OV.agent.hasApiKey) setup.push('<a href="#/settings">Claude API 키 입력</a>');
    if (!OV.kpi.mailAccount) setup.push('<a href="#/accounts">납품 · 응대용 Gmail 등록</a> (없으면 고객은 포털 링크로만 소통)');
    const settingsData = !OV.agent.hasApiKey ? null : await api('/api/settings');
    if (settingsData && !settingsData.profile.ownerName) setup.push('<a href="#/settings">프로필(이름 · 소개 · 포트폴리오) 작성</a>');

    $('#view').innerHTML = `
      <div class="page-head"><h1>개요</h1>
        <div class="row" style="flex:0 0 auto;gap:8px;align-items:center">
          <span class="muted">${OV.agent.paused ? '⏸ 일시정지됨' : OV.agent.running ? `● 작업 중: ${esc(OV.agent.running.kind)}` : `● 대기 중 · 예약 ${OV.agent.queued}건`}</span>
        </div>
      </div>
      ${setup.length ? `<div class="card alert urgent" style="margin-bottom:16px"><strong>시작하려면</strong><ol style="margin:6px 0 0">${setup.map((s) => `<li>${s}</li>`).join('')}<li>문의 양식 주소 <a href="/" target="_blank">${location.origin}/</a> 를 홈페이지 · SNS · 크몽 프로필에 걸어 두세요</li></ol></div>` : ''}
      <div class="kpis">
        <div class="card kpi"><div class="label">이번 달 입금</div><div class="value">${money(k.revenueMonth, cur())}</div><div class="sub">미수금 ${money(k.outstanding, cur())}</div></div>
        <div class="card kpi"><div class="label">견적 진행 중</div><div class="value">${money(k.pipeline, cur())}</div><div class="sub">수락 대기 견적 합계</div></div>
        <div class="card kpi"><div class="label">진행 프로젝트</div><div class="value">${k.activeProjects}</div><div class="sub">새 문의 ${k.newInquiries}건</div></div>
        <div class="card kpi"><div class="label">승인 대기</div><div class="value">${k.pendingApprovals}</div><div class="sub">알림 ${k.openAlerts}건</div></div>
        <div class="card kpi"><div class="label">오늘 API 비용</div><div class="value">$${k.spentToday.toFixed(2)}</div><div class="sub">한도 $${k.dailyBudget} · 이번 달 $${k.spentMonth.toFixed(2)}</div><div class="meter"><i style="width:${pct}%"></i></div></div>
      </div>
      <div class="grid2">
        <div class="stack">
          ${alerts.length ? `<div class="card"><h2>확인 필요</h2><div class="list">${alerts.map((a) => `
            <div class="item alert ${a.level === 'urgent' ? 'urgent' : ''}" style="padding-left:10px">
              <div class="item-row"><span>${a.projectId ? `<a href="#/projects/${a.projectId}">${esc(a.text)}</a>` : esc(a.text)}</span>
              <button class="btn small" data-dismiss="${a.id}">확인</button></div>
              <small>${when(a.createdAt)}</small></div>`).join('')}</div></div>` : ''}
          ${pending.length ? `<div class="card"><div class="item-row"><h2>승인 대기</h2><a href="#/approvals">전체 보기</a></div><div class="list">${pending.slice(0, 5).map((a) => `
            <a class="item" href="#/approvals"><div class="item-row"><span class="item-title">${esc(META.autonomy[a.category])}</span><small>${when(a.createdAt)}</small></div><small>${esc(a.project ?? a.lead ?? '')} — ${esc(a.summary)}</small></a>`).join('')}</div></div>` : ''}
          <div class="card"><div class="item-row"><h2>최근 프로젝트</h2><a href="#/projects">전체 보기</a></div>
            <div class="list">${projects.slice(0, 8).map((p) => `
              <a class="item" href="#/projects/${p.id}"><div class="item-row"><span class="item-title">${esc(p.title)}</span>${statusBadge(p.status)}</div>
              <small>${p.lastMessage ? `${esc(FROM[p.lastMessage.from])}: ${esc(p.lastMessage.text)} · ${when(p.lastMessage.at)}` : ''}</small></a>`).join('') || '<div class="empty">아직 문의가 없습니다</div>'}</div></div>
          <div class="card"><h2>최근 30일 API 비용</h2>
            <div class="chart" title="일별 비용">${usage.map((u) => `<i style="height:${(u.cost / maxDay) * 100}%" title="${u.day}: $${u.cost.toFixed(2)} (${u.calls}회)"></i>`).join('') || '<span class="muted">기록 없음</span>'}</div></div>
        </div>
        <div class="card"><h2>실시간 활동</h2><div class="list feed" id="live-feed">${activity.slice(0, 60).map(feedItem).join('') || '<div class="empty">아직 활동이 없습니다</div>'}</div></div>
      </div>`;
    $$('[data-dismiss]').forEach((b) => (b.onclick = async () => { await api(`/api/alerts/${b.dataset.dismiss}/dismiss`, { method: 'POST', body: {} }); scheduleRefresh(); }));
  }

  // ── 승인 대기 ──
  function approvalFields(a) {
    const act = a.action;
    if (act.type === 'outreach') {
      return `<div class="field"><label>제목</label><input data-k="subject" value="${esc(act.subject)}"></div>
              <div class="field"><label>본문</label><textarea data-k="body" data-prefilled="1">${esc(act.body)}</textarea></div>`;
    }
    if (act.type === 'social_publish') {
      return `${act.designId ? `<div class="designs"><iframe class="design-frame" sandbox="" loading="lazy" src="/api/designs/${act.designId}/raw"></iframe></div>` : ''}
        <div class="field"><label>Threads 글 (500자 이내 · 고쳐서 승인할 수 있습니다)</label><textarea data-k="threadsText" data-prefilled="1" rows="6">${esc(act.threadsText)}</textarea></div>
        <div class="field"><label>인스타그램 캡션</label><textarea data-k="igCaption" data-prefilled="1" rows="8">${esc(act.igCaption)}</textarea></div>
        <small class="muted">맨 아래 AI 활용 표시는 지워도 자동으로 다시 붙습니다.</small>`;
    }
    if (act.type === 'social_reply') {
      return `<p><strong>@${esc(act.username)}</strong>: ${esc(act.comment)}</p>
        <div class="field"><label>답글 (고쳐서 승인할 수 있습니다)</label><textarea data-k="message" data-prefilled="1">${esc(act.message)}</textarea></div>`;
    }
    let extra = '';
    if (act.type === 'quote') extra = `<table class="table">${act.line_items.map((i) => `<tr><td>${esc(i.name)}</td><td style="text-align:right">${money(i.price, cur())}</td></tr>`).join('')}<tr><td><strong>합계 · ${act.timeline_days}일 · 수정 ${act.revisions_included}회</strong></td><td style="text-align:right"><strong>${money(act.total, cur())}</strong></td></tr></table>`;
    if (act.type === 'invoice') extra = `<p><strong>${INV_KIND[act.kind] ?? act.kind} ${money(act.amount, cur())}</strong> — ${esc(act.description)}</p>`;
    if (act.type === 'share_designs') extra = `<div class="designs">${act.design_ids.map((id) => `<iframe class="design-frame" sandbox="" loading="lazy" src="/api/designs/${id}/raw"></iframe>`).join('')}</div>`;
    return `${extra}<div class="field" style="margin-top:10px"><label>고객에게 보낼 메시지 (고쳐서 승인할 수 있습니다)</label><textarea data-k="message" data-prefilled="1">${esc(act.message)}</textarea></div>`;
  }

  async function approvals() {
    const list = await api('/api/approvals');
    const pending = list.filter((a) => a.status === 'pending');
    const done = list.filter((a) => a.status !== 'pending').slice(0, 30);
    $('#view').innerHTML = `
      <div class="page-head"><h1>승인 대기</h1><a class="btn small" href="#/settings">자율 수준 바꾸기</a></div>
      <p class="muted">설정에서 '승인 후 실행'으로 둔 일은 여기서 확인 후 나갑니다. 반려하면서 의견을 남기면 에이전트가 고쳐서 다시 올립니다.</p>
      <div class="stack">${pending.map((a) => `
        <div class="card approval" data-id="${a.id}">
          <div class="item-row"><h3>${esc(META.autonomy[a.category])} · ${a.projectId ? `<a href="#/projects/${a.projectId}">${esc(a.project)}</a>` : esc(a.lead ?? '')}</h3><small>${when(a.createdAt)}</small></div>
          ${approvalFields(a)}
          <div class="field"><label>반려 의견 (반려할 때만)</label><input data-k="feedback" placeholder="예: 가격을 40만 원으로, 말투를 더 부드럽게"></div>
          <div class="row" style="gap:8px;flex-wrap:nowrap"><button class="btn primary" data-act="approve">승인하고 보내기</button><button class="btn danger" data-act="reject">반려</button></div>
        </div>`).join('') || '<div class="card empty">승인할 항목이 없습니다 🎉</div>'}</div>
      <h2 style="margin-top:28px">처리 내역</h2>
      <div class="card"><div class="list">${done.map((a) => `<div class="item"><div class="item-row"><span>${esc(META.autonomy[a.category])} · ${esc(a.project ?? a.lead ?? '')} — ${esc(a.summary)}</span><span class="badge ${a.status === 'approved' ? 'ok' : 'bad'}">${a.status === 'approved' ? '승인' : a.status === 'rejected' ? '반려' : '실패'}</span></div>${a.feedback ? `<small>의견: ${esc(a.feedback)}</small>` : ''}${a.result ? `<small> ${esc(a.result)}</small>` : ''}</div>`).join('') || '<div class="empty">없음</div>'}</div></div>`;
    $$('.approval').forEach((card) => {
      const val = (k) => card.querySelector(`[data-k="${k}"]`)?.value;
      card.querySelector('[data-act="approve"]').onclick = async (e) => {
        e.target.disabled = true;
        try {
          const r = await api(`/api/approvals/${card.dataset.id}/approve`, { method: 'POST', body: { message: val('message'), subject: val('subject'), body: val('body'), threadsText: val('threadsText'), igCaption: val('igCaption') } });
          toast(r.result);
        } catch (err) { toast(err.message); }
        route();
      };
      card.querySelector('[data-act="reject"]').onclick = async () => {
        await api(`/api/approvals/${card.dataset.id}/reject`, { method: 'POST', body: { feedback: val('feedback') } });
        toast(val('feedback') ? '반려했습니다. 에이전트가 의견대로 다시 작성합니다.' : '반려했습니다.');
        route();
      };
    });
  }

  // ── 프로젝트 목록 ──
  async function projects() {
    const list = await api('/api/projects');
    const filter = sessionStorage.getItem('pfilter') ?? 'active';
    const groups = { active: (p) => !['completed', 'lost'].includes(p.status), all: () => true, done: (p) => ['completed', 'lost'].includes(p.status) };
    const rows = list.filter(groups[filter] ?? groups.active);
    $('#view').innerHTML = `
      <div class="page-head"><h1>프로젝트</h1>
        <div class="row" style="flex:0 0 auto;gap:8px">
          <div class="seg">${[['active', '진행 중'], ['done', '끝남'], ['all', '전체']].map(([k, l]) => `<button data-f="${k}" class="${k === filter ? 'on' : ''}">${l}</button>`).join('')}</div>
          <button class="btn primary small" id="new-project">직접 추가</button>
        </div></div>
      <form class="card hidden stack" id="np" style="margin-bottom:16px">
        <p class="muted">카톡 · 전화 · 크몽 등 다른 곳으로 온 문의를 넣으면 에이전트가 이어서 응대합니다(고객 이메일이 있으면 포털 링크를 보냅니다).</p>
        <div class="row"><div><label>고객 이름</label><input name="name" required></div><div><label>이메일</label><input name="email" type="email"></div><div><label>회사</label><input name="company"></div></div>
        <div><label>문의 내용</label><textarea name="description" required></textarea></div>
        <div><button class="btn primary">추가하고 에이전트에게 맡기기</button></div>
      </form>
      <div class="card table-wrap"><table class="table">
        <thead><tr><th>프로젝트</th><th>고객</th><th>상태</th><th>자동</th><th>최근 대화</th></tr></thead>
        <tbody>${rows.map((p) => `<tr class="click" data-href="#/projects/${p.id}">
          <td><strong>${esc(p.title)}</strong>${p.pendingApprovals ? ` <span class="badge warn">승인 ${p.pendingApprovals}</span>` : ''}${p.unpaid ? ` <span class="badge bad">미수 ${p.unpaid}</span>` : ''}</td>
          <td>${esc(p.client?.name)}<br><small>${esc(p.client?.company ?? '')}</small></td>
          <td>${statusBadge(p.status)}</td>
          <td>${p.autopilot ? '<span class="badge ok">켜짐</span>' : '<span class="badge">꺼짐</span>'}</td>
          <td><small>${p.lastMessage ? `${esc(FROM[p.lastMessage.from])}: ${esc(p.lastMessage.text)}<br>${when(p.lastMessage.at)}` : ''}</small></td></tr>`).join('') || '<tr><td colspan="5" class="empty">프로젝트가 없습니다</td></tr>'}</tbody></table></div>`;
    $$('[data-f]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('pfilter', b.dataset.f); route(); }));
    $$('tr[data-href]').forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href)));
    $('#new-project').onclick = () => $('#np').classList.toggle('hidden');
    $('#np').onsubmit = async (e) => {
      e.preventDefault();
      const r = await api('/api/projects', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      location.hash = `#/projects/${r.id}`;
    };
  }

  // ── 프로젝트 상세 ──
  let STAFF = {};
  function msgBubble(m) {
    const cls = m.internal ? 'internal' : m.from === 'client' ? 'them' : m.from === 'system' ? 'system' : 'me';
    const imgs = (m.attachments ?? []).map((a) => `<a href="/api/uploads/${a.file}" target="_blank"><img class="attach" src="/api/uploads/${a.file}" alt="${esc(a.name)}"></a>`).join('');
    const refs = [m.quoteId && '견적서', m.invoiceId && '청구서', m.designIds?.length && `시안 ${m.designIds.length}개`, m.emailed && '이메일 발송됨'].filter(Boolean).join(' · ');
    const who = m.staffId && STAFF[m.staffId] ? STAFF[m.staffId].label : null;
    const label = m.internal
      ? (m.from === 'owner' ? '대표 지시 · 코칭 (사내)' : `${who ?? '에이전트'} · 사내 채널`)
      : m.from === 'agent' && who ? who : FROM[m.from];
    return `<div class="bubble ${cls}">${cls !== 'system' ? `<span class="meta">${esc(label)} · ${when(m.createdAt)}${refs ? ` · ${refs}` : ''}</span>` : ''}${esc(m.text)}${imgs}</div>`;
  }

  async function projectView(id) {
    const d = await api(`/api/projects/${id}`);
    STAFF = d.staff;
    const p = d.project;
    const mode = sessionStorage.getItem('compose') ?? 'instruct';
    $('#view').innerHTML = `
      <div class="page-head">
        <div><a href="#/projects" class="muted">← 프로젝트</a><h1>${esc(p.title)}</h1>
          <small>${esc(d.client.name)}${d.client.company ? ` · ${esc(d.client.company)}` : ''} · ${esc(d.client.email || '이메일 없음')} · 비용 $${d.usage.toFixed(2)}</small></div>
        <div class="row" style="flex:0 0 auto;gap:8px;align-items:center">
          <label class="switch"><input type="checkbox" id="autopilot" ${p.autopilot ? 'checked' : ''}> 자동 응대</label>
          <select id="status" style="width:auto">${Object.entries(META.statuses).map(([k, v]) => `<option value="${k}" ${k === p.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <button class="btn small" id="copy-portal">고객 포털 링크 복사</button>
          <a class="btn small" href="${esc(d.portalUrl)}" target="_blank" rel="noopener">포털 보기</a>
        </div>
      </div>
      <div class="grid-detail">
        <div class="stack">
          <div class="card"><div class="thread-box"><div class="thread">${d.messages.map(msgBubble).join('') || '<div class="empty">메시지 없음</div>'}</div></div></div>
          <form class="card stack" id="compose">
            <div class="seg"><button type="button" data-m="instruct" class="${mode === 'instruct' ? 'on' : ''}">에이전트에게 지시</button><button type="button" data-m="message" class="${mode === 'message' ? 'on' : ''}">고객에게 직접 보내기</button></div>
            <textarea id="compose-text" placeholder="${mode === 'instruct' ? '예: 이 고객은 단골이니 10% 할인해서 다시 견적 보내 줘 / 다음 시안은 더 미니멀하게' : '고객에게 보낼 메시지 (스튜디오 이름으로 나갑니다)'}"></textarea>
            <div><button class="btn primary">${mode === 'instruct' ? '지시하기' : '보내기'}</button></div>
          </form>
        </div>
        <div class="stack">
          <div class="card"><h3>담당 · 일정</h3>
            <small>디자이너: ${p.designerId && d.staff[p.designerId] ? esc(d.staff[p.designerId].name) : '킥오프 때 배정'} · 계약서: ${d.contract ? (d.contract.status === 'signed' ? `서명 완료 (${esc(d.contract.signerName)}, ${d.contract.signedAt.slice(0, 10)})` : '서명 대기') : '없음'}</small>
            <small>포트폴리오 · SNS 게시: ${p.portfolioConsent ? (p.portfolioNamed ? '동의 (업체명 표시 가능)' : '동의 (업체명 비공개)') : '동의 없음'}${p.consentBy === 'owner' ? ` — 대표 기록${p.consentNote ? `: ${esc(p.consentNote)}` : ''}` : ''} <button class="btn small" id="consent-edit">동의 기록</button></small>
            ${d.contract ? `<details style="margin-top:4px"><summary>계약서 보기</summary><div class="pre" style="max-height:260px;overflow:auto;font-size:0.85rem">${esc(d.contract.body)}</div></details>` : ''}
            <div class="list" style="margin-top:6px">${(p.plan?.milestones ?? []).map((m) => `<div class="item"><div class="item-row"><span>${m.done ? '✅' : m.due < new Date().toISOString().slice(0, 10) ? '⚠️' : '⬜'} ${esc(m.title)}</span><small>${esc(m.due)} · ${esc(m.owner)}</small></div></div>`).join('') || '<span class="muted">킥오프 전</span>'}</div></div>
          <div class="card"><h3>브리프</h3><p class="pre">${esc(p.brief || '아직 정리되지 않았습니다.')}</p>
            <small>예산 ${esc(p.budget || '-')} · 일정 ${esc(p.deadline || '-')} · 시안 ${p.designRounds}차 진행 (추가 수정 허용 ${p.extraRounds}회)</small>
            <div style="margin-top:6px"><button class="btn small" id="extra-round">추가 수정 1회 허용</button></div></div>
          ${d.approvals.filter((a) => a.status === 'pending').length ? `<div class="card alert"><strong>승인 대기 ${d.approvals.filter((a) => a.status === 'pending').length}건</strong> — <a href="#/approvals">확인하기</a></div>` : ''}
          <div class="card"><h3>시안</h3><div class="designs">${d.designs.slice().reverse().map((x) => `
            <div class="stack"><iframe class="design-frame" sandbox="" loading="lazy" title="${esc(x.title)}" src="/api/designs/${x.id}/raw"></iframe>
            <div><strong>${esc(x.title)}</strong> <span class="badge">${x.round}차</span> ${x.shared ? '<span class="badge accent">공유됨</span>' : '<span class="badge">미공유</span>'} ${x.approved ? '<span class="badge ok">확정</span>' : ''}</div>
            ${x.review ? `<small>검토 ${x.review.score}/10${x.review.revised ? ' (수정 반영)' : ''} — ${esc(x.review.summary)}</small>` : ''}
            <div class="row" style="gap:6px"><a class="btn small" href="/api/designs/${x.id}/raw" target="_blank">크게</a><a class="btn small" href="/api/designs/${x.id}/download">${x.approved && x.finalStatus === 'ready' ? '납품 ZIP 받기' : '받기'}</a>${x.approved ? `<button class="btn small" data-final="${x.id}">납품 파일 다시 만들기</button>` : ''}</div>${x.approved ? `<small class="muted">납품 파일: ${FINAL_STATUS[x.finalStatus] ?? '없음'}${x.finalStatus === 'ready' ? ` — ${(x.finalFiles ?? []).map((f) => esc(f.purpose)).join(', ')}` : ''}${x.finalStatus === 'failed' ? ` — ${esc(x.finalError ?? '')}` : ''}</small>` : ''}</div>`).join('') || '<span class="muted">아직 없음</span>'}</div></div>
          <div class="card"><h3>견적</h3>${d.quotes.map((q) => `<div class="item-row"><span>${money(q.total, cur())} · ${q.timelineDays}일 · 수정 ${q.revisions}회</span><span class="badge ${q.status === 'accepted' ? 'ok' : ''}">${{ sent: '발송', accepted: '수락', superseded: '대체됨' }[q.status] ?? q.status}</span></div>`).join('') || '<span class="muted">없음</span>'}</div>
          <div class="card"><h3>청구 · 입금</h3>${d.invoices.map((i) => `<div class="item-row" style="margin-bottom:6px"><span>${INV_KIND[i.kind] ?? i.kind} ${money(i.amount, cur())}<br><small>기한 ${i.dueDate}${i.clientNotified ? ' · 고객이 입금 알림' : ''}</small></span>
              ${i.status === 'sent' ? `<span class="row" style="gap:4px;flex:0 0 auto"><button class="btn small primary" data-paid="${i.id}">입금 확인</button><button class="btn small danger" data-cancel="${i.id}">취소</button></span>` : `<span class="badge ${i.status === 'paid' ? 'ok' : ''}">${i.status === 'paid' ? '입금 완료' : '취소'}</span>`}</div>`).join('') || '<span class="muted">없음</span>'}</div>
          <div class="card"><h3>작업</h3><div class="list">${d.jobs.slice().reverse().slice(0, 8).map((j) => `<div class="item"><div class="item-row"><span>${esc(j.kind)} ${(j.payload.events ?? []).map((e) => e.kind).join(', ')}</span><span class="badge ${j.status === 'failed' ? 'bad' : j.status === 'done' ? 'ok' : ''}">${esc(j.status)}</span></div>${j.status === 'queued' ? `<small>예정 ${when(j.runAt)}</small>` : ''}${j.error ? `<small class="error-text">${esc(j.error)}</small>` : ''}</div>`).join('') || '<span class="muted">없음</span>'}</div></div>
        </div>
      </div>`;
    const tb = $('.thread-box');
    tb.scrollTop = tb.scrollHeight;
    const patch = (body) => api(`/api/projects/${id}`, { method: 'PATCH', body });
    $('#autopilot').onchange = async (e) => { await patch({ autopilot: e.target.checked }); toast(e.target.checked ? '에이전트가 다시 응대합니다' : '자동 응대를 껐습니다. 직접 응대하세요.'); };
    $('#status').onchange = async (e) => { await patch({ status: e.target.value }); toast('상태를 바꿨습니다'); };
    $('#consent-edit').onclick = async () => {
      const choice = prompt('고객에게 따로(메일 · 서면) 받은 포트폴리오 게시 동의를 기록합니다.\n1 = 동의(업체명 비공개)\n2 = 동의(업체명 표시 가능)\n0 = 동의 없음', p.portfolioConsent ? (p.portfolioNamed ? '2' : '1') : '0');
      if (choice === null || !['0', '1', '2'].includes(choice.trim())) return;
      const note = choice.trim() === '0' ? '' : (prompt('어떻게 받은 동의인가요? (예: 10/20 메일로 동의)') ?? '');
      await api(`/api/projects/${p.id}/consent`, { method: 'POST', body: { portfolio: choice.trim() !== '0', named: choice.trim() === '2', note } });
      toast('기록했습니다'); route();
    };
    $('#extra-round').onclick = async () => { await patch({ extraRounds: p.extraRounds + 1 }); toast('추가 수정 1회를 허용했습니다'); route(); };
    $('#copy-portal').onclick = async () => { await navigator.clipboard.writeText(d.portalUrl); toast('복사했습니다'); };
    $$('[data-m]').forEach((b) => (b.onclick = () => { sessionStorage.setItem('compose', b.dataset.m); route(); }));
    $('#compose').onsubmit = async (e) => {
      e.preventDefault();
      const text = $('#compose-text').value.trim();
      if (!text) return;
      await api(`/api/projects/${id}/${mode === 'instruct' ? 'instruct' : 'message'}`, { method: 'POST', body: { text } });
      $('#compose-text').value = '';
      toast(mode === 'instruct' ? '지시를 전달했습니다. 곧 에이전트가 처리합니다.' : '보냈습니다');
      route();
    };
    $$('[data-paid]').forEach((b) => (b.onclick = async () => { if (!confirm('입금을 확인했나요? 에이전트가 다음 단계를 진행합니다.')) return; await api(`/api/invoices/${b.dataset.paid}/paid`, { method: 'POST', body: {} }); route(); }));
    $$('[data-final]').forEach((b) => (b.onclick = async () => { if (!confirm('확정 시안으로 납품 파일(SVG · PNG)을 다시 만들까요? API 비용이 듭니다.')) return; try { await api(`/api/designs/${b.dataset.final}/final-files`, { method: 'POST', body: {} }); toast('납품 파일을 다시 만들기 시작했습니다'); route(); } catch (err) { toast(err.message); } }));
    $$('[data-cancel]').forEach((b) => (b.onclick = async () => { if (!confirm('이 청구서를 취소할까요?')) return; await api(`/api/invoices/${b.dataset.cancel}/cancel`, { method: 'POST', body: {} }); route(); }));
  }

  // ── 영업 ──
  async function sales() {
    const leads = await api('/api/leads');
    $('#view').innerHTML = `
      <div class="page-head"><h1>영업</h1></div>
      <div class="card alert" style="margin-bottom:12px"><strong>법적으로 보낼 수 있는 사람에게만 보냅니다</strong> (정보통신망법 제50조)<br>
      <small>광고성 메일은 ① 수신에 동의한 사람(문의 양식의 '제안 메일 수신 동의' 포함) 또는 ② 최근 6개월 안에 거래(납품)한 고객에게만 보낼 수 있습니다.
      처음 보는 가게 · 회사에 동의 없이 보내는 메일, SNS DM은 불법이라 이 시스템은 보내지 않습니다. 보낼 때는 제목 (광고) 표시, 보낸 사람 · 연락처, 수신거부 링크, AI 사용 고지가 자동으로 붙고, 수신거부한 주소는 영구히 막힙니다.</small></div>
      <form class="card stack" id="lead-form">
        <div class="row"><div><label>회사 · 브랜드</label><input name="company"></div><div><label>담당자</label><input name="name"></div><div><label>이메일</label><input name="email" type="email"></div></div>
        <div><label>웹사이트 · 인스타그램</label><input name="website" placeholder="https://"></div>
        <div class="row"><div><label>연락 근거 (필수)</label><select name="basis"><option value="">선택하세요</option>${Object.entries(META.outreachBasis).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          <div style="flex:2 1 280px"><label>동의 근거 (언제 · 어떻게 동의받았는지)</label><input name="basisNote" placeholder="예: 2026-10-01 행사 부스에서 명함 교환 시 서면 동의"></div></div>
        <div><label>메모 (무엇을 하는 곳인지, 어떤 제안이 도움이 될지 — 구체적일수록 좋은 메시지가 나옵니다)</label><textarea name="notes"></textarea></div>
        <div class="row" style="align-items:center"><label class="switch"><input type="checkbox" name="autoOutreach" checked> 추가하자마자 제안 메시지 작성</label><div style="flex:0 0 auto"><button class="btn primary">리드 추가</button></div></div>
      </form>
      <div class="stack" style="margin-top:16px">${leads.map((l) => `
        <div class="card" data-lead="${l.id}">
          <div class="item-row"><h3>${esc(l.company || l.name)} ${l.company && l.name ? `<small>· ${esc(l.name)}</small>` : ''}</h3>
            <select data-status style="width:auto">${Object.entries(LEAD_STATUS).map(([k, v]) => `<option value="${k}" ${k === l.status ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <small>${esc(l.email || '이메일 없음')} ${l.website ? `· <a href="${esc(l.website)}" target="_blank" rel="noopener">${esc(l.website)}</a>` : ''}</small>
          ${l.notes ? `<p class="pre" style="margin-top:6px">${esc(l.notes)}</p>` : ''}
          ${l.lastOutreach ? `<details style="margin-top:6px"><summary>${l.lastOutreach.emailed ? '보낸 메시지' : '보낼 메시지 (직접 복사해서 보내세요)'} · ${when(l.lastOutreach.at)}</summary><p><strong>${esc(l.lastOutreach.subject)}</strong></p><p class="pre">${esc(l.lastOutreach.body)}</p><button class="btn small" data-copy>복사</button></details>` : ''}
          <div><small>근거: ${esc(META.outreachBasis[l.basis] ?? '없음')}${l.basisNote ? ` — ${esc(l.basisNote)}` : ''}</small> ${l.optOut ? '<span class="badge bad">수신거부</span>' : l.blocked ? `<span class="badge warn" title="${esc(l.blocked)}">발송 불가</span>` : '<span class="badge ok">발송 가능</span>'}</div>
          ${l.blocked && !l.optOut ? `<small class="error-text">${esc(l.blocked)}</small>` : ''}
          ${(l.agentNotes ?? []).length ? `<small>에이전트 메모: ${esc(l.agentNotes.at(-1).text)}</small>` : ''}
          <div class="row" style="margin-top:8px;align-items:center"><input data-instr placeholder="(선택) 지시: 예) 리뉴얼 오픈 축하로 시작해 줘"><div style="flex:0 0 auto"><button class="btn small" data-outreach ${l.blocked ? 'disabled' : ''}>제안 메시지 ${l.lastOutreach ? '다시 ' : ''}작성</button></div></div>
        </div>`).join('') || '<div class="card empty">리드가 없습니다</div>'}</div>`;
    $('#lead-form').onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      body.autoOutreach = Boolean(body.autoOutreach);
      try { await api('/api/leads', { method: 'POST', body }); toast('추가했습니다'); e.target.reset(); route(); } catch (err) { toast(err.message); }
    };
    $$('[data-lead]').forEach((card) => {
      const id = card.dataset.lead;
      card.querySelector('[data-status]').onchange = (e) => api(`/api/leads/${id}`, { method: 'PATCH', body: { status: e.target.value } });
      card.querySelector('[data-outreach]').onclick = async () => { await api(`/api/leads/${id}/outreach`, { method: 'POST', body: { instruction: card.querySelector('[data-instr]').value } }); toast('작성을 맡겼습니다'); };
      const copy = card.querySelector('[data-copy]');
      if (copy) copy.onclick = () => { const det = copy.closest('details'); navigator.clipboard.writeText(`${det.querySelector('strong').textContent}\n\n${det.querySelector('.pre').textContent}`); toast('복사했습니다'); };
    });
  }

  // ── 활동 기록 ──
  async function activity() {
    const [rows, jobs] = await Promise.all([api('/api/activity'), api('/api/jobs')]);
    $('#view').innerHTML = `
      <div class="page-head"><h1>활동 기록</h1></div>
      <div class="grid2">
        <div class="card"><h2>활동</h2><div class="list feed" id="live-feed">${rows.map(feedItem).join('') || '<div class="empty">없음</div>'}</div></div>
        <div class="card"><h2>작업 대기열</h2><div class="list">${jobs.map((j) => `
          <div class="item"><div class="item-row"><span>${esc(j.kind)} ${(j.payload.events ?? []).map((e) => esc(e.kind)).join(', ')} ${j.payload.projectId ? `<a href="#/projects/${j.payload.projectId}">보기</a>` : ''}</span>
          <span class="badge ${j.status === 'failed' ? 'bad' : j.status === 'done' ? 'ok' : j.status === 'running' ? 'accent' : ''}">${esc(j.status)}</span></div>
          <small>${j.status === 'queued' ? `예정 ${when(j.runAt)}` : when(j.updatedAt)}${j.attempts ? ` · 시도 ${j.attempts}` : ''}</small>
          ${j.error ? `<div class="error-text">${esc(j.error)}</div>` : ''}
          ${['failed', 'cancelled'].includes(j.status) ? `<button class="btn small" data-retry="${j.id}">다시 시도</button>` : ''}
          ${j.status === 'queued' ? `<button class="btn small" data-cancel="${j.id}">취소</button>` : ''}</div>`).join('') || '<div class="empty">없음</div>'}</div></div>
      </div>`;
    $$('[data-retry]').forEach((b) => (b.onclick = async () => { await api(`/api/jobs/${b.dataset.retry}/retry`, { method: 'POST', body: {} }); route(); }));
    $$('[data-cancel]').forEach((b) => (b.onclick = async () => { await api(`/api/jobs/${b.dataset.cancel}/cancel`, { method: 'POST', body: {} }); route(); }));
  }

  // ── 설정 ──
  async function settings() {
    const s = await api('/api/settings');
    const f = (label, name, value, attrs = '') => `<div class="field"><label>${label}</label><input name="${name}" value="${esc(value)}" ${attrs}></div>`;
    const ta = (label, name, value, ph = '') => `<div class="field"><label>${label}</label><textarea name="${name}" placeholder="${esc(ph)}">${esc(value)}</textarea></div>`;
    const sel = (label, name, value, opts) => `<div class="field"><label>${label}</label><select name="${name}">${Object.entries(opts).map(([k, v]) => `<option value="${k}" ${String(k) === String(value) ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`;
    const efforts = { low: 'low (빠름 · 저렴)', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max (최고 품질 · 비쌈)' };
    $('#view').innerHTML = `
      <div class="page-head"><h1>설정</h1><button class="btn primary" id="save">저장</button></div>
      <form id="sf" class="stack">
        <div class="card"><h2>Claude API</h2>
          <div class="row"><div class="field" style="flex:3 1 280px"><label>API 키 (console.anthropic.com → API Keys)</label><input name="apiKey" value="${esc(s.apiKey)}" placeholder="sk-ant-..." autocomplete="off"></div>
          <div class="field" style="flex:0 0 auto;align-self:flex-end"><button type="button" class="btn" id="test-key">연결 확인</button></div></div>
          <div class="row">${sel('모델', 'model', s.model, META.models)}${sel('응대 · 영업 생각 깊이', 'agentEffort', s.agentEffort, efforts)}${sel('디자인 생각 깊이', 'designEffort', s.designEffort, efforts)}</div>
          <div class="row">${f('하루 API 예산 (USD, 넘으면 자동 정지)', 'dailyBudgetUsd', s.dailyBudgetUsd, 'type="number" min="0" step="1"')}<div class="field"><label>&nbsp;</label><label class="switch"><input type="checkbox" name="design.selfReview" ${s.design.selfReview ? 'checked' : ''}> 시안마다 아트디렉터 자체 검토 (품질↑, 비용↑)</label></div></div>
          <small class="muted">키는 이 컴퓨터의 data/db.json 에만 저장됩니다(저장소에 올라가지 않음). 거절된 요청은 Anthropic의 대체 모델이 자동으로 이어받습니다.</small>
        </div>

        <div class="card"><h2>프로필 — 에이전트가 '나'로서 일할 때 쓰는 정보</h2>
          <div class="row">${f('이름', 'profile.ownerName', s.profile.ownerName)}${f('스튜디오 이름', 'profile.studioName', s.profile.studioName)}${f('직함', 'profile.title', s.profile.title)}</div>
          <div class="row">${f('알림 받을 이메일', 'profile.ownerEmail', s.profile.ownerEmail, 'type="email"')}${f('작업 시간', 'profile.workingHours', s.profile.workingHours)}${f('사용 언어', 'profile.languages', s.profile.languages)}</div>
          ${ta('소개', 'profile.bio', s.profile.bio, '경력, 강점, 작업 철학 — 사실만 적으세요. 에이전트는 여기 없는 경력을 지어내지 않습니다.')}
          ${f('전문 분야', 'profile.specialties', s.profile.specialties)}
          ${ta('포트폴리오 · 링크', 'profile.portfolio', s.profile.portfolio, '비핸스, 인스타그램, 홈페이지, 대표 작업 설명')}
          ${ta('말투', 'profile.tone', s.profile.tone)}
          ${f('서명 (선택)', 'profile.signature', s.profile.signature)}
        </div>

        <div class="card"><h2>서비스 · 가격표</h2>
          <p class="muted">최저가 아래로는 견적이 나가지 않습니다(코드로 막혀 있음). 더 깎아 달라는 요청은 '확인 필요'로 올라옵니다.</p>
          <div class="table-wrap"><table class="table services"><thead><tr><th>id</th><th>이름</th><th>설명</th><th>정가</th><th>최저가</th><th>기간(일)</th><th>수정</th><th></th></tr></thead>
          <tbody id="svc">${s.services.map(svcRow).join('')}</tbody></table></div>
          <button type="button" class="btn small" id="add-svc">서비스 추가</button>
        </div>

        <div class="card"><h2>정책</h2>
          <div class="row">${f('통화', 'policy.currency', s.policy.currency)}${f('계약금 %', 'policy.depositPercent', s.policy.depositPercent, 'type="number"')}${f('급행 추가 %', 'policy.rushFeePercent', s.policy.rushFeePercent, 'type="number"')}${f('추가 수정 1회 가격', 'policy.extraRevisionPrice', s.policy.extraRevisionPrice, 'type="number"')}${f('1차 시안 개수', 'policy.conceptsPerRound', s.policy.conceptsPerRound, 'type="number" min="1" max="3"')}</div>
          <label class="switch"><input type="checkbox" name="policy.requireDeposit" ${s.policy.requireDeposit ? 'checked' : ''}> 계약금 입금 확인 후에만 디자인 작업 시작</label>
          ${ta('입금 안내 (청구서에 자동 첨부)', 'policy.paymentInfo', s.policy.paymentInfo, '예: 국민은행 000-00-0000 홍길동 / 세금계산서 발행 가능')}
          ${ta('에이전트에게 주는 추가 지침', 'policy.extraInstructions', s.policy.extraInstructions, '예: 주말 문의는 월요일 오전에 답한다고 안내 / 경쟁사 비방 금지 / 수정은 영업일 2일 안에')}
        </div>

        <div class="card"><h2>회사 운영</h2>
          <div class="row">${f('데일리 스탠드업 보고 시각 (KST, 시)', 'company.standupHour', s.company.standupHour, 'type="number" min="0" max="23"')}${f('연체 독촉 간격 (일)', 'company.overdueReminderDays', s.company.overdueReminderDays, 'type="number" min="1"')}${f('AD 반려 후 재작업 최대 횟수', 'design.maxReworks', s.design.maxReworks, 'type="number" min="0" max="5"')}<div class="field"><label>&nbsp;</label><label class="switch"><input type="checkbox" name="design.copywriting" ${s.design.copywriting !== false ? 'checked' : ''}> 카피라이터가 시안 문구 먼저 작성</label></div></div>
          <label class="switch"><input type="checkbox" name="company.requireContract" ${s.company.requireContract ? 'checked' : ''}> 견적 수락 후 용역 계약서 서명을 받은 뒤에만 청구 · 작업</label>
          <div class="field" style="margin-top:10px"><label>계약서 양식 — {{project}} {{scope}} {{total}} {{deposit}} {{balance}} {{days}} {{revisions}} {{extraRevisionPrice}} {{client}} {{studio}} {{owner}} {{businessInfo}} {{date}} 자리에 견적 내용이 들어갑니다. 실제 사용 전 전문가 검토를 권합니다.</label>
          <textarea name="company.contractTemplate" style="min-height:260px;font-size:0.85rem">${esc(s.company.contractTemplate)}</textarea></div>
        </div>

        <div class="card"><h2>자율 수준</h2>
          <p class="muted">'자동'은 에이전트가 바로 실행, '승인 후'는 승인 대기에 올라와 내가 확인하면 나갑니다.</p>
          ${Object.entries(META.autonomy).map(([k, v]) => `<div class="item-row" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${v}</span>
            <div class="seg" data-auto="${k}"><button type="button" data-v="auto" class="${s.autonomy[k] === 'auto' ? 'on' : ''}">자동</button><button type="button" data-v="approve" class="${s.autonomy[k] !== 'auto' ? 'on' : ''}">승인 후</button></div></div>`).join('')}
        </div>

        <div class="card"><h2>법적 고지 정보</h2>
          <p class="muted">광고 메일 하단 · 개인정보 처리 안내(<a href="/privacy" target="_blank">/privacy</a>)에 자동으로 들어갑니다. 고객 응대 · 메일에는 생성형 AI 사용 고지가 항상 붙습니다(끌 수 없음).</p>
          ${f('사업자 정보 (상호 · 대표자 · 사업자등록번호 · 주소, 있으면)', 'policy.businessInfo', s.policy.businessInfo, 'placeholder="예: TONECRAFT · 임민규 · 123-45-67890 · 서울시 …"')}
          ${f('개인정보 보유 기간', 'policy.retention', s.policy.retention)}
          ${f('하루 영업 메일 최대 발송 수', 'policy.outreachDailyLimit', s.policy.outreachDailyLimit, 'type="number" min="1" max="100"')}
        </div>

        <div class="card"><h2>연결</h2>
          ${f('공개 주소 (고객에게 보내는 링크의 앞부분)', 'publicUrl', s.publicUrl)}
          <p class="muted">다른 채널(메일 전달, 카카오 채널 챗봇, Zapier/Make 등)에서 받은 메시지를 아래처럼 보내면 에이전트가 응대합니다.</p>
          <pre class="card mono pre" style="background:var(--surface-2)">curl -X POST ${esc(s.publicUrl)}/api/inbound \\
  -H "Content-Type: application/json" \\
  -H "x-inbound-token: ${esc(s.inboundToken)}" \\
  -d '{"email":"client@example.com","name":"고객","text":"로고 문의드립니다"}'</pre>
        </div>
      </form>

      <form class="card stack" id="pwf" style="margin-top:12px"><h2>대시보드 비밀번호 변경</h2>
        <div class="row"><div><label>현재 비밀번호</label><input type="password" name="current" autocomplete="current-password"></div><div><label>새 비밀번호</label><input type="password" name="next" autocomplete="new-password"></div></div>
        <div><button class="btn">변경</button></div></form>`;

    const autonomy = { ...s.autonomy };
    $$('[data-auto]').forEach((seg) => seg.querySelectorAll('button').forEach((b) => (b.onclick = () => {
      autonomy[seg.dataset.auto] = b.dataset.v;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    })));
    $('#add-svc').onclick = () => $('#svc').insertAdjacentHTML('beforeend', svcRow({ id: '', name: '', description: '', basePrice: 0, minPrice: 0, days: 5, revisions: 2 }));
    $('#svc').onclick = (e) => { if (e.target.dataset.del !== undefined) e.target.closest('tr').remove(); };
    $('#test-key').onclick = async () => {
      const r = await api('/api/settings/test-key', { method: 'POST', body: { apiKey: $('[name="apiKey"]').value } });
      toast(r.ok ? `연결 성공 — ${r.model}` : `연결 실패: ${r.error}`);
    };
    $('#save').onclick = async () => {
      const body = { autonomy };
      for (const el of $$('#sf [name]')) {
        const path = el.name.split('.');
        let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
        let o = body;
        while (path.length > 1) { const k = path.shift(); o = o[k] ??= {}; }
        o[path[0]] = v;
      }
      body.services = $$('#svc tr').map((tr) => Object.fromEntries($$('input', tr).map((i) => [i.dataset.k, i.type === 'number' ? Number(i.value) : i.value]))).filter((x) => x.name);
      try {
        await api('/api/settings', { method: 'PUT', body });
        toast('저장했습니다');
        await refreshOverview();
        route();
      } catch (err) { toast(err.message); }
    };
    $('#pwf').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/api/settings/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('비밀번호를 바꿨습니다'); e.target.reset(); } catch (err) { toast(err.message); }
    };
  }

  // ── 네이버 블로그 ──
  async function blog() {
    const d = await api('/api/blog');
    const s = d.settings ?? {};
    const ST = { ready: ['accent', '발행 대기'], filled: ['warn', '글쓰기 창에 채움 · 발행 확인 중'], published: ['ok', '발행됨'], archived: ['', '보관'] };
    const ready = d.posts.filter((x) => x.status === 'ready' || x.status === 'filled');
    const preview = (x) => {
      let n = 0;
      return x.blocks.map((b) => b.type === 'img' ? `<img src="/api/blog/${x.id}/images/${n++}.png" style="max-width:100%;border-radius:8px;margin:6px 0">` : b.type === 'h' ? `<h4 style="margin:12px 0 4px">${esc(b.text)}</h4>` : `<p class="pre" style="margin:4px 0">${esc(b.text)}</p>`).join('') + `<p class="muted">${x.tags.map((t) => '#' + esc(t)).join(' ')}</p>`;
    };
    $('#view').innerHTML = `
      <div class="page-head"><h1>네이버 블로그</h1><button class="btn small" id="bl-more">글 하나 더 쓰기</button></div>
      <p class="muted">글은 카피라이터가 전부 씁니다(제목 · 본문 · 표지 이미지 · 태그). <b>WordPress.com</b>은 정한 일정대로 발행까지 완전 자동입니다. <b>네이버</b>는 글쓰기 API가 없어, <b>네이버에 발행하러 가기</b> → 도우미의 '제목 복사 · 본문 복사'로 Ctrl+V 두 번 → <b>발행</b>(20초). 네이버에 발행하면 20분 안에 자동으로 '발행됨'으로 바뀝니다.</p>
      <div class="card stack" style="margin-bottom:16px">
        <div class="item-row"><h2>완전 자동 블로그 (WordPress.com)</h2><span class="badge ${d.wp.connected ? (d.wp.status === 'expired' ? 'bad' : 'ok') : ''}">${d.wp.connected ? (d.wp.status === 'expired' ? '연결 끊김' : '자동 발행 중') : '연결 전'}</span></div>
        <p class="muted" style="margin:0">공식 API로 글 · 이미지 · 태그를 올리고 발행까지 사람 손 없이 합니다. ${d.wp.connected ? `연결된 블로그: <a href="${esc(d.wp.siteUrl)}" target="_blank" rel="noopener">${esc(d.wp.siteUrl)}</a>` : ''}</p>
        ${d.wp.lastError ? `<p class="error-text">${esc(d.wp.lastError)}</p>` : ''}
        <details ${d.wp.connected ? '' : 'open'}><summary><strong>처음 한 번만: 계정 · 앱 만들기 (10분)</strong> — 계정은 대표님이 직접 만드셔야 합니다</summary>
          <ol style="line-height:1.9">
            <li><a href="https://wordpress.com/start" target="_blank" rel="noopener">wordpress.com/start</a>에서 무료 계정과 사이트를 만듭니다(예: 주소 <code>ongyeol</code>). 유료 요금제는 필요 없습니다.</li>
            <li><a href="https://developer.wordpress.com/apps/new/" target="_blank" rel="noopener">developer.wordpress.com/apps/new</a>에서 앱을 만듭니다. 칸마다 아래 값을 붙여 넣으세요.
              <div class="stack" style="gap:4px;margin:6px 0">
                ${[['Name', '온결 스튜디오 자동 발행'], ['Description', '온결 스튜디오 블로그 글 자동 발행'], ['Website URL', 'http://localhost:4300'], ['Redirect URLs', d.wp.redirectUri], ['Type', 'Web']].map(([k, v]) => `<div class="row" style="gap:6px;align-items:center;flex-wrap:nowrap"><small style="width:110px;flex:0 0 auto">${k}</small><code class="mono" style="flex:1">${esc(v)}</code><button class="btn small" style="flex:0 0 auto" data-copy="${esc(v)}">복사</button></div>`).join('')}
              </div>
              'Javascript Origins'는 비워 두고, 사람 확인 문제가 나오면 풀고 <b>Create</b>.</li>
            <li>만든 앱 화면의 <b>Client ID</b>(숫자)와 <b>Client Secret</b>을 아래에 붙여 넣고 저장:
              <div class="row" style="align-items:flex-end;margin-top:6px"><div><label>Client ID</label><input id="wp-cid" value="${esc(d.wp.clientId ?? '')}" placeholder="12345"></div><div><label>Client Secret ${d.wp.hasSecret ? '(저장됨 · 바꿀 때만)' : ''}</label><input id="wp-secret" type="password" autocomplete="off"></div><div style="flex:0 0 auto"><button class="btn" id="wp-save">저장</button></div></div></li>
            <li><b>이 대시보드를 <code>http://localhost:4300/admin</code> 주소로 연 상태에서</b> 아래 <b>연결</b> → WordPress.com 화면에서 <b>Approve</b>. 끝나면 이 화면으로 돌아옵니다.</li>
          </ol></details>
        <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn primary" id="wp-connect">${d.wp.connected ? '다시 연결' : '연결'}</button>
          <label class="switch"><input type="checkbox" id="wp-auto" ${d.wp.autoPublish !== false ? 'checked' : ''}> 자동 발행</label>
          <span>주 <input id="wp-week" type="number" min="1" max="14" value="${d.wp.perWeek ?? 3}" style="width:60px;display:inline-block">회, <input id="wp-hour" type="number" min="0" max="23" value="${d.wp.publishHour ?? 10}" style="width:60px;display:inline-block">시 이후</span>
          <button class="btn small" id="wp-sched">일정 저장</button>
          ${d.wp.lastPublishedAt ? `<small class="muted">마지막 자동 발행 ${when(d.wp.lastPublishedAt)}</small>` : ''}
        </div>
      </div>
      <h2 style="margin:8px 0">네이버 블로그 (반자동: 복사 · 붙여넣기)</h2>      <details class="card" style="margin-bottom:16px" ${s.blogId ? '' : 'open'}><summary><strong>처음 한 번만 설정 (5분)</strong></summary>
        <ol style="line-height:1.8">
          <li>내 블로그 아이디(blog.naver.com/ 뒤의 영문)를 넣고 저장: <input id="bl-id" value="${esc(s.blogId ?? '')}" placeholder="예: ongyeol_studio" style="max-width:220px"> <button class="btn small primary" id="bl-save">저장</button></li>
          <li>크롬 주소창에 <code>chrome://extensions</code> 입력 → 오른쪽 위 <b>개발자 모드</b> 켜기 → <b>압축해제된 확장 프로그램을 로드합니다</b> → 이 폴더 선택:<br><code class="mono">${esc(d.extensionDir)}</code> <button class="btn small" id="bl-copy-dir">경로 복사</button></li>
          <li>네이버에 로그인해 둡니다(비밀번호는 이 프로그램에 저장하지 않습니다).</li>
          <li>블로그 관리 → 기본 설정 → 블로그 정보에서 <b>RSS 공개</b>(외부 보내기)가 켜져 있어야 발행 여부를 자동으로 확인할 수 있습니다.</li>
        </ol></details>
      <div class="card stack" style="margin-bottom:16px"><h2>발행 대기 ${ready.length}개 ${d.composing ? '<span class="badge warn">카피라이터가 쓰는 중</span>' : ''}</h2>
        <p class="muted" style="margin:0">항상 ${s.keepReady ?? 3}개를 미리 써 둡니다 (<input id="bl-keep" type="number" min="1" max="10" value="${s.keepReady ?? 3}" style="width:60px;display:inline-block"> 개 <button class="btn small" id="bl-keep-save">바꾸기</button>). 고객이 동의한 작업은 사례 글로 먼저 씁니다.</p>
        <div class="row" style="align-items:flex-end"><div><label>직접 주제 주기 (선택)</label><input id="bl-topic" placeholder="예: 카페 창업 전에 로고 준비하는 법"></div><div style="flex:0 0 auto"><button class="btn" id="bl-topic-go">이 주제로 쓰기</button></div></div>
      </div>
      <div class="stack">${d.posts.filter((x) => x.status !== 'archived').map((x) => `
        <div class="card" data-post="${x.id}">
          <div class="item-row"><h3>${esc(x.title)}</h3><span class="badge ${ST[x.status]?.[0] ?? ''}">${ST[x.status]?.[1] ?? esc(x.status)}</span></div>
          <small class="muted">${x.kind === 'case' ? `사례 글 · ${esc(x.project ?? '')}` : `주제 글 · ${esc(x.topic)}`} · 작성 ${esc(x.writer ?? '')} · ${when(x.createdAt)}${x.fillReport?.length && !x.fillOk ? ' · <span class="error-text">자동 입력 일부 실패</span>' : ''}</small>
          ${x.publishedUrl ? `<p><a href="${esc(x.publishedUrl)}" target="_blank" rel="noopener">네이버 발행 글 보기</a></p>` : ''}
          ${x.wp?.url ? `<p><a href="${esc(x.wp.url)}" target="_blank" rel="noopener">워드프레스 자동 발행 글 보기</a></p>` : x.wp?.error ? `<p class="error-text">워드프레스 발행 실패: ${esc(x.wp.error)}</p>` : ''}          <details style="margin-top:6px"><summary>미리 보기</summary>${preview(x)}</details>
          <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
            ${x.status !== 'published' ? `<button class="btn primary" data-arm="${x.id}">네이버에 발행하러 가기</button>` : ''}
            ${d.wp.connected && !x.wp?.url ? `<button class="btn small" data-wp="${x.id}">워드프레스에 지금 발행</button>` : ''}            ${x.status === 'filled' ? `<button class="btn small" data-done="${x.id}">발행했어요</button>` : ''}
            <button class="btn small" data-archive="${x.id}">보관</button>
          </div>
        </div>`).join('') || '<div class="card empty">아직 글이 없습니다. 블로그 아이디를 저장하면 카피라이터가 쓰기 시작합니다.</div>'}</div>`;
    $$('[data-copy]').forEach((b) => (b.onclick = async () => { await navigator.clipboard.writeText(b.dataset.copy); toast('복사했습니다'); }));
    $('#wp-save').onclick = async () => { try { await api('/api/wp/settings', { method: 'PUT', body: { clientId: $('#wp-cid').value, clientSecret: $('#wp-secret').value } }); toast('저장했습니다. 이제 연결을 누르세요'); route(); } catch (err) { toast(err.message); } };
    $('#wp-connect').onclick = async () => { try { const r = await api('/api/wp/connect', { method: 'POST', body: {} }); location.href = r.url; } catch (err) { toast(err.message); } };
    $('#wp-sched').onclick = async () => { await api('/api/wp/settings', { method: 'PUT', body: { autoPublish: $('#wp-auto').checked, perWeek: Number($('#wp-week').value), publishHour: Number($('#wp-hour').value) } }); toast('일정을 저장했습니다'); route(); };
    $$('[data-wp]').forEach((b) => (b.onclick = async () => { try { await api(`/api/wp/publish/${b.dataset.wp}`, { method: 'POST', body: {} }); toast('워드프레스에 올리는 중입니다(1분 안팎)'); } catch (err) { toast(err.message); } }));    $('#bl-save').onclick = async () => { try { await api('/api/blog/settings', { method: 'PUT', body: { blogId: $('#bl-id').value } }); toast('저장했습니다. 곧 카피라이터가 글을 쓰기 시작합니다'); route(); } catch (err) { toast(err.message); } };
    $('#bl-copy-dir').onclick = async () => { await navigator.clipboard.writeText(d.extensionDir); toast('경로를 복사했습니다'); };
    $('#bl-keep-save').onclick = async () => { await api('/api/blog/settings', { method: 'PUT', body: { keepReady: Number($('#bl-keep').value) } }); toast('바꿨습니다'); route(); };
    $('#bl-more').onclick = async () => { await api('/api/blog/compose', { method: 'POST', body: {} }); toast('카피라이터가 새 글을 씁니다(1~2분)'); route(); };
    $('#bl-topic-go').onclick = async () => { const t = $('#bl-topic').value.trim(); if (!t) return toast('주제를 적어 주세요'); await api('/api/blog/compose', { method: 'POST', body: { topic: t } }); toast('그 주제로 씁니다(1~2분)'); route(); };
    $$('[data-arm]').forEach((b) => (b.onclick = async () => {
      try { const r = await api(`/api/blog/${b.dataset.arm}/arm`, { method: 'POST', body: {} }); window.open(r.url, '_blank', 'noopener'); toast('네이버 글쓰기 창에서 자동으로 채워집니다. 다 채워지면 발행을 누르세요'); } catch (err) { toast(err.message); }
    }));
    $$('[data-done]').forEach((b) => (b.onclick = async () => { const url = prompt('발행한 글 주소를 붙여 넣으면 함께 저장됩니다(비워도 됩니다)') ?? ''; await api(`/api/blog/${b.dataset.done}`, { method: 'PATCH', body: { status: 'published', publishedUrl: url } }); route(); }));
    $$('[data-archive]').forEach((b) => (b.onclick = async () => { if (!confirm('이 글을 보관할까요? (발행 대기에서 빠집니다)')) return; await api(`/api/blog/${b.dataset.archive}`, { method: 'PATCH', body: { status: 'archived' } }); route(); }));
  }

  // ── SNS (인스타그램 · Threads) ──
  async function social() {
    const d = await api('/api/social');
    const acct = (k) => d.accounts.find((a) => a.kind === k);
    const ST = { ok: ['ok', '연결됨'], error: ['bad', '오류'], expired: ['bad', '토큰 만료'] };
    const POST_ST = { pending: ['warn', '승인 대기'], queued: ['accent', '올리는 중'], published: ['ok', '게시됨'], partial: ['warn', '일부만 게시'], failed: ['bad', '실패'], cancelled: ['', '취소'] };
    const CM_ST = { new: ['warn', '대기'], drafted: ['warn', '답글 승인 대기'], replied: ['ok', '답함'], ignored: ['', '넘김'], escalated: ['bad', '대표 확인 필요'], failed: ['bad', '답글 실패'] };
    const card = (k, name) => {
      const a = acct(k);
      return `<div class="card stack" data-platform="${k}">
        <div class="item-row"><h3>${name} ${a ? `<small>${esc(a.address)}</small>` : ''}</h3>${a ? `<span class="badge ${ST[a.status]?.[0] ?? ''}">${ST[a.status]?.[1] ?? esc(a.status)}</span>` : '<span class="badge">연결 안 됨</span>'}</div>
        ${a?.lastError ? `<p class="error-text">${esc(a.lastError)}</p>` : ''}
        ${a ? `<small>토큰 만료 ${esc((a.tokenExpiresAt ?? '').slice(0, 10))} (자동 갱신) · 마지막 댓글 확인 ${a.lastCheckAt ? when(a.lastCheckAt) : '없음'}</small>` : ''}
        <div class="row" style="align-items:flex-end"><div><label>${a ? '새 액세스 토큰 (바꿀 때만)' : '액세스 토큰'}</label><input data-token type="password" autocomplete="off" placeholder="Meta 개발자 앱에서 만든 토큰"></div>
          <div style="flex:0 0 auto"><button class="btn primary" data-connect="${k}">${a ? '토큰 바꾸기' : '연결'}</button></div></div>
      </div>`;
    };
    $('#view').innerHTML = `
      <div class="page-head"><h1>SNS 영업</h1><button class="btn small" id="sync-now">지금 댓글 확인</button></div>
      <p class="muted">Meta 공식 API로만 연결합니다. 고객이 동의한 작업만 소개하고, 모든 글과 답글에 AI 활용 표시가 붙습니다. 먼저 남에게 댓글 · DM을 보내는 영업은 하지 않습니다(약관 · 정보통신망법).</p>
      <details class="card" style="margin-bottom:16px"><summary><strong>처음 연결하는 방법 (10~20분, 한 번만)</strong></summary>
        <ol class="pre" style="white-space:normal;line-height:1.7">
          <li>인스타그램 앱 → 설정 → 계정 유형을 <strong>프로페셔널(비즈니스 또는 크리에이터)</strong>로 바꿉니다. Threads는 같은 인스타그램 계정으로 만듭니다.</li>
          <li><a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">Meta for Developers</a>에서 로그인 → <strong>앱 만들기</strong>. 사용 사례에서 <strong>'Threads API 액세스'</strong>와 <strong>'인스타그램 메시지 및 콘텐츠 관리'</strong>를 고릅니다.</li>
          <li>Threads: 앱 역할 → 역할 → <strong>Threads 테스터</strong>로 내 계정을 추가하고, Threads 앱(웹) 설정 → 계정 → 웹사이트 권한 → 초대에서 수락합니다. 권한 threads_basic · threads_content_publish · threads_read_replies · threads_manage_replies 를 켜고 <strong>사용자 토큰 생성</strong>을 눌러 나온 토큰을 아래에 붙여 넣습니다.</li>
          <li>인스타그램: 'API 설정(인스타그램 로그인)'에서 내 계정을 추가하고 <strong>토큰 생성</strong> → 권한 instagram_business_basic · instagram_business_content_publishing · instagram_business_manage_comments 를 허용 → 나온 토큰을 붙여 넣습니다.</li>
          <li>내 계정에만 쓰는 앱이라 Meta 앱 심사는 필요 없습니다. 토큰은 암호화해 이 컴퓨터에만 저장하고 60일마다 자동으로 새로 받습니다. 토큰을 채팅이나 메신저로 보내지 마세요.</li>
        </ol></details>
      ${d.publicUrlOk ? '' : `<div class="card alert" style="margin-bottom:16px"><strong>이미지 게시에는 외부 접속 주소가 필요합니다.</strong> Meta가 이미지를 직접 내려받는데, 지금 주소(${esc(d.publicUrl)})는 이 컴퓨터 안에서만 열립니다. 그동안 Threads는 글만 올리고, 인스타그램(이미지 필수)은 건너뜁니다. 외부에서 열리는 https 주소를 <a href="#/settings">설정</a>의 '공개 주소'에 넣으면 이미지도 올라갑니다.</div>`}
      <div class="grid2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-bottom:16px">${card('threads', 'Threads')}${card('instagram', '인스타그램')}</div>
      <div class="card stack" style="margin-bottom:16px"><h2>홍보 글 만들기</h2>
        <p class="muted">작업이 정산되면(고객 동의 시) 자동으로 만들어집니다. 직접 만들 수도 있습니다. 만든 글은 <a href="#/approvals">승인 대기</a>에서 확인 후 올라갑니다(설정에서 자동으로 바꿀 수 있음).</p>
        <div class="row" style="align-items:flex-end">
          <div><label>소개할 작업 (고객 동의 · 정산 완료)</label><select id="sp-project"><option value="">— 작업 없이 주제로 쓰기 —</option>${d.eligible.map((p) => `<option value="${p.id}">${esc(p.title)}${p.named ? '' : ' (업체명 비공개)'}</option>`).join('')}</select></div>
          <div><label>주제 (작업 없이 쓸 때)</label><input id="sp-topic" placeholder="예: 온결 스튜디오 소개, 로고 의뢰 전에 준비하면 좋은 것"></div>
          <div style="flex:0 0 auto"><button class="btn primary" id="sp-create">글 만들기</button></div>
        </div></div>
      <div class="card" style="margin-bottom:16px"><h2>게시물</h2><div class="list">${d.posts.map((x) => `<div class="item">
          <div class="item-row"><span>${x.project ? `<a href="#/projects/${x.projectId}">${esc(x.project)}</a>` : esc(x.topic || '주제 글')}</span><span class="badge ${POST_ST[x.status]?.[0] ?? ''}">${POST_ST[x.status]?.[1] ?? esc(x.status)}</span></div>
          <small class="pre">${esc((x.threadsText || '').slice(0, 160))}…</small>
          <div>${Object.entries(x.results ?? {}).map(([k, r]) => `<small>${k === 'threads' ? 'Threads' : '인스타그램'}: ${r.permalink ? `<a href="${esc(r.permalink)}" target="_blank" rel="noopener">게시물 보기</a>` : r.id ? '게시됨' : r.skipped ? esc(r.skipped) : `<span class="error-text">${esc(r.error ?? '')}</span>`}</small><br>`).join('')}</div>
          ${['failed', 'partial'].includes(x.status) ? `<button class="btn small" data-retry="${x.id}">다시 올리기</button>` : ''}
        </div>`).join('') || '<div class="empty">아직 없습니다</div>'}</div></div>
      <div class="card"><h2>댓글 · 답글</h2><div class="list">${d.comments.map((c) => `<div class="item">
          <div class="item-row"><span>${c.platform === 'threads' ? 'Threads' : '인스타그램'} · <strong>@${esc(c.username)}</strong>: ${esc(c.text)}</span><span class="badge ${CM_ST[c.status]?.[0] ?? ''}">${CM_ST[c.status]?.[1] ?? esc(c.status)}</span></div>
          ${c.reply ? `<small>↳ ${esc(c.reply)}</small>` : ''}${c.note ? `<small class="muted"> ${esc(c.note)}</small>` : ''}
        </div>`).join('') || '<div class="empty">아직 없습니다</div>'}</div></div>`;
    $$('[data-connect]').forEach((b) => (b.onclick = async () => {
      const box = b.closest('[data-platform]');
      const token = box.querySelector('[data-token]').value.trim();
      if (!token) return toast('토큰을 붙여 넣으세요');
      b.disabled = true;
      try { const a = await api('/api/social/connect', { method: 'POST', body: { platform: b.dataset.connect, token } }); toast(`연결했습니다: ${a.address}`); } catch (err) { toast(err.message); }
      route();
    }));
    $('#sp-create').onclick = async () => {
      try { await api('/api/social/posts', { method: 'POST', body: { projectId: $('#sp-project').value || null, topic: $('#sp-topic').value } }); toast('카피라이터가 글을 쓰고 있습니다. 끝나면 승인 대기에 올라옵니다'); } catch (err) { toast(err.message); }
    };
    $$('[data-retry]').forEach((b) => (b.onclick = async () => { try { await api(`/api/social/posts/${b.dataset.retry}/retry`, { method: 'POST', body: {} }); toast('다시 올립니다'); route(); } catch (err) { toast(err.message); } }));
    $('#sync-now').onclick = async () => { await api('/api/social/sync', { method: 'POST', body: {} }); toast('댓글을 확인합니다'); };
  }

  // ── 계정 ──
  async function accounts() {
    const list = (await api('/api/accounts')).filter((a) => a.kind === 'gmail');
    const STATUS = { ok: ['ok', '정상'], error: ['bad', '오류'], unverified: ['warn', '확인 전'] };
    $('#view').innerHTML = `
      <div class="page-head"><h1>계정</h1></div>
      <div class="card stack" style="margin-bottom:16px">
        <h2>납품 · 응대용 Gmail</h2>
        <p class="muted">등록하면 고객 답장 · 견적 · 청구 · 납품 파일이 이 주소로 나가고, 받은편지함을 2분마다 확인해 답장과 새 문의를 자동으로 처리합니다.
        <strong>Google 계정 비밀번호가 아니라 '앱 비밀번호'</strong>를 넣으세요: Google 계정 → 보안 → 2단계 인증 켜기 → <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">앱 비밀번호</a>에서 16자리 생성.
        비밀번호는 암호화해서 이 컴퓨터에만 저장하고, 화면에 다시 보여 주지 않습니다. 채팅이나 메신저로 다른 사람(AI 포함)에게 보내지 마세요.</p>
        <form class="row" id="acct-form" style="align-items:flex-end">
          <div><label>Gmail 주소</label><input name="address" type="email" placeholder="studio.example@gmail.com" required autocomplete="off"></div>
          <div><label>앱 비밀번호 (16자리)</label><input name="password" type="password" autocomplete="new-password" required></div>
          <div style="flex:0 0 auto"><button class="btn primary">등록</button></div>
        </form>
      </div>
      <div class="stack">${list.map((a) => `
        <div class="card" data-acct="${a.id}">
          <div class="item-row"><h3>${esc(a.address)} <small>· ${esc(a.label)}</small></h3><span class="badge ${STATUS[a.status]?.[0] ?? ''}">${STATUS[a.status]?.[1] ?? esc(a.status)}</span></div>
          ${a.lastError ? `<p class="error-text">${esc(a.lastError)}</p>` : ''}
          <small>마지막 확인 ${a.lastCheckAt ? when(a.lastCheckAt) : '없음'}</small>
          <div style="display:flex;flex-wrap:wrap;margin-top:8px;align-items:center;gap:8px">
            <label class="switch"><input type="checkbox" data-k="enabled" ${a.enabled !== false ? 'checked' : ''}> 사용</label>
            <label class="switch"><input type="checkbox" data-k="inbox" ${a.inbox !== false ? 'checked' : ''}> 받은편지함 자동 처리</label>
            <input data-pw type="password" placeholder="새 앱 비밀번호 (바꿀 때만)" autocomplete="new-password" style="max-width:240px">
            <button class="btn small" data-act="pw">비밀번호 변경</button>
            <button class="btn small primary" data-act="test">연결 확인</button>
            <button class="btn small danger" data-act="del">삭제</button>
          </div>
        </div>`).join('') || '<div class="card empty">등록된 계정이 없습니다</div>'}</div>
      <div class="card" style="margin-top:16px"><h2>SNS 계정</h2><p class="muted">인스타그램 · Threads 연결은 <a href="#/social">SNS 화면</a>에서 합니다(Meta 공식 API).</p></div>`;
    $('#acct-form').onsubmit = async (e) => {
      e.preventDefault();
      const body = { kind: 'gmail', ...Object.fromEntries(new FormData(e.target)) };
      try {
        const a = await api('/api/accounts', { method: 'POST', body });
        toast('등록했습니다. 연결을 확인합니다…');
        const r = await api(`/api/accounts/${a.id}/test`, { method: 'POST', body: {} });
        toast(r.ok ? '연결 성공 — 이제 메일을 자동으로 주고받습니다' : `연결 실패: ${r.error}`);
      } catch (err) { toast(err.message); }
      route();
    };
    $$('[data-acct]').forEach((card) => {
      const id = card.dataset.acct;
      card.querySelectorAll('input[data-k]').forEach((i) => (i.onchange = () => api(`/api/accounts/${id}`, { method: 'PATCH', body: { [i.dataset.k]: i.checked } })));
      card.querySelector('[data-act="test"]').onclick = async (e) => {
        e.target.disabled = true;
        try {
          // 새 앱 비밀번호 칸에 입력해 둔 값이 있으면 먼저 저장하고 확인합니다('비밀번호 변경'을 깜빡해도 되도록).
          const pw = card.querySelector('[data-pw]').value;
          if (pw) await api(`/api/accounts/${id}`, { method: 'PATCH', body: { password: pw } });
          const r = await api(`/api/accounts/${id}/test`, { method: 'POST', body: {} });
          toast(r.ok ? '연결 성공 — 이제 메일을 자동으로 주고받습니다' : `연결 실패: ${r.error}`);
        } catch (err) { toast(err.message); }
        route();
      };
      card.querySelector('[data-act="pw"]').onclick = async () => {
        const pw = card.querySelector('[data-pw]').value;
        if (!pw) return toast('새 앱 비밀번호를 입력하세요');
        try {
          await api(`/api/accounts/${id}`, { method: 'PATCH', body: { password: pw } });
          toast('바꿨습니다. 연결 확인을 눌러 주세요');
          route();
        } catch (err) { toast(err.message); }
      };
      card.querySelector('[data-act="del"]').onclick = async () => {
        if (!confirm('이 계정을 삭제할까요? 메일 자동 처리가 멈춥니다.')) return;
        await api(`/api/accounts/${id}`, { method: 'DELETE' });
        route();
      };
    });
  }

  // ── 연습 · 학습 ──
  const SCOPE = { account: '응대 · 견적', design: '디자인', sales: '영업 메일', all: '전체' };

  function lessonRow(l) {
    return `<div class="item" data-lesson="${l.id}"><div class="item-row" style="align-items:flex-start">
      <span class="pre" style="${l.active === false ? 'opacity:.5;text-decoration:line-through' : ''}">${esc(l.text)}</span>
      <span style="display:inline-flex;flex:0 0 auto;gap:4px;align-items:center"><span class="badge">${SCOPE[l.scope] ?? l.scope}</span>
      <button class="btn small" data-l="toggle">${l.active === false ? '켜기' : '끄기'}</button><button class="btn small danger" data-l="del">삭제</button></span></div>
      ${l.target ? `<small>대상: ${esc(l.target)}</small>` : ''}</div>`;
  }

  function bindLessons(root) {
    const again = () => (currentView === 'practiceDetail' ? refreshPracticeSide() : route(true));
    $$('[data-lesson]', root).forEach((row) => {
      const id = row.dataset.lesson;
      row.querySelector('[data-l="toggle"]').onclick = async (e) => { await api(`/api/lessons/${id}`, { method: 'PATCH', body: { active: e.target.textContent === '켜기' } }); again(); };
      row.querySelector('[data-l="del"]').onclick = async () => { if (confirm('이 학습 노트를 삭제할까요?')) { await api(`/api/lessons/${id}`, { method: 'DELETE' }); again(); } };
    });
  }

  async function practice() {
    const [sims, lessons, st] = await Promise.all([api('/api/projects?sim=1'), api('/api/lessons'), api('/api/public/studio')]);
    $('#view').innerHTML = `
      <div class="page-head"><h1>연습 · 학습</h1></div>
      <p class="muted">실제 고객을 받기 전에, 내가 고객 역할을 하며 에이전트와 대화해 보세요. 견적 · 디자인 시안까지 실제와 똑같이 만들지만 메일 · 청구는 나가지 않습니다(API 비용은 실제로 듭니다).
      마음에 안 드는 점은 '코칭 피드백'에 적으면 <strong>학습 노트</strong>로 저장되어 연습과 실제 업무 모두에 계속 적용됩니다.</p>
      <div class="grid2">
        <form class="card stack" id="sim-form"><h2>새 연습 시작</h2>
          <div class="row"><div><label>고객 이름 (역할)</label><input name="name" placeholder="예: 김사장"></div><div><label>회사 · 브랜드</label><input name="company" placeholder="예: 모모카페"></div></div>
          <div class="row"><div><label>서비스</label><select name="serviceId"><option value="">선택 안 함</option>${st.services.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div><div><label>예산 (선택)</label><input name="budget"></div></div>
          <div><label>첫 요청 (고객이 처음 보내는 메시지)</label><textarea name="description" required placeholder="예: 동네 카페 로고가 필요해요. 따뜻하고 미니멀한 느낌으로, 간판이랑 컵에 쓸 거예요."></textarea></div>
          <div><button class="btn primary">연습 시작</button></div>
        </form>
        <div class="card"><h2>연습 기록</h2><div class="list">${sims.map((p) => `
          <a class="item" href="#/practice/${p.id}"><div class="item-row"><span class="item-title">${esc(p.title)}</span>${statusBadge(p.status)}</div><small>${p.lastMessage ? `${esc(FROM[p.lastMessage.from])}: ${esc(p.lastMessage.text)} · ${when(p.lastMessage.at)}` : ''}</small></a>`).join('') || '<div class="empty">아직 연습이 없습니다</div>'}</div></div>
      </div>
      <div class="card" style="margin-top:16px" id="lessons-card"><div class="item-row"><h2>학습 노트 (${lessons.filter((l) => l.active !== false).length}개 적용 중)</h2></div>
        <p class="muted">에이전트의 지시문에 그대로 들어가는 규칙입니다. 끄면 적용되지 않고, 삭제하면 사라집니다.</p>
        <form class="row" id="lesson-add" style="align-items:flex-end;margin-bottom:8px"><div style="flex:3 1 300px"><label>직접 추가</label><input name="text" placeholder="예: 로고 시안은 항상 흑백 버전도 같이 보여 줄 것"></div><div style="flex:0 0 140px"><label>적용 범위</label><select name="scope">${Object.entries(SCOPE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div style="flex:0 0 auto"><button class="btn">추가</button></div></form>
        <div class="list">${lessons.map(lessonRow).join('') || '<div class="empty">아직 없습니다</div>'}</div></div>`;
    $('#sim-form').onsubmit = async (e) => {
      e.preventDefault();
      try { const r = await api('/api/sim', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); location.hash = `#/practice/${r.id}`; } catch (err) { toast(err.message); }
    };
    $('#lesson-add').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/api/lessons', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); route(); } catch (err) { toast(err.message); }
    };
    bindLessons($('#lessons-card'));
  }

  let practiceId = null;
  async function practiceDetail(id) {
    practiceId = id;
    const d = await api(`/api/projects/${id}`);
    $('#view').innerHTML = `
      <div class="page-head"><div><a href="#/practice" class="muted">← 연습 · 학습</a><h1>${esc(d.project.title)}</h1></div>
        <div class="row" style="flex:0 0 auto;gap:8px"><a class="btn small" href="#/projects/${id}">업무 화면으로 보기 (입금 확인 등)</a><a class="btn small" href="${esc(d.portalUrl)}" target="_blank" rel="noopener">고객 화면 새 창</a></div></div>
      <div class="grid-detail">
        <div class="card" style="padding:0;overflow:hidden">
          <div style="padding:10px 14px;border-bottom:1px solid var(--line)"><strong>고객 역할</strong> <small class="muted">— 실제 고객이 보는 화면 그대로입니다. 여기서 채팅 · 견적 수락 · 시안 확정을 해 보세요.</small></div>
          <iframe src="/p/${esc(d.project.portalToken)}" title="고객 화면" style="width:100%;height:78vh;border:0;background:var(--bg)"></iframe>
        </div>
        <div class="stack">
          <form class="card stack" id="coach">
            <h2>코칭 피드백</h2>
            <p class="muted" style="margin:0">고객으로서가 아니라 <strong>대표로서</strong> 에이전트에게 주는 피드백입니다. 학습 노트로 저장되고, 에이전트가 바로 반영해서 다시 합니다.</p>
            <div class="row"><div><label>적용 범위</label><select name="scope">${Object.entries(SCOPE).filter(([k]) => k !== 'sales').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
              <div style="flex:2 1 200px"><label>무엇에 대한 피드백</label><input name="target" id="coach-target" placeholder="예: 마지막 답장 / 시안 「원형 컵」"></div></div>
            <textarea name="text" id="coach-text" placeholder="예: 첫 답장이 너무 길어. 3문장 이내로. / 로고 글자가 너무 얇아서 간판에서 안 보여. 굵은 산세리프로."></textarea>
            <div class="row" style="align-items:center"><label class="switch"><input type="checkbox" name="redo" checked> 바로 다시 하게 하기</label><div style="flex:0 0 auto"><button class="btn primary">피드백 저장</button></div></div>
          </form>
          <div id="ps-live" class="stack"></div>
        </div>
      </div>`;
    $('#coach').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try {
        await api(`/api/projects/${id}/coach`, { method: 'POST', body: { text: f.text, scope: f.scope, target: f.target, redo: Boolean(f.redo) } });
        $('#coach-text').value = '';
        $('#coach-target').value = '';
        toast(f.redo ? '저장했습니다. 에이전트가 반영해서 다시 합니다.' : '학습 노트로 저장했습니다.');
        refreshPracticeSide();
      } catch (err) { toast(err.message); }
    };
    await refreshPracticeSide();
  }

  async function refreshPracticeSide() {
    const box = $('#ps-live');
    if (!box || !practiceId) return;
    const [d, lessons] = await Promise.all([api(`/api/projects/${practiceId}`), api('/api/lessons')]);
    const notes = d.messages.filter((m) => m.internal).slice(-6).reverse();
    const mine = lessons.filter((l) => l.projectId === practiceId);
    const busy = d.jobs.some((j) => ['queued', 'running'].includes(j.status));
    box.innerHTML = `
      <div class="card"><div class="item-row"><h3>진행 상황</h3>${statusBadge(d.project.status)}</div>
        <small>${busy ? '● 에이전트가 작업 중입니다…' : '대기 중'} · 이 연습 비용 $${d.usage.toFixed(2)}</small></div>
      <div class="card"><h3>시안</h3><div class="designs">${d.designs.slice().reverse().map((x) => `
        <div class="stack"><iframe class="design-frame" sandbox="" loading="lazy" title="${esc(x.title)}" src="/api/designs/${x.id}/raw"></iframe>
        <div><strong>${esc(x.title)}</strong> <span class="badge">${x.round}차</span>${x.review ? ` <small>검토 ${x.review.score}/10</small>` : ''}</div>
        <div class="row" style="gap:6px"><a class="btn small" href="/api/designs/${x.id}/raw" target="_blank">크게</a><button class="btn small" data-coach="${esc(`시안 「${x.title}」(${x.round}차)`)}">이 시안에 피드백</button></div></div>`).join('') || '<span class="muted">아직 없음</span>'}</div></div>
      <div class="card"><h3>에이전트 메모 · 내 코칭</h3><div class="list">${notes.map((m) => `<div class="item"><small>${m.from === 'owner' ? '내 코칭/지시' : '에이전트'} · ${when(m.createdAt)}</small><div class="pre">${esc(m.text)}</div></div>`).join('') || '<span class="muted">없음</span>'}</div></div>
      <div class="card" id="ps-lessons"><h3>이 연습에서 생긴 학습 노트</h3><div class="list">${mine.map(lessonRow).join('') || '<span class="muted">없음</span>'}</div></div>`;
    $$('[data-coach]', box).forEach((b) => (b.onclick = () => { $('#coach-target').value = b.dataset.coach; $('#coach [name="scope"]').value = 'design'; $('#coach-text').focus(); }));
    bindLessons($('#ps-lessons'));
  }

  // ── 조직 (직원) ──
  async function org() {
    const [list, s] = await Promise.all([api('/api/staff'), api('/api/settings')]);
    const ROLE_LABEL = Object.fromEntries(Object.entries(META.roles).map(([k, v]) => [k, v.label]));
    const svcBoxes = (cur) => s.services.map((v) => `<label class="chip-check"><input type="checkbox" name="specialties" value="${esc(v.id)}" ${(cur ?? []).includes(v.id) ? 'checked' : ''}>${esc(v.name)}</label>`).join('');
    const formBody = (form) => { const fd = new FormData(form); return { ...Object.fromEntries(fd), specialties: fd.getAll('specialties') }; };
    const DEPTS = META.departments;
    const posOpts = (cur) => META.positions.map((p) => `<option ${p === cur ? 'selected' : ''}>${p}</option>`).join('');
    const modelOpts = (cur) => `<option value="">회사 기본 (${esc(META.models[OV.agent.model] ?? OV.agent.model)})</option>${Object.entries(META.models).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(v)}</option>`).join('')}`;
    const rank = (p) => { const i = META.positions.indexOf(p); return i < 0 ? 99 : i; };
    $('#view').innerHTML = `
      <div class="page-head"><h1>조직도</h1></div>
      ${Pixel.orgChart(list, s.profile.ownerName, META)}
      <div class="card" style="margin-bottom:16px"><h3>업무 흐름</h3><p class="pre" style="margin:0;font-size:0.92rem">문의 → 영업팀 응대 · 견적 → 고객 견적 수락 → 계약서 서명 → 계약금 청구 · 입금(대표 확인)
→ PM팀 킥오프(일정 · 담당 PM · 디자이너 배정) → 크리에이티브 실장 방향 설정 → 카피라이터 문구 → 디자이너 제작 → 실장 검수(반려 시 재작업)
→ 영업팀 시안 제시 → 고객 피드백 → 수정 라운드 → 최종 확정 → 잔금 청구 → 입금 → 원본 납품 → PM팀 회고
매일 아침 PM팀 스탠드업 보고 · 일정 지연 / 연체 점검(경영지원팀 → 영업팀 독촉) · 신규 영업 메일은 BD 담당(동의 · 거래관계 대상만)</p></div>
      <p class="muted">직원은 모두 AI이며 고객에게는 이름과 함께 항상 'AI'로 표시됩니다. AM · PM · 디자이너는 프로젝트마다 한 명씩 자동 배정됩니다 — 담당 한도에 여유가 있고, 전문 서비스가 맞고, 일이 적은 사람 순. 경력 · 배경은 업무 판단용 가상 설정이며 고객에게 실제 경력처럼 말하지 않습니다. 업무 원칙은 그 직원의 프롬프트에 그대로 들어가 항상 지켜집니다.</p>
      ${Object.entries(DEPTS).map(([key, d]) => {
        const people = list.filter((x) => x.dept === key).sort((a, b) => rank(a.position) - rank(b.position));
        if (!people.length) return '';
        return `<h2 style="margin-top:22px;display:flex;align-items:center;gap:10px"><span style="width:14px;height:14px;background:${d.color};display:inline-block"></span>${esc(d.name)}</h2>
        <div class="staff-grid">${people.map((x) => `
        <form class="card stack" id="card-${x.id}" data-staff="${x.id}" style="${x.active === false ? 'opacity:.55' : ''}">
          <div style="display:flex;gap:12px;align-items:center">
            <canvas data-seed="${esc(x.id)}" data-shirt="${d.color}" data-position="${esc(x.position)}" data-inactive="${x.active === false ? 1 : ''}" data-scale="3" style="flex:none"></canvas>
            <div style="flex:1;min-width:0" class="stack">
              <div style="display:flex;gap:6px"><select name="position" style="width:auto">${posOpts(x.position)}</select><input name="name" value="${esc(x.name)}" style="font-weight:600"></div>
              <div><span class="badge ${x.busy ? 'warn' : x.active === false ? '' : 'ok'}" style="white-space:normal;line-height:1.35">${x.busy ? `작업 중 · ${esc(x.busy)}` : x.active === false ? '휴직' : '근무 중'}</span></div>
            </div>
          </div>
          <small style="display:block"><b>${esc(x.roleLabel)}</b> — ${esc(x.duty)}</small>
          <small class="muted" style="display:block">보고 대상: ${esc(x.reportsTo)}${x.load != null ? ` · 담당 ${x.load}/${x.capacityNow}건` : ''}${x.career ? ` · ${esc(x.career)}` : ''}</small>
          ${x.bio ? `<p style="margin:0;font-size:.9rem">${esc(x.bio)}</p>` : ''}
          ${x.skills?.length ? `<div class="skill-tags">${x.skills.map((k) => `<span>${esc(k)}</span>`).join('')}</div>` : ''}
          <details><summary>프로필 · 업무 원칙 수정</summary><div class="stack" style="margin-top:8px">
            <div class="row"><div><label>경력 (가상 설정)</label><input name="career" value="${esc(x.career)}"></div>${x.load != null ? `<div style="max-width:120px"><label>동시 담당 한도</label><input name="capacity" type="number" min="1" max="20" value="${esc(x.capacity ?? '')}" placeholder="${x.capacityNow}"></div>` : ''}</div>
            <div><label>소개 · 배경</label><textarea name="bio" style="min-height:54px">${esc(x.bio)}</textarea></div>
            <div><label>보유 스킬 (쉼표로 구분)</label><input name="skills" value="${esc((x.skills ?? []).join(', '))}"></div>
            <div><label>전문 서비스 (배정 우선)</label><div class="chip-row">${svcBoxes(x.specialties)}</div></div>
            <div><label>업무 성향</label><textarea name="persona" style="min-height:54px">${esc(x.persona)}</textarea></div>
            <div><label>업무 원칙 (한 줄에 하나, 항상 지킴)</label><textarea name="principles" style="min-height:90px">${esc(x.principles)}</textarea></div>
            <div><label>모델</label><select name="model">${modelOpts(x.model)}</select></div>
          </div></details>
          <small>진행 ${x.stats.activeProjects}건${x.role === 'designer' ? ` · 시안 ${x.stats.designsMade}개 · 실장 검수 평균 ${x.stats.avgScore ?? '-'}점 · 반려 ${x.stats.reworks}회` : ''}${x.role === 'ad' ? ` · 검수 ${x.stats.designsReviewed}건` : ''}${x.role === 'copywriter' ? ` · 카피 ${x.stats.copies}건` : ''} · 이번 달 비용 $${x.stats.costMonth.toFixed(2)}</small>
          <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn small primary">저장</button><button type="button" class="btn small" data-toggle>${x.active === false ? '복직' : '휴직'}</button></div>
        </form>`).join('')}</div>`;
      }).join('')}
      <form class="card stack" id="hire" style="margin-top:22px"><h2>채용</h2>
        <div class="row"><div><label>이름</label><input name="name" required></div><div><label>직무 (부서는 자동)</label><select name="role">${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${k === 'designer' ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div><div><label>직책</label><select name="position">${posOpts('사원')}</select></div><div><label>모델</label><select name="model">${modelOpts('')}</select></div></div>
        <div class="row"><div><label>경력 (가상 설정)</label><input name="career" placeholder="예: 경력 6년 · 패키지 디자인"></div><div><label>보유 스킬 (쉼표로 구분)</label><input name="skills" placeholder="예: 패키지, 일러스트, 레터링"></div></div>
        <div><label>업무 성향 · 전문 스타일</label><input name="persona" placeholder="예: 레트로 · 타이포 포스터 전문, 대담한 색 사용"></div>
        <div><label>전문 서비스 (배정 우선)</label><div class="chip-row">${svcBoxes([])}</div></div>
        <div><label>업무 원칙 (한 줄에 하나)</label><textarea name="principles" style="min-height:60px" placeholder="예: 납품 전 인쇄용 CMYK 변환 확인"></textarea></div>
        <div><button class="btn primary">채용</button></div></form>`;
    Pixel.mount($('#view'));
    $$('[data-goto]').forEach((b) => (b.onclick = () => {
      const card = $(`#card-${b.dataset.goto}`);
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
    }));
    $$('[data-staff]').forEach((f) => {
      f.onsubmit = async (e) => { e.preventDefault(); try { await api(`/api/staff/${f.dataset.staff}`, { method: 'PATCH', body: formBody(f) }); toast('저장했습니다'); route(); } catch (err) { toast(err.message); } };
      f.querySelector('[data-toggle]').onclick = async (e) => { try { await api(`/api/staff/${f.dataset.staff}`, { method: 'PATCH', body: { active: e.target.textContent === '복직' } }); route(); } catch (err) { toast(err.message); } };
    });
    $('#hire').onsubmit = async (e) => { e.preventDefault(); try { await api('/api/staff', { method: 'POST', body: formBody(e.target) }); toast('채용했습니다'); route(); } catch (err) { toast(err.message); } };
  }

  // ── 보고서 ──
  async function reports() {
    const list = await api('/api/reports');
    $('#view').innerHTML = `
      <div class="page-head"><h1>보고서</h1><button class="btn small" id="standup-now">지금 스탠드업 받기</button></div>
      <p class="muted">PM이 매일 아침 진행 상황을 보고하고, 프로젝트가 끝나면 회고를 씁니다. 회고의 '다음에 적용할 규칙'을 채택하면 학습 노트가 되어 모든 직원에게 적용됩니다.</p>
      <div class="stack">${list.map((r) => `
        <div class="card stack" data-report="${r.id}">
          <div class="item-row"><h3>${esc(r.title)}</h3><small>${esc(r.staffName ?? '')} · ${when(r.createdAt)}</small></div>
          ${r.projectId ? `<a href="#/projects/${r.projectId}" class="muted">${esc(r.project ?? '')}</a>` : ''}
          <div class="pre">${esc(r.body)}</div>
          ${(r.proposals ?? []).length ? `<div class="list"><strong>다음에 적용할 규칙 (제안)</strong>${r.proposals.map((x, i) => `<div class="item"><div class="item-row"><span>${esc(x.text)} <span class="badge">${esc(x.scope)}</span></span>${x.status === 'pending' ? `<span style="display:inline-flex;gap:4px"><button class="btn small primary" data-adopt="${i}">학습 노트로 채택</button><button class="btn small" data-dismiss="${i}">넘기기</button></span>` : `<span class="badge ${x.status === 'adopted' ? 'ok' : ''}">${x.status === 'adopted' ? '채택' : '넘김'}</span>`}</div></div>`).join('')}</div>` : ''}
        </div>`).join('') || '<div class="card empty">아직 보고서가 없습니다. 매일 아침 스탠드업이 자동으로 올라옵니다.</div>'}</div>`;
    $('#standup-now').onclick = async () => { await api('/api/reports/standup', { method: 'POST', body: {} }); toast('PM에게 요청했습니다. 잠시 후 올라옵니다.'); };
    $$('[data-report]').forEach((c) => {
      $$('[data-adopt],[data-dismiss]', c).forEach((b) => (b.onclick = async () => {
        const i = b.dataset.adopt ?? b.dataset.dismiss;
        await api(`/api/reports/${c.dataset.report}/proposals/${i}/${b.dataset.adopt !== undefined ? 'adopt' : 'dismiss'}`, { method: 'POST', body: {} });
        route(true);
      }));
    });
  }

  // ── 재무 ──
  async function finance() {
    const month = sessionStorage.getItem('fmonth') || new Date().toISOString().slice(0, 7);
    const f = await api(`/api/finance?month=${month}`);
    const KIND = { deposit: '계약금', final: '잔금', extra_revision: '추가 수정', extra: '추가 작업' };
    $('#view').innerHTML = `
      <div class="page-head"><h1>재무</h1><input type="month" id="fm" value="${month}" style="width:auto"></div>
      <div class="kpis">
        <div class="card kpi"><div class="label">입금 매출</div><div class="value">${money(f.revenue, cur())}</div><div class="sub">정산 완료 ${f.projectsCompleted}건 · 계약 ${f.contractsSigned}건</div></div>
        <div class="card kpi"><div class="label">미수금</div><div class="value">${money(f.receivables, cur())}</div><div class="sub">연체 ${money(f.overdue, cur())}</div></div>
        <div class="card kpi"><div class="label">AI 직원 비용 (API)</div><div class="value">$${f.apiUsd.toFixed(2)}</div><div class="sub">그중 연습 $${f.practiceUsd.toFixed(2)}</div></div>
      </div>
      <div class="grid2">
        <div class="card"><h2>직원별 비용</h2><table class="table"><thead><tr><th>직원</th><th>호출</th><th>비용</th></tr></thead><tbody>${f.byStaff.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.calls}</td><td>$${x.costUsd.toFixed(2)}</td></tr>`).join('')}${f.otherUsd ? `<tr><td>기타</td><td></td><td>$${f.otherUsd.toFixed(2)}</td></tr>` : ''}</tbody></table>
          <small class="muted">원화 매출과 달러 API 비용은 환율에 따라 비교하세요.</small></div>
        <div class="card"><h2>입금 내역</h2><div class="list">${f.paid.map((x) => `<div class="item"><div class="item-row"><span>${esc(x.project ?? '')} · ${KIND[x.kind] ?? x.kind}</span><strong>${money(x.amount, cur())}</strong></div><small>${(x.paidAt ?? '').slice(0, 10)}</small></div>`).join('') || '<div class="empty">없음</div>'}</div></div>
      </div>`;
    $('#fm').onchange = (e) => { sessionStorage.setItem('fmonth', e.target.value); route(); };
  }

  function svcRow(x) {
    const c = (k, v, t = 'text', w = '') => `<td><input data-k="${k}" type="${t}" value="${esc(v)}" ${w}></td>`;
    return `<tr>${c('id', x.id, 'text', 'style="width:80px"')}${c('name', x.name)}${c('description', x.description)}${c('basePrice', x.basePrice, 'number', 'style="width:110px"')}${c('minPrice', x.minPrice, 'number', 'style="width:110px"')}${c('days', x.days, 'number', 'style="width:70px"')}${c('revisions', x.revisions, 'number', 'style="width:60px"')}<td><button type="button" class="btn small danger" data-del>삭제</button></td></tr>`;
  }

  boot();
})();
