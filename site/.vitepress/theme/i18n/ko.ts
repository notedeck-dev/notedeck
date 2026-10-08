// 原文 ja.ts から訳した時点のハッシュ。docs-lint が訳の置き去りを検出する (#1145)
// sourceHash: 744d7c22947c

import type { Messages } from './ja'

const ko: Messages = {
  nav: {
    docs: '문서',
    why: '특징',
    features: '기능',
    download: '다운로드',
    menu: '메뉴',
    colorMode: '색상 모드 전환',
    language: '언어',
  },
  release: {
    latest: '최신 릴리스 보기',
    released: (tag: string) => `${tag} 릴리스`,
  },
  hero: {
    desc: 'Misskey 헤비 유저를 위한 비공식 클라이언트.',
    download: '다운로드',
    tryGuest: '로그인 없이 써 보기',
    screenshotAlt: 'NoteDeck의 덱 화면 — 칼럼을 가로로 나란히 배치한 레이아웃',
  },
  keyFeatures: [
    {
      icon: '🗂️',
      title: '모든 서버를 한 화면에',
      lead: '알림, 타임라인, 검색을 ',
      leadStrong: '계정을 넘나들며 한꺼번에.',
      body: 'misskey.io, nijimiss, sushi.ski — 서버를 몇 곳 쓰든 하나의 덱에서 모두 파악할 수 있습니다. 칼럼마다 다른 계정을 지정하는 사용법은 Misskey 웹의 덱으로는 할 수 없습니다.',
    },
    {
      icon: '💾',
      title: '본 노트는 손안에 남습니다',
      lead: '지나간 노트를 ',
      leadStrong: '앱이 자동으로 기억합니다.',
      body: '흘러간 타임라인은 로컬 DB에 자동으로 저장됩니다. "그 노트 어디 있었지?"도 전문 검색으로 금방 찾을 수 있습니다. 네트워크가 없어도 다시 읽을 수 있고, 서버에서 사라져도 손안에는 남습니다.',
    },
    {
      icon: '⚡',
      title: '가볍고 빠르게',
      lead: '브라우저가 아닌 ',
      leadStrong: 'Rust로 만든 네이티브 앱.',
      body: '콜드 스타트는 1초 미만, 트레이에서의 복귀는 순식간입니다. 스크롤은 매끄럽고 배터리에도 부담이 적습니다. 계속 열어 둔 브라우저 탭이나 무거운 런타임과는 무관합니다.',
    },
  ],
  guest: {
    title: '로그인 없이 써 볼 수 있습니다',
    lead: '게스트 계정을 추가하면 회원 가입 없이 공개 콘텐츠를 열람할 수 있습니다.',
    canLabel: '할 수 있는 것',
    cannotLabel: '할 수 없는 것',
    can: [
      '공개 타임라인 (로컬, 글로벌 등) 열람',
      '채널, 갤러리, 페이지 등 공개 콘텐츠 열람',
      '서버 정보, 커스텀 이모지, 연합 차트 살펴보기',
      '테마, 위젯 등 로컬 도구 사용',
    ],
    cannot: [
      '게시, 리액션, 팔로우',
      '알림 수신',
      '드라이브, 리스트, 안테나, 클립 관리',
    ],
    foot: '열람할 수 있는 범위는 각 서버의 공개 설정을 따릅니다. 그만둘 때는 "게스트 삭제"만 하면 됩니다 — 회원 가입도 이메일 주소도 필요 없습니다.',
  },
  features: {
    title: '기능',
    deck: {
      chip: '덱 UI',
      title: '자유롭게 배치하는 나만의 레이아웃',
      body: '홈, 로컬, 알림, 검색, 리스트, 안테나, 채널, 채팅 — 어떤 칼럼이든 가로로 나란히 놓고 한눈에 볼 수 있습니다. 너비는 드래그로 자유롭게 조절하고, 배치는 "프로파일"로 저장해 클릭 한 번으로 전환합니다.',
      list: [
        '16종류 이상의 칼럼 타입',
        '여러 계정의 알림과 검색을 통합 표시',
        '칼럼을 팝아웃해 별도 창으로',
        'PiP (항상 위에 표시되는 작은 창)로 멀티 모니터 활용',
      ],
    },
    offline: {
      chip: '오프라인에서도',
      title: '흘러간 노트도 여기에 남습니다',
      body: '타임라인에 흘러온 노트는 로컬 SQLite에 자동으로 쌓입니다. 서버에서 노트가 사라져도, 연합이 끊겨도 손안의 데이터는 계속 남습니다.',
      list: [
        '전문 검색으로 지난 노트를 순식간에 발견',
        '오프라인 모드로 전환해 배터리 절약',
        'DB 파일 하나를 복사해 통째로 백업',
        '서버가 사라져도 게시물은 손안에 남음',
      ],
    },
    security: {
      chip: '안심',
      title: '로그인 정보는 OS가 지킵니다',
      body: '계정의 열쇠가 되는 토큰은 브라우저 저장소가 아니라 OS 키체인 (macOS Keychain, Windows 자격 증명 관리자 등)에 암호화해 보관합니다. 앱 안에 평문으로 두지 않는 설계입니다.',
      list: [
        'OS 키체인에 암호화해 보관',
        '다 쓴 토큰은 메모리에서도 삭제',
        '로컬 API는 외부 웹사이트의 접근을 차단',
      ],
      policyHtml:
        '대책의 자세한 내용은 <a href="https://github.com/notedeck-dev/notedeck/blob/main/SECURITY.md">SECURITY</a>에 공개되어 있습니다',
    },
  },
  more: {
    title: '그 밖에도',
    keyboard: {
      title: '키보드만으로 완결',
      body: '명령 팔레트 (Ctrl+K)에서 30개 이상의 명령을 검색하고 실행합니다. 키 바인딩은 모두 사용자 지정할 수 있습니다.',
    },
    bossKey: {
      title: 'Boss Key & Quick Note',
      body: 'Ctrl+Shift+B로 창을 순식간에 숨깁니다. Ctrl+Alt+N으로 어느 화면에서든 바로 게시합니다. 데스크톱 앱이기에 가능한 글로벌 단축키입니다.',
    },
    mfm: {
      title: 'MFM도 수식도',
      body: 'Misskey 고유의 문자 꾸미기 문법 (MFM)을 모두 지원합니다. 수식 (KaTeX)과 코드 하이라이트도 깔끔하게 표시합니다.',
    },
    preview: {
      title: 'URL만 붙여 넣으면 미리보기',
      body: 'YouTube, Spotify, 니코니코 동화, Pixiv, Amazon 등 16개 사이트 전용 미리보기를 지원합니다. 링크를 붙여 넣기만 하면 풍부하게 펼쳐집니다.',
    },
    forks: {
      title: '포크도 지원',
      body: 'Misskey 본가와 Misskey라는 이름을 계속 쓰는 포크를 지원합니다. 서버 종류는 자동으로 판별하고, 포크 고유의 타임라인도 그대로 쓸 수 있습니다.',
    },
    appearance: {
      title: '외관은 내 취향대로',
      body: 'Misskey 테마를 그대로 쓸 수 있고, 덱 배경 화면도 설정할 수 있습니다. 다크/라이트 자동 전환, 제스처 조작, OS 네이티브 알림도 지원합니다.',
    },
    ads: {
      title: '서버와의 공생',
      body: '서버 광고를 제대로 표시하는 몇 안 되는 서드파티 클라이언트입니다. 표시 빈도도 서버 설정을 따릅니다.',
    },
    data: {
      title: '데이터는 당신의 것',
      body: 'DB 파일을 복사해 통째로 백업합니다. 설정 내보내기/가져오기도 지원하며, 로그아웃 후에도 데이터를 남길지 고를 수 있습니다.',
    },
    perf: {
      title: '가벼움을 고를 수 있습니다',
      body: '저메모리부터 고성능까지 프리셋으로 전환합니다. 프레임 레이트는 기기에 맞춰 자동으로 최적화됩니다.',
    },
  },
  ide: {
    title: '사실 이건 "IDE"입니다',
    descHtml:
      'NoteDeck의 정체는 <strong>Misskey 통합 덱 환경</strong> (Integrated Deck Environment)',
    store: {
      title: '스토어에서 꾸미고 기능을 더하기',
      strong: '플러그인, 테마, 위젯을 클릭 한 번으로. ',
      bodyHtml:
        '전용 스토어 <a href="https://store.notedeck.io">misstore</a>에서 바로 설치하고, 계정마다 켜고 끌 수 있습니다. AiScript 에디터와 라이브 미리보기도 내장되어 있어 직접 만든 것이 그 자리에서 동작합니다.',
    },
    ai: {
      title: 'AI가 덱에 산다',
      strong: '요약도 게시도 리액션도 맡길 수 있는 파트너. ',
      body: 'AI 채팅 전용 칼럼과 함께 노트 메뉴에서 바로 AI 액션을 쓸 수 있습니다. 무언가를 쓰기 전에는 반드시 확인을 구하므로 멋대로 움직이지 않습니다. 자리를 비운 동안의 정기 점검도 맡길 수 있습니다. Anthropic, OpenAI, xAI, Google, OpenRouter 등에서 자유롭게 고를 수 있습니다. 사용 여부는 선택 사항 — 자신의 API 키를 연결했을 때만 활성화되며, 없어도 다른 기능은 모두 쓸 수 있습니다.',
    },
    inspect: {
      title: '속이 전부 보입니다',
      strong: 'Misskey의 이면을 그대로 관찰할 수 있습니다. ',
      body: '서버와 주고받는 내용을 실시간으로 들여다보는 인스펙터와 노트의 원시 데이터 (Raw JSON) 뷰를 내장했습니다. 민감한 필드는 자동으로 마스킹됩니다. Misskey의 구조를 배우는 가장 빠른 길입니다.',
    },
    openTitle: '닫힌 상자가 아닌 열린 상자',
    openLead: '출하 시의 기능으로 끝나지 않습니다. 쓰는 사람의 손으로 넓혀 가기 위해.',
    extend: {
      title: '직접 확장할 수 있습니다',
      strong: '새 명령을 쓰면 그 자리에서 덱의 기능이 됩니다. ',
      body: 'AiScript로 쓴 명령은 바로 명령 팔레트에 올라가고, AI의 도구로도 쓸 수 있습니다. 번역, 날씨, GitHub 등 외부 서비스도 가져올 수 있습니다. 키가 필요한 서비스도 안전하게 등록할 수 있으며, 그 내용이 AI에게 보이는 일은 없습니다.',
    },
    grow: {
      title: 'AI와 함께 자랍니다',
      strong: '쓸수록 나만의 도구로 자라 갑니다. ',
      body: '테마와 키 바인딩부터 AI 자신의 페르소나까지, AI가 대화에서 바로 편집합니다. 칼럼 추가나 계정 전환 같은 UI 조작도 대신하며, 조작한 곳은 빛나서 보입니다. 기억한 것은 다음 대화에도 이어집니다.',
    },
    api: {
      title: '외부에서도 움직일 수 있습니다',
      strong: '물리 버튼도 CLI도 AI도 같은 입구로. ',
      body: '로컬 API로 덱을 통째로 조작합니다 — 게시도, 타임라인 가져오기도, 칼럼 조작도. Raycast, Obsidian, Stream Deck부터 AI 에이전트까지, 한 번 쓰면 어디서든 호출할 수 있습니다.',
    },
  },
  developers: {
    title: '개발자 여러분께',
    desc: 'NoteDeck은 오픈 소스 (AGPL-3.0)입니다. Misskey 본가와 같은 Vue 3 + TypeScript이므로, 본가 코드를 읽을 수 있는 분이라면 그대로 읽을 수 있습니다.',
    device: {
      label: '손안의 기기',
      desc: 'OS 통합 + 클라이언트 계층. 창, 트레이, OS 알림, 키체인, 자동 업데이트. WebView는 손안의 Rust와만 대화하며, 데이터 쪽 호출은 notecore로, AI 쪽 호출은 notemaid로 넘깁니다.',
    },
    frontend: {
      label: '프런트엔드',
      desc: '덱의 UI. 코어가 어디서 동작하는지 알지 못합니다.',
      vaporTag: 'Vapor 준비 완료',
    },
    remote: {
      label: 'AI 프로세스',
      desc: 'AI (에이전트 루프, HEARTBEAT)는 언제나 별도 프로세스입니다. 기본적으로 앱이 실행하고 앱과 함께 종료됩니다. 로그인 시 작업으로 상주시키면 앱을 종료해도 HEARTBEAT가 계속됩니다. 데이터는 기기에 남으며, notemaid는 노트 DB를 열지 않습니다.',
    },
    core: {
      label: '코어',
      desc: 'Tauri에 의존하지 않는 데이터 쪽. 캐시 DB, 쿼리 런타임, Vault, 설정, 인가. "기기가 한 대도 연결되어 있지 않아도 의미가 있는 처리"만 맡으며, AI는 알지 못합니다. notemaid가 빌려 쓰는 것은 Vault, 인가, 설정뿐입니다.',
    },
    client: {
      label: 'Misskey 클라이언트',
      desc: 'Misskey API, WebSocket 스트리밍, SQLite (FTS5). NoteDeck 고유의 것은 알지 못하며, 라이브러리로도 CLI로도 단독으로 동작합니다.',
    },
    forkTitle: '여러분 서버의 고유 기능을 NoteDeck에',
    forkBodyHtml:
      '포크마다 다른 부분은 <strong>어댑터</strong>가 맡습니다. 쓸 수 없는 고유 기능이 있다면 알려 주세요 (대상은 Misskey라는 이름을 계속 쓰는 포크).',
    forkButton: '지원 요청하기',
  },
  download: {
    title: '다운로드',
    desc: '사용하는 환경에 맞춰 설치하세요',
    comingSoon: 'Coming soon',
    unsigned:
      'Windows / macOS 버전은 아직 코드 서명 없이 배포하고 있어, 처음 실행할 때 "알 수 없는 게시자" 경고가 표시됩니다.',
    unsignedLink: '경고를 없애기 위해 협력을 부탁드립니다',
    packageManagers: '패키지 관리자',
    copied: 'copied!',
    clickToCopy: 'click to copy',
    storeTitle: '경고 없이 스토어에서 전하기 위해',
    storeLead:
      '데스크톱 버전의 "알 수 없는 게시자" 경고도, Google Play / App Store 정식 배포도, 남아 있는 것은 기술이 아니라 절차의 벽입니다. 프로젝트가 알려져 있어야 하고, 개발자 계정 비용이 듭니다. 커뮤니티 여러분과 함께 넘고 싶습니다.',
    star: {
      title: 'GitHub에서 Star 누르기',
      body: 'Windows용 OSS 무료 코드 서명 (SignPath Foundation)은 "아무도 모르는 소스 코드에는 서명할 수 없다"며 실제로 쓰이고 있는 실적을 심사합니다. Star와 다운로드 수가 그대로 근거가 됩니다. 클릭 한 번으로 할 수 있는 가장 손쉬운 응원입니다.',
      button: 'GitHub에서 Star',
    },
    beta: {
      title: '베타 테스터 모집',
      body: 'Google Play는 2023년 11월 13일 이후에 만든 개인 개발자 계정에 프로덕션 액세스를 주는 조건으로, 12명 이상이 14일 연속 참여하는 비공개 테스트를 요구합니다. 실기기에서의 동작 확인과 피드백에 협력해 주실 분을 모집합니다.',
      button: '테스터 지원하기',
    },
    sponsor: {
      title: '개발 후원하기',
      body: 'Google Play (등록비 $25) / Apple Developer Program ($99/년) 계정 비용, 테스트 기기 마련, 지속적인 배포 작업 유지에 쓰겠습니다. macOS의 Gatekeeper 경고를 없애는 공증 (notarization)에도 같은 Apple Developer Program이 필요합니다.',
      button: 'GitHub Sponsor',
    },
  },
}

export default ko
