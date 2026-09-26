import { i18n } from '@/i18n'
import { labelTable } from '@/i18n/labelTable'
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
    get label() {
      return i18n.ts._windows.noteDetail
    },
    icon: 'ti ti-note',
    width: 500,
    maxHeight: 600,
    uri: (w, h) =>
      typeof w.props.noteId === 'string'
        ? `notedeck://${h}/note/${w.props.noteId}`
        : null,
  },
  'note-inspector': {
    get label() {
      return i18n.ts._windows.noteInspector
    },
    icon: 'ti ti-code',
    exposure: 'developer',
    width: 620,
    maxHeight: 720,
    uri: (w, h) =>
      typeof w.props.noteId === 'string'
        ? `notedeck://${h}/note/${w.props.noteId}`
        : null,
  },
  'notification-inspector': {
    get label() {
      return i18n.ts._windows.notificationInspector
    },
    icon: 'ti ti-code',
    exposure: 'developer',
    width: 620,
    maxHeight: 720,
  },
  'user-profile': {
    get label() {
      return i18n.ts._windows.userProfile
    },
    icon: 'ti ti-user',
    width: 620,
    maxHeight: 650,
    uri: (w, h) =>
      typeof w.props.userId === 'string'
        ? `notedeck://${h}/user/${w.props.userId}`
        : null,
  },
  'federation-instance': {
    get label() {
      return i18n.ts._windows.federationInstance
    },
    icon: 'ti ti-planet',
    width: 500,
    maxHeight: 650,
    uri: (w, h) =>
      typeof w.props.host === 'string'
        ? `notedeck://${h}/instance/${w.props.host}`
        : null,
  },
  'follow-list': {
    get label() {
      return i18n.ts._windows.followList
    },
    icon: 'ti ti-users',
    width: 500,
    maxHeight: 650,
    uri: (w, h) => {
      const uid = w.props.userId
      if (typeof uid !== 'string') return null
      const tab = w.props.initialTab === 'followers' ? 'followers' : 'following'
      return `notedeck://${h}/user/${uid}/${tab}`
    },
  },
  aiSettings: {
    get label() {
      return i18n.ts._windows.aiSettings
    },
    icon: 'ti ti-robot',
    width: 400,
    maxHeight: 700,
  },
  permissions: {
    get label() {
      return i18n.ts._windows.permissions
    },
    icon: 'ti ti-shield-lock',
    width: 420,
    maxHeight: 700,
  },
  plugins: {
    get label() {
      return i18n.ts._windows.plugins
    },
    icon: 'ti ti-plug',
    width: 500,
    maxHeight: 720,
  },
  keybinds: {
    get label() {
      return i18n.ts._windows.keybinds
    },
    icon: 'ti ti-keyboard',
    width: 400,
    maxHeight: 650,
  },
  cssEditor: {
    get label() {
      return i18n.ts._windows.cssEditor
    },
    icon: 'ti ti-code',
    width: 400,
    maxHeight: 650,
  },
  themeEditor: {
    get label() {
      return i18n.ts._windows.themeEditor
    },
    icon: 'ti ti-palette',
    width: 400,
    maxHeight: 720,
  },
  profileEditor: {
    get label() {
      return i18n.ts._windows.profileEditor
    },
    icon: 'ti ti-layout-columns',
    width: 400,
    maxHeight: 700,
  },
  login: {
    get label() {
      return i18n.ts._windows.login
    },
    icon: 'ti ti-login-2',
    width: 380,
    maxHeight: 480,
  },
  about: {
    get label() {
      return i18n.ts._windows.about
    },
    icon: 'ti ti-info-circle',
    width: 380,
    maxHeight: 640,
  },
  navEditor: {
    get label() {
      return i18n.ts._windows.navEditor
    },
    icon: 'ti ti-layout-sidebar-left-collapse',
    width: 400,
    maxHeight: 700,
  },
  performanceEditor: {
    get label() {
      return i18n.ts._windows.performanceEditor
    },
    icon: 'ti ti-gauge',
    width: 420,
    maxHeight: 750,
  },
  appearanceEditor: {
    get label() {
      return i18n.ts._windows.appearanceEditor
    },
    icon: 'ti ti-brush',
    width: 400,
    maxHeight: 700,
  },
  backup: {
    get label() {
      return i18n.ts._windows.backup
    },
    icon: 'ti ti-package-export',
    width: 440,
    maxHeight: 550,
  },
  cacheEditor: {
    get label() {
      return i18n.ts._windows.cacheEditor
    },
    icon: 'ti ti-eraser',
    width: 440,
    maxHeight: 550,
  },
  tasksEditor: {
    get label() {
      return i18n.ts._windows.tasksEditor
    },
    exposure: 'developer',
    icon: 'ti ti-player-play',
    width: 500,
    maxHeight: 700,
  },
  snippetsEditor: {
    get label() {
      return i18n.ts._windows.snippetsEditor
    },
    exposure: 'developer',
    icon: 'ti ti-code-plus',
    width: 500,
    maxHeight: 700,
  },
  memoEditor: {
    get label() {
      return i18n.ts._windows.memoEditor
    },
    icon: 'ti ti-notes',
    width: 500,
    maxHeight: 600,
  },
  'column-query-editor': {
    get label() {
      return i18n.ts._windows.columnQueryEditor
    },
    icon: 'ti ti-filter',
    exposure: 'developer',
    width: 560,
    maxHeight: 720,
  },
  'page-detail': {
    get label() {
      return i18n.ts._windows.pageDetail
    },
    icon: 'ti ti-note',
    width: 500,
    maxHeight: 720,
    uri: (w, h) =>
      typeof w.props.pageId === 'string'
        ? `notedeck://${h}/page/${w.props.pageId}`
        : null,
  },
  'play-detail': {
    get label() {
      return i18n.ts._windows.playDetail
    },
    icon: 'ti ti-player-play',
    width: 500,
    maxHeight: 720,
    uri: (w, h) =>
      typeof w.props.flashId === 'string'
        ? `notedeck://${h}/play/${w.props.flashId}`
        : null,
  },
  'gallery-detail': {
    get label() {
      return i18n.ts._windows.galleryDetail
    },
    icon: 'ti ti-icons',
    width: 500,
    maxHeight: 720,
    uri: (w, h) =>
      typeof w.props.postId === 'string'
        ? `notedeck://${h}/gallery/${w.props.postId}`
        : null,
  },
  'list-detail': {
    get label() {
      return i18n.ts._windows.listDetail
    },
    icon: 'ti ti-list',
    width: 500,
    maxHeight: 720,
    uri: (w, h) =>
      typeof w.props.listId === 'string'
        ? `notedeck://${h}/list/${w.props.listId}`
        : null,
  },
  'clip-detail': {
    get label() {
      return i18n.ts._windows.clipDetail
    },
    icon: 'ti ti-paperclip',
    width: 500,
    maxHeight: 720,
    uri: (w, h) =>
      typeof w.props.clipId === 'string'
        ? `notedeck://${h}/clip/${w.props.clipId}`
        : null,
  },
  'drive-file-detail': {
    get label() {
      return i18n.ts._windows.driveFileDetail
    },
    icon: 'ti ti-file',
    width: 500,
    maxHeight: 720,
  },
  'page-edit': {
    get label() {
      return i18n.ts._windows.pageEdit
    },
    icon: 'ti ti-pencil',
    width: 500,
    maxHeight: 720,
  },
  'play-edit': {
    get label() {
      return i18n.ts._windows.playEdit
    },
    icon: 'ti ti-pencil',
    width: 500,
    maxHeight: 720,
  },
  'widget-edit': {
    get label() {
      return i18n.ts._windows.widgetEdit
    },
    icon: 'ti ti-layout-dashboard',
    exposure: 'developer',
    width: 500,
    maxHeight: 720,
  },
  'skill-edit': {
    get label() {
      return i18n.ts._windows.skillEdit
    },
    icon: 'ti ti-sparkles',
    exposure: 'developer',
    width: 500,
    maxHeight: 720,
  },
  'edit-history': {
    get label() {
      return i18n.ts._windows.editHistory
    },
    icon: 'ti ti-history',
    exposure: 'developer',
    width: 620,
    maxHeight: 720,
  },
  connections: {
    get label() {
      return i18n.ts._windows.connections
    },
    icon: 'ti ti-plug-connected',
    width: 440,
    maxHeight: 650,
  },
  connectionEdit: {
    get label() {
      return i18n.ts._windows.connectionEdit
    },
    icon: 'ti ti-plug-connected',
    width: 440,
    maxHeight: 720,
  },
  tutorial: {
    get label() {
      return i18n.ts._windows.tutorial
    },
    icon: 'ti ti-presentation-analytics',
    width: 380,
    maxHeight: 420,
    anchor: 'top-right',
  },
  tutorialEditor: {
    get label() {
      return i18n.ts._windows.tutorialEditor
    },
    icon: 'ti ti-checkbox',
    width: 500,
    maxHeight: 700,
  },
}

// ============================================================
// 派生
// ============================================================

export const ALL_WINDOW_TYPES = Object.keys(
  WINDOW_REGISTRY,
) as readonly WindowType[]

/** 種別 → 表示名。表示名は辞書から引くので、参照した時点で引く (#135) */
export const WINDOW_LABELS: Record<string, string> = labelTable(
  () => ALL_WINDOW_TYPES,
  (type) => WINDOW_REGISTRY[type as WindowType]?.label,
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
