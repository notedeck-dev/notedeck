import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { pushOverlay } from '@/composables/useBackButton'
import { useUiStore } from '@/stores/ui'
import { WINDOW_SIZES } from '@/windows/registry'

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
  | 'column-query-editor'
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
  // 未リサイズ時は WINDOW_REGISTRY のデフォルトに従い、高さは max-height で内容に追従する。
  width?: number
  height?: number
  zIndex: number
  minimized: boolean
  maximized: boolean
  // 右上アンカー (WINDOW_REGISTRY[type].anchor 由来)。描画時に viewport 右端からの
  // 相対配置にするための印。ユーザーがドラッグ/リサイズすると外れて x 配置に戻る。
  anchor?: 'top-right'
}

export const WINDOW_MIN_SIZE = { width: 240, height: 180 }

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
    'column-query-editor': ['columnId', 'queryId'],
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
