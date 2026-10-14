(async () => {
  try {
    const s = await api('/api/public/studio');
    document.title = `${s.studioName} — 디자인 문의`;
    $('#studio').textContent = `${s.studioName} — 디자인 문의`;
    $('#bio').textContent = s.bio || s.specialties || '';
    $('#retention').textContent = s.retention;
    $('#ai-notice').textContent = s.aiNotice;
    for (const svc of s.services) {
      const o = document.createElement('option');
      o.value = svc.id;
      o.textContent = `${svc.name} (${money(svc.basePrice, s.currency)}~)`;
      $('#serviceId').append(o);
    }
  } catch { /* 기본 문구 그대로 */ }

  $('#form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#err').textContent = '';
    const f = new FormData(e.target);
    const body = Object.fromEntries(f.entries());
    if (!body.name.trim() || !body.email.includes('@') || body.description.trim().length < 5) {
      $('#err').textContent = '이름 · 이메일 · 요청 내용을 확인해 주세요.';
      return;
    }
    if (!$('#privacyConsent').checked) {
      $('#err').textContent = '개인정보 수집 · 이용 안내에 동의해 주세요.';
      return;
    }
    body.privacyConsent = true;
    body.marketingConsent = $('#marketingConsent').checked;
    $('#submit').disabled = true;
    try {
      body.images = await readImages($('#images'));
      const r = await api('/api/public/inquiry', { method: 'POST', body });
      $('#form').classList.add('hidden');
      $('#done').classList.remove('hidden');
      $('#portal').href = r.portalUrl;
      $('#portal').textContent = `${location.origin}${r.portalUrl}`;
    } catch (err) {
      $('#err').textContent = err.message;
      $('#submit').disabled = false;
    }
  });
})();
