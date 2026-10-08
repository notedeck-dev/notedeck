import { type DefaultTheme, defineConfig } from 'vitepress'

const BASE_URL = 'https://notedeck.io'
const REPO = 'https://github.com/notedeck-dev/notedeck'
// 共有カードは自前で配信する (#978)。外部の添付 URL はリダイレクト先が失効し、
// 最初の応答も画像ではないので、リダイレクトを追わないクローラーで出ない。
// 版下は site/assets/ogp.svg。
const OGP_IMAGE = `${BASE_URL}/ogp.png`

const JA_SIDEBAR: DefaultTheme.Sidebar = {
  '/docs/': [
    {
      text: 'はじめに',
      collapsed: false,
      items: [
        { text: 'NoteDeck とは', link: '/docs/' },
        { text: 'インストール', link: '/docs/install' },
        { text: 'AI の別プロセス (notemaid)', link: '/docs/notemaid' },
        { text: '最初のセットアップ', link: '/docs/first-run' },
        { text: 'ログインせずに試す', link: '/docs/guest' },
      ],
    },
    {
      text: 'デッキを組む',
      collapsed: false,
      items: [
        { text: 'カラムとウィンドウ', link: '/docs/deck/columns' },
        { text: 'プロファイル', link: '/docs/deck/profiles' },
        { text: 'ナビバー', link: '/docs/deck/navbar' },
      ],
    },
    {
      text: '使いこなす',
      collapsed: false,
      items: [
        { text: 'キーボード操作', link: '/docs/guide/keyboard' },
        { text: 'ノートを探す', link: '/docs/guide/search' },
        { text: '見た目を変える', link: '/docs/guide/appearance' },
        { text: 'ストアで拡張する', link: '/docs/guide/store' },
        { text: 'AI と使う', link: '/docs/guide/ai' },
        { text: '環境を育てる', link: '/docs/guide/grow' },
        { text: 'リンクで開く', link: '/docs/guide/links' },
      ],
    },
    {
      text: '拡張をつくる',
      collapsed: false,
      items: [
        { text: '拡張の全体像', link: '/docs/dev/' },
        { text: 'プラグイン', link: '/docs/dev/plugin' },
        { text: 'ウィジェット', link: '/docs/dev/widget' },
        { text: 'テーマ', link: '/docs/dev/theme' },
        { text: 'カラムクエリ', link: '/docs/dev/query' },
        { text: 'スキル', link: '/docs/dev/skill' },
      ],
    },
    {
      text: '設定とデータ',
      collapsed: false,
      items: [
        { text: '設定ファイル', link: '/docs/config/files' },
        { text: 'バックアップ', link: '/docs/config/backup' },
      ],
    },
    {
      text: 'こまったとき',
      collapsed: false,
      items: [{ text: 'トラブルシューティング', link: '/docs/troubleshooting' }],
    },
  ],
}

// 訳したページだけを載せる。VitePress は未訳ページを原文に fallback せず 404 にするので、
// ここに無いページへは本文から原文 (ja) の URL でリンクする (#1145)。
// 訳の腐りは scripts/docs-lint.mjs が原文のハッシュで検出する
const EN_SIDEBAR: DefaultTheme.Sidebar = {
  '/en/docs/': [
    {
      text: 'Getting started',
      collapsed: false,
      items: [
        { text: 'What is NoteDeck', link: '/en/docs/' },
        { text: 'Installation', link: '/en/docs/install' },
        { text: 'The AI process (notemaid)', link: '/en/docs/notemaid' },
        { text: 'First-run setup', link: '/en/docs/first-run' },
        { text: 'Try without logging in', link: '/en/docs/guest' },
      ],
    },
    {
      text: 'Build your deck',
      collapsed: false,
      items: [
        { text: 'Columns and windows', link: '/en/docs/deck/columns' },
        { text: 'Profiles', link: '/en/docs/deck/profiles' },
        { text: 'Navbar', link: '/en/docs/deck/navbar' },
      ],
    },
    {
      text: 'Make the most of it',
      collapsed: false,
      items: [
        { text: 'Keyboard', link: '/en/docs/guide/keyboard' },
        { text: 'Finding notes', link: '/en/docs/guide/search' },
        { text: 'Appearance', link: '/en/docs/guide/appearance' },
        { text: 'Extending from the store', link: '/en/docs/guide/store' },
        { text: 'Using AI', link: '/en/docs/guide/ai' },
        { text: 'Growing your environment', link: '/en/docs/guide/grow' },
        { text: 'Opening from links', link: '/en/docs/guide/links' },
      ],
    },
    {
      text: 'Building extensions',
      collapsed: false,
      items: [
        { text: 'Extensions overview', link: '/en/docs/dev/' },
        { text: 'Plugins', link: '/en/docs/dev/plugin' },
        { text: 'Widgets', link: '/en/docs/dev/widget' },
        { text: 'Themes', link: '/en/docs/dev/theme' },
        { text: 'Column queries', link: '/en/docs/dev/query' },
        { text: 'Skills', link: '/en/docs/dev/skill' },
      ],
    },
    {
      text: 'Settings and data',
      collapsed: false,
      items: [
        { text: 'Settings files', link: '/en/docs/config/files' },
        { text: 'Backup', link: '/en/docs/config/backup' },
      ],
    },
    {
      text: 'Troubleshooting',
      collapsed: false,
      items: [{ text: 'Troubleshooting', link: '/en/docs/troubleshooting' }],
    },
  ],
}

const ZH_SIDEBAR: DefaultTheme.Sidebar = {
  '/zh/docs/': [
    {
      text: '入门',
      collapsed: false,
      items: [
        { text: 'NoteDeck 是什么', link: '/zh/docs/' },
        { text: '安装', link: '/zh/docs/install' },
        { text: 'AI 的独立进程 (notemaid)', link: '/zh/docs/notemaid' },
        { text: '首次设置', link: '/zh/docs/first-run' },
        { text: '不登录试用', link: '/zh/docs/guest' },
      ],
    },
    {
      text: '搭建 Deck',
      collapsed: false,
      items: [
        { text: '列与窗口', link: '/zh/docs/deck/columns' },
        { text: '配置文件', link: '/zh/docs/deck/profiles' },
        { text: '导航栏', link: '/zh/docs/deck/navbar' },
      ],
    },
    {
      text: '用得更顺手',
      collapsed: false,
      items: [
        { text: '键盘操作', link: '/zh/docs/guide/keyboard' },
        { text: '查找帖子', link: '/zh/docs/guide/search' },
        { text: '更改外观', link: '/zh/docs/guide/appearance' },
        { text: '用商店扩展', link: '/zh/docs/guide/store' },
        { text: '与 AI 一起使用', link: '/zh/docs/guide/ai' },
        { text: '培养你的环境', link: '/zh/docs/guide/grow' },
        { text: '通过链接打开', link: '/zh/docs/guide/links' },
      ],
    },
    {
      text: '制作扩展',
      collapsed: false,
      items: [
        { text: '扩展概览', link: '/zh/docs/dev/' },
        { text: '插件', link: '/zh/docs/dev/plugin' },
        { text: '小工具', link: '/zh/docs/dev/widget' },
        { text: '主题', link: '/zh/docs/dev/theme' },
        { text: '列查询', link: '/zh/docs/dev/query' },
        { text: '技能', link: '/zh/docs/dev/skill' },
      ],
    },
    {
      text: '设置与数据',
      collapsed: false,
      items: [
        { text: '设置文件', link: '/zh/docs/config/files' },
        { text: '备份', link: '/zh/docs/config/backup' },
      ],
    },
    {
      text: '遇到问题时',
      collapsed: false,
      items: [
        { text: '故障排除', link: '/zh/docs/troubleshooting' },
      ],
    },
  ],
}

const KO_SIDEBAR: DefaultTheme.Sidebar = {
  '/ko/docs/': [
    {
      text: '시작하기',
      collapsed: false,
      items: [
        { text: 'NoteDeck이란', link: '/ko/docs/' },
        { text: '설치', link: '/ko/docs/install' },
        { text: 'AI 별도 프로세스 (notemaid)', link: '/ko/docs/notemaid' },
        { text: '처음 설정하기', link: '/ko/docs/first-run' },
        { text: '로그인 없이 써 보기', link: '/ko/docs/guest' },
      ],
    },
    {
      text: '덱 구성하기',
      collapsed: false,
      items: [
        { text: '칼럼과 창', link: '/ko/docs/deck/columns' },
        { text: '프로파일', link: '/ko/docs/deck/profiles' },
        { text: '내비게이션 바', link: '/ko/docs/deck/navbar' },
      ],
    },
    {
      text: '제대로 활용하기',
      collapsed: false,
      items: [
        { text: '키보드 조작', link: '/ko/docs/guide/keyboard' },
        { text: '노트 찾기', link: '/ko/docs/guide/search' },
        { text: '외관 바꾸기', link: '/ko/docs/guide/appearance' },
        { text: '스토어로 확장하기', link: '/ko/docs/guide/store' },
        { text: 'AI와 함께 쓰기', link: '/ko/docs/guide/ai' },
        { text: '환경 키우기', link: '/ko/docs/guide/grow' },
        { text: '링크로 열기', link: '/ko/docs/guide/links' },
      ],
    },
    {
      text: '확장 만들기',
      collapsed: false,
      items: [
        { text: '확장 개요', link: '/ko/docs/dev/' },
        { text: '플러그인', link: '/ko/docs/dev/plugin' },
        { text: '위젯', link: '/ko/docs/dev/widget' },
        { text: '테마', link: '/ko/docs/dev/theme' },
        { text: '칼럼 쿼리', link: '/ko/docs/dev/query' },
        { text: '스킬', link: '/ko/docs/dev/skill' },
      ],
    },
    {
      text: '설정과 데이터',
      collapsed: false,
      items: [
        { text: '설정 파일', link: '/ko/docs/config/files' },
        { text: '백업', link: '/ko/docs/config/backup' },
      ],
    },
    {
      text: '문제 해결',
      collapsed: false,
      items: [
        { text: '문제 해결', link: '/ko/docs/troubleshooting' },
      ],
    },
  ],
}

export default defineConfig({
  title: 'NoteDeck',
  titleTemplate: ':title | NoteDeck',
  cleanUrls: true,
  lastUpdated: true,
  metaChunk: true,

  head: [
    ['link', { rel: 'icon', href: '/favicon.png', type: 'image/png' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'NoteDeck' }],
    ['meta', { property: 'og:image', content: OGP_IMAGE }],
    ['meta', { property: 'og:image:type', content: 'image/png' }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    [
      'link',
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    ],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;800&display=swap',
      },
    ],
  ],

  sitemap: { hostname: BASE_URL },

  // 原文の ja は root のまま現行 URL を保つ (共有リンクと OGP を壊さない)。
  // 他の言語は /<key>/ 配下。VitePress は themeConfig を浅くマージするので、
  // 言語で変わるオブジェクトは言語ごとに丸ごと書く (#1145)
  locales: {
    root: {
      label: '日本語',
      lang: 'ja',
      description:
        'Misskey Pro — Misskey廃人のための Misskey 統合デッキ環境 (IDE)。',
      head: [
        [
          'meta',
          {
            property: 'og:image:alt',
            content: 'NoteDeck — Misskey廃人のための 非公式クライアント。',
          },
        ],
      ],
      themeConfig: {
        sidebar: JA_SIDEBAR,
        editLink: {
          pattern: `${REPO}/edit/main/site/:path`,
          text: 'このページを編集',
        },
        docFooter: { prev: '前へ', next: '次へ' },
        outline: { level: [2, 3], label: 'このページの内容' },
        lastUpdated: {
          text: '最終更新',
          formatOptions: { dateStyle: 'medium' },
        },
        darkModeSwitchLabel: 'カラーモード',
        lightModeSwitchTitle: 'ライトモードに切り替え',
        darkModeSwitchTitle: 'ダークモードに切り替え',
        sidebarMenuLabel: 'メニュー',
        returnToTopLabel: 'ページの先頭へ',
      },
    },
    en: {
      label: 'English',
      lang: 'en',
      description:
        'Misskey Pro — the Misskey Integrated Deck Environment (IDE) for power users.',
      head: [
        [
          'meta',
          {
            property: 'og:image:alt',
            content: 'NoteDeck — the unofficial client for Misskey power users.',
          },
        ],
      ],
      themeConfig: {
        sidebar: EN_SIDEBAR,
        editLink: {
          pattern: `${REPO}/edit/main/site/:path`,
          text: 'Edit this page',
        },
        outline: { level: [2, 3], label: 'On this page' },
        lastUpdated: {
          text: 'Last updated',
          formatOptions: { dateStyle: 'medium' },
        },
      },
    },
    zh: {
      label: '简体中文',
      lang: 'zh-Hans',
      description:
        'Misskey Pro — 面向 Misskey 重度用户的 Misskey 集成 Deck 环境 (IDE)。',
      head: [
        [
          'meta',
          {
            property: 'og:image:alt',
            content: 'NoteDeck — 面向 Misskey 重度用户的非官方客户端。',
          },
        ],
      ],
      themeConfig: {
        sidebar: ZH_SIDEBAR,
        editLink: {
          pattern: `${REPO}/edit/main/site/:path`,
          text: '编辑此页',
        },
        docFooter: { prev: '上一页', next: '下一页' },
        outline: { level: [2, 3], label: '本页内容' },
        lastUpdated: {
          text: '最后更新',
          formatOptions: { dateStyle: 'medium' },
        },
        darkModeSwitchLabel: '颜色模式',
        lightModeSwitchTitle: '切换到浅色模式',
        darkModeSwitchTitle: '切换到深色模式',
        sidebarMenuLabel: '菜单',
        returnToTopLabel: '回到顶部',
      },
    },
    ko: {
      label: '한국어',
      lang: 'ko',
      description:
        'Misskey Pro — Misskey 헤비 유저를 위한 Misskey 통합 덱 환경 (IDE).',
      head: [
        [
          'meta',
          {
            property: 'og:image:alt',
            content: 'NoteDeck — Misskey 헤비 유저를 위한 비공식 클라이언트.',
          },
        ],
      ],
      themeConfig: {
        sidebar: KO_SIDEBAR,
        editLink: {
          pattern: `${REPO}/edit/main/site/:path`,
          text: '이 페이지 편집',
        },
        docFooter: { prev: '이전', next: '다음' },
        outline: { level: [2, 3], label: '이 페이지의 내용' },
        lastUpdated: {
          text: '마지막 업데이트',
          formatOptions: { dateStyle: 'medium' },
        },
        darkModeSwitchLabel: '색상 모드',
        lightModeSwitchTitle: '라이트 모드로 전환',
        darkModeSwitchTitle: '다크 모드로 전환',
        sidebarMenuLabel: '메뉴',
        returnToTopLabel: '맨 위로',
      },
    },
  },

  themeConfig: {
    // ナビとフッターは theme/components/HubNav.vue / HubFooter.vue が持つ。
    // VitePress の VPNav / VPFooter は site.css で隠しているので、
    // ここに nav / socialLinks / footer を書いても表示されない。
    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: '検索', buttonAriaLabel: '検索' },
              modal: {
                displayDetails: '詳細を表示',
                resetButtonTitle: '検索をリセット',
                backButtonTitle: '戻る',
                noResultsText: '見つかりませんでした',
                footer: {
                  selectText: '選択',
                  selectKeyAriaLabel: 'Enter',
                  navigateText: '移動',
                  navigateUpKeyAriaLabel: '上矢印',
                  navigateDownKeyAriaLabel: '下矢印',
                  closeText: '閉じる',
                  closeKeyAriaLabel: 'Escape',
                },
              },
            },
          },
          zh: {
            translations: {
              button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
              modal: {
                displayDetails: '显示详细信息',
                resetButtonTitle: '清除搜索',
                backButtonTitle: '返回',
                noResultsText: '未找到结果',
                footer: {
                  selectText: '选择',
                  selectKeyAriaLabel: 'Enter',
                  navigateText: '切换',
                  navigateUpKeyAriaLabel: '向上箭头',
                  navigateDownKeyAriaLabel: '向下箭头',
                  closeText: '关闭',
                  closeKeyAriaLabel: 'Escape',
                },
              },
            },
          },
          ko: {
            translations: {
              button: { buttonText: '검색', buttonAriaLabel: '검색' },
              modal: {
                displayDetails: '자세히 보기',
                resetButtonTitle: '검색 초기화',
                backButtonTitle: '뒤로',
                noResultsText: '결과를 찾을 수 없습니다',
                footer: {
                  selectText: '선택',
                  selectKeyAriaLabel: 'Enter',
                  navigateText: '이동',
                  navigateUpKeyAriaLabel: '위쪽 화살표',
                  navigateDownKeyAriaLabel: '아래쪽 화살표',
                  closeText: '닫기',
                  closeKeyAriaLabel: 'Escape',
                },
              },
            },
          },
        },
      },
    },

    externalLinkIcon: true,
  },

  markdown: {
    // 既定の slugify は NFKD で分解したまま id にするので、濁点のある和文や
    // ハングルの見出しでは id が本文のリンク (NFC) と一致せず飛ばない (#1145)。
    // 既定と同じ規則で作り、最後に NFC に戻す
    anchor: {
      slugify: (str) =>
        str
          .normalize('NFKD')
          .replace(/[\u0300-\u036F]/g, '')
          .replace(/[\u0000-\u001f]/g, '')
          .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, '-')
          .replace(/-{2,}/g, '-')
          .replace(/^-+|-+$/g, '')
          .replace(/^(\d)/, '_$1')
          .toLowerCase()
          .normalize('NFC'),
    },
    // AiScript (.is) を shiki は知らない。JS として色付けする
    languageAlias: { is: 'js' },
    container: {
      tipLabel: 'ヒント',
      warningLabel: '注意',
      dangerLabel: '危険',
      infoLabel: '情報',
      detailsLabel: '詳細',
    },
  },
})
