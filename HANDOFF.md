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

> **먼저 알아 둘 것 — 저장소는 공개(public)입니다.**
> `site/` 는 공개 조건을 만족한 작업만 담도록 보호되지만, `content/works.mjs` 처럼 **커밋하는 파일은 적힌 그대로 누구나 볼 수 있고, 지워도 기록에 남습니다.**
> 그래서 동의를 받기 전의 작업 정보는 git에 올라가지 않는 `content/works.private.mjs` 에만 적도록 아래 프롬프트에 정해 두었습니다. ([README 9장](README.md#저장소에-올라가는-content-도-공개됩니다))

---

## 1단계 — PC에 저장소 받기

1. **(권장) 저장소를 비공개로 바꾸기** — GitHub Pages로 배포할 계획이 아니라면(Netlify Drop · Cloudflare Pages · 일반 호스팅은 GitHub가 필요 없음)
   GitHub 저장소 페이지 → **Settings → General → 맨 아래 Danger Zone → Change repository visibility → Make private**.
   무료 요금제의 GitHub Pages는 공개 저장소에서만 동작하므로, GitHub Pages를 쓸 거라면 공개로 두세요. 어느 쪽이든 아래 규칙은 똑같이 지킵니다.
2. 이전 사이트 폴더와 **다른 위치**에 받으세요(이전 폴더는 그대로 둡니다). 비공개로 바꿨다면 GitHub 로그인 창이 뜹니다.

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

원본 마스터(ProRes 등)를 `raw/` 로 **복사**하므로 디스크 여유 공간이 넉넉해야 합니다. ProRes 422 HQ는 24p 기준 1080p 1분에 약 1.3 GB, UHD 1분에 약 5 GB입니다.

## 2단계 — PC의 Claude Code에게 옮기기 맡기기

### (선택) 먼저 이전 세션에서 메모 남기기

새 `work` 폴더에서 연 Claude Code는 **새 세션**이라, 이전 세션(“DI 프리랜서 홈페이지”)에서 나눈 대화 — 동의가 필요한 5개가 어느 작업인지, 제목 미정 4개가 무엇인지 — 를 모릅니다.
이전 세션이 남아 있다면 그 세션에 먼저 이렇게 요청해 두세요.

```text
이 사이트의 작업 20개와 쇼릴에 대해 아는 것을 이 폴더에 handoff-notes.md 로 정리해줘:
작업별 제목, 클라이언트/아티스트, 공개 동의가 필요한지(동의 필요 5개가 어느 것인지), 제목 미정 4개가 어느 것인지,
영상·이미지 파일 위치, 원본 마스터 위치, 쇼릴에 들어간 작업, 이미 정해 둔 결정 사항. 다른 파일은 고치지 말 것.
```

### 붙여 넣기

1. 방금 받은 `work` 폴더에서 Claude Code를 **새로** 엽니다. (아래 프롬프트는 이전 세션이 아니라 새 세션에 붙여 넣습니다)
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
1. 이전 사이트 폴더를 읽기 전용으로 조사해서(아무것도 수정·이동·삭제하지 말 것) 작업 20개의 정보를 정리해줘.
   그 폴더에 handoff-notes.md 가 있으면 먼저 읽어줘(이전 세션이 남긴 메모).
   제목, 클라이언트/아티스트, 장르, 연도, 설명, 크레딧, 카메라, 영상 파일, 포스터, 비포·애프터 쌍, 스틸 컷,
   대사·내레이션이 있는지와 자막이 영상에 입혀져 있는지(알 수 있으면).
   이전 사이트의 서비스 소개·자기소개 문구도 찾아줘.
2. 작업 20개를 content/works.private.mjs 에 모두 적어줘 (README 5장 ③·9장). content/works.mjs 는 비워 둘 것.
   works.mjs 는 공개 저장소에 그대로 올라가서, 동의받지 않은 작업의 제목·클라이언트·크레딧·영상 링크가 공개되기 때문이야.
   works.private.mjs 는 .gitignore 로 제외되어 있고, 형식은 works.mjs 와 같아 (export default [ ... ];, UTF-8로 저장).
   - slug는 소문자 영어·숫자·하이픈만 (예: 'brand-film-2026'). 제목을 바탕으로 짧게. 클라이언트·브랜드 이름은 slug에 넣지 말 것.
   - category는 commercial(광고) / music-video(뮤직비디오) / film(영화·단편) / branded(브랜디드·유튜브) / product(제품·커머스) 중 가장 가까운 것. 애매하면 골라 두고 보고서에 표시.
   - 공개 동의가 필요한데 아직 받지 못한 프로젝트 5개: publish: false, consent: 'pending'.
   - 제목이 없는 작업 4개: slug 'untitled-1'~'untitled-4', title '제목 미정 1'~'제목 미정 4', publish: false.
   - 나머지 작업도 consent 값을 추측하지 말고 일단 'pending'으로 둬. 이전 사이트 자료나 메모에 동의 여부가 적혀 있으면
     근거(파일·문구)와 함께 보고서에 적고, 하나씩 나에게 확인받아줘.
     (내가 확인해 준 것만 'granted' 또는 'not-required' + publish: true 로 바꾸고, 그 작업 블록을 works.mjs 로 옮길 것)
   - 이전 사이트에 없는 정보(클라이언트명, 연도, 크레딧 등)는 절대 지어내지 말고 '' 또는 null로 둘 것.
   - 비포·애프터가 있는 작업은 comparisons에 쌍마다 { caption, beforeLabel, afterLabel } 을 적어줘 (모르면 caption '').
3. 미디어 파일을 raw/ 로 "복사"해줘 (이동 금지). 파일 이름 규칙은 README 5장·7장 그대로.
   복사하기 전에 복사할 파일의 예상 총 용량과 이 드라이브의 여유 공간을 보고하고, 내 확인을 받은 뒤 복사할 것.
   - 쇼릴 → raw/reel/ (영상 파일 1개). content/site.mjs 의 reel.consent 는 'pending' 그대로 둘 것.
     쇼릴에 어떤 작업의 장면이 들어 있는지 알 수 있으면 보고서에 적고, 동의 대기 작업의 장면이 있으면 알려줄 것.
   - 작업 → raw/works/<slug>/main.<확장자>, poster.<확장자>, before-1/after-1 …, stills/
   - 같은 영상의 원본 마스터(ProRes, 고비트레이트)가 있으면 이전 사이트의 압축된 웹용 파일 대신 원본을 쓰고,
     웹용 파일밖에 없는 작업은 보고서에 표시해줘.
   - HDR/Rec.2020 파일이면 쓰지 말고 알려줘.
   - 1분이 넘는 긴 영상은 Vimeo/YouTube 임베드(video 필드)가 필요하다고 보고서에 표시해줘.
     이미 올라가 있는 링크를 찾으면 works.private.mjs 의 그 작업 video 에 적어줘 (비공개 Vimeo 주소도 works.mjs 에는 적지 말 것).
4. 순서대로 실행해줘: npm run media → npm run check → npm run preview (미리보기 서버는 백그라운드로 켜 두고 주소를 알려줘)
   - npm run media 는 작업 20개면 몇 시간 걸릴 수 있어. 백그라운드로 실행하거나 slug별로 나눠 실행해줘.
     중간에 멈춰도 다시 실행하면 끝난 파일은 건너뛰고 이어서 처리돼.
   - 1분 넘는 영상이 있으면 npm run media 전에 나에게 임베드(Vimeo/YouTube)로 할지 먼저 물어봐줘.
     video 가 적혀 있으면 긴 main.mp4 인코딩을 건너뛰어.
   - 오류가 나면 README 14장을 참고해 고치고, 고친 내용을 알려줘.
5. 이전 사이트의 서비스·소개 문구가 content/site.mjs 와 다르면 덮어쓰지 말고 차이를 보여주고 어떻게 할지 물어봐줘.
6. 마지막에 보고서를 줘:
   - 작업 20개 표: slug / 제목 / 장르 / 연도 / publish / consent / main 영상 / 포스터 / 비포·애프터 쌍 수 / 대사·자막 / 비고
   - npm run check 가 출력한 숨김 작업 목록과 이유, 그리고 경고 전체
   - 쇼릴에 들어간 작업(알 수 있는 만큼)과 그중 동의 대기 작업
   - 내가 결정해야 할 것 목록 (동의 여부, 제목 미정 4개, 장르가 애매한 작업, 긴 영상 임베드, 쇼릴 공개, 자막이 필요한 작업 등)
   - 빌드 보고서의 큰 파일 경고(25 MB / 95 MB 초과)

지켜야 할 것:
- git commit / push 는 내가 명시적으로 요청할 때만. raw/, media/, .preview/, content/works.private.mjs 는 절대 git에 올리지 말 것 (git add -f 금지).
- content/works.mjs 는 공개 저장소에 그대로 공개돼. 공개가 확정되지 않은 작업(publish: false 또는 consent: 'pending')은
  제목까지 포함해 content/works.private.mjs 에만 적을 것. 동의 기록(날짜·방법)도 works.mjs 주석에 쓰지 말 것.
- 동의받지 않은 클라이언트 작업의 파일이 site/ 에 들어가거나 커밋되지 않게 할 것.
- 커밋을 요청받으면 먼저 npm run check 의 숨김 목록·경고, git status, git diff --cached content/ 를 보여줄 것.
  works.mjs 에 publish: false 또는 consent: 'pending' 작업이 있거나, raw/·media/·.preview/·works.private.mjs 가 목록에 있으면 커밋하지 말 것.
- src/, tools/, site/assets/ 는 내가 요청하지 않으면 수정하지 말 것.
- 이전 사이트 폴더와 원본 마스터 폴더는 읽기만 할 것.
```

## 3단계 — 확인하고 결정하기

Claude의 보고서를 보고 아래를 결정한 뒤 알려주면, `content/works.private.mjs` · `content/works.mjs` · `content/site.mjs` 에 반영해 줍니다.

- [ ] **제목 미정 4개**의 제목과 slug (공개한 뒤에는 slug를 바꾸지 않는 것이 좋습니다)
- [ ] **동의가 필요한 5개** — 클라이언트에게 공개 동의 요청 → 받은 것만 `consent: 'granted'` + `publish: true` 로 바꾸고 `works.mjs` 로 옮기기
      (받은 날짜·방법은 메일함 등 저장소 밖에 보관)
- [ ] 나머지 작업의 동의 상태 — 동의 받음(`'granted'`) / 필요 없음(`'not-required'`) / 확인 중(`'pending'`, `works.private.mjs` 에 그대로)
- [ ] 클라이언트명·크레딧을 공개해도 되는지 (동의 범위에 이름 공개까지 포함되는지)
- [ ] **쇼릴에 동의 대기 작업의 장면이 없는지** → 있으면 그 장면을 뺀 쇼릴로 교체(이전 파일은 `raw/reel/` 에서 삭제), 확인 후 `reel.consent: 'granted'`
      (모두 본인 작업이면 `'not-required'`) — [README 6장](README.md#6-쇼릴-교체하기)
- [ ] 대사·내레이션이 있는 작업의 **자막** — 자막을 입혀 다시 내보낼지, YouTube/Vimeo 자막으로 연결할지 ([README 5장](README.md#대사내레이션이-있는-작업은-자막이-필요합니다))
- [ ] 홈에서 크게 보일 대표 작업(`featured`)과 순서(`order`)
- [ ] 1분 이상 긴 영상을 Vimeo/YouTube에 올릴지 (용량 문제 → README 12장)
- [ ] **크몽** 서비스 주소 (`contact.kmongUrl`)
- [ ] 배포할 곳 (Netlify Drop / Cloudflare Pages / GitHub Pages / 일반 호스팅) → 배포 후 `siteUrl` 입력.
      GitHub Pages가 아니면 저장소를 비공개로 바꾸기(1단계)
- [ ] README 13장 「확인 필요」 체크리스트 (서비스 범위, 장르, 툴, 예산 구간, FAQ 답변, 검색 설명 등)

## 4단계 — 배포

결정이 끝나면:

```bash
npm run check     # 숨김 목록과 경고가 예상과 같은지 확인
npm run build
npm run serve     # 미리보기 서버가 켜져 있으면 먼저 Ctrl+C 로 끄세요. 화면에 표시된 주소(보통 http://localhost:4173)에서
                  # 배포본 확인 — 상단에 PREVIEW 띠가 보이면 배포본이 아니라 미리보기입니다
```

그다음 [README.md → 10. 배포하기](README.md#10-배포하기-파일만-올리면-끝)를 따라 `site/` 폴더를 올리고, `siteUrl` 을 입력해 한 번 더 빌드·업로드합니다.

변경 내용을 GitHub에 저장하고 싶다면 Claude Code에게 이렇게 요청하세요.

```text
숨김 목록·경고, git status, git diff --cached content/ 를 보여주고,
works.mjs 에 공개 확정 안 된 작업이 없으면 커밋·푸시해줘
```

`content/works.mjs` 는 커밋하는 순간 공개되고 기록에 남으므로, 동의받지 않은 작업의 정보나 파일이 올라가지 않는지 먼저 확인하는 것이 중요합니다.
나중에 공개를 취소하거나 동의가 철회되면 [README 9장 「공개를 취소하거나 동의가 철회됐을 때」](README.md#공개를-취소하거나-동의가-철회됐을-때)를 따르세요.
