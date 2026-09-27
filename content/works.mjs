// =============================================================================================
//  작업(포트폴리오) 목록
// ---------------------------------------------------------------------------------------------
//  작업 하나 = { ... } 한 덩어리. 아래 [ ] 안에 쉼표로 구분해 차례로 적습니다.
//  맨 아래 「예시」를 복사해 // 를 지우고 내용을 바꾸면 됩니다. (자세한 순서는 README.md 「작업 추가하기」)
//
//  ■ 꼭 필요한 값
//    slug      주소와 미디어 폴더 이름. 소문자 영어·숫자·하이픈(-)만. 예: 'nike-air-2026'
//              → 원본 파일은 raw/works/<slug>/ 에 넣습니다. 한 번 공개한 뒤에는 바꾸지 않는 것이 좋습니다.
//    title     작품 제목
//    category  site.mjs의 categories id 중 하나
//              'commercial'(광고) · 'music-video'(뮤직비디오) · 'film'(영화·단편)
//              'branded'(브랜디드·유튜브) · 'product'(제품·커머스)
//
//  ■ 공개 규칙 (중요)
//    사이트에 보이려면 세 가지가 모두 맞아야 합니다.
//      1) publish: true
//      2) consent가 'pending'(동의 대기)이 아닐 것 → 'granted'(동의 받음) 또는 'not-required'(동의 불필요)
//      3) 포스터 이미지가 있을 것 (npm run media 가 raw/ 파일로 만들어 줍니다)
//    하나라도 빠지면 그 작업은 배포용 사이트(site/)에 페이지·카드·이미지·영상 어디에도 흔적이 남지 않습니다.
//    숨겨진 작업은 `npm run preview`에서만 보입니다.
//
//  ■ 원본 파일 이름 규칙 (raw/works/<slug>/)
//    main.mp4 (또는 .mov 등)      완성된 전체 영상 (선택)
//    poster.jpg                    대표 이미지 (선택 — 없으면 main 영상에서 자동 추출)
//    before-1.jpg / after-1.jpg    비포·애프터 1번 쌍 (이미지 또는 영상, 양쪽 모두 필요)
//    before-2.mov / after-2.mov    2번 쌍 …
//    stills/*.jpg                  추가 스틸 컷 (선택, 파일 이름순)
//
//  ■ 목록 순서: order 작은 순 → 연도 최신순 → 제목순. featured: true 는 홈에서 크게 보입니다.
// =============================================================================================

export default [
  // ---------------------------------------------------------------- 예시 (// 를 지우고 사용)
  // {
  //   slug: 'brand-film-2026',              // 필수 · 주소 works/brand-film-2026/ 와 raw/works/brand-film-2026/
  //   title: '브랜드 필름 제목',             // 필수
  //   client: '',                           // 클라이언트·아티스트 이름 (공개 동의를 받은 경우만)
  //   category: 'commercial',               // 필수 · 위 분류 id 중 하나
  //   year: 2026,                           // 연도 (숫자, 따옴표 없이)
  //   date: '',                             // 공개일 'YYYY-MM-DD' (선택)
  //   role: '컬러 그레이딩',                  // 맡은 역할 (기본값 '컬러 그레이딩')
  //   summary: '',                          // 카드·상세 페이지에 보이는 한 줄 소개
  //   notes: [                              // 그레이딩 노트 — 한 항목이 한 문단
  //     // '따뜻한 하이라이트와 차분한 섀도로 제품의 질감을 살렸습니다.',
  //   ],
  //   credits: [                            // 크레딧 (공개 동의를 받은 이름만)
  //     // { role: '감독', name: '홍길동' },
  //     // { role: '촬영', name: '...' },
  //   ],
  //   camera: '',                           // 촬영 카메라 (예: 'Sony FX6')
  //   featured: false,                      // true → 홈에서 크게 + 비포·애프터 우선 노출
  //   order: 0,                             // 정렬 순서 (작을수록 앞)
  //   publish: false,                       // true 여야 공개
  //   consent: 'pending',                   // 'granted' | 'pending' | 'not-required' — 'pending'이면 공개되지 않음
  //   video: null,                          // 긴 영상은 Vimeo/YouTube 연결 권장: { type: 'vimeo', id: '123456789' }
  //                                         //   또는 { type: 'youtube', id: 'AbCdEfGhIjK' } (11자 ID) — null이면 raw의 main 영상을 직접 재생
  //   comparisons: [                        // 비포·애프터 쌍마다 설명 (0번 = before-1/after-1)
  //     // { caption: '로그 원본 → 최종 그레이딩', beforeLabel: 'LOG', afterLabel: 'GRADED' },
  //   ],
  //   alt: '',                              // 대표 이미지 설명 (비우면 '제목 컬러 그레이딩 장면')
  //
  //   // ---- 미디어 변환 옵션 (npm run media 가 사용, 보통은 그대로 두세요) ----
  //   posterTime: null,                     // main 영상의 몇 초 지점을 포스터로 쓸지 (기본: 길이의 30%, 최대 20초)
  //   previewStart: null,                   // 카드 미리보기 시작 초 (기본: posterTime과 같음)
  //   previewDuration: 6,                   // 카드 미리보기 길이 (초)
  //   baTimes: [],                          // 비포·애프터가 영상일 때 쌍별로 뽑을 프레임 위치(초). 예: [12.5, 40]
  //   baVideo: false,                       // true → 영상 쌍이면 좌우 비교 영상도 생성
  //   baVideoStart: null,                   // 비교 영상 시작 초 (기본: baTimes 값 또는 0)
  //   baVideoDuration: 8,                   // 비교 영상 길이 (초)
  // },
];
