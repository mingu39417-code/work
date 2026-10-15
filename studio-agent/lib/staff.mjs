// 직원(에이전트) — 회사의 각 직무를 맡는 AI 직원입니다.
// 직원마다 이름 · 직무 · 성향 · 사용할 모델이 있고, 누가 무슨 일을 했는지(비용 포함) 기록됩니다.
// 고객에게 보일 때는 항상 'AI'임을 함께 표시합니다(인공지능기본법 투명성 의무).

export const ROLES = {
  am: { label: '고객관리 · 영업 (AM)', duty: '문의 응대, 요구사항 파악, 견적 · 계약, 고객 커뮤니케이션 전담' },
  pm: { label: '프로젝트 매니저 (PM)', duty: '킥오프, 일정 · 마일스톤 관리, 데일리 스탠드업 보고, 프로젝트 회고' },
  ad: { label: '아트 디렉터 (AD)', duty: '크리에이티브 방향 설정, 시안 내부 검수 · 반려, 품질 책임' },
  designer: { label: '디자이너', duty: '방향에 맞춰 실제 시안 제작, AD 피드백 반영' },
  finance: { label: '재무 · 경영지원', duty: '청구 · 입금 관리, 미수금 독촉, 월간 정산 보고' },
};

export function defaultStaff() {
  const s = (id, name, role, persona) => ({ id, name, role, title: ROLES[role].label, persona, model: '', active: true });
  return [
    s('stf_am', '김지원', 'am', '밝고 신뢰감 있는 말투. 고객의 말을 잘 정리해 되묻고, 약속은 구체적인 날짜로 한다.'),
    s('stf_pm', '박서준', 'pm', '꼼꼼하고 현실적. 일정은 여유 있게 잡고 위험 요소를 먼저 말한다.'),
    s('stf_ad', '이하늘', 'ad', '기준이 높고 솔직하다. 근거 있는 피드백만 주며, 브리프와 어긋나면 과감히 반려한다.'),
    s('stf_ds1', '정다온', 'designer', '타이포그래피와 여백을 잘 다루는 미니멀 스타일.'),
    s('stf_ds2', '최유리', 'designer', '색과 일러스트적 요소로 생동감 있게 표현하는 스타일.'),
    s('stf_fin', '한결', 'finance', '정확하고 정중하다. 숫자는 항상 근거와 함께.'),
  ];
}

export function staffOf(store, role) {
  return store.find('staff', (x) => x.role === role && x.active !== false);
}

export function lead(store, role) {
  return staffOf(store, role)[0] ?? null;
}

// 진행 중인 디자인 작업이 가장 적은 디자이너에게 배정합니다.
export function pickDesigner(store, project) {
  const designers = staffOf(store, 'designer');
  if (!designers.length) return null;
  if (project?.designerId) {
    const cur = designers.find((d) => d.id === project.designerId);
    if (cur) return cur;
  }
  const load = (d) => store.find('projects', (p) => p.designerId === d.id && ['in_progress', 'review', 'revision'].includes(p.status)).length;
  return designers.slice().sort((a, b) => load(a) - load(b))[0];
}

export function modelFor(store, staff) {
  return staff?.model || store.settings.model;
}

export function staffLabel(staff) {
  if (!staff) return 'AI 직원';
  return `${staff.name} (${ROLES[staff.role]?.label ?? staff.role} · AI)`;
}

export function staffBlock(staff) {
  if (!staff) return '';
  return `\n\n## You are this employee\n- Name: ${staff.name} — ${ROLES[staff.role]?.label}\n- Duty: ${ROLES[staff.role]?.duty}\n- Working style: ${staff.persona || '(none)'}\nYou are an AI employee. When you introduce yourself to a client, say your name and that you are the studio's AI ${ROLES[staff.role]?.label}.`;
}
