# TONECRAFT — 컬러리스트 임민규 포트폴리오 사이트

컬러 그레이딩 · DI 작업을 소개하는 포트폴리오 웹사이트와, 그 사이트를 만드는 도구 모음입니다.

- **내용(문구·작업 목록)** 은 `content/` 폴더의 파일만 고치면 됩니다. 아직 공개하지 않을 작업은 git에 올라가지 않는 `content/works.private.mjs` 에 적습니다([9장](#저장소에-올라가는-content-도-공개됩니다)).
- **영상·이미지** 는 DaVinci Resolve에서 내보낸 원본을 `raw/` 폴더에 넣고 `npm run media` 한 번이면 웹용으로 변환됩니다.
- **배포** 는 완성된 `site/` 폴더를 호스팅 서비스에 그대로 올리는 방식입니다. 서버·데이터베이스·빌드 설정이 필요 없습니다.
- 외부 라이브러리를 쓰지 않아서 `npm install` 이 필요 없습니다. Node.js와 ffmpeg만 설치하면 됩니다.

> Claude Code에게 맡길 때는 이 문서를 기준으로 “작업 추가해줘”, “쇼릴 바꿔줘”처럼 요청하면 됩니다.
> 이전 PC의 사이트에서 작업물을 옮겨 오는 방법은 **[HANDOFF.md](HANDOFF.md)** 에 따로 정리했습니다.

---

## 목차

1. [폴더 구조](#1-폴더-구조)
2. [준비물 설치](#2-준비물-설치)
3. [빠른 시작](#3-빠른-시작)
4. [명령어 한눈에 보기](#4-명령어-한눈에-보기)
5. [작업 추가하기 (단계별)](#5-작업-추가하기-단계별)
6. [쇼릴 교체하기](#6-쇼릴-교체하기)
7. [비포·애프터 만들기](#7-비포애프터-만들기)
8. [문의 연락처 · 크몽 · 문의 양식 설정](#8-문의-연락처--크몽--문의-양식-설정)
9. [공개 규칙과 동의 관리](#9-공개-규칙과-동의-관리)
10. [배포하기 (파일만 올리면 끝)](#10-배포하기-파일만-올리면-끝)
11. [DaVinci Resolve 내보내기 권장 설정](#11-davinci-resolve-내보내기-권장-설정)
12. [용량이 큰 영상 다루기](#12-용량이-큰-영상-다루기)
13. [확인 필요 체크리스트](#13-확인-필요-체크리스트)
14. [문제 해결](#14-문제-해결)

---

## 1. 폴더 구조

```
work/
├─ content/                 ← 직접 고치는 곳
│  ├─ site.mjs              사이트 전체 문구·연락처·서비스·FAQ·SEO 설정
│  ├─ works.mjs             공개할 작업(포트폴리오) 목록 — 저장소(GitHub)에 올라감
│  └─ works.private.mjs     아직 공개하지 않을 작업 목록 (직접 만듦 · git에 올라가지 않음 → 9장)
├─ raw/                     ← Resolve에서 내보낸 원본을 넣는 곳 (git에 올라가지 않음)
│  ├─ reel/                 쇼릴 영상 1개 (+ 선택: poster.jpg)
│  └─ works/<slug>/         작업별 원본 (main, poster, before-1, after-1, stills/ …)
├─ media/                   웹용으로 변환된 파일 (npm run media 가 만듦, git에 올라가지 않음)
├─ site/                    ← 배포할 폴더 (이 폴더를 통째로 업로드)
│  ├─ index.html, works/…   npm run build 가 만듦 — 직접 고치지 마세요
│  ├─ media/                공개된 작업의 미디어만 자동 복사됨
│  └─ assets/               디자인(CSS)·스크립트·폰트·아이콘
├─ .preview/                미리보기 빌드 (비공개 작업 포함 — 절대 업로드 금지, git 제외)
├─ .demo/                   데모 프로젝트 (npm run demo, git 제외)
├─ src/templates/           페이지 HTML 틀 (디자인을 바꿀 때만)
├─ tools/                   빌드·미디어 변환·로컬 서버 도구
├─ tests/                   자동 테스트
├─ README.md                이 문서
└─ HANDOFF.md               이전 사이트에서 작업물 옮겨 오기
```

**요약**: 평소에는 `content/` 와 `raw/` 만 만지고, 명령어를 실행한 뒤 `site/` 를 올리면 됩니다.
`site/` 안의 HTML은 매번 새로 만들어지므로 직접 고쳐도 다음 빌드 때 덮어써집니다.

---

## 2. 준비물 설치

| 프로그램 | 버전 | 용도 |
| --- | --- | --- |
| **Node.js** | 18.17 이상 (LTS 권장) | 사이트 빌드·로컬 서버 |
| **ffmpeg** (ffprobe 포함) | 최신 | 영상·이미지 변환 (`npm run media`) |
| **Git** | 최신 | 저장소 받기·배포 (GitHub 사용 시) |

### Windows

PowerShell 또는 터미널에서:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Gyan.FFmpeg
winget install Git.Git
```

설치 후 **터미널을 완전히 닫았다가 다시 열어야** 명령어가 인식됩니다.

### macOS

[Homebrew](https://brew.sh)가 있다면:

```bash
brew install node ffmpeg git
```

(Node.js는 [nodejs.org](https://nodejs.org)의 LTS 설치 파일로 설치해도 됩니다.)

### 설치 확인

```bash
node -v        # v18.17 이상이면 OK (예: v22.x)
ffmpeg -version
ffprobe -version
```

ffmpeg를 PATH에 넣지 않고 쓰고 싶다면(또는 설치했는데도 `ffmpeg을 찾을 수 없습니다` 가 나오면) 환경 변수 `FFMPEG_PATH`, `FFPROBE_PATH` 에
실행 파일 경로를 지정합니다. 사용하는 터미널에 맞는 줄을 쓰세요(경로는 실제 설치 위치로 바꾸세요).

```text
PowerShell         $env:FFMPEG_PATH="C:\ffmpeg\bin\ffmpeg.exe"; $env:FFPROBE_PATH="C:\ffmpeg\bin\ffprobe.exe"; npm run media
명령 프롬프트(cmd)  set "FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe" && set "FFPROBE_PATH=C:\ffmpeg\bin\ffprobe.exe" && npm run media
macOS 터미널        FFMPEG_PATH=/opt/homebrew/bin/ffmpeg FFPROBE_PATH=/opt/homebrew/bin/ffprobe npm run media
```

---

## 3. 빠른 시작

```bash
# 1) 저장소 받기
git clone https://github.com/mingu39417-code/work
cd work
git checkout claude/di-freelancer-homepage-ttz7z9

# 2) (선택) 데모로 완성된 모습 먼저 보기 — ffmpeg로 가짜 영상을 만들어 작업 여러 개를 채워 줍니다
npm run demo
node tools/serve.mjs --root .demo          # → http://localhost:4173

# 3) 내 사이트 검사 · 빌드 · 확인
npm run check                               # 오류·경고만 확인 (파일을 쓰지 않음)
npm run build                               # site/ 생성
npm run serve                               # → http://localhost:4173 에서 배포본 확인
```

서버는 `Ctrl + C` 로 끕니다. 서버가 켜질 때 `http://192.168.x.x:4173` 같은 주소도 함께 표시되는데,
**같은 와이파이의 휴대폰**에서 그 주소로 들어가면 모바일 화면을 바로 확인할 수 있습니다.

> 작업이 아직 하나도 없으면 홈의 작업 섹션에 “작업물을 정리하고 있습니다” 안내가 대신 표시됩니다.
> 쇼릴이 없으면 첫 화면은 벡터스코프 그래픽이 들어간 타이포그래피 화면으로 나옵니다. 둘 다 정상입니다.
> 쇼릴 파일이 있어도 공개 동의를 확인하기 전(`reel.consent: 'pending'`)에는 배포본에 나오지 않습니다 → [6장](#6-쇼릴-교체하기).

---

## 4. 명령어 한눈에 보기

| 명령어 | 하는 일 |
| --- | --- |
| `npm run build` | 배포용 사이트를 `site/` 에 만듭니다. **공개 조건을 만족한 작업만** 들어갑니다. |
| `npm run check` | 내용 검사와 보고만 합니다. 파일은 쓰지 않습니다. 배포 전 습관처럼 실행하세요. |
| `npm run preview` | 비공개 작업까지 포함한 미리보기를 `.preview/` 에 만들고 http://127.0.0.1:4173 (`localhost:4173` 과 같음) 에서 보여줍니다. 이 컴퓨터에서만 열립니다(휴대폰으로 보려면 `npm run preview -- --lan`). |
| `npm run serve` | `site/` (배포본)를 http://localhost:4173 에서 보여줍니다. |
| `npm run media` | `raw/` 원본을 웹용으로 변환해 `media/` 에 저장합니다. 바뀐 파일만 다시 처리합니다. |
| `npm run demo` | 데모 프로젝트를 `.demo/` 에 만들고 빌드합니다. 확인: `node tools/serve.mjs --root .demo` |
| `npm test` | 자동 테스트(콘텐츠 검사·화면 템플릿·빌드·미디어 변환·서버)를 실행합니다. 브라우저 테스트는 아래 [브라우저 테스트](#브라우저-테스트-선택) 참고. |

### 옵션

npm 명령에 옵션을 붙일 때는 **`--` 뒤에** 적습니다. (`node tools/...` 로 직접 실행해도 같습니다.)

```bash
npm run media -- brand-film-2026         # 이 작업만 변환
npm run media -- --reel                  # 쇼릴만 변환
npm run media -- --force                 # 이미 만든 것도 전부 다시 변환
npm run media -- --dry-run               # 무엇을 할지 보여주기만
npm run serve -- --port 5000             # 다른 포트로 서버 열기
npm run preview -- --lan                 # 미리보기를 같은 와이파이의 휴대폰에서도 열기
```

| 도구 | 옵션 |
| --- | --- |
| `tools/build.mjs` | `--root <폴더>` `--preview` `--check` `--quiet` |
| `tools/media.mjs` | `[slug ...]` `--reel` `--force` `--dry-run` `--root <폴더>` |
| `tools/serve.mjs` | `--root <폴더>` `--port <번호>` (기본 4173, 사용 중이면 다음 번호) `--host <주소>` (기본: 배포본 0.0.0.0, 미리보기 127.0.0.1) `--preview` `--lan` (미리보기를 같은 네트워크에도 열기) |
| `tools/demo.mjs` | `--force` (데모 원본·미디어를 모두 다시 만들기) `--root <폴더>` (기본 `.demo`) |

미디어 변환 속도·품질은 환경 변수로 조절할 수 있습니다: `TONECRAFT_X264_PRESET` (기본: 전체 영상 `slow`, 나머지 `medium` — 급할 때 `veryfast`. `ultrafast` 는 화질 프로필이 낮아지므로 쓰지 마세요), `TONECRAFT_MEDIA_JOBS` (동시에 처리할 파일 수).

### 브라우저 테스트 (선택)

`tests/e2e.mjs` 는 실제 브라우저(Playwright의 Chromium)로 사이트를 열어 메뉴, 쇼릴 재생·창, 밝은 화면 위 첫 화면 글자 대비, 필터, 카드 미리보기, 비포·애프터 드래그·터치·키보드·영상 비교,
작업 페이지 링크, 문의 양식(검사·메일 구성·복사·임시 저장), 404, 가로 넘침을 데스크톱·모바일 크기에서 확인합니다.
Playwright는 이 프로젝트에 포함되지 않으므로(의존성 0개 원칙) 따로 설치된 경우에만 실행됩니다.

```bash
npm run demo                                              # 테스트할 데모 사이트 준비
npm install --no-save playwright && npx playwright install chromium   # 처음 한 번 (선택)
node tests/e2e.mjs                 # .demo 검사  (--root . 이면 실제 site/ 검사)
```

`AXE_PATH=<axe-core의 axe.min.js 경로>` 를 함께 주면 접근성 검사(axe-core)도 실행합니다. Playwright가 없으면 안내만 출력하고 건너뜁니다.

### 구현 메모 (처음 설계와 달라진 동작)

사이트를 고치는 사람(또는 Claude Code)이 참고할 내용입니다. 테스트(`tests/`)도 이 동작을 기준으로 합니다.

- **첫 화면 배경 영상 버튼**: 이름(`aria-label`)은 항상 “배경 영상 일시정지”이고, 멈춘 상태는 `aria-pressed="true"` 로만 알립니다(ARIA 토글 버튼 권장 방식 — 이름과 눌림 상태를 함께 바꾸면 스크린리더가 반대로 읽습니다).
  눌림 상태는 화면의 ▶/❚❚ 아이콘과 같아서, 영상이 아직 로드 중이거나 브라우저가 멈춘 동안에도 ▶(눌림)로 표시됩니다.
- 메뉴 링크(`/#contact` 등)로 페이지 중간에 바로 들어오면 첫 화면 배경 영상을 받지 않고, 첫 화면으로 올라왔을 때 받아서 재생합니다.
- **비포·애프터 슬라이더 키보드**: ←/→ 2%씩(2% 눈금에 맞춤), Shift+←/→ 10%씩, Home/End 양 끝. 스크린리더에는 “LOG 40% · GRADED 60%” 처럼 라벨과 비율을 읽어 줍니다.
- **작업 페이지 플레이어 크기**: 직접 호스팅 영상과 Vimeo/YouTube 연결 작업은 원본 영상의 화면비(검은 띠 포함)로, 영상 없는 작업은 (띠를 잘라낸) 포스터 화면비로 잡습니다.

---

## 5. 작업 추가하기 (단계별)

예시: 2026년 광고 작업 “브랜드 필름”을 추가한다고 가정합니다.

### ① slug(영문 주소 이름) 정하기

- 소문자 영어, 숫자, 하이픈(`-`)만 사용합니다. 예: `brand-film-2026`, `summer-lookbook-mv`
- 사이트 주소(`works/brand-film-2026/`)와 원본 폴더 이름으로 쓰입니다. 주소에 그대로 보이므로, 클라이언트가 이름 공개에 동의하지 않았다면 slug에도 브랜드·아티스트 이름을 넣지 마세요.
- 한 번 공개한 뒤에는 바꾸지 않는 것이 좋습니다(공유된 링크가 깨집니다).

### ② 원본 파일을 `raw/works/<slug>/` 에 넣기

```
raw/works/brand-film-2026/
├─ main.mov            완성된 전체 영상 (선택 · mp4 mov mxf mkv m4v avi webm)
├─ poster.jpg          대표 이미지 (선택 · 없으면 main 영상에서 자동으로 한 장 뽑음)
├─ before-1.png        비포·애프터 1번 쌍 — before와 after 둘 다 있어야 합니다
├─ after-1.png
├─ before-2.mov        2번 쌍 (이미지 대신 영상도 가능)
├─ after-2.mov
└─ stills/             추가 스틸 컷 (선택 · 파일 이름순으로 표시 — 탐색기처럼 1, 2, 10 순서)
   ├─ 01.png
   └─ 02.png
```

- 이미지 형식: jpg jpeg png tif tiff webp bmp dpx (대소문자 무관)
- 파일 이름은 위 규칙(`main`, `poster`, `before-숫자`, `after-숫자`)을 지켜야 인식됩니다. 규칙에 맞지 않는 파일은 무시되고, 무시된 파일 목록이 화면에 표시됩니다.
- **포스터는 반드시 필요합니다.** `poster.*` 가 없으면 `main` 영상에서, `main` 도 없으면 `after-1` 에서 만듭니다. 셋 다 없으면 그 작업은 공개되지 않습니다.
- 원본은 삭제되지 않습니다. 도구는 `raw/` 를 읽기만 합니다.

### ③ 작업 정보 적기 — 처음에는 `content/works.private.mjs` 에

`content/works.mjs` 는 저장소(GitHub)에 그대로 올라가서 누구나 볼 수 있습니다 → [9장](#저장소에-올라가는-content-도-공개됩니다).
그래서 **공개 동의를 받기 전의 작업은 `content/works.private.mjs`** 에 적습니다. 형식은 `works.mjs` 와 똑같고, 이 파일은 git에 올라가지 않습니다.
파일이 없으면 새로 만드세요(메모장·VS Code에서 **UTF-8** 로 저장). `works.mjs` 안의 예시 블록(주석 처리된 부분)을 복사해 `//` 를 지우고 고치면 됩니다. 최소한 이 정도면 됩니다.

```js
// content/works.private.mjs — 아직 공개하지 않을 작업 (git에 올라가지 않음)
export default [
  {
    slug: 'brand-film-2026',
    title: '브랜드 필름',
    client: '',                 // 사이트에 표시됨 — 이름 공개까지 동의받은 경우에만 적기
    category: 'commercial',     // commercial · music-video · film · branded · product
    year: 2026,
    summary: '따뜻한 자연광의 질감을 살린 브랜드 필름',
    camera: 'Sony FX6',
    comparisons: [{ caption: 'S-Log3 원본 → 최종 그레이딩', beforeLabel: 'LOG', afterLabel: 'GRADED' }],
    featured: false,
    publish: false,             // 우선 비공개로 두고 미리보기로 확인
    consent: 'pending',
  },
];
```

- 작업끼리는 `},` 처럼 **쉼표로 구분**합니다. 따옴표·쉼표가 빠지면 `npm run check` 가 알려줍니다.
- 긴 영상은 Vimeo/YouTube에 올리고 `video: { type: 'vimeo', id: '123456789' }` 로 연결하는 것을 권장합니다 → [12장](#12-용량이-큰-영상-다루기).
  **다음 단계(`npm run media`) 전에 적어 두면** 오래 걸리는 `main.mp4` 인코딩을 건너뜁니다.
- 정렬: `order` 작은 순 → 연도 최신순 → 제목순. `featured: true` 는 홈에서 크게 보이고 비포·애프터에 먼저 나옵니다.
- `posterTime: 12.5` 처럼 적으면 포스터를 뽑을 위치(초)를 정할 수 있습니다.

### ④ 웹용으로 변환하기

```bash
npm run media                      # 전체 (바뀐 것만)
npm run media -- brand-film-2026   # 이 작업만
```

결과는 `media/works/brand-film-2026/` 에 저장됩니다: 전체 영상(`main.mp4`), 카드용 6초 미리보기(`preview.mp4`),
포스터(`poster.jpg` + 크기별 WebP `poster-640/1280/1920.webp`), 공유용 이미지(`og.jpg`, 1200×630),
비포·애프터 이미지(`ba-N-before/after` + 휴대폰용 `-1280.webp`), 스틸 컷.
모든 영상은 BT.709(Rec.709)로 정확히 태그되고, 색 변환 행렬을 추측하지 않도록 고정해 두었습니다.
`main.mp4` 는 휴대폰·TV에서도 재생되도록 H.264 레벨 4.1(순간 최대 약 12Mbps)로 만들며, 결과가 25MB를 넘으면 Vimeo/YouTube 연결을 권하는 경고가 나옵니다 → [12장](#12-용량이-큰-영상-다루기).

- `npm run media` 는 ③에서 적은 옵션을 읽어서 변환합니다. **`video`, `baVideo`, `baTimes`, `baVideoStart`·`baVideoDuration`, `posterTime`,
  `previewStart`·`previewDuration`, `autoCrop` 을 바꾼 뒤에는 `npm run media -- <slug>` 를 다시 실행하세요.** 바뀐 부분만 다시 만듭니다.
  (작업 정보를 적기 전에 변환하면 기본 옵션으로 처리되어, 예를 들어 `baVideo` 비교 영상이 만들어지지 않습니다.)
- 원본에 검은 띠(레터박스)가 입혀져 있으면 포스터·카드 미리보기·공유 이미지·비포·애프터·스틸에서 자동으로 잘라냅니다.
  전체 영상(`main.mp4`)은 원본 화면 그대로입니다 → [11장](#검은-띠레터박스가-있는-마스터).
- 작업이 많으면 오래 걸립니다(전체 영상은 화질 우선 설정). 중간에 멈추거나 `Ctrl + C` 로 꺼도, 다시 실행하면 끝난 파일은 건너뛰고 이어서 처리합니다.

### ⑤ 미리보기로 확인하기

```bash
npm run preview            # → http://127.0.0.1:4173 (= localhost:4173, 이 컴퓨터에서만)
npm run preview -- --lan   # 같은 와이파이의 휴대폰에서도 확인할 때 (집·사무실 와이파이에서만)
```

미리보기는 `publish: false` 인 작업과 `works.private.mjs` 의 작업도 보여줍니다(상단에 `PREVIEW` 띠가 표시됩니다). 카드, 상세 페이지, 비포·애프터, 휴대폰 화면을 확인하세요.
`--lan` 으로 열면 같은 네트워크의 모든 기기에서 비공개 작업이 보이므로, 확인이 끝나면 `Ctrl + C` 로 끄세요.

### ⑥ 공개 동의 확인 후 공개로 바꾸기

클라이언트에게 공개 동의를 받았다면 값을 바꾸고, **그 작업 블록을 `works.private.mjs` 에서 `works.mjs` 로 옮깁니다**(잘라내기 → 붙여넣기).

```js
    publish: true,
    consent: 'granted',        // 본인 작업 등 동의가 필요 없으면 'not-required'
```

- `client`, `credits` 는 클라이언트가 **이름 공개까지** 동의한 경우에만 적습니다. 동의 범위가 작품 공개뿐이면 비워 두세요.
- 동의 기록(받은 날짜·방법·범위)은 `works.mjs` 에 주석으로 적지 말고 메일함 등 **저장소 밖**에 보관하세요. `works.mjs` 의 주석도 그대로 공개됩니다.

### ⑦ 검사 → 빌드 → 배포

```bash
npm run check          # 오류 0개인지, 숨김 작업 목록이 예상과 같은지 확인
npm run build          # site/ 갱신
npm run serve          # 배포본 최종 확인 (선택)
```

그다음 `site/` 폴더를 다시 업로드합니다 → [10장](#10-배포하기-파일만-올리면-끝).

### 대사·내레이션이 있는 작업은 자막이 필요합니다

단편영화·광고·브랜디드 영상처럼 **대사나 내레이션이 있는 작업**은 소리를 듣기 어려운 방문자도 내용을 따라갈 수 있게 자막을 넣어 주세요.
이 사이트가 직접 재생하는 영상(`main.mp4`)에는 별도 자막 파일(.srt·.vtt)을 붙일 수 없으므로, 둘 중 하나를 고릅니다.

1. **자막을 영상에 입혀서(burn-in) 내보내기** — Resolve Deliver 페이지 → Video → **Subtitle Settings** → Export Subtitle 체크 → Format: **Burn into video**.
   이 파일을 `raw/works/<slug>/main.<확장자>` 로 씁니다. (비포·애프터·포스터용 파일은 자막 없이 내보내도 됩니다)
2. **YouTube/Vimeo에 자막과 함께 올리고 연결하기** — 플랫폼에 자막(한국어, 필요하면 영어)을 올린 뒤 `video: { type: 'vimeo', id: '…' }` 로 연결합니다.
   방문자는 플레이어의 자막(CC) 버튼으로 켜고 끌 수 있습니다 → [12장](#12-용량이-큰-영상-다루기).

대사·내레이션 없이 음악만 흐르는 영상은 자막 없이 올려도 됩니다. 카드 미리보기(6초)와 첫 화면 배경 영상은 소리가 없어서 해당되지 않습니다.

---

## 6. 쇼릴 교체하기

1. `raw/reel/` 에 새 쇼릴 영상을 넣고 **이전 파일은 지웁니다**. (여러 개가 있으면 이름순으로 첫 번째 파일만 쓰고 경고합니다.)
   포스터를 직접 고르고 싶다면 같은 폴더에 `poster.jpg` (png 등도 가능)를 함께 넣으세요.
2. 변환합니다.
   ```bash
   npm run media -- --reel
   ```
   - `reel.mp4` — 소리 포함 전체 쇼릴 (‘쇼릴 보기’ 버튼으로 재생). 원본 화면 그대로입니다.
   - `reel-loop.mp4` — 첫 화면 배경용 무음 루프 (기본 20초 · 앞부분 검은 화면은 건너뜀 · 입혀진 검은 띠는 잘라냄)
   - `poster.jpg` — 영상이 로드되기 전에 보이는 이미지 (기본: 배경 루프의 첫 프레임)
3. **공개 동의를 확인합니다.** 쇼릴은 클라이언트 작업의 장면을 모은 것이라, 작업과 같은 공개 규칙을 따릅니다 → [9장](#9-공개-규칙과-동의-관리).
   쇼릴 속 **모든 장면**이 동의를 받은(`'granted'`) 또는 동의가 필요 없는(`'not-required'`) 작업인지 확인한 뒤 `content/site.mjs` 의 `reel` 을 바꿉니다.
   ```js
   consent: 'granted',   // 모두 본인 작업이면 'not-required'
   ```
   `'pending'`(기본값)인 동안에는 배포본(`site/`)에 쇼릴이 들어가지 않고 미리보기에서만 보입니다.
   동의 대기 작업의 장면이 들어 있다면 그 장면을 빼고 다시 편집한 쇼릴로 1번부터 다시 하세요.
4. `npm run build` 후 `site/` 를 다시 업로드합니다.

**옵션** (`content/site.mjs` 의 `reel`)

- 소리까지 있는 전체 쇼릴을 Vimeo/YouTube에 올렸다면 `embed: { type: 'vimeo', id: '123456789' }` 로 연결하세요.
  이 경우 `reel.mp4` 는 만들지 않고, 배경 루프만 직접 호스팅합니다(파일 용량을 크게 줄일 수 있습니다).
- `fps` 는 첫 화면 타임코드 표시용입니다. 쇼릴 타임라인의 프레임 레이트를 적으세요(23.976이면 24).
- `publish: false` 로 두면 쇼릴이 사이트에서 완전히 빠집니다(미리보기에서도).
- 첫 화면 배경 루프·포스터 — 바꾼 뒤 `npm run media -- --reel` 을 다시 실행하세요.
  - `loopStart: 12` — 배경 루프를 시작할 위치(초). 기본(`null`)은 쇼릴 앞부분의 검은 화면(로고·페이드 인)을 건너뛴 지점입니다.
  - `loopDuration: 20` — 배경 루프 길이(초, 1~40). 휴대폰이 첫 화면에서 바로 받는 파일이라 짧을수록 빨리 뜹니다(4 MB를 넘으면 경고).
  - `posterTime: 15.5` — 포스터로 쓸 위치(초). 기본은 배경 루프의 첫 프레임이라 영상이 재생될 때 화면이 튀지 않습니다. `raw/reel/poster.jpg` 가 있으면 그 이미지를 씁니다.
  - `autoCrop: false` — 검은 띠를 자르지 않습니다. 기본(`true`)은 쇼릴에 입혀진 검은 띠(예: 16:9 안의 2.39:1)를 배경 루프와 포스터에서 잘라냅니다.
    첫 화면은 화면을 꽉 채우도록 확대되기 때문에, 띠를 남기면 메뉴 아래에 검은 줄이 생깁니다. 화면비가 섞인 쇼릴은 가장 자주 나오는 띠를 기준으로 자릅니다.
- 빌드 보고서에 `reel.mp4` 가 25 MB를 넘는다고 나오면 Cloudflare Pages에는 올릴 수 없습니다. 이때는 위의 `embed` 를 쓰세요 → [12장](#12-용량이-큰-영상-다루기).

---

## 7. 비포·애프터 만들기

비포·애프터는 슬라이더로 원본과 그레이딩 결과를 비교하는 기능입니다. 홈에는 작업별 첫 번째 쌍이 최대 4개(`featured` 작업 먼저) 나오고,
작업 상세 페이지에는 그 작업의 모든 쌍이 나옵니다.

### 파일 규칙

- `before-1` 과 `after-1` 이 한 쌍입니다. 2번째 쌍은 `before-2` / `after-2` … 이렇게 이어집니다.
- **같은 프레임, 같은 해상도, 같은 화면 비율**이어야 슬라이더에서 정확히 겹칩니다.
  화면 비율이 다르면 도구가 before의 가운데를 after 비율에 맞춰 잘라 쓰고 경고를 표시합니다(가장자리가 잘리므로 같은 비율로 다시 내보내는 것이 좋습니다).
- after에 검은 띠(레터박스)가 입혀져 있으면 after에서 찾은 띠를 before에도 같은 위치로 잘라, 두 장이 그대로 겹칩니다(끄려면 `autoCrop: false`).
- before는 촬영 원본(LOG 그대로 또는 보정 전), after는 최종 그레이딩입니다.
- 한 쌍의 두 파일은 **같은 종류**(둘 다 이미지 또는 둘 다 영상)로 맞추는 것을 권장합니다.

### 방법 A — 스틸 이미지 쌍 (가장 간단)

Resolve에서 같은 프레임을 두 번 내보냅니다.

- after: 그레이딩이 적용된 상태로 한 프레임을 PNG/TIFF로 내보내기 (Gallery의 스틸 Export 또는 Deliver에서 한 프레임 렌더)
- before: 같은 프레임을 그레이드를 끈 상태로 내보내기 (예: 타임라인을 복제한 뒤 복제본에서 그레이드를 리셋)

```
raw/works/brand-film-2026/before-1.png
raw/works/brand-film-2026/after-1.png
```

### 방법 B — 영상 쌍 (움직이는 비교)

같은 구간을 before/after 두 개의 영상으로 렌더링합니다(시작 타임코드·길이·해상도 동일).

```
raw/works/brand-film-2026/before-1.mov
raw/works/brand-film-2026/after-1.mov
```

- 슬라이더 이미지는 영상의 1/3 지점 프레임으로 자동 추출됩니다. 위치를 정하려면 `baTimes: [12.5]` (쌍별 초 단위).
- `baVideo: true` 를 켜면 두 영상을 좌우로 붙인 비교 영상(`ba-1.mp4`)도 만들어집니다.
  슬라이더에 **‘영상 비교 재생’** 버튼이 생기고, 재생 중에도 손잡이를 움직여 비교할 수 있습니다.
  작업 정보에 `baVideo: true` 를 적은 **뒤에** `npm run media -- <slug>` 를 실행해야 만들어집니다(이미 변환했다면 다시 실행).
- 비교 영상 구간은 `baVideoStart` (기본: `baTimes` 값 또는 0초), `baVideoDuration` (기본 8초)으로 조절합니다. 바꾼 뒤에도 `npm run media -- <slug>` 를 다시 실행하세요.

### 설명 문구

```js
comparisons: [
  { caption: 'S-Log3 원본 → 최종 그레이딩', beforeLabel: 'LOG', afterLabel: 'GRADED' },  // 1번 쌍
  { caption: '카메라 매칭 — B캠을 A캠 톤에 맞춤' },                                      // 2번 쌍 (라벨 기본값 BEFORE/AFTER)
],
```

- `beforeLabel`·`afterLabel` 은 슬라이더 위 작은 라벨로, **적은 그대로** 표시됩니다(대문자로 바꾸지 않음 — `'S-Log3'` 는 `S-Log3`).
  한글 라벨(예: `'원본'`, `'보정 후'`)도 됩니다. 아주 긴 라벨은 좁은 휴대폰 화면에서 `…` 로 줄어드니 한두 단어로 적으세요.
- 방문자는 손잡이를 끌거나 화면을 눌러 비교하고, 키보드로는 ←/→ 2%씩, Shift+←/→ 10%씩, Home/End 로 양 끝으로 이동합니다.

> 팁: 피부 톤과 밝은 하이라이트·깊은 섀도가 함께 있는 프레임, 움직임이 적은 프레임이 비교 효과가 좋습니다.

---

## 8. 문의 연락처 · 크몽 · 문의 양식 설정

모두 `content/site.mjs` 의 `contact` 에서 설정합니다.

```js
contact: {
  email: 'crafttone3@gmail.com',
  kmongUrl: '',                    // 크몽 서비스 주소
  kmongLabel: '크몽에서 의뢰하기',
  responseNote: '',                // 예: '보통 하루 안에 답변드립니다'
  formEndpoint: '',                // 폼 전송 서비스 주소 (선택)
},
```

### 크몽 버튼

크몽 서비스 페이지 주소(`https://kmong.com/gig/…`)를 `kmongUrl` 에 붙여 넣으면 문의 섹션·작업 상세 페이지·푸터에 크몽 버튼이 나타납니다.
비워 두면 버튼이 어디에도 표시되지 않습니다(빈 링크가 생기지 않음). `https://` 로 시작하는 전체 주소여야 합니다.

### 문의 양식이 동작하는 방식

- **기본 (`formEndpoint: ''`)**: ‘메일로 문의 보내기’를 누르면 방문자의 메일 앱이 열리고 제목·본문이 자동으로 채워집니다.
  메일 앱이 없는 PC를 위해 **‘문의 내용 복사’** 버튼이 있어, 복사한 내용을 직접 메일로 보낼 수 있습니다. 작성 중인 내용은 브라우저에 임시 저장됩니다.
- **폼 전송 서비스 사용**: 메일 앱 없이 사이트에서 바로 전송되게 하려면 [Formspree](https://formspree.io) 같은 서비스를 씁니다.
  1. Formspree에 가입 → New Form 생성 → 받을 이메일에 `crafttone3@gmail.com` 지정
  2. 발급된 주소(`https://formspree.io/f/xxxxxxx`)를 `formEndpoint` 에 붙여 넣기
  3. `npm run build` → 업로드 → 사이트에서 테스트 문의를 한 번 보내 확인 (첫 전송 때 Formspree가 확인 메일을 보낼 수 있습니다)
  - 무료 요금제는 월 전송 건수 제한이 있으니 가입 시 확인하세요. 전송에 실패하면 자동으로 메일 앱 방식으로 넘어갑니다.
- 작성 중인 내용은 방문자의 브라우저(`localStorage` 의 `tonecraft:inquiry-draft`)에만 저장되고 30일 뒤 지워집니다. 서버로 보내지지 않습니다.
- 내용이 길면(PC에서는 채운 항목 수에 따라 한글 약 80~200자 이상, 휴대폰·태블릿은 약 1,000자 이상) 일부 PC 메일 프로그램이 주소를 받지 못하므로, 메일에는 앞부분만 담고 **전체 내용은 자동으로 클립보드에 복사**한 뒤 붙여넣도록 안내합니다.
- (개발용) 보내기를 누르면 양식에서 `tonecraft:inquiry` 이벤트가 발생합니다 (`detail`: subject, body, mailto). 분석 도구 연동 등에 쓸 수 있습니다.

### 사업자 정보

사업자 등록 후 푸터에 표시할 정보가 있으면 `business` 에 채우세요. 빈 항목은 표시되지 않습니다.

---

## 9. 공개 규칙과 동의 관리

클라이언트 작업은 **공개 동의를 받은 것만** 사이트에 올라가야 합니다. 이 프로젝트는 실수를 막도록 만들어져 있습니다.

### 작업이 배포용 사이트에 들어가는 조건 (셋 다 만족해야 함)

1. `publish: true`
2. `consent` 가 `'pending'` 이 아님 → `'granted'` (동의 받음) 또는 `'not-required'` (개인 작업 등 동의 불필요)
3. 포스터 이미지가 있음 (`npm run media` 가 만듦)

| 상황 | 설정 |
| --- | --- |
| 아직 정리 중 | `publish: false` |
| 동의 요청 중 | `consent: 'pending'` (publish가 true여도 공개되지 않음) |
| 동의 받음 | `consent: 'granted'`, `publish: true` |
| 개인 작업·자체 제작 | `consent: 'not-required'`, `publish: true` |

**쇼릴도 같은 규칙입니다.** 작업별 `consent` 는 쇼릴에 적용되지 않으므로, 쇼릴 속 장면이 모두 공개 가능한 작업인지 따로 확인한 뒤
`content/site.mjs` 의 `reel.consent` 를 `'granted'`(모두 본인 작업이면 `'not-required'`)로 바꿔야 배포본에 들어갑니다 → [6장](#6-쇼릴-교체하기).

### 숨긴 작업은 `site/` 에 흔적이 남지 않습니다

조건을 만족하지 못한 작업은 `site/` 에 **페이지, 카드, 제목, 주소, 검색용 데이터(JSON-LD), 사이트맵, 이미지·영상 파일 어디에도** 들어가지 않습니다.
예전에 공개했다가 숨긴 작업의 페이지와 미디어도 다음 빌드 때 `site/` 에서 삭제됩니다.

이렇게까지 하는 이유: 정적 사이트는 `site/` 폴더 안의 모든 파일이 곧 공개 파일입니다. 링크만 숨기면 주소를 추측하거나 소스 보기로 찾아낼 수 있습니다.
그래서 “숨김 = 아예 없음”으로 처리합니다.

- `npm run check` / `npm run build` 는 숨겨진 작업과 그 이유를 매번 출력합니다. 배포 전에 목록이 예상과 같은지 확인하세요.
- 미리보기(`npm run preview`)는 숨긴 작업까지 보여주지만 결과가 `.preview/` 에만 저장되므로 배포본과 섞이지 않습니다. **`.preview/` 는 절대 업로드하지 마세요.**
- 이 보장은 **내 컴퓨터의 `site/` 폴더** 기준입니다. 저장소에 커밋하는 `content/` 와, 이미 서버에 올린 파일은 아래 두 절을 참고하세요.
- 숨긴 작업의 흔적을 지우지 못하면 `npm run build` 가 **실패(오류)로 끝나고 `이 상태의 site/ 는 업로드하지 마세요`** 라고 알립니다. 경우는 두 가지입니다.
  - 숨긴 작업의 파일을 다른 프로그램이 잡고 있어 삭제하지 못함(영상 플레이어, 탐색기 미리보기 창, OneDrive 동기화 등) → 그 프로그램을 닫고 다시 `npm run build`.
  - `site/works/<숨긴 작업 slug>/` 폴더를 직접 만들어 둔 경우(빌드가 만든 폴더가 아니라 지우지 않음) → 그 폴더를 직접 삭제하고 다시 `npm run build`.

### 저장소에 올라가는 `content/` 도 공개됩니다

GitHub 저장소(`mingu39417-code/work`)는 지금 **공개(public)** 입니다. `site/` 만이 아니라 **커밋한 모든 파일을 누구나 볼 수 있고, 나중에 지워도 기록(히스토리)에 남습니다.**
빌드가 걸러 주는 것은 `site/` 뿐이라, `content/works.mjs` 에 적은 동의 대기 작업의 제목·클라이언트·설명·크레딧·영상 링크(비공개 Vimeo 주소 포함)와 주석은 커밋하는 순간 그대로 공개됩니다.

1. **아직 공개하지 않을 작업은 `content/works.private.mjs` 에만 적습니다.**
   - `publish: false` 이거나 `consent: 'pending'` 인 작업은 제목까지 포함해 블록 전체를 이 파일에 둡니다. 형식은 `works.mjs` 와 같고([5장 ③](#5-작업-추가하기-단계별)),
     `.gitignore` 로 제외되어 커밋되지 않습니다. 빌드·검사·미리보기는 두 파일을 합쳐서 읽습니다.
   - 공개 동의를 받으면 그 블록을 `works.mjs` 로 옮깁니다([5장 ⑥](#5-작업-추가하기-단계별)).
   - `works.mjs` 에 있는 비공개·동의 대기 작업에 클라이언트·크레딧·메모·영상 링크가 적혀 있으면 `npm run check` 가 경고합니다. 제목·설명만 있을 때는 경고하지 않으니 직접 확인하세요.
   - 동의 기록(받은 날짜·방법·범위)도 `works.mjs` 주석이 아니라 메일함 등 저장소 밖에 보관하세요.
   - `works.private.mjs` 는 이 컴퓨터에만 있습니다. 원본(`raw/`)과 함께 따로 백업하세요.
2. **GitHub Pages로 배포하지 않는다면 저장소를 비공개로 바꾸는 것을 권장합니다.** Netlify Drop, Cloudflare Pages 직접 업로드, FTP는 GitHub 없이 `site/` 폴더만 올리므로 저장소가 공개일 필요가 없습니다.
   GitHub 저장소 페이지 → **Settings → General → 맨 아래 Danger Zone → Change repository visibility → Make private**
   - 무료 요금제의 GitHub Pages는 공개 저장소에서만 쓸 수 있습니다(비공개 저장소는 유료 요금제 필요). GitHub Pages로 배포한다면 공개로 두고 1번 규칙을 꼭 지키세요.
   - 비공개로 바꾸면 `git clone`·`git push` 할 때 GitHub 로그인을 요구합니다(Windows의 Git은 로그인 창을 자동으로 띄웁니다).
3. **커밋하기 전에 올라갈 내용을 확인합니다.**
   ```bash
   npm run check                  # 숨김 목록과 경고 확인
   git add content                # works.private.mjs 는 자동으로 빠집니다
   git diff --cached content/     # 올라갈 내용 — works.mjs 에 publish: false · consent: 'pending' 작업이 없어야 합니다
   git status                     # raw/ · media/ · .preview/ 가 목록에 없어야 합니다
   ```

### 공개를 취소하거나 동의가 철회됐을 때

`site/` 에서는 다음 빌드 때 자동으로 사라지지만, **이미 올린 서버와 저장소에는 남습니다.** 순서대로 정리하세요.

1. 그 작업을 `publish: false` 또는 `consent: 'pending'` 으로 바꾸고, 블록을 `works.private.mjs` 로 옮깁니다.
   쇼릴에 그 작업의 장면이 있다면 쇼릴도 다시 편집해 교체하거나, 그동안 `reel.consent: 'pending'` 으로 내립니다.
2. `npm run build` → 보고서에 `이전 페이지 삭제 1개 (<slug>)` 가 나오는지 확인 → 배포한 곳에 다시 올립니다.
3. 배포 방식별로 남은 파일을 지웁니다.
   - **FTP·일반 호스팅**: 업로드는 서버의 파일을 지우지 않습니다. 서버에서 `works/<slug>/` 와 `media/works/<slug>/` 폴더를 직접 삭제하세요
     (FileZilla의 ‘디렉터리 비교’로 서버에만 남은 파일을 찾을 수 있습니다). 쇼릴을 내렸다면 `media/reel/` 도 삭제합니다.
   - **Netlify / Cloudflare Pages**: 새 배포가 사이트 주소를 대신하므로 그 주소에서는 사라집니다. 다만 예전 배포도 각자의 고유 주소(Netlify 배포 기록,
     Cloudflare `<해시>.<프로젝트>.pages.dev`)로 남습니다. 추측하기 어려운 주소지만, 확실히 지워야 한다면 Cloudflare는 프로젝트의 배포 목록에서 예전 배포를 삭제하고,
     Netlify는 사이트를 삭제한 뒤 새로 만드세요(주소가 바뀌면 `siteUrl` 도 고치기).
   - **GitHub (Pages 포함)**: 커밋했던 파일은 기록(히스토리)에 남습니다. 저장소를 비공개로 바꾸거나, 꼭 필요하면 Claude Code에게 기록에서 지우는 작업을 요청하세요
     (이미 누군가 받아 간 사본은 되돌릴 수 없습니다).
4. 검색·공유 캐시: 지운 주소는 검색엔진이 다음 수집 때 뺍니다. 빨리 내리려면 [Google Search Console](https://search.google.com/search-console)의 **삭제** 메뉴로 주소 삭제를 요청하고,
   네이버는 [서치어드바이저](https://searchadvisor.naver.com)에서 그 주소의 수집을 다시 요청하거나 네이버 고객센터의 검색결과 삭제 요청을 이용하세요.
   카카오톡·페이스북 미리보기는 [카카오 공유 디버거](https://developers.kakao.com/tool/debugger/sharing) · [Facebook 공유 디버거](https://developers.facebook.com/tools/debug/)에서 캐시를 초기화합니다.

---

## 10. 배포하기 (파일만 올리면 끝)

`npm run build` 로 만든 **`site/` 폴더 하나**가 사이트 전체입니다. 모든 내부 링크가 상대 경로라서 도메인 최상위든
`https://아이디.github.io/work/` 같은 하위 폴더든 그대로 동작합니다. 호스팅별 설정 파일은 필요 없습니다.

배포 전 공통 확인:

```bash
npm run check    # 오류 0개, 숨김 작업 목록 확인
npm run build    # 빌드 보고서의 ‘25 MB 초과’ 경고가 없는지 확인
```

### 방법 1 — Netlify Drop (가장 쉬움)

1. [app.netlify.com/drop](https://app.netlify.com/drop) 에 접속해 로그인(무료 계정)합니다. 로그인해야 사이트가 계속 유지됩니다.
2. 탐색기/Finder에서 **`site` 폴더를 통째로** 끌어다 놓습니다.
3. `https://임의의-이름.netlify.app` 주소가 생깁니다. Site settings에서 이름을 바꾸거나 개인 도메인을 연결할 수 있습니다.
4. 업데이트: 해당 사이트의 **Deploys** 탭에 새 `site` 폴더를 다시 끌어다 놓으면 됩니다.

### 방법 2 — Cloudflare Pages (직접 업로드)

1. Cloudflare 대시보드 → **Workers & Pages** → 만들기 → **Pages** → **Upload assets(에셋 업로드)** 를 선택합니다. (메뉴 이름은 조금 바뀔 수 있습니다)
2. 프로젝트 이름을 정하고 `site` 폴더를 업로드합니다. → `https://프로젝트명.pages.dev`
3. 업데이트: 프로젝트에서 **새 배포 만들기** 로 다시 업로드합니다.
- **파일 하나당 25 MB 제한**이 있습니다. 빌드 보고서에 25 MB 초과 파일이 표시되면 [12장](#12-용량이-큰-영상-다루기)을 참고하세요.

### 방법 3 — GitHub Pages

GitHub Pages는 저장소의 최상위 또는 `docs/` 폴더만 게시할 수 있어서, `site/` 폴더를 `gh-pages` 브랜치의 최상위로 올리는 방식을 씁니다.

```bash
npm run check                    # 숨김 목록과 경고 확인
npm run build
git add content site             # works.private.mjs 는 자동으로 빠집니다
git diff --cached content/       # works.mjs 에 publish: false · consent: 'pending' 작업이 없는지 확인
git status                       # raw/ · media/ · .preview/ 가 목록에 없는지 확인
git commit -m "사이트 업데이트"
git push
git subtree push --prefix site origin gh-pages
```

1. 처음 한 번: GitHub 저장소 → **Settings → Pages → Build and deployment** → Source: *Deploy from a branch*, Branch: **`gh-pages` / `(root)`** → Save
2. 몇 분 뒤 `https://mingu39417-code.github.io/work/` 에서 확인합니다.
3. 이렇게 **하위 폴더(`/work/`) 주소**에 배포하면 `siteUrl` 을 `'https://mingu39417-code.github.io/work'` 로 설정하고 다시 빌드·푸시하세요. 그래야 없는 주소로 들어왔을 때 보이는 404 페이지의 디자인과 링크도 제대로 동작합니다(다른 페이지는 설정 전에도 정상).
- 무료 요금제의 GitHub Pages는 **공개 저장소**에서만 동작합니다. 커밋하는 순간 `site/` 뿐 아니라 `content/` 도 공개되고, 나중에 지워도 **기록(히스토리)에 남습니다.**
  아직 공개하지 않을 작업은 반드시 `content/works.private.mjs` 에 두세요 → [9장](#저장소에-올라가는-content-도-공개됩니다). (`raw/`, `media/`, `.preview/`, `works.private.mjs` 는 git에서 제외되어 있습니다.)
- GitHub은 100 MB 이상 파일을 받지 않습니다(빌드 보고서에서 95 MB 초과 파일을 표시합니다).
- `git subtree push` 가 거부되면(예: gh-pages 브랜치를 따로 고친 경우) 다음 명령으로 덮어씁니다 (Git Bash·macOS 터미널·PowerShell 공통):
  `git push origin "$(git subtree split --prefix site HEAD):gh-pages" --force`

### 방법 4 — 일반 웹호스팅 / FTP

FTP 프로그램(FileZilla 등)으로 **`site` 폴더 안의 내용물**을 호스팅의 웹 루트(`public_html`, `www`, `html` 등)에 올립니다.
호스팅 관리 화면에서 오류 페이지를 설정할 수 있다면 404 페이지로 `404.html` 을 지정하세요.

- **업데이트할 때 `site/` 에서 사라진 파일은 서버에서 직접 지워야 합니다.** FTP 업로드는 덮어쓰기만 하고 지우지는 않습니다.
  숨기거나 공개를 취소한 작업이 있으면 서버의 `works/<slug>/` 와 `media/works/<slug>/` 를 삭제하세요. FileZilla의 **디렉터리 비교**(보기 메뉴)로 서버에만 남은 파일을 찾을 수 있습니다 → [9장](#공개를-취소하거나-동의가-철회됐을-때).

### 배포 후 꼭 할 일 — `siteUrl` 설정

주소가 정해지면 `content/site.mjs` 의 `siteUrl` 에 적고 **다시 빌드해서 다시 업로드**하세요.

```js
siteUrl: 'https://tonecraft.netlify.app',   // 끝에 / 없이. GitHub Pages라면 'https://mingu39417-code.github.io/work'
```

이 값이 있어야:

- 카카오톡·페이스북·X 등에 링크를 공유할 때 **미리보기 이미지**가 제대로 뜹니다(공유 이미지는 절대 주소가 필요합니다).
- 검색엔진용 `sitemap.xml` 과 대표 주소(canonical)가 만들어집니다.

링크를 공유하면 홈은 `site/assets/img/og-default.jpg` (1200×630) 를, 작업 페이지는 작업마다 자동으로 만든 `og.jpg` 를 미리보기 이미지로 씁니다.
기본 이미지를 바꾸고 싶다면 같은 이름·크기의 JPG로 교체하면 됩니다.

공유 미리보기가 예전 모습으로 보이면 캐시를 새로고침하세요:
[카카오 공유 디버거](https://developers.kakao.com/tool/debugger/sharing) · [Facebook 공유 디버거](https://developers.facebook.com/tools/debug/)

검색 노출을 원하면 [Google Search Console](https://search.google.com/search-console) 과 [네이버 서치어드바이저](https://searchadvisor.naver.com) 에 사이트를 등록하고,
받은 확인 코드를 `seo.googleVerification` / `seo.naverVerification` 에 넣은 뒤 `sitemap.xml` 을 제출하세요.
Search Console·서치어드바이저가 보여 주는 **HTML 태그(`<meta name="…" content="…">`)를 통째로 붙여 넣어도** 도구가 코드만 골라 씁니다.
형식이 맞지 않는 값은 넣지 않고 `npm run check` 에서 경고합니다.

---

## 11. DaVinci Resolve 내보내기 권장 설정

`npm run media` 는 원본을 웹용 H.264로 다시 인코딩하면서 **Rec.709(BT.709) 태그를 정확히 붙이고, 색 변환 행렬을 추측하지 않도록 고정**합니다.
따라서 원본은 “화질 좋은 Rec.709 마스터”이기만 하면 됩니다. 웹용 압축은 도구에 맡기세요.

| 항목 | 권장 값 |
| --- | --- |
| 그레이딩 기준 | 타임라인/출력 색공간 **Rec.709 Gamma 2.4** |
| 형식 · 코덱 | QuickTime **Apple ProRes 422 HQ** (마스터) — 또는 고화질 H.264 (Quality: Best 등 넉넉한 비트레이트) |
| 해상도 | 1920×1080 이상 (도구가 긴 변을 1920 이하로 줄입니다. 절대 키우지 않음) |
| 프레임 레이트 | 타임라인 그대로 |
| Data Levels | **Auto (Video)** — Full로 바꾸지 마세요 |
| 색 태그 | Deliver → Video → Advanced Settings → **Color Space Tag: Rec.709 / Gamma Tag: Rec.709** → 1-1-1 태그 |
| 오디오 | **스테레오 1트랙**(1·2채널 = 최종 믹스), Linear PCM(ProRes) 또는 AAC 320 kbps — 쇼릴·전체 영상만 소리를 사용합니다. 방송 납품용처럼 모노 트랙이 여러 개인 마스터(MXF 등)나 다채널 트랙은 피하세요. 도구가 모노 1·2번 트랙은 L/R로 합치고, 5.1은 스테레오로 줄이고, 그 밖의 다채널은 1·2채널만 쓰지만(경고 표시), 믹스가 다른 채널에 있으면 소리가 빠집니다 |
| 화면 비율 · 검은 띠 | 가능하면 **검은 띠 없이 실제 화면 비율**(예: 2.39:1 → 1920×804)로 내보내세요. 16:9 안에 띠를 입힌 마스터도 됩니다 — 전체 영상은 그대로 두고, 포스터·미리보기·공유 이미지·비포·애프터·스틸에서는 띠를 자동으로 잘라냅니다 → [아래](#검은-띠레터박스가-있는-마스터) |
| 세로 영상 (9:16) | 그대로 내보내면 됩니다. 가로 영상과 같이 긴 변을 1920 이하로 맞춥니다(예: 2160×3840 → 1080×1920). 공유 이미지(1200×630)에는 세로 화면 전체가 검은 바탕 가운데에 들어갑니다 |
| 자막 | 대사·내레이션이 있으면 **Subtitle Settings → Burn into video** 로 자막을 입혀서 내보내거나, YouTube/Vimeo 자막을 쓰세요 → [5장](#대사내레이션이-있는-작업은-자막이-필요합니다) |
| HDR 소스 | 사용하지 마세요. HDR/Rec.2020 파일이면 도구가 경고합니다 → SDR Rec.709로 내보낸 파일로 교체 |

### 검은 띠(레터박스)가 있는 마스터

2.39:1 같은 와이드 작품을 16:9 프레임에 검은 띠로 넣어 내보낸 경우, `npm run media` 가 띠를 찾아 **웹용 이미지·짧은 영상에서만** 잘라냅니다.
띠가 남아 있으면 카드와 첫 화면처럼 화면을 꽉 채우는 곳에서 위아래가 검게 비거나, 공유 미리보기에 두꺼운 검은 줄이 생기기 때문입니다.

| 잘라내는 것 (`autoCrop: true`, 기본) | 그대로 두는 것 |
| --- | --- |
| 포스터·공유 이미지(`og.jpg`), 카드 미리보기(`preview.mp4`), 비포·애프터 이미지·비교 영상, 스틸 컷, 쇼릴의 배경 루프·포스터 | 전체 영상 `main.mp4`, 전체 쇼릴 `reel.mp4` (원본 화면 그대로) |

- 자르면 `npm run media` 화면에 `레터박스 감지: 1920x800로 자름` 처럼 표시됩니다. 이미 변환한 작업은 `npm run media -- <slug> --dry-run --force` 로 다시 확인할 수 있습니다(파일은 바뀌지 않음).
- 그림을 잘못 자르지 않도록 **확실한 띠만** 자릅니다: 완전히 검은 줄이 위아래(또는 좌우) 같은 두께로 프레임의 2% 이상 있고, 자른 결과가 표준 화면비(2.39:1, 1.85:1, 4:3, 9:16 등)이고,
  영상이면 여러 지점에서 똑같이 보일 때만입니다. 자막·로고가 띠 위에 걸쳐 있거나 띠가 회색이면 자르지 않습니다.
- 끄려면 작업마다 `autoCrop: false` (쇼릴은 `site.mjs` 의 `reel.autoCrop: false`) → `npm run media -- <slug>` (쇼릴은 `-- --reel`) → `npm run build`.
- 비포·애프터는 after에서 찾은 띠를 before에도 같은 위치로 잘라 두 장이 그대로 겹칩니다.

### Mac에서 영상이 밝고 물빠져 보이는 현상 (감마 시프트)

- Mac의 QuickTime·Safari 등은 1-1-1 태그 영상을 Rec.709 카메라 감마(약 1.96)로 해석해서, Gamma 2.4 레퍼런스 모니터에서 본 것보다 **밝고 대비가 약하게** 보입니다.
  Windows·안드로이드의 대부분 브라우저는 다르게 표시합니다. 파일의 문제가 아니라 재생 환경의 차이입니다.
- Resolve의 출력 색공간 **Rec.709-A** 는 Mac의 해석 방식에 맞춘 옵션입니다. Mac(QuickTime) 재생 기준으로는 뷰어와 비슷해지지만, 다른 환경에서는 **더 어둡게** 보일 수 있습니다.
- 이 사이트의 기본 권장은 **Rec.709 Gamma 2.4 그레이딩 + 1-1-1 태그** 입니다. 방문자 대부분이 Mac·iPhone이라고 판단될 때만 Rec.709-A를 선택적으로 고려하세요.
- 비교할 때는 같은 기준끼리 보세요: 레퍼런스 모니터 ↔ 레퍼런스 모니터, Mac Safari ↔ Mac Safari.

Vimeo/YouTube에 올리는 파일도 같은 설정(Rec.709 Gamma 2.4, 1-1-1)을 쓰면 사이트 안의 영상과 톤이 맞습니다.

---

## 12. 용량이 큰 영상 다루기

직접 호스팅하는 영상은 방문자 데이터와 호스팅 제한을 모두 잡아먹습니다. 원칙은 **“긴 영상은 Vimeo/YouTube, 사이트에는 가벼운 파일만”** 입니다.

### 권장 방식

1. 전체 영상(뮤직비디오, 1분 이상 광고 등)은 **Vimeo 또는 YouTube** 에 올립니다. (Vimeo는 광고 없는 플레이어라 포트폴리오용으로 많이 쓰입니다)
2. `works.mjs` 에 연결합니다.
   ```js
   video: { type: 'vimeo', id: '123456789' },     // vimeo.com/123456789
   video: { type: 'youtube', id: 'AbCdEfGhIjK' }, // youtube.com/watch?v=AbCdEfGhIjK
   ```
   영상 주소 전체(`'https://vimeo.com/123456789'`)를 문자열로 적어도 됩니다. 비공개(unlisted) Vimeo 주소도 지원합니다.
   (비공개 주소는 아는 사람만 볼 수 있는 링크이므로, 공개 동의 전에는 `works.private.mjs` 에만 적으세요.)
   처음 `npm run media` 를 실행하기 **전에** 적어 두면 오래 걸리는 `main.mp4` 인코딩을 건너뜁니다. 나중에 적었다면 `npm run media -- <slug>` 를 다시 실행하세요.
3. 원본 `main.mov` 는 **그대로 `raw/` 에 둡니다.** 카드 미리보기(6초)와 포스터는 원본에서 만들고, 무거운 `main.mp4` 는 배포 폴더에 복사되지 않습니다.
   상세 페이지에서는 포스터를 누르면 그때 Vimeo/YouTube 플레이어가 로드됩니다.

직접 호스팅은 짧은 영상에만 쓰세요. 화질을 우선한 1080p 설정이라 30초짜리 영상도 수십 MB가 될 수 있습니다(실제 크기는 빌드 보고서에서 확인).

- `main.mp4`·`reel.mp4` 는 휴대폰·TV에서도 끊김 없이 재생되도록 H.264 레벨 4.1(초당 31프레임 초과는 4.2), 순간 최대 약 12Mbps로 만듭니다.
- `npm run media` 는 `main.mp4`·`reel.mp4` 가 **25 MB를 넘으면**, 첫 화면 배경 루프 `reel-loop.mp4` 가 **4 MB를 넘으면** 경고합니다.
  앞의 것은 Vimeo/YouTube 연결을, 뒤의 것은 `reel.loopDuration` 을 줄이는 것을 권합니다(기본 20초, 1~40초) → [6장](#6-쇼릴-교체하기).
- 포스터는 화면 크기별 WebP(`poster-640/1280/1920.webp`), 비포·애프터는 휴대폰용 `ba-N-before/after-1280.webp` 를 함께 만들어,
  브라우저가 화면에 맞는 크기만 받습니다.

### 호스팅별 파일 크기 제한

| 호스팅 | 파일 하나당 제한 |
| --- | --- |
| Cloudflare Pages | 25 MB |
| GitHub (Pages 포함) | 100 MB (50 MB부터 경고) |

`npm run build` 가 끝나면 `site/` 전체 크기, 가장 큰 파일 목록, 25 MB·95 MB 초과 파일을 알려줍니다. 초과 파일이 있으면 임베드로 바꾸거나 영상을 짧게 잘라 주세요.

### 저장소(GitHub)에 올릴 때

- 이 저장소는 지금 **공개**입니다. GitHub Pages로 배포하지 않는다면 비공개로 바꾸는 것을 권장합니다 → [9장](#저장소에-올라가는-content-도-공개됩니다).
- `raw/`(원본), `media/`(변환본), `.preview/`, `content/works.private.mjs` 는 `.gitignore` 로 제외되어 있으니 **`git add -f` 로 강제로 올리지 마세요.**
- `site/` 에는 공개 조건을 만족한 작업의 파일만 들어가지만, `content/works.mjs` 는 적힌 그대로 올라갑니다. 커밋 전에 `npm run check` 의 숨김 목록과 경고,
  `git diff --cached content/` 로 **동의 대기 작업의 정보가 `works.mjs` 에 없는지** 확인하세요.
- Netlify Drop·Cloudflare 직접 업로드로 배포한다면 `site/media/` 를 굳이 커밋할 필요가 없습니다. `git add content` 처럼 필요한 폴더만 골라 커밋하세요.
  한 번 커밋한 영상 파일은 지워도 기록에 남아 저장소 용량을 계속 차지합니다.

---

## 13. 확인 필요 체크리스트

`content/site.mjs` 의 문구는 **사실만 쓰도록 초안을 잡았지만**, 아래 항목은 본인이 확인하고 맞게 고쳐야 합니다.
(경력 연수, 클라이언트 이름, 수상, 작업 수, 가격, 작업 기간, 수정 횟수, 지역 같은 사실은 일부러 적지 않았습니다. 넣고 싶다면 사실대로 추가하세요.)

**서비스·작업 방식**

- [ ] 서비스 4가지를 모두 제공하는지 — 특히 **뷰티·클린업 리터치**, **현장 모니터링용 LUT**, 촬영 전 **룩 테스트** (`services`).
      뺀 서비스는 같은 표현이 남은 곳도 고치기: `sections.services.lead`, `about.facts`(SERVICE), `faq` 첫 답변, `inquiry.projectTypes`, `seo.description`, `seo.keywords`
- [ ] 장르(특히 **영화·단편**)가 실제 작업과 맞는지: `hero.lead`, `sections.works.lead`, `about.facts`(FOCUS), `inquiry.projectTypes`, `seo.description`
- [ ] 작업 툴이 **DaVinci Resolve Studio** 가 맞는지 (`about`, `formats`)
- [ ] **Rec.709 · Gamma 2.4 기준**으로 그레이딩하는지 (`formats` → 작업 환경)
- [ ] **온라인 파일 전달·원격 진행**이 기본인지 (`about` 3번째 문단, `facts` WORKFLOW)
- [ ] 받을 수 있는 촬영 포맷 목록 (ARRI·Sony·Canon·Panasonic·Fujifilm·Nikon·BRAW·RED·Apple Log·DJI) — 실제로 처리 가능한 것만 남기기
- [ ] 편집 프로젝트 형식(Premiere XML·EDL·AAF, FCPXML, DRP·DRT)과 납품 포맷(ProRes 4444, DNxHR, 라운드트립, LUT 파일) 제공 여부
- [ ] 진행 방식 6단계가 실제 순서와 맞는지 (`process`)

**정책·안내 문구**

- [ ] 답변 안내 문구를 넣을지 (`contact.responseNote` — 지킬 수 있는 내용만)
- [ ] 문의 양식의 **예산 구간** (`inquiry.budgets`) — 실제 받는 작업 규모에 맞게
- [ ] FAQ의 “결제 방식과 증빙 서류도 견적과 함께 안내” — 세금계산서·현금영수증 발행 가능 여부 확인
- [ ] FAQ의 “동의받은 작업만 공개” 정책이 실제와 같은지
- [ ] FAQ의 “편집본 파일만으로도 작업 가능”, “라운드트립 가능” 답변이 맞는지
- [ ] 소개 문단의 생각·태도 문장이 본인 말투와 생각에 맞는지 (`about.paragraphs`, `sections.about.title`)
- [ ] 첫 화면 문구 (`hero.title`, `hero.lead`) 와 한 줄 소개 (`brand.tagline`)
- [ ] 공개된 작업이 0개일 때 작업 섹션에 보이는 안내 (`sections.works.empty` — 제목·본문·버튼 문구. 비워 두면 기본 문구)
- [ ] 검색 결과·카카오톡 미리보기에 보이는 설명과 검색어 (`seo.description`, `seo.keywords`) — 위에서 고친 서비스·장르와 맞는지

**설정값**

- [ ] 크몽 서비스 주소 (`contact.kmongUrl`)
- [ ] 배포 후 사이트 주소 (`siteUrl`) → 다시 빌드
- [ ] 쇼릴 프레임 레이트 (`reel.fps`, 기본 24)
- [ ] 쇼릴에 동의받지 않은 작업의 장면이 없는지 → 확인 후 `reel.consent: 'granted'` (모두 본인 작업이면 `'not-required'`) — [6장](#6-쇼릴-교체하기)
- [ ] GitHub 저장소를 비공개로 바꿀지 (GitHub Pages를 쓰지 않는다면 권장) — [9장](#저장소에-올라가는-content-도-공개됩니다)
- [ ] 대사·내레이션이 있는 작업에 자막이 들어갔는지 — [5장](#대사내레이션이-있는-작업은-자막이-필요합니다)
- [ ] 폼 전송 서비스(Formspree)를 쓸지 (`contact.formEndpoint`)
- [ ] Google Analytics를 쓸지 (`analytics.ga4Id`)
- [ ] Formspree나 GA4를 쓰는 경우, 개인정보(이름·연락처·방문 기록) 처리 안내가 필요한지 확인
- [ ] 사업자 정보 표시 여부 (`business`)
- [ ] 프로필 사진을 넣을지 (`about.portrait` — `site/assets/img/` 에 넣고 경로 입력). **JPG 또는 WebP, 긴 변 1200px 이하, 400KB 이하**로 줄여서 넣으세요
      (더 크면 빌드가 경고합니다. 휴대폰 사진의 HEIC·TIFF는 브라우저가 못 여니 경고 후 빼고 빌드합니다).
- [ ] 패키지·가격을 공개할지 (`packages` — 비워 두면 섹션 숨김)

---

## 14. 문제 해결

**`'npm'`/`'ffmpeg'` 은(는) 내부 또는 외부 명령… 이 아닙니다 / command not found**
설치 후 터미널을 새로 열었는지 확인하세요. ffmpeg가 계속 인식되지 않으면 `FFMPEG_PATH`, `FFPROBE_PATH` 환경 변수에 실행 파일 경로를 지정합니다.
터미널마다 쓰는 법이 다릅니다 — PowerShell: `$env:FFMPEG_PATH="C:\ffmpeg\bin\ffmpeg.exe"; $env:FFPROBE_PATH="C:\ffmpeg\bin\ffprobe.exe"; npm run media`,
명령 프롬프트(cmd): `set "FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe" && set "FFPROBE_PATH=C:\ffmpeg\bin\ffprobe.exe" && npm run media`,
macOS: `FFMPEG_PATH=/opt/homebrew/bin/ffmpeg FFPROBE_PATH=/opt/homebrew/bin/ffprobe npm run media` ([2장](#설치-확인)).

**Windows PowerShell: “이 시스템에서 스크립트를 실행할 수 없으므로 npm.ps1 파일을 로드할 수 없습니다”**
`npm.cmd run build` 처럼 `npm.cmd` 로 실행하거나, PowerShell에서 한 번만 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 를 실행하세요.

**`Node.js 18.17 이상이 필요합니다`**
[nodejs.org](https://nodejs.org) 에서 LTS 버전을 설치하세요.

**`npm run check` 에서 오류가 나요**
오류 메시지에 파일과 항목이 표시됩니다. 자주 있는 원인:
- 따옴표·쉼표·괄호 누락 (`content/*.mjs 를 읽지 못했습니다 — 문법 오류`) → 직전에 고친 줄 주변을 확인
- `slug` 에 대문자·공백·한글 사용 → 소문자 영어·숫자·하이픈만
- `category` 가 `site.mjs` 의 분류 id와 다름
- `consent` 오타 → `'granted'`, `'pending'`, `'not-required'` 중 하나
- `kmongUrl`·`siteUrl`·`formEndpoint` 가 `https://` 로 시작하지 않음

**작업이 사이트에 안 보여요**
`npm run check` 의 숨김 목록에 이유가 나옵니다: `publish: false`, `consent: 'pending'`, `포스터 이미지 없음`.
포스터가 없다고 나오면 `raw/works/<slug>/` 파일 이름을 확인하고 `npm run media -- <slug>` 를 실행하세요.

**쇼릴이 배포본에 안 나와요 (첫 화면에 쇼릴 대신 그래픽이 나와요)**
`npm run check` 에 `쇼릴 숨김 — reel.consent: 'pending'` 이 나오면 정상입니다. 쇼릴 속 장면의 공개 동의를 확인한 뒤 `content/site.mjs` 의 `reel.consent` 를
`'granted'`(모두 본인 작업이면 `'not-required'`)로 바꾸고 다시 빌드하세요 → [6장](#6-쇼릴-교체하기). 미리보기에서는 동의 전에도 보입니다.

**`works.mjs 의 비공개·동의 대기 작업 …에 클라이언트·크레딧·메모·영상 링크가 적혀 있습니다` 경고**
`works.mjs` 는 저장소에 그대로 올라가므로, 경고에 나온 작업의 블록을 통째로 `content/works.private.mjs` 로 옮기세요 → [9장](#저장소에-올라가는-content-도-공개됩니다).
이미 커밋·푸시했다면 기록에 남아 있으니 저장소를 비공개로 바꾸는 것을 검토하세요.

**원본이나 옵션을 바꿨는데 반영이 안 돼요 (‘영상 비교 재생’ 버튼이 안 나와요 등)**
`npm run media` 는 바뀐 원본과 옵션만 처리하므로, 작업 정보의 미디어 옵션(`video`, `baVideo`, `baTimes`, `posterTime`, `previewStart`, `autoCrop` …)이나
`reel` 의 `loopStart`·`loopDuration`·`posterTime`·`autoCrop` 을 바꿨다면 `npm run media -- <slug>` (쇼릴은 `npm run media -- --reel`)를 다시 실행하세요.
그래도 그대로면 `npm run media -- <slug> --force` 로 다시 만드세요. 그다음 `npm run build`.

**검은 띠가 잘렸어요 / 안 잘렸어요**
- 원본에 입혀진 검은 띠(레터박스)는 포스터·카드 미리보기·공유 이미지·비포·애프터·스틸·쇼릴 배경에서 **일부러** 잘라냅니다. 전체 영상(`main.mp4`·`reel.mp4`)에는 띠가 그대로 남습니다 → [11장](#검은-띠레터박스가-있는-마스터).
- **잘리면 안 되는데 잘렸다면** (검은 여백이 디자인의 일부인 작품 등): 그 작업에 `autoCrop: false` (쇼릴은 `reel.autoCrop: false`)를 적고
  `npm run media -- <slug>` (쇼릴은 `npm run media -- --reel`) → `npm run build`.
- **안 잘렸다면**: 띠가 완전히 검지 않거나(회색), 위아래 두께가 다르거나, 자막·로고가 띠에 걸쳐 있거나, 영상 중간에 화면비가 바뀌면 그림이 잘릴까 봐 자르지 않습니다.
  `npm run media -- <slug> --dry-run --force` (파일은 바뀌지 않음) 결과에 `레터박스 감지` 가 없으면 감지되지 않은 것입니다. 이때는 Resolve에서 띠 없이 실제 화면 비율(예: 1920×804)로 내보낸
  `poster.jpg`·`before-N`/`after-N`·스틸을 쓰세요.

**`HDR 소스입니다` 경고**
HDR/Rec.2020 파일은 웹에서 색이 틀어집니다. Resolve에서 SDR Rec.709로 다시 내보내세요 → [11장](#11-davinci-resolve-내보내기-권장-설정).

**사이트의 영상 색이 Resolve와 달라 보여요**
재생 환경(특히 Mac)의 감마 해석 차이일 가능성이 큽니다 → [11장](#11-davinci-resolve-내보내기-권장-설정)의 감마 시프트 설명을 참고하세요.

**카카오톡 공유 미리보기에 이미지가 안 떠요**
`siteUrl` 을 설정하고 다시 빌드·업로드했는지 확인하고, [카카오 공유 디버거](https://developers.kakao.com/tool/debugger/sharing) 에서 캐시를 초기화하세요.

**`포트 4173 사용 중`**
서버가 자동으로 다음 번호(4174 …)를 씁니다. 화면에 표시된 주소로 접속하세요. 이전 서버 창이 켜져 있다면 `Ctrl + C` 로 꺼 주세요.
미리보기 서버가 켜진 채로 `npm run serve` 를 실행하면 4173에는 미리보기가 그대로 보입니다. 상단에 `PREVIEW` 띠가 보이면 미리보기이니, 표시된 새 주소로 들어가세요.

**휴대폰에서 접속이 안 돼요**
PC와 휴대폰이 같은 와이파이인지, 서버가 표시한 `http://192.168.…:4173` 주소를 썼는지 확인하세요. Windows 방화벽이 Node.js 허용을 물으면 ‘개인 네트워크’를 허용하세요.
미리보기(`npm run preview`)는 비공개 작업이 들어 있어 이 컴퓨터에서만 열립니다. 휴대폰으로 보려면 `npm run preview -- --lan` 으로 여세요(집·사무실 와이파이에서만).

**`index.html` 을 더블클릭해서 열면 일부가 이상해요**
영상 재생 등 일부 기능은 브라우저 보안 때문에 파일로 직접 열면 제한됩니다. `npm run serve` 로 확인하세요.

**수정했는데 브라우저에 예전 화면이 보여요**
`Ctrl + F5` (Mac: `Cmd + Shift + R`) 로 새로고침하세요.
