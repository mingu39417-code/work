// 세 화면(문의 · 포털 · 대시보드)이 같이 쓰는 도구
window.$ = (sel, root = document) => root.querySelector(sel);
window.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];

window.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

window.api = async (url, { method = 'GET', body } = {}) => {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `요청 실패 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
};

window.money = (n, currency = 'KRW') => {
  try {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency, maximumFractionDigits: currency === 'KRW' ? 0 : 2 }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
};

window.when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d) / 1000;
  if (diff < 60 && diff > -60) return '방금';
  if (diff > 0 && diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff > 0 && diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

window.toast = (msg) => {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
};

window.readImages = async (input) => {
  const files = [...(input.files ?? [])].slice(0, 4);
  return Promise.all(files.map((f) => new Promise((resolve, reject) => {
    if (f.size > 5 * 1024 * 1024) return reject(new Error(`${f.name}: 5MB를 넘습니다`));
    const r = new FileReader();
    r.onload = () => resolve({ name: f.name, dataUrl: r.result });
    r.onerror = () => reject(new Error('이미지를 읽지 못했습니다'));
    r.readAsDataURL(f);
  })));
};
