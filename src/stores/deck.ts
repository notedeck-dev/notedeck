import JSON5 from 'json5'
import { defineStore } from 'pinia'
import { computed, nextTick, reactive, ref } from 'vue'
import type { TimelineFilter, TimelineType } from '@/adapters/types'
import * as snapshotStore from '@/composables/useSnapshotStore'
import { PERSIST_DEBOUNCE_MS } from '@/constants/persist'
import defaultNavbarJson5 from '@/defaults/navbar.json5?raw'
import { useAccountsStore } from '@/stores/accounts'
import { useDeckProfileStore } from '@/stores/deckProfile'
import { useDeckWallpaperStore } from '@/stores/deckWallpaper'
import { generateWidgetId, useWidgetsStore } from '@/stores/widgets'
import { buildColumnUri } from '@/utils/columnUri'
import * as deckLayout from '@/utils/deckLayout'
import { hapticMedium } from '@/utils/haptics'
import { isTauri, readNavbar, writeNavbar } from '@/utils/settingsFs'
import { getStorageJson, removeStorage, STORAGE_KEYS } from '@/utils/storage'

export type ColumnType =
  | 'timeline'
  | 'notifications'
  | 'search'
  | 'list'
  | 'antenna'
  | 'favorites'
  | 'clip'
  | 'user'
  | 'mentions'
  | 'channel'
  | 'role'
  | 'specified'
  | 'chat'
  | 'widget'
  | 'aiscript'
  | 'play'
  | 'page'
  | 'ai'
  | 'announcements'
  | 'drive'
  | 'gallery'
  | 'explore'
  | 'followRequests'
  | 'achievements'
  | 'apiConsole'
  | 'apiDocs'
  | 'lookup'
  | 'serverInfo'
  | 'ads'
  | 'aboutMisskey'
  | 'emoji'
  | 'streamInspector'
  | 'pluginManager'
  | 'themeManager'
  | 'taskRunner'
  | 'memos'
  | 'charts'
  | 'federation'
  | 'skill'

/**
 * ノートを連続ストリーミング表示するカラム型 (= 「直近フォーカスしたタイムライン」
 * の追跡対象)。AI チャットや IDE 系ツールカラムは除外。
 */
export const TIMELINE_LIKE_COLUMN_TYPES: ReadonlySet<ColumnType> = new Set([
  'timeline',
  'notifications',
  'list',
  'antenna',
  'mentions',
  'channel',
  'favorites',
  'clip',
  'user',
  'specified',
  'search',
  'role',
  'chat',
])

/**
 * @deprecated useWidgetsStore に移行済み。マイグレーション用にのみ残置 (1〜2 リリース後に削除)
 */
export interface WidgetData {
  code?: string
  autoRun?: boolean
  /** MisStore 由来 widget の由来追跡 (将来の「Store から更新」用) */
  storeId?: string
}

/**
 * @deprecated useWidgetsStore.WidgetMeta に移行済み。マイグレーション用にのみ残置
 */
export interface WidgetConfig {
  id: string
  data: WidgetData
}

export interface DeckWindowLayout {
  id: string
  x: number
  y: number
  width: number
  height: number
  monitor?: string
}

export interface DeckProfile {
  id: string
  name: string
  columns: DeckColumn[]
  layout: string[][]
  createdAt: number
  /** Window positions/sizes for multi-window layouts */
  windows?: DeckWindowLayout[]
}

/** sidebar チャットカラムで開く DM 会話のターゲット (永続化しない transient 値)。 */
export interface ChatConversationTarget {
  accountId: string
  userId: string
  name: string
  avatarUrl: string | null
  serverHost: string | null
}

export interface DeckColumn {
  id: string
  type: ColumnType
  name: string | null
  width: number
  accountId: string | null
  tl?: TimelineType
  query?: string
  active?: boolean
  filters?: TimelineFilter
  listId?: string
  antennaId?: string
  clipId?: string
  channelId?: string
  roleId?: string
  userId?: string
  /** widget カラムが参照する WidgetMeta の installId 列。本体は useWidgetsStore に存在 */
  widgetIds?: string[]
  /** @deprecated widgetIds + useWidgetsStore に移行済み。マイグレーション読取専用 */
  widgets?: WidgetConfig[]
  aiscriptCode?: string
  flashId?: string
  pageId?: string
  soundMuted?: boolean
  folderId?: string | null
  /** Window assignment: undefined/null = main window */
  windowId?: string
  /** Portable account identifier ("user@host") for cross-device profile sharing */
  account?: string
  /** true if created by nav icon toggle (managed as sidebar slot) */
  sidebar?: boolean
  /**
   * AI カラムが現在表示中の `AiSession.id`。
   * `null` または未定義 = まだセッション未選択（空状態 UI を表示）。
   * セッションは `useAiSessionsStore` でグローバルに管理され、
   * カラム削除しても残る（別カラムから開ける）。
   */
  aiCurrentSessionId?: string | null
}

let columnCounter = 0
function genColumnId(): string {
  return `col-${Date.now()}-${++columnCounter}`
}

export type NavItem =
  | { type: 'divider' }
  | {
      type: ColumnType
      accountId: string | null
      /** Display label override (e.g. channel name, @user@host) */
      label?: string
      /** Extra column properties (e.g. channelId, userId) */
      columnProps?: Partial<DeckColumn>
    }

export const DEFAULT_NAV_ITEMS: NavItem[] = JSON5.parse(defaultNavbarJson5)

export function isNavDivider(item: NavItem): item is { type: 'divider' } {
  return item.type === 'divider'
}

export const useDeckStore = defineStore('deck', () => {
  const profileStore = useDeckProfileStore()
  const wallpaperStore = useDeckWallpaperStore()

  // columns and layout are derived from the profile store (single source of truth)
  const columns = computed(() => profileStore.columns)
  const layout = computed(() => profileStore.layout)

  // --- Navbar (independent from profile, persisted to navbar.json5) ---

  const navItems = ref<NavItem[]>([...DEFAULT_NAV_ITEMS])
  const isNavCustomized = ref(false)

  let navPersistTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleNavPersist() {
    if (navPersistTimer) clearTimeout(navPersistTimer)
    navPersistTimer = setTimeout(() => {
      navPersistTimer = null
      flushNavPersist()
    }, PERSIST_DEBOUNCE_MS)
  }

  function flushNavPersist() {
    if (navPersistTimer) {
      clearTimeout(navPersistTimer)
      navPersistTimer = null
    }
    if (!isTauri) return
    const content = JSON5.stringify(navItems.value, null, 2)
    writeNavbar(content).catch((e) =>
      console.warn('[deck] failed to persist navbar:', e),
    )
  }

  function setNavItems(items: NavItem[] | undefined) {
    if (items == null) {
      navItems.value = [...DEFAULT_NAV_ITEMS]
      isNavCustomized.value = false
      // Delete file content by writing empty
      if (isTauri) {
        writeNavbar('').catch((e) =>
          console.warn('[deck] failed to clear navbar:', e),
        )
      }
    } else {
      navItems.value = items
      isNavCustomized.value = true
      scheduleNavPersist()
    }
  }

  // Column types removed in past versions — silently strip from saved navbar
  const DEPRECATED_COLUMN_TYPES = new Set(['workspaceExplorer'])

  async function initNavbar() {
    if (!isTauri) return
    try {
      const content = await readNavbar()
      if (content?.trim()) {
        const parsed = JSON5.parse(content)
        if (Array.isArray(parsed) && parsed.length > 0) {
          const filtered = (parsed as NavItem[]).filter(
            (item) => !DEPRECATED_COLUMN_TYPES.has(item.type),
          )
          navItems.value = filtered
          isNavCustomized.value = true
        }
      }
    } catch (e) {
      console.warn('[deck] failed to init navbar:', e)
    }
  }

  const navCollapsed = ref(false)
  const activeColumnId = ref<string | null>(null)
  /**
   * カラム ID → 現在 focus されているノート ID。
   * `useNoteFocus.ts` から書き込まれ、`column.focusedNote` capability で読まれる。
   * カラム削除時にエントリも掃除する。
   */
  const focusedNoteIdByColumn = ref<Map<string, string>>(new Map())
  function setFocusedNoteId(columnId: string, noteId: string | null) {
    const next = new Map(focusedNoteIdByColumn.value)
    if (noteId) next.set(columnId, noteId)
    else next.delete(columnId)
    focusedNoteIdByColumn.value = next
  }
  /** Incremented to trigger a refresh on the active column */
  const refreshTrigger = ref(0)

  function refreshActiveColumn() {
    refreshTrigger.value++
  }

  /** Cache-key based invalidation signal for non-streaming columns (clip, favorites) */
  const columnInvalidation = reactive<Record<string, number>>({})

  function invalidateColumnByKey(cacheKey: string) {
    columnInvalidation[cacheKey] = (columnInvalidation[cacheKey] ?? 0) + 1
  }
  /** This window's sub-window ID (null = main window) */
  const currentWindowId = ref<string | null>(null)
  /** Column ID being dragged from another window (for cross-window D&D overlay) */
  const crossWindowDragColumnId = ref<string | null>(null)

  /** O(1) column lookup by ID */
  const columnMap = computed(() => {
    const m = new Map<string, DeckColumn>()
    for (const c of columns.value) m.set(c.id, c)
    return m
  })

  /**
   * 各カラムが報告した可視 item のキャッシュ。
   * 中身はカラム種別ごとに異なる (note / notification / driveItem / ...)。
   * AI への context 注入や監査ログなど横断的な機能から参照される。
   * 新規参照者は「特別扱い」せずこの汎用 API を使うこと
   * (memory feedback_no_special_case_columns)。
   */
  const visibleNotesByColumn = ref<Record<string, unknown[]>>({})
  /** 直近フォーカスしたタイムライン系カラムの id (AI が context として読む)。 */
  const lastFocusedTimelineColumnId = ref<string | null>(null)

  function reportVisibleItems(columnId: string, items: unknown[]) {
    visibleNotesByColumn.value = {
      ...visibleNotesByColumn.value,
      [columnId]: items,
    }
  }

  function setActiveColumn(id: string) {
    activeColumnId.value = id
    const col = columnMap.value.get(id)
    if (col && TIMELINE_LIKE_COLUMN_TYPES.has(col.type)) {
      lastFocusedTimelineColumnId.value = id
    }
  }

  function focusNextColumn() {
    if (columns.value.length === 0) return
    const idx = columns.value.findIndex((c) => c.id === activeColumnId.value)
    const next = idx < 0 ? 0 : Math.min(idx + 1, columns.value.length - 1)
    const col = columns.value[next]
    if (col) activeColumnId.value = col.id
  }

  function focusPrevColumn() {
    if (columns.value.length === 0) return
    const idx = columns.value.findIndex((c) => c.id === activeColumnId.value)
    const prev = idx <= 0 ? 0 : idx - 1
    const col = columns.value[prev]
    if (col) activeColumnId.value = col.id
  }

  function focusColumnByIndex(index: number) {
    const col = columns.value[index]
    if (col) activeColumnId.value = col.id
  }

  const activeColumnUri = computed(() => {
    if (!activeColumnId.value) return null
    const col = getColumn(activeColumnId.value)
    if (!col) return null

    if (!col.accountId) return buildColumnUri(col, null)
    const accountsStore = useAccountsStore()
    const account = accountsStore.accounts.find((a) => a.id === col.accountId)
    return buildColumnUri(col, account?.host ?? null)
  })

  function addColumn(partial: Omit<DeckColumn, 'id'>) {
    const col: DeckColumn = { ...partial, id: genColumnId() }
    profileStore.mutateProfile((p) => {
      p.columns.push(col)
      p.layout.push([col.id])
    })
    activeColumnId.value = col.id
    hapticMedium()
    return col
  }

  function addColumnAt(index: number, partial: Omit<DeckColumn, 'id'>) {
    const col: DeckColumn = { ...partial, id: genColumnId() }
    profileStore.mutateProfile((p) => {
      p.columns.push(col)
      p.layout.splice(index, 0, [col.id])
    })
    activeColumnId.value = col.id
    hapticMedium()
    return col
  }

  // チャットカラムへ「特定ユーザーとの会話を開け」と伝える transient な合図。
  // カラムには永続化せず、sidebar チャットカラムが consume したら null に戻す。
  const pendingChatTarget = ref<ChatConversationTarget | null>(null)

  /** ユーザープロフィール等から特定ユーザーとの DM を開く。 */
  function openChatWith(target: ChatConversationTarget) {
    pendingChatTarget.value = target
    const existing = columns.value.find((c) => c.sidebar)
    if (existing && existing.type === 'chat') {
      // 既に開いている → activate して watch を再発火させる。
      activeColumnId.value = null
      nextTick(() => {
        activeColumnId.value = existing.id
      })
    } else if (existing) {
      updateColumn(existing.id, { type: 'chat', accountId: null, name: null })
      activeColumnId.value = null
      nextTick(() => {
        activeColumnId.value = existing.id
      })
    } else {
      addColumnAt(0, {
        type: 'chat',
        name: null,
        width: 360,
        accountId: null,
        sidebar: true,
      })
    }
  }

  /** ハッシュタグクリック等から検索カラムをクエリ付きで開く。 */
  function openSearchWith(query: string) {
    const existing = columns.value.find((c) => c.sidebar)
    if (existing && existing.type === 'search') {
      // 既に開いている → query を差し替え (DeckSearchColumn 側の watch が再検索する)
      updateColumn(existing.id, { query })
      activeColumnId.value = null
      nextTick(() => {
        activeColumnId.value = existing.id
      })
    } else if (existing) {
      updateColumn(existing.id, {
        type: 'search',
        accountId: null,
        name: null,
        query,
      })
      activeColumnId.value = null
      nextTick(() => {
        activeColumnId.value = existing.id
      })
    } else {
      addColumnAt(0, {
        type: 'search',
        name: null,
        width: 360,
        accountId: null,
        sidebar: true,
        query,
      })
    }
  }

  /** sidebar チャットカラムが会話ターゲットを取り出して消費する。 */
  function consumePendingChatTarget(): ChatConversationTarget | null {
    const t = pendingChatTarget.value
    pendingChatTarget.value = null
    return t
  }

  function toggleSidebarColumn(
    type: ColumnType,
    accountId: string | null,
    extraProps?: Partial<DeckColumn>,
  ) {
    const existing = columns.value.find((c) => c.sidebar)
    if (existing && existing.type === type) {
      removeColumn(existing.id)
      return
    }
    if (existing) {
      // In-place update: swap type without destroying DOM / layout.
      updateColumn(existing.id, { type, accountId, name: null, ...extraProps })
      // Force watch re-trigger even if the same column is already active
      activeColumnId.value = null
      nextTick(() => {
        activeColumnId.value = existing.id
      })
      return
    }
    addColumnAt(0, {
      type,
      name: null,
      width: 360,
      accountId,
      sidebar: true,
      ...extraProps,
    })
  }

  function removeColumn(id: string) {
    snapshotStore.evictColumn(id)
    profileStore.mutateProfile((p) => {
      p.columns = p.columns.filter((c) => c.id !== id)
      p.layout = p.layout
        .map((ids) => ids.filter((_id) => _id !== id))
        .filter((ids) => ids.length > 0)
    })
    profileStore.flushPersist()
    if (visibleNotesByColumn.value[id] !== undefined) {
      const next = { ...visibleNotesByColumn.value }
      delete next[id]
      visibleNotesByColumn.value = next
    }
    if (lastFocusedTimelineColumnId.value === id) {
      lastFocusedTimelineColumnId.value = null
    }
    setFocusedNoteId(id, null)
    hapticMedium()
  }

  function updateColumn(id: string, updates: Partial<DeckColumn>) {
    const col = getColumn(id)
    if (col) {
      Object.assign(col, updates)
      profileStore.schedulePersist()
    }
  }

  function applyLayout(newLayout: string[][]) {
    profileStore.setLayout(newLayout)
  }

  function swapColumns(aIdx: number, bIdx: number) {
    const result = deckLayout.swapGroups(layout.value, aIdx, bIdx)
    if (result) applyLayout(result)
  }

  function stackColumn(
    fromId: string,
    toId: string,
    position: 'above' | 'below',
  ) {
    const result = deckLayout.stackColumn(layout.value, fromId, toId, position)
    if (result) applyLayout(result)
  }

  function swapInGroup(idA: string, idB: string) {
    const result = deckLayout.swapInGroup(layout.value, idA, idB)
    if (result) applyLayout(result)
  }

  function insertColumnAt(id: string, targetIndex: number) {
    const result = deckLayout.insertColumnAt(layout.value, id, targetIndex)
    if (result) applyLayout(result)
  }

  function unstackColumn(id: string) {
    const result = deckLayout.unstackColumn(layout.value, id)
    if (result) applyLayout(result)
  }

  function moveLeft(id: string) {
    const idx = deckLayout.groupIndexOf(layout.value, id)
    if (idx > 0) swapColumns(idx, idx - 1)
  }

  function moveRight(id: string) {
    const idx = deckLayout.groupIndexOf(layout.value, id)
    if (idx < layout.value.length - 1) swapColumns(idx, idx + 1)
  }

  function getColumn(id: string): DeckColumn | undefined {
    return columnMap.value.get(id)
  }

  // --- save / flushSave facades (backward compat for external callers) ---

  function save() {
    profileStore.schedulePersist()
  }

  function flushSave() {
    profileStore.flushPersist()
  }

  function load() {
    // One-shot migration from pre-profile era key (v0.10.2 and earlier).
    // Seed the first profile from nd-deck if it exists, then remove the key.
    const data = getStorageJson<{
      columns?: DeckColumn[]
      layout?: string[][]
    } | null>(STORAGE_KEYS.deck, null)

    const fallbackColumns = data?.columns ?? []
    const fallbackLayout = data?.layout ?? []

    profileStore.ensureDefaults(fallbackColumns, fallbackLayout)

    if (data !== null) {
      removeStorage(STORAGE_KEYS.deck)
    }

    // Set window identity from query params
    const params = new URLSearchParams(window.location.search)
    const profileId = params.get('profile')
    const windowId = params.get('window')
    if (windowId) {
      currentWindowId.value = windowId
    }

    // Initialize this window's profile view
    const targetProfileId = profileId ?? profileStore.activeProfileId
    if (targetProfileId) {
      profileStore.initWindowProfile(targetProfileId)
    }
  }

  // Widget helpers (widget 本体は useWidgetsStore、カラムは installId の参照のみ)
  const widgetsStore = useWidgetsStore()

  /**
   * widget カラムに新規 widget を追加する。
   * sidebar widget カラム (ナビバートグルで開閉) なら sidebar 並びに登録、
   * non-sidebar widget カラムならカラム自身の widgetIds[] に push する。
   */
  function addWidget(
    columnId: string,
    initial?: {
      src?: string
      autoRun?: boolean
      storeId?: string
      name?: string
      iconUrl?: string
    },
  ) {
    const col = getColumn(columnId)
    if (!col || col.type !== 'widget') return
    const installId = generateWidgetId()
    const now = Date.now()
    widgetsStore.addWidget({
      installId,
      name: initial?.name ?? `Widget ${installId.slice(4, 12)}`,
      src: initial?.src ?? '',
      autoRun: initial?.autoRun ?? false,
      storeId: initial?.storeId,
      iconUrl: initial?.iconUrl,
      createdAt: now,
      updatedAt: now,
    })
    if (col.sidebar === true) {
      widgetsStore.addToSidebar(installId)
    } else {
      if (!col.widgetIds) col.widgetIds = []
      col.widgetIds.push(installId)
      save()
    }
  }

  /**
   * 既存ライブラリ widget をカラムに配置する (= column.widgetIds への参照追加)。
   * widget 本体は widgetsStore に既にあるものを再利用する。
   * sidebar widget カラムなら sidebarWidgetIds に、それ以外は column.widgetIds に push。
   * 既に同 id があれば no-op。
   */
  function attachWidget(columnId: string, installId: string) {
    const col = getColumn(columnId)
    if (!col || col.type !== 'widget') return
    if (col.sidebar === true) {
      widgetsStore.addToSidebar(installId)
      return
    }
    if (!col.widgetIds) col.widgetIds = []
    if (col.widgetIds.includes(installId)) return
    col.widgetIds.push(installId)
    save()
  }

  /**
   * 全 widget カラムから指定 installId への参照を一括で剥がす。
   * widgetsStore.removeWidget で本体を削除する前に呼ぶことで dangling 参照
   * (column.widgetIds に残った無効 id) を防ぐ。
   * sidebar 並びの cleanup は widgetsStore 側で自動実施されるためここでは扱わない。
   * mutateProfile 経由で profileVersion を bump し、依存 computed を再評価させる。
   */
  function detachWidgetFromAllColumns(installId: string) {
    profileStore.mutateProfile((p) => {
      if (!p.columns) return
      for (const col of p.columns) {
        if (col.type !== 'widget' || !col.widgetIds) continue
        if (col.widgetIds.includes(installId)) {
          col.widgetIds = col.widgetIds.filter((id) => id !== installId)
        }
      }
    })
  }

  /**
   * widget カラムから widget を取り除く。
   * sidebar widget カラムなら本体削除 (コードも消える)、
   * non-sidebar widget カラムならカラムからの参照剥がしのみ (本体ストアに残る)。
   */
  function removeWidget(columnId: string, installId: string) {
    const col = getColumn(columnId)
    if (!col || col.type !== 'widget') return
    if (col.sidebar === true) {
      widgetsStore.removeWidget(installId)
    } else if (col.widgetIds) {
      col.widgetIds = col.widgetIds.filter((id) => id !== installId)
      save()
    }
  }

  function reorderWidgetIds(columnId: string, ids: string[]) {
    const col = getColumn(columnId)
    if (!col || col.type !== 'widget') return
    col.widgetIds = ids
    save()
  }

  function clear() {
    profileStore.setColumnsAndLayout([], [])
  }

  // --- Profile facade (delegates to profileStore) ---

  function syncCurrentToActiveProfile() {
    // No-op: profileStore is already the source of truth
    profileStore.flushPersist()
  }

  function saveAsProfile(name?: string) {
    // Flush current state first
    profileStore.flushPersist()
    const profile = profileStore.saveAsProfile(name)
    return profile
  }

  function applyProfile(profileId: string) {
    profileStore.flushPersist()
    profileStore.switchProfile(profileId)
  }

  // --- Multi-window column management ---

  /** Layout groups visible in the current window */
  const windowLayout = computed(() => {
    const wid = currentWindowId.value
    const colMap = columnMap.value
    return layout.value.filter((group) =>
      group.some((colId) => {
        const col = colMap.get(colId)
        if (!col) return false
        if (!wid) return !col.windowId
        return col.windowId === wid
      }),
    )
  })

  function popOutColumn(columnId: string, windowId: string) {
    unstackColumn(columnId)
    const col = getColumn(columnId)
    if (col) {
      col.windowId = windowId
      save()
    }
  }

  function recallColumn(columnId: string) {
    const col = getColumn(columnId)
    if (col) {
      col.windowId = undefined
      save()
    }
  }

  function recallColumnsFromWindow(windowId: string) {
    let changed = false
    for (const col of columns.value) {
      if (col.windowId === windowId) {
        col.windowId = undefined
        changed = true
      }
    }
    if (changed) save()
  }

  function moveColumnToWindow(columnId: string, targetWindowId: string | null) {
    const col = getColumn(columnId)
    if (!col) return
    col.windowId = targetWindowId || undefined
    save()
  }

  // --- Sync (delegates to profileStore) ---

  function startSync() {
    return profileStore.startSync()
  }

  function stopSync() {
    profileStore.stopSync()
  }

  return {
    columns,
    layout,
    navCollapsed,
    activeColumnId,
    activeColumnUri,
    focusedNoteIdByColumn,
    setFocusedNoteId,
    visibleNotesByColumn,
    lastFocusedTimelineColumnId,
    reportVisibleItems,
    setActiveColumn,
    focusNextColumn,
    focusPrevColumn,
    focusColumnByIndex,
    navItems,
    isNavCustomized,
    setNavItems,
    initNavbar,
    addColumn,
    addColumnAt,
    removeColumn,
    toggleSidebarColumn,
    pendingChatTarget,
    openChatWith,
    openSearchWith,
    consumePendingChatTarget,
    updateColumn,
    swapColumns,
    swapInGroup,
    stackColumn,
    insertColumnAt,
    applyLayout,
    unstackColumn,
    moveLeft,
    moveRight,
    getColumn,
    save,
    flushSave,
    load,
    clear,
    addWidget,
    attachWidget,
    detachWidgetFromAllColumns,
    removeWidget,
    reorderWidgetIds,
    // Wallpaper (facade)
    wallpaper: computed(() => wallpaperStore.wallpaper),
    setWallpaper: wallpaperStore.setWallpaper,
    clearWallpaper: wallpaperStore.clearWallpaper,
    // Profile (facade)
    activeProfileId: computed(() => profileStore.activeProfileId),
    loadActiveProfileId: profileStore.loadActiveProfileId,
    syncCurrentToActiveProfile,
    saveAsProfile,
    getProfiles: profileStore.getProfiles,
    applyProfile,
    deleteProfile: profileStore.deleteProfile,
    renameProfile: profileStore.renameProfile,
    windowProfileId: computed(() => profileStore.windowProfileId),
    currentProfileName: computed(() => profileStore.currentProfileName),
    initWindowProfile: profileStore.initWindowProfile,
    createEmptyProfile: profileStore.createEmptyProfile,
    currentWindowId,
    windowLayout,
    popOutColumn,
    recallColumn,
    recallColumnsFromWindow,
    moveColumnToWindow,
    saveWindowLayout: profileStore.saveWindowLayout,
    removeWindowLayout: profileStore.removeWindowLayout,
    getWindowLayouts: profileStore.getWindowLayouts,
    columnMap,
    crossWindowDragColumnId,
    refreshTrigger,
    refreshActiveColumn,
    columnInvalidation,
    invalidateColumnByKey,
    startSync,
    stopSync,
  }
})
