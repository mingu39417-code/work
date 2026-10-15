// 픽셀아트 조직도 — 직원 캐릭터를 16×20 픽셀로 그려 부서별 사무실에 앉힙니다.
// 얼굴(머리 모양 · 피부 · 머리색)은 직원 id로 정해져 매번 같고, 셔츠는 부서색, 팀장 · 실장은 넥타이, 실장은 재킷.
(() => {
  const HAIR = ['#2B2118', '#5A3A22', '#1C1C24', '#7A4A2C', '#3A2A3E'];
  const SKIN = ['#F2C9A0', '#E8B48A', '#D9A077'];
  const W = 16, H = 20;

  function hash(str) {
    let h = 2166136261;
    for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt)));
    return `#${[f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }

  // 픽셀 지도: 각 칸에 색 이름을 채운 뒤 한 번에 그립니다.
  function sprite({ seed, shirt, position, desk = true, owner = false, asleep = false }) {
    const h = hash(seed);
    const style = owner ? 0 : h % 3;
    const g = Array.from({ length: H }, () => Array(W).fill(null));
    const put = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c; };
    const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, c); };

    // 머리카락 (뒤)
    if (style === 1) { rect(3, 4, 3, 11, 'hair'); rect(12, 4, 12, 11, 'hair'); }
    // 얼굴
    rect(4, 4, 11, 9, 'skin');
    rect(5, 10, 10, 10, 'skin');
    // 머리카락 (위)
    rect(5, 1, 10, 1, 'hair');
    rect(4, 2, 11, 2, 'hair');
    rect(3, 3, 12, 3, 'hair');
    rect(3, 4, 3, 6, 'hair'); rect(12, 4, 12, 6, 'hair');
    if (style === 0) { rect(4, 4, 6, 4, 'hair'); }
    if (style === 1) { rect(4, 4, 11, 4, 'hair'); put(4, 5, 'hair'); put(11, 5, 'hair'); }
    if (style === 2) { rect(7, 0, 8, 0, 'hair'); rect(6, 0, 9, 1, 'hair'); rect(9, 4, 11, 4, 'hair'); }
    // 눈 · 입 · 볼
    if (asleep) { rect(5, 6, 6, 6, 'eye'); rect(9, 6, 10, 6, 'eye'); }
    else { put(6, 6, 'eye'); put(9, 6, 'eye'); put(6, 5, 'eyeHi'); put(9, 5, 'eyeHi'); }
    rect(7, 8, 8, 8, 'mouth');
    put(5, 7, 'blush'); put(10, 7, 'blush');
    // 목 · 몸
    rect(7, 11, 8, 11, 'skin');
    rect(3, 12, 12, 17, 'shirt');
    rect(2, 13, 2, 16, 'shirt'); rect(13, 13, 13, 16, 'shirt');
    put(2, 17, 'skin'); put(13, 17, 'skin');
    // 옷깃 · 넥타이 · 재킷
    put(6, 12, 'collar'); put(9, 12, 'collar');
    if (['팀장', '실장'].includes(position) || owner) { rect(7, 12, 8, 12, 'tie'); rect(7, 13, 8, 15, 'tie'); put(7, 16, 'tie'); }
    if (position === '실장' || owner) { rect(3, 12, 5, 17, 'jacket'); rect(10, 12, 12, 17, 'jacket'); rect(2, 13, 2, 16, 'jacket'); rect(13, 13, 13, 16, 'jacket'); }
    if (position === '선임') { put(4, 13, 'badge'); }
    if (desk) {
      // 책상 · 노트북(뒷면)
      rect(0, 16, 15, 16, 'deskTop');
      rect(1, 17, 14, 19, 'desk');
      rect(1, 19, 14, 19, 'deskDark');
      rect(9, 12, 13, 15, 'laptop');
      rect(9, 15, 13, 15, 'laptopDark');
      put(11, 13, 'logo');
    }
    return g;
  }

  function paint(canvas, opts) {
    const scale = Number(canvas.dataset.scale || 4);
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const h = hash(opts.seed);
    const shirt = opts.inactive ? '#9A958D' : opts.shirt;
    const colors = {
      hair: HAIR[h % HAIR.length], skin: SKIN[(h >> 3) % SKIN.length], eye: '#1D1A17', eyeHi: null,
      mouth: '#B4553F', blush: '#F0A08A', shirt, collar: '#F8F3EA', tie: opts.owner ? '#C0533B' : '#24222C',
      jacket: opts.owner ? '#24222C' : shade(shirt, -45), badge: '#F5C542',
      deskTop: '#C8925C', desk: '#A9713F', deskDark: '#8E5E36', laptop: '#C9CED6', laptopDark: '#9EA4AE', logo: '#FFFFFF',
    };
    const g = sprite(opts);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = g[y][x] && colors[g[y][x]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const RANK = (p, positions) => { const i = positions.indexOf(p); return i < 0 ? 99 : i; };

  function member(st, dept) {
    const off = st.active === false;
    return `<button type="button" class="px-member ${st.busy ? 'busy' : ''} ${off ? 'off' : ''}" data-goto="${st.id}" title="${esc(st.roleLabel)}${st.busy ? ` — ${esc(st.busy)}` : ''}">
      ${st.busy ? `<span class="px-bubble">${esc(st.busy.split(' · ')[0])}<i>...</i></span>` : off ? '<span class="px-bubble z">Zzz</span>' : ''}
      <canvas data-seed="${esc(st.id)}" data-shirt="${dept.color}" data-position="${esc(st.position)}" data-inactive="${off ? 1 : ''}" data-scale="4"></canvas>
      <span class="px-plate"><b style="background:${dept.color}">${esc(st.position)}</b>${esc(st.name)}</span>
      <span class="px-role">${esc(st.roleLabel.replace(/\s*\(.*\)/, ''))}</span>
    </button>`;
  }

  // 조직도 HTML
  function orgChart(staff, owner, meta) {
    const depts = Object.entries(meta.departments);
    const rooms = depts.map(([key, d]) => {
      const people = staff.filter((s) => s.dept === key).sort((a, b) => RANK(a.position, meta.positions) - RANK(b.position, meta.positions));
      const lead = people.find((p) => p.active !== false);
      return `<section class="px-room" style="--dept:${d.color}">
        <header class="px-room-head"><span>${esc(d.name)}</span><small>${people.filter((p) => p.active !== false).length}명</small></header>
        <div class="px-floor">${people.map((p) => member(p, d)).join('') || '<span class="px-empty">빈 자리</span>'}</div>
        <footer class="px-room-foot">${lead ? `책임자 · ${esc(lead.position)} ${esc(lead.name)}` : '책임자 없음'}</footer>
      </section>`;
    }).join('');
    const working = staff.filter((s) => s.busy).length;
    return `<div class="px-office">
      <div class="px-ceo">
        <div class="px-ceo-room">
          <canvas data-seed="owner" data-owner="1" data-shirt="#24222C" data-position="대표" data-scale="5"></canvas>
          <div><b>대표</b><strong>${esc(owner || '대표님')}</strong><small>사람 · 최종 결재</small></div>
        </div>
      </div>
      <div class="px-trunk"></div>
      <div class="px-rooms">${rooms}</div>
      <div class="px-legend"><span><i class="lg busy"></i>작업 중 ${working}명</span><span><i class="lg tie"></i>넥타이 = 팀장 · 실장</span><span><i class="lg off"></i>휴직</span><span>캐릭터를 누르면 정보 수정</span></div>
    </div>`;
  }

  function mount(root) {
    for (const c of root.querySelectorAll('canvas[data-seed]')) {
      paint(c, { seed: c.dataset.seed, shirt: c.dataset.shirt, position: c.dataset.position, owner: Boolean(c.dataset.owner), inactive: Boolean(c.dataset.inactive), asleep: Boolean(c.dataset.inactive), desk: !c.dataset.owner });
    }
  }

  window.Pixel = { orgChart, mount, paint };
})();
