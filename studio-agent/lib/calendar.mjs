// 날짜 · 요일 확인 — 언어 모델은 요일 계산을 자주 틀립니다(예: 11월 8일(금) — 실제로는 일요일).
// 고객에게 나가는 글 · 디자인 지시 · 시안 속 날짜의 요일을 실제 달력(한국 시간)과 대조합니다.

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function kstNow(now = Date.now()) {
  return new Date(now + 9 * 3600e3);
}

// 오늘부터 며칠간의 달력 한 줄(직원 지시문에 넣어 요일을 계산하지 않고 보게 함)
export function calendarLine(days = 70, now = Date.now()) {
  const t = kstNow(now);
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + i));
    out.push(`${d.getUTCMonth() + 1}/${d.getUTCDate()}${DAYS[d.getUTCDay()]}`);
  }
  return out.join(' ');
}

function weekdayOf(month, day, now) {
  const t = kstNow(now);
  // 지난 날짜(한 달 넘게 지난)는 내년으로 봅니다
  let y = t.getUTCFullYear();
  const cand = Date.UTC(y, month - 1, day);
  if (cand < Date.UTC(y, t.getUTCMonth(), t.getUTCDate()) - 31 * 864e5) y++;
  const d = new Date(Date.UTC(y, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return null; // 없는 날짜(2월 30일 등)
  return DAYS[d.getUTCDay()];
}

// "11월 8일(금)", "8일(일)", "11.8(금)", "11/8 (금요일)" 형태를 찾아 요일이 맞는지 확인합니다.
export function checkWeekdays(text, now = Date.now()) {
  const s = String(text ?? '');
  const re = /(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일\s*\(\s*([일월화수목금토])(?:요일)?\s*\)|(\d{1,2})\s*[./]\s*(\d{1,2})\s*\(\s*([일월화수목금토])(?:요일)?\s*\)/g;
  let lastMonth = null;
  const wrong = [];
  for (const m of s.matchAll(re)) {
    let month;
    let day;
    let given;
    if (m[2]) { month = m[1] ? Number(m[1]) : lastMonth; day = Number(m[2]); given = m[3]; } else { month = Number(m[4]); day = Number(m[5]); given = m[6]; }
    if (!month || month > 12 || day > 31) continue;
    lastMonth = month;
    const real = weekdayOf(month, day, now);
    if (real && real !== given) wrong.push({ text: m[0].replace(/\s+/g, ' '), month, day, given, real });
  }
  return wrong;
}

export function weekdayProblems(text, now = Date.now()) {
  const w = checkWeekdays(text, now);
  return w.length ? w.map((x) => `${x.month}월 ${x.day}일은 ${x.real}요일입니다('${x.text}'에 ${x.given}요일로 잘못 적힘)`).join('; ') : null;
}