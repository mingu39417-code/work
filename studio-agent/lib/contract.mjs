// 디자인 용역 계약서 — 견적이 수락되면 자동으로 만들어지고, 고객이 포털에서 내용 확인 후 이름을 입력해 동의(전자 서명)합니다.
// 계약 조항은 Claude가 쓰지 않고 아래 양식(설정에서 수정 가능)에 견적 내용만 채워 넣습니다.
// 일반적인 예시 양식이므로 실제 사용 전에 전문가 검토를 권합니다.

export const DEFAULT_CONTRACT = `디자인 용역 계약서

{{studio}}(이하 "수급인")와 {{client}}(이하 "도급인")은 아래 디자인 용역에 관하여 다음과 같이 계약한다.

제1조 (용역 내용)
프로젝트: {{project}}
작업 범위:
{{scope}}

제2조 (계약 금액과 지급)
1. 계약 금액은 {{total}}(부가세 별도 여부는 견적서에 따른다)으로 한다.
2. 도급인은 계약금 {{deposit}}을 계약 체결 후 지급하고, 잔금 {{balance}}은 최종 시안 확정 후 지급한다.
3. 수급인은 계약금 입금이 확인된 후 작업을 시작한다.

제3조 (작업 기간)
작업 기간은 계약금 입금 확인일로부터 영업일 기준 {{days}}일로 한다. 도급인의 자료 제공이나 피드백이 늦어지는 경우 그만큼 연장된다.

제4조 (수정)
계약 금액에는 {{revisions}}회의 수정이 포함된다. 이를 넘는 수정은 1회당 {{extraRevisionPrice}}의 추가 비용이 발생한다. 확정된 방향을 크게 바꾸는 요청은 새 작업으로 보고 별도로 협의한다.

제5조 (저작권과 사용권)
1. 최종 확정된 결과물의 저작재산권은 잔금을 포함한 계약 금액 전액이 지급된 때 도급인에게 양도된다.
2. 확정되지 않은 시안과 작업 과정의 자료는 수급인에게 남는다.
3. 수급인은 도급인이 반대하지 않는 한 결과물을 포트폴리오로 공개할 수 있다. 도급인은 계약 체결 시 또는 그 후 언제든 이를 거부할 수 있다.

제6조 (생성형 AI 사용 고지)
수급인은 고객 응대와 시안 제작에 생성형 AI(Anthropic Claude)를 사용하며, 대표({{owner}})가 운영 · 검수한다. 도급인은 이를 확인하였다. 생성형 AI로 만든 결과물은 법령에 따라 저작권 보호 범위가 제한될 수 있으며, 상표 등록 가능 여부는 수급인이 보증하지 않는다.

제7조 (자료와 권리 보증)
도급인이 제공한 자료(로고, 사진, 문구 등)의 권리 문제는 도급인이 책임진다.

제8조 (계약 해지와 환불)
1. 작업 시작 전 도급인이 해지하면 계약금 전액을 돌려준다.
2. 작업 시작 후 도급인의 사정으로 해지하면 계약금은 돌려주지 않으며, 진행된 작업 분량에 따라 추가로 정산할 수 있다.
3. 수급인의 사정으로 계약을 이행하지 못하면 받은 금액 전액을 돌려준다.

제9조 (비밀 유지)
양 당사자는 이 계약으로 알게 된 상대방의 영업상 비밀을 제3자에게 누설하지 않는다.

제10조 (분쟁 해결)
이 계약에서 정하지 않은 사항은 관련 법령과 상관례에 따르며, 분쟁이 생기면 서로 협의하여 해결한다.

계약일: {{date}}
수급인: {{studio}} {{businessInfo}}
도급인: {{client}}`;

function wonText(settings, n) {
  try {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: settings.policy.currency || 'KRW', maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(n);
  }
}

export function renderContract(settings, { project, client, quote }) {
  const depositPct = settings.policy.requireDeposit ? Number(settings.policy.depositPercent) || 0 : 0;
  const deposit = Math.round((quote.total * depositPct) / 100);
  const studio = settings.profile.studioName || settings.profile.ownerName || '디자인 스튜디오';
  const vars = {
    studio,
    owner: settings.profile.ownerName || studio,
    businessInfo: settings.policy.businessInfo ? `(${settings.policy.businessInfo})` : '',
    client: `${client.company ? `${client.company} ` : ''}${client.name}`.trim(),
    project: project.title,
    scope: quote.items.map((i) => `- ${i.name}${i.description ? `: ${i.description}` : ''} (${wonText(settings, i.price)})`).join('\n') + (project.brief ? `\n\n[브리프 요약]\n${project.brief}` : ''),
    total: wonText(settings, quote.total),
    deposit: wonText(settings, deposit),
    balance: wonText(settings, quote.total - deposit),
    days: String(quote.timelineDays ?? '-'),
    revisions: String(quote.revisions ?? 2),
    extraRevisionPrice: wonText(settings, settings.policy.extraRevisionPrice),
    date: new Date().toISOString().slice(0, 10),
  };
  return (settings.company.contractTemplate || DEFAULT_CONTRACT).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}
