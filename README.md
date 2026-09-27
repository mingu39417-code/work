# TONECRAFT — 컬러리스트 임민규 포트폴리오 사이트

컬러 그레이딩 · DI 작업을 소개하는 포트폴리오 웹사이트와, 그 사이트를 만드는 도구 모음입니다.

- **내용(문구·작업 목록)** 은 `content/` 폴더의 파일 두 개만 고치면 됩니다.
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
│  └─ works.mjs             작업(포트폴리오) 목록
├─ raw/                     ← Resolve에서 내보낸 원본을 넣는 곳 (git에 올라가지 않음)
│  ├─ reel/                 쇼릴 영상 1개
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

ffmpeg를 PATH에 넣지 않고 쓰고 싶다면 환경 변수 `FFMPEG_PATH`, `FFPROBE_PATH` 에 실행 파일 경로를 지정할 수 있습니다.

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

---

## 4. 명령어 한눈에 보기

| 명령어 | 하는 일 |
| --- | --- |
| `npm run build` | 배포용 사이트를 `site/` 에 만듭니다. **공개 조건을 만족한 작업만** 들어갑니다. |
| `npm run check` | 내용 검사와 보고만 합니다. 파일은 쓰지 않습니다. 배포 전 습관처럼 실행하세요. |
| `npm run preview` | 비공개 작업까지 포함한 미리보기를 `.preview/` 에 만들고 http://localhost:4173 에서 보여줍니다. |
| `npm run serve` | `site/` (배포본)를 http://localhost:4173 에서 보여줍니다. |
| `npm run media` | `raw/` 원본을 웹용으로 변환해 `media/` 에 저장합니다. 바뀐 파일만 다시 처리합니다. |
| `npm run demo` | 데모 프로젝트를 `.demo/` 에 만들고 빌드합니다. 확인: `node tools/serve.mjs --root .demo` |
| `npm test` | 자동 테스트(콘텐츠 검사·빌드·미디어 변환·서버)를 실행합니다. 브라우저 테스트는 아래 [브라우저 테스트](#브라우저-테스트-선택) 참고. |

### 옵션

npm 명령에 옵션을 붙일 때는 **`--` 뒤에** 적습니다. (`node tools/...` 로 직접 실행해도 같습니다.)

```bash
npm run media -- brand-film-2026         # 이 작업만 변환
npm run media -- --reel                  # 쇼릴만 변환
npm run media -- --force                 # 이미 만든 것도 전부 다시 변환
npm run media -- --dry-run               # 무엇을 할지 보여주기만
npm run serve -- --port 5000             # 다른 포트로 서버 열기
```

| 도구 | 옵션 |
| --- | --- |
| `tools/build.mjs` | `--root <폴더>` `--preview` `--check` `--quiet` |
| `tools/media.mjs` | `[slug ...]` `--reel` `--force` `--dry-run` `--root <폴더>` |
| `tools/serve.mjs` | `--root <폴더>` `--port <번호>` (기본 4173, 사용 중이면 다음 번호) `--host <주소>` (기본 0.0.0.0) `--preview` |
| `tools/demo.mjs` | `--force` (데모 원본·미디어를 모두 다시 만들기) `--root <폴더>` (기본 `.demo`) |

미디어 변환 속도·품질은 환경 변수로 조절할 수 있습니다: `TONECRAFT_X264_PRESET` (기본: 전체 영상 `slow`, 나머지 `medium` — 급할 때 `veryfast`. `ultrafast` 는 화질 프로필이 낮아지므로 쓰지 마세요), `TONECRAFT_MEDIA_JOBS` (동시에 처리할 파일 수).

### 브라우저 테스트 (선택)

`tests/e2e.mjs` 는 실제 브라우저(Playwright의 Chromium)로 사이트를 열어 메뉴, 쇼릴 재생·창, 필터, 카드 미리보기, 비포·애프터 드래그·터치·영상 비교,
작업 페이지 링크, 문의 양식(검사·메일 구성·복사·임시 저장), 404, 가로 넘침을 데스크톱·모바일 크기에서 확인합니다.
Playwright는 이 프로젝트에 포함되지 않으므로(의존성 0개 원칙) 따로 설치된 경우에만 실행됩니다.

```bash
npm run demo                                              # 테스트할 데모 사이트 준비
npm install --no-save playwright && npx playwright install chromium   # 처음 한 번 (선택)
node tests/e2e.mjs                 # .demo 검사  (--root . 이면 실제 site/ 검사)
```

`AXE_PATH=<axe-core의 axe.min.js 경로>` 를 함께 주면 접근성 검사(axe-core)도 실행합니다. Playwright가 없으면 안내만 출력하고 건너뜁니다.

---

## 5. 작업 추가하기 (단계별)

예시: 2026년 광고 작업 “브랜드 필름”을 추가한다고 가정합니다.

### ① slug(영문 주소 이름) 정하기

- 소문자 영어, 숫자, 하이픈(`-`)만 사용합니다. 예: `brand-film-2026`, `nike-air-mv`
- 사이트 주소(`works/brand-film-2026/`)와 원본 폴더 이름으로 쓰입니다.
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
└─ stills/             추가 스틸 컷 (선택 · 파일 이름순으로 표시)
   ├─ 01.png
   └─ 02.png
```

- 이미지 형식: jpg jpeg png tif tiff webp bmp dpx (대소문자 무관)
- 파일 이름은 위 규칙(`main`, `poster`, `before-숫자`, `after-숫자`)을 지켜야 인식됩니다. 규칙에 맞지 않는 파일은 무시되고, 무시된 파일 목록이 화면에 표시됩니다.
- **포스터는 반드시 필요합니다.** `poster.*` 가 없으면 `main` 영상에서, `main` 도 없으면 `after-1` 에서 만듭니다. 셋 다 없으면 그 작업은 공개되지 않습니다.
- 원본은 삭제되지 않습니다. 도구는 `raw/` 를 읽기만 합니다.

### ③ 웹용으로 변환하기

```bash
npm run media                      # 전체 (바뀐 것만)
npm run media -- brand-film-2026   # 이 작업만
```

결과는 `media/works/brand-film-2026/` 에 저장됩니다: 전체 영상(`main.mp4`), 카드용 6초 미리보기(`preview.mp4`),
포스터(`poster.jpg` + WebP), 공유용 이미지(`og.jpg`, 1200×630), 비포·애프터 이미지, 스틸 컷.
모든 영상은 BT.709(Rec.709)로 정확히 태그되고, 색 변환 행렬을 추측하지 않도록 고정해 두었습니다.

### ④ `content/works.mjs` 에 작업 정보 적기

파일 안의 예시 블록(주석 처리된 부분)을 복사해 `//` 를 지우고 고칩니다. 최소한 이 정도면 됩니다.

```js
export default [
  {
    slug: 'brand-film-2026',
    title: '브랜드 필름',
    client: '',                 // 공개 동의를 받은 경우에만 적기
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
- 정렬: `order` 작은 순 → 연도 최신순 → 제목순. `featured: true` 는 홈에서 크게 보이고 비포·애프터에 먼저 나옵니다.
- `posterTime: 12.5` 처럼 적으면 포스터를 뽑을 위치(초)를 정할 수 있습니다. 바꾼 뒤 `npm run media` 를 다시 실행하세요.

### ⑤ 미리보기로 확인하기

```bash
npm run preview        # → http://localhost:4173
```

미리보기는 `publish: false` 인 작업도 보여줍니다(상단에 `PREVIEW` 띠가 표시됩니다). 카드, 상세 페이지, 비포·애프터, 휴대폰 화면을 확인하세요.

### ⑥ 공개 동의 확인 후 공개로 바꾸기

클라이언트에게 공개 동의를 받았다면:

```js
    publish: true,
    consent: 'granted',        // 본인 작업 등 동의가 필요 없으면 'not-required'
```

### ⑦ 검사 → 빌드 → 배포

```bash
npm run check          # 오류 0개인지, 숨김 작업 목록이 예상과 같은지 확인
npm run build          # site/ 갱신
npm run serve          # 배포본 최종 확인 (선택)
```

그다음 `site/` 폴더를 다시 업로드합니다 → [10장](#10-배포하기-파일만-올리면-끝).

---

## 6. 쇼릴 교체하기

1. `raw/reel/` 에 새 쇼릴 영상을 넣고 **이전 파일은 지웁니다**. (여러 개가 있으면 이름순으로 첫 번째 파일만 씁니다.)
2. 변환합니다.
   ```bash
   npm run media -- --reel
   ```
   - `reel.mp4` — 소리 포함 전체 쇼릴 (‘쇼릴 보기’ 버튼으로 재생)
   - `reel-loop.mp4` — 첫 화면 배경용 무음 루프 (최대 40초)
   - `poster.jpg` — 영상이 로드되기 전에 보이는 이미지
3. `npm run build` 후 `site/` 를 다시 업로드합니다.

**옵션** (`content/site.mjs` 의 `reel`)

- 소리까지 있는 전체 쇼릴을 Vimeo/YouTube에 올렸다면 `embed: { type: 'vimeo', id: '123456789' }` 로 연결하세요.
  이 경우 `reel.mp4` 는 만들지 않고, 배경 루프만 직접 호스팅합니다(파일 용량을 크게 줄일 수 있습니다).
- `fps` 는 첫 화면 타임코드 표시용입니다. 쇼릴 타임라인의 프레임 레이트를 적으세요(23.976이면 24).
- `publish: false` 로 두면 쇼릴이 사이트에서 완전히 빠집니다.
- 빌드 보고서에 `reel.mp4` 가 25 MB를 넘는다고 나오면 Cloudflare Pages에는 올릴 수 없습니다. 이때는 위의 `embed` 를 쓰세요 → [12장](#12-용량이-큰-영상-다루기).

---

## 7. 비포·애프터 만들기

비포·애프터는 슬라이더로 원본과 그레이딩 결과를 비교하는 기능입니다. 홈에는 작업별 첫 번째 쌍이 최대 4개(`featured` 작업 먼저) 나오고,
작업 상세 페이지에는 그 작업의 모든 쌍이 나옵니다.

### 파일 규칙

- `before-1` 과 `after-1` 이 한 쌍입니다. 2번째 쌍은 `before-2` / `after-2` … 이렇게 이어집니다.
- **같은 프레임, 같은 해상도, 같은 화면 비율**이어야 슬라이더에서 정확히 겹칩니다.
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
- 비교 영상 구간은 `baVideoStart` (기본: `baTimes` 값 또는 0초), `baVideoDuration` (기본 8초)으로 조절합니다.

### 설명 문구

```js
comparisons: [
  { caption: 'S-Log3 원본 → 최종 그레이딩', beforeLabel: 'LOG', afterLabel: 'GRADED' },  // 1번 쌍
  { caption: '카메라 매칭 — B캠을 A캠 톤에 맞춤' },                                      // 2번 쌍 (라벨 기본값 BEFORE/AFTER)
],
```

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
- 내용이 아주 길면(한글 약 200자 이상) 일부 메일 앱이 주소를 받지 못하므로, 메일에는 앞부분만 담고 **전체 내용은 자동으로 클립보드에 복사**한 뒤 붙여넣도록 안내합니다.
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

### 숨긴 작업은 “흔적이 남지 않습니다”

조건을 만족하지 못한 작업은 `site/` 에 **페이지, 카드, 제목, 주소, 검색용 데이터(JSON-LD), 사이트맵, 이미지·영상 파일 어디에도** 들어가지 않습니다.
예전에 공개했다가 숨긴 작업의 페이지와 미디어도 다음 빌드 때 `site/` 에서 삭제됩니다.

이렇게까지 하는 이유: 정적 사이트는 `site/` 폴더 안의 모든 파일이 곧 공개 파일입니다. 링크만 숨기면 주소를 추측하거나 소스 보기로 찾아낼 수 있고,
저장소가 **공개(public)** 라서 GitHub에 올라간 파일은 누구나 볼 수 있습니다. 그래서 “숨김 = 아예 없음”으로 처리합니다.

- `npm run check` / `npm run build` 는 숨겨진 작업과 그 이유를 매번 출력합니다. 배포 전에 목록이 예상과 같은지 확인하세요.
- 미리보기(`npm run preview`)는 숨긴 작업까지 보여주지만 결과가 `.preview/` 에만 저장되므로 배포본과 섞이지 않습니다. **`.preview/` 는 절대 업로드하지 마세요.**
- 동의를 받은 날짜·방법을 `works.mjs` 에 주석으로 남겨 두면 나중에 확인하기 좋습니다. 예: `consent: 'granted', // 2026-10-02 이메일로 동의`

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
npm run build
git add content site
git commit -m "사이트 업데이트"
git push
git subtree push --prefix site origin gh-pages
```

1. 처음 한 번: GitHub 저장소 → **Settings → Pages → Build and deployment** → Source: *Deploy from a branch*, Branch: **`gh-pages` / `(root)`** → Save
2. 몇 분 뒤 `https://mingu39417-code.github.io/work/` 에서 확인합니다.
3. 이렇게 **하위 폴더(`/work/`) 주소**에 배포하면 `siteUrl` 을 `'https://mingu39417-code.github.io/work'` 로 설정하고 다시 빌드·푸시하세요. 그래야 없는 주소로 들어왔을 때 보이는 404 페이지의 디자인과 링크도 제대로 동작합니다(다른 페이지는 설정 전에도 정상).
- 저장소가 **공개**라는 점을 꼭 기억하세요. 커밋하는 순간 파일이 공개되고, 나중에 지워도 **기록(히스토리)에 남습니다.** 커밋 전에 `npm run check` 의 숨김 목록과 `git status` 를 확인하세요. (`raw/`, `media/`, `.preview/` 는 git에서 제외되어 있습니다.)
- GitHub은 100 MB 이상 파일을 받지 않습니다(빌드 보고서에서 95 MB 초과 파일을 표시합니다).
- `git subtree push` 가 거부되면(예: gh-pages 브랜치를 따로 고친 경우) 다음 명령으로 덮어씁니다 (Git Bash·macOS 터미널·PowerShell 공통):
  `git push origin "$(git subtree split --prefix site HEAD):gh-pages" --force`

### 방법 4 — 일반 웹호스팅 / FTP

FTP 프로그램(FileZilla 등)으로 **`site` 폴더 안의 내용물**을 호스팅의 웹 루트(`public_html`, `www`, `html` 등)에 올립니다.
호스팅 관리 화면에서 오류 페이지를 설정할 수 있다면 404 페이지로 `404.html` 을 지정하세요.

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

---

## 11. DaVinci Resolve 내보내기 권장 설정

`npm run media` 는 원본을 웹용 H.264로 다시 인코딩하면서 **Rec.709(BT.709) 태그를 정확히 붙이고, 색 변환 행렬을 추측하지 않도록 고정**합니다.
따라서 원본은 “화질 좋은 Rec.709 마스터”이기만 하면 됩니다. 웹용 압축은 도구에 맡기세요.

| 항목 | 권장 값 |
| --- | --- |
| 그레이딩 기준 | 타임라인/출력 색공간 **Rec.709 Gamma 2.4** |
| 형식 · 코덱 | QuickTime **Apple ProRes 422 HQ** (마스터) — 또는 고화질 H.264 (Quality: Best 등 넉넉한 비트레이트) |
| 해상도 | 1920×1080 이상 (도구가 가로 1920 이하로 줄입니다. 절대 키우지 않음) |
| 프레임 레이트 | 타임라인 그대로 |
| Data Levels | **Auto (Video)** — Full로 바꾸지 마세요 |
| 색 태그 | Deliver → Video → Advanced Settings → **Color Space Tag: Rec.709 / Gamma Tag: Rec.709** → 1-1-1 태그 |
| 오디오 | Linear PCM(ProRes) 또는 AAC 320 kbps — 쇼릴·전체 영상만 소리를 사용합니다 |
| HDR 소스 | 사용하지 마세요. HDR/Rec.2020 파일이면 도구가 경고합니다 → SDR Rec.709로 내보낸 파일로 교체 |

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
3. 원본 `main.mov` 는 **그대로 `raw/` 에 둡니다.** 카드 미리보기(6초)와 포스터는 원본에서 만들고, 무거운 `main.mp4` 는 배포 폴더에 복사되지 않습니다.
   상세 페이지에서는 포스터를 누르면 그때 Vimeo/YouTube 플레이어가 로드됩니다.

직접 호스팅은 짧은 영상에만 쓰세요. 화질을 우선한 1080p 설정이라 30초짜리 영상도 수십 MB가 될 수 있습니다(실제 크기는 빌드 보고서에서 확인).

### 호스팅별 파일 크기 제한

| 호스팅 | 파일 하나당 제한 |
| --- | --- |
| Cloudflare Pages | 25 MB |
| GitHub (Pages 포함) | 100 MB (50 MB부터 경고) |

`npm run build` 가 끝나면 `site/` 전체 크기, 가장 큰 파일 목록, 25 MB·95 MB 초과 파일을 알려줍니다. 초과 파일이 있으면 임베드로 바꾸거나 영상을 짧게 잘라 주세요.

### 저장소(GitHub)에 올릴 때

- 이 저장소는 **공개**입니다. `raw/`(원본)와 `media/`(변환본), `.preview/` 는 `.gitignore` 로 제외되어 있으니 **`git add -f` 로 강제로 올리지 마세요.**
- `site/` 에는 공개 조건을 만족한 작업의 파일만 들어가지만, 커밋 전에 `npm run check` 의 숨김 목록을 다시 확인하세요.
- Netlify Drop·Cloudflare 직접 업로드로 배포한다면 `site/media/` 를 굳이 커밋할 필요가 없습니다. `git add content` 처럼 필요한 폴더만 골라 커밋하세요.

---

## 13. 확인 필요 체크리스트

`content/site.mjs` 의 문구는 **사실만 쓰도록 초안을 잡았지만**, 아래 항목은 본인이 확인하고 맞게 고쳐야 합니다.
(경력 연수, 클라이언트 이름, 수상, 작업 수, 가격, 작업 기간, 수정 횟수, 지역 같은 사실은 일부러 적지 않았습니다. 넣고 싶다면 사실대로 추가하세요.)

**서비스·작업 방식**

- [ ] 서비스 4가지를 모두 제공하는지 — 특히 **뷰티·클린업 리터치**, **현장 모니터링용 LUT**, 촬영 전 **룩 테스트** (`services`)
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

**설정값**

- [ ] 크몽 서비스 주소 (`contact.kmongUrl`)
- [ ] 배포 후 사이트 주소 (`siteUrl`) → 다시 빌드
- [ ] 쇼릴 프레임 레이트 (`reel.fps`, 기본 24)
- [ ] 폼 전송 서비스(Formspree)를 쓸지 (`contact.formEndpoint`)
- [ ] Google Analytics를 쓸지 (`analytics.ga4Id`)
- [ ] Formspree나 GA4를 쓰는 경우, 개인정보(이름·연락처·방문 기록) 처리 안내가 필요한지 확인
- [ ] 사업자 정보 표시 여부 (`business`)
- [ ] 프로필 사진을 넣을지 (`about.portrait` — `site/assets/img/` 에 넣고 경로 입력)
- [ ] 패키지·가격을 공개할지 (`packages` — 비워 두면 섹션 숨김)

---

## 14. 문제 해결

**`'npm'`/`'ffmpeg'` 은(는) 내부 또는 외부 명령… 이 아닙니다 / command not found**
설치 후 터미널을 새로 열었는지 확인하세요. ffmpeg가 계속 인식되지 않으면 `FFMPEG_PATH`, `FFPROBE_PATH` 환경 변수에 실행 파일 경로를 지정할 수 있습니다.

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

**원본을 바꿨는데 반영이 안 돼요**
`npm run media` 는 바뀐 파일만 처리합니다. 그래도 그대로면 `npm run media -- <slug> --force` 로 다시 만드세요. 그다음 `npm run build`.

**`HDR 소스입니다` 경고**
HDR/Rec.2020 파일은 웹에서 색이 틀어집니다. Resolve에서 SDR Rec.709로 다시 내보내세요 → [11장](#11-davinci-resolve-내보내기-권장-설정).

**사이트의 영상 색이 Resolve와 달라 보여요**
재생 환경(특히 Mac)의 감마 해석 차이일 가능성이 큽니다 → [11장](#11-davinci-resolve-내보내기-권장-설정)의 감마 시프트 설명을 참고하세요.

**카카오톡 공유 미리보기에 이미지가 안 떠요**
`siteUrl` 을 설정하고 다시 빌드·업로드했는지 확인하고, [카카오 공유 디버거](https://developers.kakao.com/tool/debugger/sharing) 에서 캐시를 초기화하세요.

**`포트 4173 사용 중`**
서버가 자동으로 다음 번호(4174 …)를 씁니다. 화면에 표시된 주소로 접속하세요. 이전 서버 창이 켜져 있다면 `Ctrl + C` 로 꺼 주세요.

**휴대폰에서 접속이 안 돼요**
PC와 휴대폰이 같은 와이파이인지, 서버가 표시한 `http://192.168.…:4173` 주소를 썼는지 확인하세요. Windows 방화벽이 Node.js 허용을 물으면 ‘개인 네트워크’를 허용하세요.

**`index.html` 을 더블클릭해서 열면 일부가 이상해요**
영상 재생 등 일부 기능은 브라우저 보안 때문에 파일로 직접 열면 제한됩니다. `npm run serve` 로 확인하세요.

**수정했는데 브라우저에 예전 화면이 보여요**
`Ctrl + F5` (Mac: `Cmd + Shift + R`) 로 새로고침하세요.
