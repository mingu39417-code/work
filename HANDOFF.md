# HANDOFF — 이전 사이트의 작업물을 이 프로젝트로 옮기기

## 지금 상황

| | 이전 사이트 | 이 저장소 (새 사이트) |
| --- | --- | --- |
| 위치 | **본인 PC에만 있음** (Claude Code 세션 “DI 프리랜서 홈페이지”, `localhost:4173` 에서 확인하던 버전) | GitHub `mingu39417-code/work`, 브랜치 `claude/di-freelancer-homepage-ttz7z9` |
| 내용 | 30초 쇼릴, 작업 20개, 비포·애프터 슬라이더, 서비스 소개 | 디자인·기능·도구는 완성, **작업물은 비어 있음** |
| 상태 | 로컬 확인용 | 실제 배포용 (공개 동의 보호, SEO, 모바일, 문의 양식, 웹용 영상 변환 포함) |

새 사이트는 클라우드에서 만들어져서 **PC에 있는 영상·이미지·작업 정보에 접근할 수 없었습니다.**
그래서 PC에서 저장소를 받은 뒤, PC의 Claude Code에게 이전 사이트의 자료를 새 구조로 옮기도록 맡기면 됩니다.

이전 사이트에서 남아 있던 미해결 항목:

- 제목이 없는 작업 **4개**
- 클라이언트 공개 동의가 필요한 프로젝트 **5개**
- **크몽** 서비스 주소

---

## 1단계 — PC에 저장소 받기

이전 사이트 폴더와 **다른 위치**에 받으세요(이전 폴더는 그대로 둡니다).

```bash
git clone https://github.com/mingu39417-code/work
cd work
git checkout claude/di-freelancer-homepage-ttz7z9
```

준비물이 설치되어 있는지 확인합니다. 없으면 [README.md → 2. 준비물 설치](README.md#2-준비물-설치)를 따라 설치하세요.

```bash
node -v          # v18.17 이상
ffmpeg -version
```

## 2단계 — PC의 Claude Code에게 옮기기 맡기기

1. 방금 받은 `work` 폴더에서 Claude Code를 엽니다.
2. 아래 프롬프트의 `[이전 사이트 폴더 경로]` 를 실제 경로로 바꿉니다. (예: `C:\Users\사용자이름\Projects\di-homepage` — 모르면 비워 두세요. Claude가 물어봅니다)
3. 원본 마스터(ProRes 등)가 따로 있다면 `[원본 마스터 폴더 경로]` 도 적습니다. 없으면 “없음”이라고 적으세요.
4. 통째로 복사해 붙여 넣습니다.

### 붙여 넣을 프롬프트

```text
이 폴더는 내 컬러리스트 포트폴리오 사이트(TONECRAFT)의 새 버전이야. README.md를 먼저 끝까지 읽고 규칙을 따라줘.
이전 버전 사이트는 이 PC의 다른 폴더에 있어(예전 Claude Code 세션 "DI 프리랜서 홈페이지", localhost:4173에서 보던 것).
거기 있는 쇼릴 1개와 작업 20개를 이 프로젝트 구조로 옮기는 게 목표야.

- 이전 사이트 폴더: [이전 사이트 폴더 경로]
- 원본 마스터 폴더(있으면): [원본 마스터 폴더 경로]

해야 할 일:
1. 이전 사이트 폴더를 읽기 전용으로 조사해서(아무것도 수정·이동·삭제하지 말 것) 작업 20개의 정보를 정리해줘:
   제목, 클라이언트/아티스트, 장르, 연도, 설명, 크레딧, 카메라, 영상 파일, 포스터, 비포·애프터 쌍, 스틸 컷.
   이전 사이트의 서비스 소개·자기소개 문구도 찾아줘.
2. content/works.mjs 에 20개를 모두 추가해줘.
   - slug는 소문자 영어·숫자·하이픈만 (예: 'brand-film-2026'). 제목을 바탕으로 짧게.
   - category는 commercial(광고) / music-video(뮤직비디오) / film(영화·단편) / branded(브랜디드·유튜브) / product(제품·커머스) 중 가장 가까운 것. 애매하면 골라 두고 보고서에 표시.
   - 공개 동의가 필요한데 아직 받지 못한 프로젝트 5개: publish: false, consent: 'pending'.
   - 제목이 없는 작업 4개: slug 'untitled-1'~'untitled-4', title '제목 미정 1'~'제목 미정 4', publish: false.
   - 나머지 작업도 consent 값을 추측하지 말고 일단 'pending'으로 둬. 이전 사이트 자료나 메모에 동의 여부가 적혀 있으면
     근거(파일·문구)와 함께 보고서에 적고, 하나씩 나에게 확인받아줘.
     (내가 확인해 준 것만 'granted' 또는 'not-required' + publish: true 로 바꿀 것)
   - 이전 사이트에 없는 정보(클라이언트명, 연도, 크레딧 등)는 절대 지어내지 말고 '' 또는 null로 둘 것.
   - 비포·애프터가 있는 작업은 comparisons에 쌍마다 { caption, beforeLabel, afterLabel } 을 적어줘 (모르면 caption '').
3. 미디어 파일을 raw/ 로 "복사"해줘 (이동 금지). 파일 이름 규칙은 README 5장·7장 그대로:
   - 쇼릴 → raw/reel/ (파일 1개)
   - 작업 → raw/works/<slug>/main.<확장자>, poster.<확장자>, before-1/after-1 …, stills/
   - 같은 영상의 원본 마스터(ProRes, 고비트레이트)가 있으면 이전 사이트의 압축된 웹용 파일 대신 원본을 쓰고,
     웹용 파일밖에 없는 작업은 보고서에 표시해줘.
   - HDR/Rec.2020 파일이면 쓰지 말고 알려줘.
   - 1분이 넘는 긴 영상은 Vimeo/YouTube 임베드(video 필드)가 필요하다고 보고서에 표시해줘. 이미 올라가 있는 링크를 찾으면 video에 적어줘.
4. 순서대로 실행해줘: npm run media → npm run check → npm run preview (미리보기 서버는 백그라운드로 켜 두고 주소를 알려줘)
   오류가 나면 README 14장을 참고해 고치고, 고친 내용을 알려줘.
5. 이전 사이트의 서비스·소개 문구가 content/site.mjs 와 다르면 덮어쓰지 말고 차이를 보여주고 어떻게 할지 물어봐줘.
6. 마지막에 보고서를 줘:
   - 작업 20개 표: slug / 제목 / 장르 / 연도 / publish / consent / main 영상 / 포스터 / 비포·애프터 쌍 수 / 비고
   - npm run check 가 출력한 숨김 작업 목록과 이유
   - 내가 결정해야 할 것 목록 (동의 여부, 제목 미정 4개, 장르가 애매한 작업, 긴 영상 임베드 등)
   - 빌드 보고서의 큰 파일 경고(25 MB / 95 MB 초과)

지켜야 할 것:
- git commit / push 는 내가 명시적으로 요청할 때만. raw/, media/, .preview/ 는 절대 git에 올리지 말 것 (git add -f 금지).
- 동의받지 않은 클라이언트 작업의 파일이 site/ 에 들어가거나 커밋되지 않게 할 것. 커밋을 요청받으면 먼저 npm run check 의 숨김 목록과 git status 를 보여줄 것.
- src/, tools/, site/assets/ 는 내가 요청하지 않으면 수정하지 말 것.
- 이전 사이트 폴더와 원본 마스터 폴더는 읽기만 할 것.
```

## 3단계 — 확인하고 결정하기

Claude의 보고서를 보고 아래를 결정한 뒤 알려주면, `content/works.mjs` 와 `content/site.mjs` 에 반영해 줍니다.

- [ ] **제목 미정 4개**의 제목과 slug (공개한 뒤에는 slug를 바꾸지 않는 것이 좋습니다)
- [ ] **동의가 필요한 5개** — 클라이언트에게 공개 동의 요청 → 받은 것만 `consent: 'granted'` + `publish: true` (받은 날짜·방법을 주석으로 남기기)
- [ ] 나머지 작업의 동의 상태 — 동의 받음(`'granted'`) / 필요 없음(`'not-required'`) / 확인 중(`'pending'`)
- [ ] 클라이언트명·크레딧을 공개해도 되는지 (동의 범위에 포함되는지)
- [ ] 홈에서 크게 보일 대표 작업(`featured`)과 순서(`order`)
- [ ] 1분 이상 긴 영상을 Vimeo/YouTube에 올릴지 (용량 문제 → README 12장)
- [ ] **크몽** 서비스 주소 (`contact.kmongUrl`)
- [ ] 배포할 곳 (Netlify Drop / Cloudflare Pages / GitHub Pages / 일반 호스팅) → 배포 후 `siteUrl` 입력
- [ ] README 13장 「확인 필요」 체크리스트 (서비스 범위, 툴, 예산 구간, FAQ 답변 등)

## 4단계 — 배포

결정이 끝나면:

```bash
npm run check     # 숨김 목록이 예상과 같은지 확인
npm run build
npm run serve     # http://localhost:4173 에서 배포본 최종 확인
```

그다음 [README.md → 10. 배포하기](README.md#10-배포하기-파일만-올리면-끝)를 따라 `site/` 폴더를 올리고, `siteUrl` 을 입력해 한 번 더 빌드·업로드합니다.

변경 내용을 GitHub에 저장하고 싶다면 Claude Code에게 “숨김 목록과 git status 확인하고 커밋·푸시해줘”라고 요청하세요.
저장소는 **공개**이므로, 동의받지 않은 작업의 파일이 올라가지 않았는지 먼저 확인하는 것이 중요합니다.
