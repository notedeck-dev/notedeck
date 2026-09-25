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
        },
      },
    },

    externalLinkIcon: true,
  },

  markdown: {
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
