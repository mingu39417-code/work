# 인수인계 — 내 PC(D 드라이브)의 Claude Code에서 이어서 작업하기

이 프로그램은 지금까지 클라우드 Claude Code 세션에서 만들었습니다. 클라우드 세션은 대표님 PC에 직접 옮겨 갈 수 없으므로, PC에서 **새 Claude Code 세션**을 열고 아래 프롬프트를 붙여 넣으면 이어서 작업할 수 있습니다. 코드는 모두 GitHub 브랜치에 올라가 있어 아무것도 잃지 않습니다.

## 1. D 드라이브에 받기

PC에 [Git](https://git-scm.com) · [Node.js LTS](https://nodejs.org) · [Claude Code](https://claude.com/claude-code)가 있어야 합니다. 명령 프롬프트(cmd)에서:

```bat
D:
cd \
git clone https://github.com/mingu39417-code/work
cd work
git checkout claude/great-feynman-9jhf0o
claude
```

(저장소가 비공개면 GitHub 로그인 창이 뜹니다.)

## 2. Claude Code에 붙여 넣을 프롬프트

```text
studio-agent/ 폴더의 프로그램을 이어서 개발한다. 먼저 studio-agent/HANDOFF.md 와 studio-agent/README.md 를 끝까지 읽고 구조를 파악해.
그다음 cd studio-agent && npm install && npm test 로 테스트가 모두 통과하는지 확인하고 결과를 알려줘.
작업 브랜치는 claude/great-feynman-9jhf0o. HANDOFF.md 의 "지켜야 할 규칙"은 절대 어기지 말 것.
다음 할 일 목록 중 무엇부터 할지 나에게 물어봐.
```

## 3. 지금 상태 (2026-10-15)

AI 직원으로 운영하는 디자인 외주 회사. Node.js(ESM) 서버 하나 + 브라우저 화면, DB는 `data/db.json`.

| 영역 | 파일 | 상태 |
| --- | --- | --- |
| 서버 · API · 인증 | `server.mjs` | 완료 |
| 직원 · 직무 · 배정 | `lib/staff.mjs` | 완료 (11명: AM 2 · BD · PM 2 · AD · 카피 · 디자이너 3 · 재무, 프로필 · 업무 원칙 · 전문/한도 기반 배정) |
| AM (고객 응대 · 견적 · 청구 · 영업) | `lib/agent.mjs`, `lib/prompts.mjs` | 완료 — 도구 사용 루프 |
| 디자인팀 (AD 방향 → 제작 → AD 검수 · 반려) | `lib/designer.mjs` | 완료 — 구조화 출력 + 스트리밍 |
| PM · 재무 (킥오프 · 스탠드업 · 회고 · 점검 · 집계) | `lib/pm.mjs` | 완료 |
| 계약서 | `lib/contract.mjs` | 완료 — 양식 기반(Claude가 조항을 쓰지 않음) |
| 업무 규칙 · 결재 · 납품 | `lib/actions.mjs` | 완료 |
| 작업 대기열 · 재시도 · 예산 | `lib/scheduler.mjs` | 완료 |
| Gmail 발송 · 받은편지함 | `lib/mailer.mjs`, `lib/inbox.mjs` | 코드 완료, **실제 계정으로는 미검증** |
| 계정 비밀번호 암호화 | `lib/vault.mjs` | 완료 |
| 화면 | `public/` (dashboard · portal · inquiry · unsubscribe) | 완료 |
| 테스트 | `tests/` — 가짜 Claude로 26개 | 모두 통과 |

## 4. 다음 할 일 (우선순위 순)

1. **실제 Claude API 키로 연습 모드 한 바퀴** — 대시보드 → 연습 · 학습에서 로고 의뢰를 끝까지 진행해 보고, 프롬프트 · 비용 · 시안 품질을 다듬기 (지금까지는 가짜 Claude로만 검증)
2. **실제 Gmail 계정 연결 확인** — 계정 화면 '연결 확인', 답장 스레드 · 새 문의 생성 · 납품 메일 첨부 확인
3. ~~인스타그램 · Threads 공식 API 연동~~ 완료(2026-10-15, `lib/social.mjs` — 동의 작업 게시 · 내 게시물 댓글 응대 · 토큰 갱신). 남은 것: 실제 Meta 계정으로 검증, 이미지용 외부 공개 주소(예: Cloudflare Tunnel), 인스타그램 DM 응대(24시간 응답 창 규칙). 네이버 블로그는 글쓰기 API가 2020년 종료돼 제외(대표 결정)
4. ~~시안 PNG 변환~~ 완료(2026-10-15, `lib/finals.mjs` — 확정 시 납품용 SVG 세트 + resvg PNG, ZIP 납품). 남은 것: PDF, 글자를 윤곽선으로 바꾼 SVG(인쇄소 요청 대비)
5. ~~포트폴리오 게시 동의 체크박스~~ 완료(견적 수락 때 선택 2개: 게시 · 업체명 표시)
7. **최종 결정(2026-10-16): 인스타그램 카드뉴스 완전 자동**(Threads 숨김, WordPress 꺼짐 — 대표: 워드프레스 유료). `lib/igcards.mjs`(카드) · `lib/mediatunnel.mjs`(cloudflared 임시 이미지 주소, 실제 시험 통과) · `igDue` 일정. 남은 것: 대표가 인스타 프로페셔널 계정 · Meta 개발자 앱 · 토큰 연결 후 실제 첫 게시 확인.
   이전 결정 — 블로그(대표 결정: 인스타 · Threads 대신 블로그만) — 완전 자동은 WordPress.com(`lib/wordpress.mjs`, 공식 API · 발행 일정). 네이버는 SmartEditor가 스크립트 입력을 막아(실제 시도 결과 title:fail · body:empty) 확장이 '제목 복사 · 본문 복사' 버튼으로 돕는 반자동. 디버거 기반 실제 입력은 이 환경의 안전 검사에서 막혀 보류.
   이전 메모: — `lib/blog.mjs` + 크롬 확장 `naver-helper/`. 남은 것: **실제 네이버 글쓰기 창에서 자동 채우기 확인**(SmartEditor는 로그인이 필요해 아직 실제로 못 돌려 봄 — 첫 시도 결과가 글의 fillReport에 남음). 인스타 · Threads 코드는 남아 있고 settings.social.enabled 로 켬
8. 2026-10-15 팀워크 연습(요가 SNS · 빵집 포스터 동시) 결과로 고친 것: 작업 줄 분리(디자인이 고객 응대를 막지 않음), 달력 기반 요일 검사(지시 · 고객 메시지 · 시안), 연습에도 PM 킥오프, 고객용 시안 설명과 사내 메모 분리. 학습 노트 3개 채택
6. 결제 대행(PG) 연동으로 입금 확인 자동화 (지금은 대표가 확인)

## 5. 지켜야 할 규칙 (대표 요청: "법적인 문제가 생기면 절대 안 됨")

- **SNS를 아이디 · 비밀번호로 로그인해 자동 조작하지 않는다** (플랫폼 약관 위반 · 계정 정지). 공식 API만 쓴다.
- **광고성 메일 · DM은 수신 동의자 또는 6개월 내 거래 고객에게만** (정보통신망법 제50조). 제목 (광고), 보낸 사람 · 연락처, 수신거부 방법 필수, 거부 시 영구 차단. `outreachBlocked()` · `adMessage()` 를 우회하지 말 것.
- **AI 사용 고지는 끌 수 없다** (인공지능기본법 투명성 의무) — 첫 답장 · 메일 · 포털 · 시안 'AI 생성' 표시. 직원은 사람인 척하지 않는다.
- 개인정보 수집 · 국외 이전 동의(문의 양식), `/privacy` 안내 유지.
- 가격 하한 · 계약서 서명 · 계약금 · 수정 횟수 · 청구 한도 · 정산 후 원본 공개 규칙은 **코드에서** 강제한다(프롬프트에만 맡기지 않음).
- 비밀번호 · API 키는 `data/` 에만(암호화), git에 올리지 않는다. 채팅으로 받지 않는다.
- 계약서 · 개인정보 안내는 예시 양식이므로 실제 운영 전 전문가 검토를 권한다고 계속 안내한다.

## 6. 개발 관례

- 주석 · 화면 문구는 한국어, 대표님(비개발자)이 읽을 수 있게.
- Claude 호출은 `lib/claude.mjs` 의 `llm.create` / `llm.stream` 만 사용 (비용 기록 · 예산 · 거절 시 대체 모델 `fallbacks: "default"`). 기본 모델 `claude-opus-5-5`, 직원별로 바꿀 수 있음.
- 대화 기록은 덧붙이기만 한다(이전 메시지 수정 금지 — 생각 블록 유지).
- 테스트는 `tests/helpers.mjs` 의 가짜 Claude로 — API 비용 없이 `npm test`.
- 의존성 버전은 출시 2주 이상 지난 것을 고정 버전으로.
