import JSON5 from 'json5'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { DeckColumn, DeckProfile, DeckWindowLayout } from '@/stores/deck'
import { useWidgetsStore, type WidgetMeta } from '@/stores/widgets'
import { createDebouncedPersist } from '@/utils/debouncedPersist'
import * as settingsFs from '@/utils/settingsFs'
import {
  getStorageJson,
  getStorageString,
  STORAGE_KEYS,
  setStorageJson,
  setStorageString,
} from '@/utils/storage'
import { emitTauri, listenTauri } from '@/utils/tauriEvents'

/** Deep-clone reactive state into a plain object safe for serialization.
 *  structuredClone strips Vue Proxy wrappers without the overhead of
 *  JSON serialization round-trips. */
function deepClone<T>(value: T): T {
  return structuredClone(value)
}

/** Strip internal-only fields before writing to file. */
function toFileFormat(profile: DeckProfile): Record<string, unknown> {
  const { id: _id, ...rest } = profile
  return rest
}

/**
 * Widget マイグレーション。
 * - 旧 `type: 'aiscriptConsole'` の widget 行は削除 (コードは失われる)。
 * - 旧 `widgets[]` は本体を抽出してストアに移送、カラムには `widgetIds[]` のみ残す。
 * - 既に `widgetIds[]` 化済みのカラムは触らない (idempotent)。
 * 削除件数と抽出した widget は呼び出し側でストアに登録するため返す。
 */
function migrateWidgetColumns(columns: DeckColumn[]): {
  columns: DeckColumn[]
  droppedConsoleCount: number
  extractedWidgets: WidgetMeta[]
  sidebarSeed: string[]
} {
  let droppedConsoleCount = 0
  const extractedWidgets: WidgetMeta[] = []
  const sidebarSeed: string[] = []
  const now = Date.now()
  const migrated = columns.map((col) => {
    if (col.type !== 'widget') return col
    if (!col.widgets) return col

    const newIds: string[] = []
    for (const w of col.widgets) {
      const legacyType = (w as { type?: string }).type
      if (legacyType === 'aiscriptConsole') {
        droppedConsoleCount++
        continue
      }
      // 既存 widget.id をそのまま installId に再利用
      // (AiScript の `Mk:save` localStorage キー prefix `nd-aiscript-app-${id}:` を保全する最重要不変条件)
      const installId = w.id
      newIds.push(installId)
      extractedWidgets.push({
        installId,
        name: `Widget ${installId.slice(4, 12)}`,
        src: w.data?.code ?? '',
        autoRun: w.data?.autoRun ?? false,
        storeId: w.data?.storeId,
        createdAt: now,
        updatedAt: now,
      })
    }

    // sidebar widget カラムの並びはストア外 sidebarWidgetIds に引き継ぐ
    if (col.sidebar) sidebarSeed.push(...newIds)

    const { widgets: _w, ...rest } = col
    return { ...rest, widgetIds: newIds } as DeckColumn
  })
  return {
    columns: migrated,
    droppedConsoleCount,
    extractedWidgets,
    sidebarSeed,
  }
}

/** 起動時に累積する Console widget 削除件数。toast 表示後に 0 に戻す。 */
let pendingConsoleMigrationCount = 0
/** マイグレーション適用後にディスク上のプロファイルファイルを書き直す必要があるか。 */
let pendingConsoleMigrationFilesDirty = false

/** マイグレーションで widgets[] → widgetIds[] への変換が起きたか。プロファイル再書込判定用 */
let pendingWidgetExtractionDirty = false

/** 抽出した widget を widgetsStore に流し込む (重複 installId は skip)。 */
function pushExtractedWidgets(extracted: WidgetMeta[], sidebarSeed: string[]) {
  if (extracted.length === 0 && sidebarSeed.length === 0) return
  pendingWidgetExtractionDirty = true
  const store = useWidgetsStore()
  store.ensureLoaded()
  for (const w of extracted) {
    if (store.getWidget(w.installId)) continue
    store.addWidget(w)
  }
  for (const id of sidebarSeed) {
    store.addToSidebar(id)
  }
}

/** Parse a profile file and assign an ID based on filename. */
function fromFileFormat(
  filename: string,
  data: Record<string, unknown>,
): DeckProfile {
  const rawColumns = (data.columns as DeckColumn[]) || []
  const { columns, droppedConsoleCount, extractedWidgets, sidebarSeed } =
    migrateWidgetColumns(rawColumns)
  pendingConsoleMigrationCount += droppedConsoleCount
  pushExtractedWidgets(extractedWidgets, sidebarSeed)
  return {
    id: filename,
    name: (data.name as string) || filename,
    columns,
    layout: (data.layout as string[][]) || [],
    createdAt: (data.createdAt as number) || Date.now(),
    windows: data.windows as DeckWindowLayout[] | undefined,
  }
}

export const useDeckProfileStore = defineStore('deckProfile', () => {
  const activeProfileId = ref<string | null>(null)
  /** Per-window profile ID (set via ?profile= query). Isolates this window from deck:sync. */
  const windowProfileId = ref<string | null>(null)
  /** Bumped on every persist to make profile-derived computeds reactive */
  const profileVersion = ref(0)
  /** Whether file-based storage has been initialized */
  const initialized = ref(false)

  /** Cached profile name, kept in sync imperatively to avoid localStorage dependency. */
  const currentProfileName = ref<string | null>(null)

  /** In-memory cache of profiles. Uses shallowRef to avoid deep reactivity
   *  overhead on large nested DeckColumn[]/DeckWindowLayout[] structures.
   *  In-place mutations are signalled via profileVersion bump. */
  const profilesData = shallowRef<DeckProfile[]>([])

  // --- Profile data access (reactive) ---

  /** The profile this window is currently viewing.
   *  Depends on profileVersion to detect in-place mutations (shallowRef). */
  const currentProfile = computed(() => {
    void profileVersion.value
    return (
      profilesData.value.find((p) => p.id === windowProfileId.value) ?? null
    )
  })

  /** Columns of the current profile (reactive, read-only from outside). */
  const columns = computed<DeckColumn[]>(() => {
    void profileVersion.value
    return currentProfile.value?.columns ?? []
  })

  /** Layout of the current profile (reactive, read-only from outside). */
  const layout = computed<string[][]>(() => {
    void profileVersion.value
    return currentProfile.value?.layout ?? []
  })

  // --- Profile mutation ---

  /** Mutate the current profile's data and schedule persistence. */
  function mutateProfile(
    fn: (profile: DeckProfile) => void,
    profileId?: string | null,
  ) {
    const target = profileId
      ? profilesData.value.find((p) => p.id === profileId)
      : currentProfile.value
    if (!target) return
    fn(target)
    // Trigger reactivity by bumping version (Vue tracks the ref)
    profileVersion.value++
    schedulePersist()
  }

  function setColumns(newColumns: DeckColumn[], profileId?: string | null) {
    mutateProfile((p) => {
      p.columns = newColumns
    }, profileId)
  }

  function setLayout(newLayout: string[][], profileId?: string | null) {
    mutateProfile((p) => {
      p.layout = newLayout
    }, profileId)
  }

  function setColumnsAndLayout(
    newColumns: DeckColumn[],
    newLayout: string[][],
    profileId?: string | null,
  ) {
    mutateProfile((p) => {
      p.columns = newColumns
      p.layout = newLayout
    }, profileId)
  }

  // --- Persistence (debounced) ---

  const { schedule: schedulePersist, cancel: cancelPersist } =
    createDebouncedPersist(persistNow)

  /** debounce を待たず即時書き込み (ペンディングは破棄) */
  function flushPersist() {
    cancelPersist()
    persistNow()
  }

  function persistNow() {
    try {
      const profiles = profilesData.value
      // Sync: localStorage + bump version
      setStorageJson(STORAGE_KEYS.deckProfiles, profiles)
      const profile = currentProfile.value
      // Async: write changed profile to file
      if (initialized.value && profile) {
        persistSingleProfile(profile).catch((e) =>
          console.warn('[deckProfile] failed to persist profile:', e),
        )
      }
      // Notify other windows
      if (windowProfileId.value) {
        emitTauri('deck:profile-updated', {
          profileId: windowProfileId.value,
        }).catch(() => {
          // Not running in Tauri (browser dev mode)
        })
      }
    } catch (e) {
      console.warn('[deckProfile] failed to persist:', e)
    }
  }

  // --- Cross-window sync ---

  function reloadFromStorage() {
    profilesData.value = getStorageJson<DeckProfile[]>(
      STORAGE_KEYS.deckProfiles,
      [],
    )
    profileVersion.value++
    refreshProfileName()
  }

  const unlistenFns: (() => void)[] = []

  async function startSync() {
    stopSync()

    // Profile content changed (columns/layout)
    unlistenFns.push(
      await listenTauri('deck:profile-updated', (payload) => {
        if (payload.profileId !== windowProfileId.value) return
        reloadFromStorage()
      }),
    )

    // Profile list changed (add/delete/rename)
    unlistenFns.push(
      await listenTauri('deck:profiles-changed', () => {
        reloadFromStorage()
      }),
    )
  }

  function stopSync() {
    for (const fn of unlistenFns) fn()
    unlistenFns.length = 0
  }

  // --- Internal helpers ---

  /** Update currentProfileName from current windowProfileId. */
  function refreshProfileName() {
    currentProfileName.value = currentProfile.value?.name ?? null
  }

  function loadProfilesFromStorage(): DeckProfile[] {
    const raw = getStorageJson<DeckProfile[]>(STORAGE_KEYS.deckProfiles, [])
    return raw.map((p) => {
      const { columns, droppedConsoleCount, extractedWidgets, sidebarSeed } =
        migrateWidgetColumns(p.columns ?? [])
      pendingConsoleMigrationCount += droppedConsoleCount
      pushExtractedWidgets(extractedWidgets, sidebarSeed)
      return { ...p, columns }
    })
  }

  /** Persist profiles: write profilesData to localStorage + files + notify other windows. */
  function saveProfiles(profiles: DeckProfile[]) {
    profilesData.value = profiles
    setStorageJson(STORAGE_KEYS.deckProfiles, profiles)
    profileVersion.value++
    if (initialized.value) {
      persistProfilesToFiles(profiles).catch((e) =>
        console.warn('[deckProfile] failed to persist to files:', e),
      )
    }
    // Notify all windows that the profile list changed
    emitTauri('deck:profiles-changed').catch(() => {
      // Not running in Tauri (browser dev mode)
    })
  }

  /** Write only the given profile to its file. */
  async function persistSingleProfile(profile: DeckProfile): Promise<void> {
    const filename = settingsFs.profileFilename(profile.name)
    const content = JSON5.stringify(toFileFormat(profile), null, 2)
    await settingsFs.writeProfile(filename, content)
  }

  /** Write all profiles to files. */
  async function persistProfilesToFiles(
    profiles: DeckProfile[],
  ): Promise<void> {
    await Promise.all(profiles.map((p) => persistSingleProfile(p)))
  }

  function saveActiveProfileId(id: string | null) {
    activeProfileId.value = id
    setStorageString(STORAGE_KEYS.deckActiveProfile, id)
  }

  function loadActiveProfileId() {
    activeProfileId.value = getStorageString(STORAGE_KEYS.deckActiveProfile)
  }

  /** Find the next available "プロファイル N" name */
  function nextProfileName(profiles: DeckProfile[]): string {
    const names = new Set(profiles.map((p) => p.name))
    for (let i = 1; ; i++) {
      const candidate = `プロファイル ${i}`
      if (!names.has(candidate)) return candidate
    }
  }

  // --- Profile CRUD ---

  function syncColumnsToProfile(
    profileId: string,
    cols: DeckColumn[],
    lay: string[][],
  ) {
    const profile = profilesData.value.find((p) => p.id === profileId)
    if (!profile) return
    profile.columns = deepClone(cols)
    profile.layout = deepClone(lay)
    setStorageJson(STORAGE_KEYS.deckProfiles, profilesData.value)
    profileVersion.value++
    if (initialized.value) {
      persistSingleProfile(profile).catch((e) =>
        console.warn('[deckProfile] failed to persist profile:', e),
      )
    }
  }

  function switchProfile(
    newProfileId: string,
  ): { columns: DeckColumn[]; layout: string[][] } | null {
    const profiles = profilesData.value
    const newProfile = profiles.find((p) => p.id === newProfileId)
    if (!newProfile) return null

    // Single localStorage write
    setStorageJson(STORAGE_KEYS.deckProfiles, profiles)
    profileVersion.value++

    const oldProfileId = windowProfileId.value

    windowProfileId.value = newProfileId
    saveActiveProfileId(newProfileId)
    refreshProfileName()

    // Async: persist only changed profiles
    if (initialized.value) {
      const toWrite = oldProfileId
        ? profiles.filter((p) => p.id === oldProfileId || p.id === newProfileId)
        : [newProfile]
      const unique = [...new Map(toWrite.map((p) => [p.id, p])).values()]
      Promise.all(unique.map((p) => persistSingleProfile(p))).catch((e) =>
        console.warn('[deckProfile] failed to persist profiles:', e),
      )
    }

    return {
      columns: newProfile.columns,
      layout: newProfile.layout,
    }
  }

  function saveAsProfile(name?: string): DeckProfile {
    const profiles = profilesData.value
    const autoName = name || nextProfileName(profiles)

    const profile: DeckProfile = {
      id: settingsFs.profileFilename(autoName),
      name: autoName,
      columns: [],
      layout: [],
      createdAt: Date.now(),
    }
    profiles.push(profile)
    saveProfiles(profiles)
    saveActiveProfileId(profile.id)
    windowProfileId.value = profile.id
    refreshProfileName()

    return profile
  }

  function createEmptyProfile(name?: string): DeckProfile {
    const profiles = profilesData.value
    const autoName = name || nextProfileName(profiles)
    const profile: DeckProfile = {
      id: settingsFs.profileFilename(autoName),
      name: autoName,
      columns: [],
      layout: [],
      createdAt: Date.now(),
    }
    profiles.push(profile)
    saveProfiles(profiles)
    return profile
  }

  function getProfiles(): DeckProfile[] {
    return profilesData.value
  }

  function applyProfile(
    profileId: string,
  ): { columns: DeckColumn[]; layout: string[][] } | null {
    const profile = profilesData.value.find((p) => p.id === profileId)
    if (!profile) return null
    windowProfileId.value = profileId
    saveActiveProfileId(profileId)
    refreshProfileName()
    return {
      columns: profile.columns,
      layout: profile.layout,
    }
  }

  function deleteProfile(profileId: string) {
    const profiles = profilesData.value.filter((p) => p.id !== profileId)
    profilesData.value = profiles
    setStorageJson(STORAGE_KEYS.deckProfiles, profiles)
    profileVersion.value++

    if (activeProfileId.value === profileId) {
      saveActiveProfileId(profiles[0]?.id ?? null)
    }

    if (initialized.value) {
      settingsFs
        .deleteProfile(profileId)
        .catch((e) => console.warn('[deckProfile] failed to delete file:', e))
    }
  }

  function renameProfile(profileId: string, newName: string) {
    const profile = profilesData.value.find((p) => p.id === profileId)
    if (!profile) return

    const oldFilename = profile.id
    const newFilename = settingsFs.profileFilename(newName)

    profile.name = newName
    profile.id = newFilename

    if (activeProfileId.value === oldFilename) {
      saveActiveProfileId(newFilename)
    }
    if (windowProfileId.value === oldFilename) {
      windowProfileId.value = newFilename
    }

    saveProfiles(profilesData.value)
    refreshProfileName()

    if (initialized.value && oldFilename !== newFilename) {
      settingsFs
        .renameProfile(oldFilename, newFilename)
        .catch((e) => console.warn('[deckProfile] failed to rename file:', e))
    }
  }

  /** Initialize this window with a profile */
  function initWindowProfile(profileId: string) {
    windowProfileId.value = profileId
    refreshProfileName()
  }

  /** Save window layout (position/size) to the current profile.
   *  Defaults to debounced persist to avoid I/O cascades during rapid resize.
   *  Pass `{ immediate: true }` from beforeunload paths where the debounce
   *  timer wouldn't fire in time. */
  function saveWindowLayout(
    windowLayout: DeckWindowLayout,
    opts?: { immediate?: boolean },
  ) {
    if (!windowProfileId.value) return
    const profile = currentProfile.value
    if (!profile) return
    if (!profile.windows) profile.windows = []
    const existing = profile.windows.findIndex((w) => w.id === windowLayout.id)
    if (existing >= 0) {
      profile.windows[existing] = windowLayout
    } else {
      profile.windows.push(windowLayout)
    }
    profileVersion.value++
    if (opts?.immediate) flushPersist()
    else schedulePersist()
  }

  function removeWindowLayout(
    windowId: string,
    opts?: { immediate?: boolean },
  ) {
    if (!windowProfileId.value) return
    const profile = currentProfile.value
    if (!profile?.windows) return
    profile.windows = profile.windows.filter((w) => w.id !== windowId)
    profileVersion.value++
    if (opts?.immediate) flushPersist()
    else schedulePersist()
  }

  function getWindowLayouts(): DeckWindowLayout[] {
    return currentProfile.value?.windows ?? []
  }

  // --- File-based initialization ---

  async function loadProfilesFromFiles(): Promise<DeckProfile[]> {
    const filenames = await settingsFs.listProfiles()
    if (filenames.length === 0) return []

    const results = await Promise.all(
      filenames.map(async (filename) => {
        try {
          const content = await settingsFs.readProfile(filename)
          const data = JSON5.parse(content)
          return fromFileFormat(filename, data)
        } catch (e) {
          console.warn(`[deckProfile] failed to parse ${filename}:`, e)
          return null
        }
      }),
    )
    return results.filter((p): p is DeckProfile => p !== null)
  }

  /** Ensure profiles exist on first load. Discards legacy format profiles. */
  function ensureDefaults(
    fallbackColumns: DeckColumn[],
    fallbackLayout: string[][],
  ) {
    // Load from localStorage into reactive state
    profilesData.value = loadProfilesFromStorage()
    const profiles = profilesData.value

    // Fix blank names
    let needsSave = false
    for (const [i, profile] of profiles.entries()) {
      if (!profile.name || profile.name.trim() === '') {
        profile.name = `プロファイル ${i + 1}`
        needsSave = true
      }
    }
    if (needsSave) saveProfiles(profiles)

    if (profiles.length === 0) {
      const profile: DeckProfile = {
        id: settingsFs.profileFilename('プロファイル 1'),
        name: 'プロファイル 1',
        columns: deepClone(fallbackColumns),
        layout: deepClone(fallbackLayout),
        createdAt: Date.now(),
      }
      profiles.push(profile)
      saveProfiles(profiles)
      saveActiveProfileId(profile.id)
    } else {
      loadActiveProfileId()
      const first = profiles[0]
      if (first && !profiles.find((p) => p.id === activeProfileId.value)) {
        saveActiveProfileId(first.id)
      }
    }

    // Kick off async file sync in background (Tauri only)
    if (settingsFs.isTauri) {
      initFileStorage().catch((e) =>
        console.warn('[deckProfile] file storage init failed:', e),
      )
    } else {
      initialized.value = true
      flushConsoleMigrationNotice()
    }
  }

  async function initFileStorage(): Promise<void> {
    const fileProfiles = await loadProfilesFromFiles()

    if (fileProfiles.length > 0) {
      // Merge: file profiles are authoritative, but keep in-memory-only
      // profiles that were created before file I/O completed.
      const fileIds = new Set(fileProfiles.map((p) => p.id))
      const memOnly = profilesData.value.filter((p) => !fileIds.has(p.id))
      const merged = [...fileProfiles, ...memOnly]
      profilesData.value = merged
      setStorageJson(STORAGE_KEYS.deckProfiles, merged)
      profileVersion.value++
    }
    initialized.value = true
    flushConsoleMigrationNotice()

    // Rewrite files with migrated content so the next load is clean
    if (pendingConsoleMigrationFilesDirty || pendingWidgetExtractionDirty) {
      pendingConsoleMigrationFilesDirty = false
      pendingWidgetExtractionDirty = false
      persistProfilesToFiles(profilesData.value).catch((e) =>
        console.warn('[deckProfile] migration rewrite failed:', e),
      )
    }
  }

  /** Show a one-shot toast summarising dropped legacy Console widgets.
   *  Called after all load sources have reported their counts. */
  function flushConsoleMigrationNotice() {
    if (pendingConsoleMigrationCount === 0) return
    const count = pendingConsoleMigrationCount
    pendingConsoleMigrationCount = 0
    pendingConsoleMigrationFilesDirty = true
    import('@/stores/toast')
      .then(({ useToast }) => {
        useToast().show(
          `旧 AiScript Console widget を ${count} 件削除しました。コードは失われています (スクラッチパッドカラムで同等の機能が使えます)。`,
          'info',
        )
      })
      .catch(() => {
        /* toast unavailable — skip */
      })
  }

  return {
    // Reactive state
    activeProfileId,
    windowProfileId,
    profileVersion,
    currentProfileName,
    initialized,
    columns,
    layout,
    currentProfile,
    // Mutation
    mutateProfile,
    setColumns,
    setLayout,
    setColumnsAndLayout,
    // Persistence
    flushPersist,
    schedulePersist,
    startSync,
    stopSync,
    // Profile CRUD
    syncColumnsToProfile,
    saveAsProfile,
    createEmptyProfile,
    getProfiles,
    applyProfile,
    deleteProfile,
    renameProfile,
    initWindowProfile,
    switchProfile,
    ensureDefaults,
    // Window layout
    saveWindowLayout,
    removeWindowLayout,
    getWindowLayouts,
    // Legacy compat
    saveActiveProfileId,
    loadActiveProfileId,
    saveProfiles,
  }
})
