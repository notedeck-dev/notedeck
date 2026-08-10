import type { Component } from 'vue'
import { defineAsyncComponent } from 'vue'
import type { ExposureTag } from '@/settings/exposure'
import type { DeckWindow, WindowType } from '@/stores/windows'

/**
 * ウィンドウ種別の定義 (#794 W6)。
 *
 * 従来はラベル・アイコン・サイズ・描画分岐・URI 変換がそれぞれ別ファイルに
 * 直書きされ、種別を 1 つ足すたびに 5 箇所を手で同期する必要があった
 * (実際に 4 種が capability 側の一覧から漏れていた)。ここを唯一の定義元にする。
 *
 * カラムレジストリと違い、実行時登録は開けない。組み込みが自分自身をここに
 * 登録する形に揃えるところまでが範囲で、第三者への開放は別途判断する。
 */
export interface WindowSpec {
  /** タイトルバー表示名。AI Spotlight の読み上げにも使う */
  label: string
  /** Tabler アイコンのクラス (例: 'ti ti-note') */
  icon: string
  /** 既定の幅 (px)。ユーザーがリサイズすると上書きされる */
  width: number
  /** 高さの上限 (px)。高さは内容に追従する */
  maxHeight: number
  /** 右上アンカー。指定するとビューポート右端からの相対配置になる */
  anchor?: 'top-right'
  /** 中身のコンポーネント。props は DeckWindow.props がそのまま渡る */
  component: () => Promise<{ default: Component }>
  /**
   * notedeck:// URI の生成。省略した種別は URI 非対応 (共有できない)。
   * 必要な props が欠けていれば null を返す。
   */
  uri?: (win: DeckWindow, host: string) => string | null
  /**
   * 入口を出す条件 (#1034)。既定 (未指定) は 'general'。'developer' を付けた
   * ウィンドウは、開発者モードが無効なときメニュー等の入口から消える。
   * open() 自体は塞がない — プラグイン・AI・notedeck:// リンクからの正当な
   * 呼び出しまで壊すと「機能の削除・劣化はしない」原則に反するため。
   */
  exposure?: ExposureTag
}

export const WINDOW_REGISTRY: Record<WindowType, WindowSpec> = {
  'note-detail': {
    label: 'ノート',
    icon: 'ti ti-note',
    width: 500,
    maxHeight: 600,
    component: () => import('@/components/window/NoteDetailContent.vue'),
    uri: (w, h) =>
      typeof w.props.noteId === 'string'
        ? `notedeck://${h}/note/${w.props.noteId}`
        : null,
  },
  'note-inspector': {
    label: 'ノートインスペクタ',
    icon: 'ti ti-code',
    exposure: 'developer',
    width: 620,
    maxHeight: 720,
    component: () => import('@/components/window/NoteInspectorContent.vue'),
    uri: (w, h) =>
      typeof w.props.noteId === 'string'
        ? `notedeck://${h}/note/${w.props.noteId}`
        : null,
  },
  'notification-inspector': {
    label: '通知インスペクタ',
    icon: 'ti ti-code',
    exposure: 'developer',
    width: 620,
    maxHeight: 720,
    component: () =>
      import('@/components/window/NotificationInspectorContent.vue'),
  },
  'user-profile': {
    label: 'プロフィール',
    icon: 'ti ti-user',
    width: 620,
    maxHeight: 650,
    component: () => import('@/components/window/UserProfileContent.vue'),
    uri: (w, h) =>
      typeof w.props.userId === 'string'
        ? `notedeck://${h}/user/${w.props.userId}`
        : null,
  },
  'federation-instance': {
    label: 'サーバー',
    icon: 'ti ti-planet',
    width: 500,
    maxHeight: 650,
    component: () => import('@/components/window/InstanceProfileContent.vue'),
    uri: (w, h) =>
      typeof w.props.host === 'string'
        ? `notedeck://${h}/instance/${w.props.host}`
        : null,
  },
  'follow-list': {
    label: 'フォロー / フォロワー',
    icon: 'ti ti-users',
    width: 500,
    maxHeight: 650,
    component: () => import('@/components/window/FollowListContent.vue'),
    uri: (w, h) => {
      const uid = w.props.userId
      if (typeof uid !== 'string') return null
      const tab = w.props.initialTab === 'followers' ? 'followers' : 'following'
      return `notedeck://${h}/user/${uid}/${tab}`
    },
  },
  aiSettings: {
    label: 'エージェント',
    icon: 'ti ti-robot',
    width: 400,
    maxHeight: 700,
    component: () => import('@/components/window/AiSettingsContent.vue'),
  },
  permissions: {
    label: '権限',
    icon: 'ti ti-shield-lock',
    width: 420,
    maxHeight: 700,
    component: () => import('@/components/window/PermissionsContent.vue'),
  },
  plugins: {
    label: 'プラグイン',
    icon: 'ti ti-plug',
    width: 500,
    maxHeight: 720,
    component: () => import('@/components/window/PluginsContent.vue'),
  },
  keybinds: {
    label: 'キーバインド',
    icon: 'ti ti-keyboard',
    width: 400,
    maxHeight: 650,
    component: () => import('@/components/window/KeybindsContent.vue'),
  },
  cssEditor: {
    label: 'カスタムCSS',
    icon: 'ti ti-code',
    width: 400,
    maxHeight: 650,
    component: () => import('@/components/window/CssEditorContent.vue'),
  },
  themeEditor: {
    label: 'テーマ',
    icon: 'ti ti-palette',
    width: 400,
    maxHeight: 720,
    component: () => import('@/components/window/ThemeEditorContent.vue'),
  },
  profileEditor: {
    label: 'プロファイルエディタ',
    icon: 'ti ti-layout-columns',
    width: 400,
    maxHeight: 700,
    component: () => import('@/components/window/ProfileEditorContent.vue'),
  },
  login: {
    label: 'アカウント追加',
    icon: 'ti ti-login-2',
    width: 380,
    maxHeight: 480,
    component: () => import('@/components/window/LoginContent.vue'),
  },
  about: {
    label: 'NoteDeck について',
    icon: 'ti ti-info-circle',
    width: 380,
    maxHeight: 640,
    component: () => import('@/components/window/AboutContent.vue'),
  },
  navEditor: {
    label: 'ナビバー',
    icon: 'ti ti-layout-sidebar-left-collapse',
    width: 400,
    maxHeight: 700,
    component: () => import('@/components/window/NavEditorContent.vue'),
  },
  performanceEditor: {
    label: 'パフォーマンス',
    icon: 'ti ti-gauge',
    width: 420,
    maxHeight: 750,
    component: () => import('@/components/window/PerformanceEditorContent.vue'),
  },
  appearanceEditor: {
    label: 'アピアランス',
    icon: 'ti ti-brush',
    width: 400,
    maxHeight: 700,
    component: () => import('@/components/window/AppearanceEditorContent.vue'),
  },
  backup: {
    label: 'バックアップ',
    icon: 'ti ti-package-export',
    width: 440,
    maxHeight: 550,
    component: () => import('@/components/window/BackupContent.vue'),
  },
  cacheEditor: {
    label: 'キャッシュ',
    icon: 'ti ti-eraser',
    width: 440,
    maxHeight: 550,
    component: () => import('@/components/window/CacheEditorContent.vue'),
  },
  tasksEditor: {
    label: 'タスク設定',
    icon: 'ti ti-player-play',
    width: 500,
    maxHeight: 700,
    component: () => import('@/components/window/TasksEditorContent.vue'),
  },
  snippetsEditor: {
    label: 'スニペット',
    icon: 'ti ti-code-plus',
    width: 500,
    maxHeight: 700,
    component: () => import('@/components/window/SnippetsEditorContent.vue'),
  },
  memoEditor: {
    label: 'メモ',
    icon: 'ti ti-notes',
    width: 500,
    maxHeight: 600,
    component: () => import('@/components/window/MemoEditorContent.vue'),
  },
  'column-query-editor': {
    label: 'カラムクエリ',
    icon: 'ti ti-filter',
    exposure: 'developer',
    width: 560,
    maxHeight: 720,
    component: () => import('@/components/window/ColumnQueryEditorContent.vue'),
  },
  'page-detail': {
    label: 'ページ',
    icon: 'ti ti-note',
    width: 500,
    maxHeight: 720,
    component: () => import('@/components/window/PageDetailContent.vue'),
    uri: (w, h) =>
      typeof w.props.pageId === 'string'
        ? `notedeck://${h}/page/${w.props.pageId}`
        : null,
  },
  'play-detail': {
    label: 'Play',
    icon: 'ti ti-player-play',
    width: 500,
    maxHeight: 720,
    component: () => import('@/components/window/PlayDetailContent.vue'),
    uri: (w, h) =>
      typeof w.props.flashId === 'string'
        ? `notedeck://${h}/play/${w.props.flashId}`
        : null,
  },
  'gallery-detail': {
    label: 'ギャラリー',
    icon: 'ti ti-icons',
    width: 500,
    maxHeight: 720,
    component: () => import('@/components/window/GalleryDetailContent.vue'),
    uri: (w, h) =>
      typeof w.props.postId === 'string'
        ? `notedeck://${h}/gallery/${w.props.postId}`
        : null,
  },
  'list-detail': {
    label: 'リスト',
    icon: 'ti ti-list',
    width: 500,
    maxHeight: 720,
    component: () => import('@/components/window/ListDetailContent.vue'),
    uri: (w, h) =>
      typeof w.props.listId === 'string'
        ? `notedeck://${h}/list/${w.props.listId}`
        : null,
  },
  'clip-detail': {
    label: 'クリップ',
    icon: 'ti ti-paperclip',
    width: 500,
    maxHeight: 720,
    component: () => import('@/components/window/ClipDetailContent.vue'),
    uri: (w, h) =>
      typeof w.props.clipId === 'string'
        ? `notedeck://${h}/clip/${w.props.clipId}`
        : null,
  },
  'drive-file-detail': {
    label: 'ファイル',
    icon: 'ti ti-file',
    width: 500,
    maxHeight: 720,
    component: () => import('@/components/window/DriveFileDetailContent.vue'),
  },
  'page-edit': {
    label: 'ページを編集',
    icon: 'ti ti-pencil',
    width: 500,
    maxHeight: 720,
    component: () => import('@/components/window/PageEditContent.vue'),
  },
  'play-edit': {
    label: 'Play を編集',
    icon: 'ti ti-pencil',
    width: 500,
    maxHeight: 720,
    component: () => import('@/components/window/PlayEditContent.vue'),
  },
  'widget-edit': {
    label: 'ウィジット編集',
    icon: 'ti ti-layout-dashboard',
    exposure: 'developer',
    width: 500,
    maxHeight: 720,
    component: () => import('@/components/window/WidgetEditContent.vue'),
  },
  'skill-edit': {
    label: 'スキル編集',
    icon: 'ti ti-sparkles',
    exposure: 'developer',
    width: 500,
    maxHeight: 720,
    component: () => import('@/components/window/SkillEditContent.vue'),
  },
  connections: {
    label: '接続',
    icon: 'ti ti-plug-connected',
    width: 440,
    maxHeight: 650,
    component: () => import('@/components/window/ConnectionsContent.vue'),
  },
  connectionEdit: {
    label: '接続を編集',
    icon: 'ti ti-plug-connected',
    width: 440,
    maxHeight: 720,
    component: () => import('@/components/window/ConnectionEditContent.vue'),
  },
  tutorial: {
    label: 'チュートリアル',
    icon: 'ti ti-presentation-analytics',
    width: 380,
    maxHeight: 420,
    anchor: 'top-right',
    component: () => import('@/components/tutorial/TutorialContent.vue'),
  },
  tutorialEditor: {
    label: 'チュートリアル',
    icon: 'ti ti-checkbox',
    width: 500,
    maxHeight: 700,
    component: () => import('@/components/window/TutorialEditorContent.vue'),
  },
}

// ============================================================
// 派生
// ============================================================

export const ALL_WINDOW_TYPES = Object.keys(
  WINDOW_REGISTRY,
) as readonly WindowType[]

export const WINDOW_LABELS: Record<string, string> = Object.fromEntries(
  ALL_WINDOW_TYPES.map((t) => [t, WINDOW_REGISTRY[t].label]),
)

export const WINDOW_ICONS: Record<string, string> = Object.fromEntries(
  ALL_WINDOW_TYPES.map((t) => [t, WINDOW_REGISTRY[t].icon]),
)

export const WINDOW_SIZES: Record<
  WindowType,
  { width: number; maxHeight: number; anchor?: 'top-right' }
> = Object.fromEntries(
  ALL_WINDOW_TYPES.map((t) => {
    const spec = WINDOW_REGISTRY[t]
    return [
      t,
      { width: spec.width, maxHeight: spec.maxHeight, anchor: spec.anchor },
    ]
  }),
) as Record<
  WindowType,
  { width: number; maxHeight: number; anchor?: 'top-right' }
>

/** DeckWindowLayer が `<component :is>` で描くためのマップ */
export const WINDOW_COMPONENTS: Record<string, Component> = Object.fromEntries(
  ALL_WINDOW_TYPES.map((t) => [
    t,
    defineAsyncComponent(WINDOW_REGISTRY[t].component),
  ]),
)

/**
 * notedeck:// URI を組む。URI 未対応の種別・ホスト不明・必要な props 欠落は null。
 */
export function buildWindowUri(
  win: DeckWindow,
  accountHost: string | null,
): string | null {
  if (!accountHost) return null
  return WINDOW_REGISTRY[win.type]?.uri?.(win, accountHost) ?? null
}
