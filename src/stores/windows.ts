import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { pushOverlay } from '@/composables/useBackButton'
import { useUiStore } from '@/stores/ui'

export type WindowType =
  | 'note-detail'
  | 'note-inspector'
  | 'notification-inspector'
  | 'user-profile'
  | 'federation-instance'
  | 'follow-list'
  | 'login'
  | 'plugins'
  | 'keybinds'
  | 'cssEditor'
  | 'themeEditor'
  | 'profileEditor'
  | 'aiSettings'
  | 'permissions'
  | 'about'
  | 'navEditor'
  | 'performanceEditor'
  | 'appearanceEditor'
  | 'backup'
  | 'cacheEditor'
  | 'tasksEditor'
  | 'snippetsEditor'
  | 'memoEditor'
  | 'page-detail'
  | 'play-detail'
  | 'gallery-detail'
  | 'list-detail'
  | 'clip-detail'
  | 'drive-file-detail'
  | 'page-edit'
  | 'play-edit'
  | 'widget-edit'
  | 'skill-edit'
  | 'connections'
  | 'connectionEdit'
  | 'tutorial'

export interface DeckWindow {
  id: string
  type: WindowType
  props: Record<string, unknown>
  x: number
  y: number
  // ユーザーが 8 方向ハンドルでリサイズした場合のみ値が入る。
  // 未リサイズ時は WINDOW_SIZES[type] のデフォルトに従い、高さは max-height で内容に追従する。
  width?: number
  height?: number
  zIndex: number
  minimized: boolean
  maximized: boolean
  // 右上アンカー (WINDOW_SIZES[type].anchor 由来)。描画時に viewport 右端からの
  // 相対配置にするための印。ユーザーがドラッグ/リサイズすると外れて x 配置に戻る。
  anchor?: 'top-right'
}

export const WINDOW_MIN_SIZE = { width: 240, height: 180 }

export const WINDOW_SIZES: Record<
  WindowType,
  { width: number; maxHeight: number; anchor?: 'top-right' }
> = {
  // Content windows
  'note-detail': { width: 500, maxHeight: 600 },
  'note-inspector': { width: 620, maxHeight: 720 },
  'notification-inspector': { width: 620, maxHeight: 720 },
  'user-profile': { width: 620, maxHeight: 650 },
  'federation-instance': { width: 500, maxHeight: 650 },
  'follow-list': { width: 500, maxHeight: 650 },
  aiSettings: { width: 400, maxHeight: 700 },
  permissions: { width: 420, maxHeight: 700 },
  // Tool windows
  plugins: { width: 500, maxHeight: 720 },
  // Editor windows
  keybinds: { width: 400, maxHeight: 650 },
  cssEditor: { width: 400, maxHeight: 650 },
  themeEditor: { width: 400, maxHeight: 720 },
  profileEditor: { width: 400, maxHeight: 700 },
  // Login
  login: { width: 380, maxHeight: 480 },
  // About — hero (80px アイコン) + リンク行 + 技術情報。診断のコードブロックは内部スクロール
  about: { width: 380, maxHeight: 640 },
  // Nav editor
  navEditor: { width: 400, maxHeight: 700 },
  // Performance editor
  performanceEditor: { width: 420, maxHeight: 750 },
  // Settings JSON editor
  appearanceEditor: { width: 400, maxHeight: 700 },
  // Backup / Import / Export
  backup: { width: 440, maxHeight: 550 },
  // Cache editor (notes_cache の統計と削除)
  cacheEditor: { width: 440, maxHeight: 550 },
  // Tasks editor
  tasksEditor: { width: 500, maxHeight: 700 },
  // Snippets editor
  snippetsEditor: { width: 500, maxHeight: 700 },
  // Memo editor (Markdown body) — matches note-detail sizing
  memoEditor: { width: 500, maxHeight: 600 },
  // Misskey content detail windows
  'page-detail': { width: 500, maxHeight: 720 },
  'play-detail': { width: 500, maxHeight: 720 },
  'gallery-detail': { width: 500, maxHeight: 720 },
  'list-detail': { width: 500, maxHeight: 720 },
  'clip-detail': { width: 500, maxHeight: 720 },
  'drive-file-detail': { width: 500, maxHeight: 720 },
  // Misskey content edit windows
  'page-edit': { width: 500, maxHeight: 720 },
  'play-edit': { width: 500, maxHeight: 720 },
  // Widget edit window (= 「空のエディタで始める」相当の編集 UI)
  'widget-edit': { width: 500, maxHeight: 720 },
  // Skill edit window (markdown + frontmatter のフォーム編集)
  'skill-edit': { width: 500, maxHeight: 720 },
  // Secret Vault (#564): 外部サービス接続の一覧 / 編集
  connections: { width: 440, maxHeight: 650 },
  connectionEdit: { width: 440, maxHeight: 720 },
  // Tutorial — 新規ユーザー向けセットアップ wizard。背景の他 window と並べて
  // 進められるよう小さめサイズ。チュートリアル中に中央へ開くログイン/接続
  // window と重ならないよう右上アンカーで出す。
  tutorial: { width: 380, maxHeight: 420, anchor: 'top-right' },
}

export const useWindowsStore = defineStore('windows', () => {
  const windows = ref<DeckWindow[]>([])
  let windowCounter = 0
  let topZIndex = 1500
  const overlayCleanups = new Map<string, () => void>()

  /** The frontmost (highest zIndex) window, or null when none are open. */
  const topWindow = computed<DeckWindow | null>(() => {
    if (windows.value.length === 0) return null
    return [...windows.value].sort((a, b) => b.zIndex - a.zIndex)[0] ?? null
  })

  /** Types that match by both type and specific props (multi-instance). */
  const PROPS_DEDUP_KEYS: Partial<Record<WindowType, string[]>> = {
    'note-detail': ['noteId', 'accountId'],
    'note-inspector': ['noteId', 'accountId'],
    'notification-inspector': ['notificationId', 'accountId'],
    'user-profile': ['userId', 'accountId'],
    'federation-instance': ['host', 'accountId'],
    'follow-list': ['userId', 'accountId'],
    memoEditor: ['memoKey', 'accountId'],
    'page-detail': ['pageId', 'accountId'],
    'play-detail': ['flashId', 'accountId'],
    'gallery-detail': ['postId', 'accountId'],
    'list-detail': ['listId', 'accountId'],
    'clip-detail': ['clipId', 'accountId'],
    // origin (フォルダ開始位置) の差は dedup に影響させない
    'drive-file-detail': ['fileId', 'accountId'],
    'page-edit': ['pageId', 'accountId'],
    'play-edit': ['flashId', 'accountId'],
    'widget-edit': ['widgetId'],
    'skill-edit': ['skillId'],
    connectionEdit: ['connectionId'],
  }

  /** Types that are always singletons (at most one instance). */
  const SINGLETON_TYPES: ReadonlySet<WindowType> = new Set([
    'login',
    'plugins',
    'keybinds',
    'cssEditor',
    'themeEditor',
    'aiSettings',
    'permissions',
    'about',
    'navEditor',
    'profileEditor',
    'performanceEditor',
    'appearanceEditor',
    'backup',
    'cacheEditor',
    'tasksEditor',
    'snippetsEditor',
    'connections',
    'tutorial',
  ])

  // PiP WebView (別 OS ウィンドウ) 内では DeckWindow オーバーレイが存在しないため、
  // open() 呼び出しを新規 PiP ウィンドウの起動にリダイレクトする。
  function isInPipContext(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.location.pathname.startsWith('/pip')
    )
  }

  function open(type: WindowType, props: Record<string, unknown> = {}): string {
    if (isInPipContext()) {
      import('@/composables/usePipWindow').then(
        ({ openPipWindowForWindow }) => {
          openPipWindowForWindow(type, props)
        },
      )
      return ''
    }

    const duplicate = windows.value.find((w) => {
      if (w.type !== type) return false
      const keys = PROPS_DEDUP_KEYS[type]
      if (keys) return keys.every((k) => w.props[k] === props[k])
      return SINGLETON_TYPES.has(type)
    })
    if (duplicate) {
      // Update props for singleton windows when re-opened with new data
      if (SINGLETON_TYPES.has(type)) {
        Object.assign(duplicate.props, props)
      }
      bringToFront(duplicate.id)
      return duplicate.id
    }

    const size = WINDOW_SIZES[type]
    const viewW = globalThis.innerWidth || 800
    const viewH = globalThis.innerHeight || 600
    const offset = (windows.value.length % 5) * 30
    let x: number
    let y: number
    if (size.anchor === 'top-right') {
      // 右上に固定。中央へ開く他 window (login / connections) と重ねない。
      const margin = 32
      x = Math.max(50, viewW - size.width - margin)
      y = Math.max(50, 72 + offset)
    } else {
      x = Math.max(50, (viewW - size.width) / 2 + offset)
      y = Math.max(50, (viewH - size.maxHeight) / 2 + offset)
    }

    topZIndex++
    const id = `win-${Date.now()}-${++windowCounter}`
    const win: DeckWindow = {
      id,
      type,
      props,
      x,
      y,
      zIndex: topZIndex,
      minimized: false,
      maximized: false,
      anchor: size.anchor,
    }
    windows.value.push(win)
    if (useUiStore().isMobilePlatform) {
      overlayCleanups.set(
        id,
        pushOverlay(() => close(id)),
      )
    }
    return id
  }

  function close(id: string) {
    overlayCleanups.get(id)?.()
    overlayCleanups.delete(id)
    windows.value = windows.value.filter((w) => w.id !== id)
  }

  function bringToFront(id: string) {
    const win = windows.value.find((w) => w.id === id)
    if (!win) return
    topZIndex++
    win.zIndex = topZIndex
  }

  function updatePosition(id: string, x: number, y: number) {
    const win = windows.value.find((w) => w.id === id)
    if (win) {
      win.x = x
      win.y = y
      // ユーザーが動かしたら右上アンカーを解除し、以後は x/y 配置に従う。
      win.anchor = undefined
    }
  }

  function updateSize(id: string, width: number, height: number) {
    const win = windows.value.find((w) => w.id === id)
    if (win) {
      win.width = width
      win.height = height
    }
  }

  function toggleMinimize(id: string) {
    const win = windows.value.find((w) => w.id === id)
    if (!win) return
    win.minimized = !win.minimized
    if (!win.minimized) win.maximized = false
  }

  function toggleMaximize(id: string) {
    const win = windows.value.find((w) => w.id === id)
    if (!win) return
    win.maximized = !win.maximized
    if (win.maximized) win.minimized = false
  }

  function closeAll() {
    for (const cleanup of overlayCleanups.values()) cleanup()
    overlayCleanups.clear()
    windows.value = []
  }

  return {
    windows,
    topWindow,
    open,
    close,
    bringToFront,
    updatePosition,
    updateSize,
    toggleMinimize,
    toggleMaximize,
    closeAll,
  }
})
