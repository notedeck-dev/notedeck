import { defineConfig } from 'vitepress'

const BASE_URL = 'https://notedeck.io'
const REPO = 'https://github.com/notedeck-dev/notedeck'
const OGP_IMAGE =
  'https://github.com/user-attachments/assets/a9bca10d-a59d-4c35-9284-fb0534ccf886'

export default defineConfig({
  lang: 'ja',
  title: 'NoteDeck',
  titleTemplate: ':title | NoteDeck',
  description:
    'Misskey Pro — Misskey廃人のための Misskey 統合デッキ環境 (IDE)。',
  cleanUrls: true,
  lastUpdated: true,
  metaChunk: true,

  head: [
    ['link', { rel: 'icon', href: '/favicon.png', type: 'image/png' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'NoteDeck' }],
    ['meta', { property: 'og:image', content: OGP_IMAGE }],
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

  themeConfig: {
    // ナビとフッターは theme/components/HubNav.vue / HubFooter.vue が持つ。
    // VitePress の VPNav / VPFooter は site.css で隠しているので、
    // ここに nav / socialLinks / footer を書いても表示されない。
    sidebar: {
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
    },

    search: {
      provider: 'local',
      options: {
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
    externalLinkIcon: true,
  },

  markdown: {
    container: {
      tipLabel: 'ヒント',
      warningLabel: '注意',
      dangerLabel: '危険',
      infoLabel: '情報',
      detailsLabel: '詳細',
    },
  },
})
