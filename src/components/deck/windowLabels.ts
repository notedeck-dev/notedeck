/**
 * DeckWindow の type → 日本語表示名のマップ。
 *
 * 元は DeckWindow.vue 内 `BASE_TITLES` だったが、AI Spotlight の SR
 * (aria-live) テキスト用に dispatcher 側からも参照したいため切り出した。
 * 「ウィンドウタイプの名前を変えたい」とき 1 箇所修正で済む。
 */
export const WINDOW_LABELS: Record<string, string> = {
  'note-detail': 'ノート',
  'note-inspector': 'ノートインスペクタ',
  'notification-inspector': '通知インスペクタ',
  'user-profile': 'プロフィール',
  'federation-instance': 'サーバー',
  'follow-list': 'フォロー / フォロワー',
  login: 'アカウント追加',
  search: '検索',
  notifications: '通知',
  plugins: 'プラグイン',
  keybinds: 'キーバインド',
  cssEditor: 'カスタムCSS',
  themeEditor: 'テーマ',
  profileEditor: 'プロファイルエディタ',
  ai: 'AI アシスタント',
  aiSettings: 'AI 設定',
  chat: 'チャット',
  about: 'NoteDeck について',
  navEditor: 'ナビバー',
  performanceEditor: 'パフォーマンス',
  appearanceEditor: 'アピアランス',
  backup: 'バックアップ',
  cacheEditor: 'キャッシュ',
  tasksEditor: 'タスク設定',
  snippetsEditor: 'スニペット',
  memoEditor: 'メモ',
  'page-detail': 'ページ',
  'play-detail': 'Play',
  'gallery-detail': 'ギャラリー',
  'list-detail': 'リスト',
  'clip-detail': 'クリップ',
  'page-edit': 'ページを編集',
  'play-edit': 'Play を編集',
  'widget-edit': 'ウィジット編集',
  'skill-edit': 'スキル編集',
  connections: '接続',
  connectionEdit: '接続を編集',
}
