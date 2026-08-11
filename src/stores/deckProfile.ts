import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { migrateWidgetColumns } from '@/services/deckProfileCodec'
import {
  drainProfileLoadByproducts,
  profileFiles,
} from '@/services/deckProfileFiles'
import {
  casefold,
  resolveAvailable,
  slugifyName,
} from '@/services/settingsSlug'
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

export const useDeckProfileStore = defineStore('deckProfile', () => {
  const activeProfileId = ref<string | null>(null)
  /** Per-window profile ID (set via ?profile= query). Isolates this window from deck:sync. */
  const windowProfileId = ref<string | null>(null)
  /** Bumped on every persist to make profile-derived computeds reactive */
  const profileVersion = ref(0)
  /** Whether file-based storage has been initialized */
  const initialized = ref(false)

  // 変更系操作 (作成・リネーム・保存・削除) のファイル反映は
  // 「初回読込 (対応表確定) + 初回移行」の完了を待つゲート (#913)
  let resolveReady: (() => void) | undefined
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

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

  /**
   * 保存・削除の直前にミラーの対応表 (fileBase) を読み直す (#913)。
   * 自分のミラー書込が別ウィンドウのリネーム結果を潰す前に、必ず先に
   * 取り込む (stale なファイル名での書込・削除の空振り防止)。
   */
  function adoptMirrorFileBases(profiles: readonly DeckProfile[]) {
    const mirror = getStorageJson<DeckProfile[]>(STORAGE_KEYS.deckProfiles, [])
    const byId = new Map(mirror.map((p) => [p.id, p.fileBase]))
    for (const p of profiles) {
      const fileBase = byId.get(p.id)
      if (fileBase) p.fileBase = fileBase
    }
  }

  /** ミラーへ書く直前に対応表を読み直して合流させてから書く。 */
  function writeProfilesMirror() {
    if (settingsFs.isTauri) adoptMirrorFileBases(profilesData.value)
    setStorageJson(STORAGE_KEYS.deckProfiles, profilesData.value)
  }

  /** プロファイル 1 件をファイルへ反映する (ready 待ち + 対応表のミラー反映)。 */
  function persistProfileToFile(profileId: string) {
    if (!settingsFs.isTauri) return
    void ready
      .then(async () => {
        // 直近の状態を参照する (初期化中のマージでオブジェクトが入れ替わる)
        const live = profilesData.value.find((p) => p.id === profileId)
        if (!live) return // 既に削除された
        adoptMirrorFileBases([live])
        await profileFiles.persistItem(live, profilesData.value)
        setStorageJson(STORAGE_KEYS.deckProfiles, profilesData.value)
        profileVersion.value++
      })
      .catch((e) => console.warn('[deckProfile] failed to persist profile:', e))
  }

  /** 全プロファイルをファイルへ反映する (ready 待ち)。 */
  function persistAllProfilesToFiles() {
    if (!settingsFs.isTauri) return
    void ready
      .then(async () => {
        for (const p of profilesData.value) {
          await profileFiles.persistItem(p, profilesData.value)
        }
        setStorageJson(STORAGE_KEYS.deckProfiles, profilesData.value)
        profileVersion.value++
      })
      .catch((e) =>
        console.warn('[deckProfile] failed to persist to files:', e),
      )
  }

  const { schedule: schedulePersist, cancel: cancelPersist } =
    createDebouncedPersist(persistNow)

  /** debounce を待たず即時書き込み (ペンディングは破棄) */
  function flushPersist() {
    cancelPersist()
    persistNow()
  }

  function persistNow() {
    try {
      // Sync: localStorage + bump version
      writeProfilesMirror()
      const profile = currentProfile.value
      // Async: write changed profile to file
      if (profile) persistProfileToFile(profile.id)
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
    writeProfilesMirror()
    profileVersion.value++
    persistAllProfilesToFiles()
    // Notify all windows that the profile list changed
    emitTauri('deck:profiles-changed').catch(() => {
      // Not running in Tauri (browser dev mode)
    })
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

  /**
   * 新規プロファイルの ID を slug 形式で生成する (#913: ファイル名由来をやめる)。
   * ファイル basename は persistItem が対応表・実列挙に対して別途解決するため、
   * ここでは種別内 ID の一意性のみ見る。
   */
  function generateProfileId(name: string): string {
    const taken = new Set(profilesData.value.map((p) => casefold(p.id)))
    return resolveAvailable(slugifyName(name, 'profile'), (c) =>
      taken.has(casefold(c)),
    )
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
    writeProfilesMirror()
    profileVersion.value++
    persistProfileToFile(profileId)
  }

  function switchProfile(
    newProfileId: string,
  ): { columns: DeckColumn[]; layout: string[][] } | null {
    const profiles = profilesData.value
    const newProfile = profiles.find((p) => p.id === newProfileId)
    if (!newProfile) return null

    // Single localStorage write
    writeProfilesMirror()
    profileVersion.value++

    const oldProfileId = windowProfileId.value

    windowProfileId.value = newProfileId
    saveActiveProfileId(newProfileId)
    refreshProfileName()

    // Async: persist only changed profiles
    if (oldProfileId && oldProfileId !== newProfileId) {
      persistProfileToFile(oldProfileId)
    }
    persistProfileToFile(newProfileId)

    return {
      columns: newProfile.columns,
      layout: newProfile.layout,
    }
  }

  function saveAsProfile(name?: string): DeckProfile {
    const profiles = profilesData.value
    const autoName = name || nextProfileName(profiles)

    const profile: DeckProfile = {
      id: generateProfileId(autoName),
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
      id: generateProfileId(autoName),
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

  /** プロファイルを削除する。undo トースト用に復元関数を返す */
  function deleteProfile(profileId: string): (() => void) | undefined {
    const removedIndex = profilesData.value.findIndex((p) => p.id === profileId)
    const removed = profilesData.value[removedIndex]
    // 削除対象の対応表 (fileBase) は、ミラーを絞り込みで上書きする前に読み直す
    // (別ウィンドウのリネーム後の削除が stale 名で空振りしないように #913)
    if (removed && settingsFs.isTauri) adoptMirrorFileBases([removed])
    const profiles = profilesData.value.filter((p) => p.id !== profileId)
    profilesData.value = profiles
    writeProfilesMirror()
    profileVersion.value++

    if (activeProfileId.value === profileId) {
      saveActiveProfileId(profiles[0]?.id ?? null)
    }

    if (removed && settingsFs.isTauri) {
      void ready
        .then(() => profileFiles.deleteItemFiles(removed))
        .catch((e) => console.warn('[deckProfile] failed to delete file:', e))
    }

    if (!removed) return undefined
    return () => {
      if (profilesData.value.some((p) => p.id === profileId)) return
      const restored = [...profilesData.value]
      restored.splice(Math.min(removedIndex, restored.length), 0, removed)
      // saveProfiles が localStorage + ファイル書き戻し + 他ウィンドウ通知まで行う
      saveProfiles(restored)
    }
  }

  /**
   * 表示名を変更する (#913: ID 不変。activeProfileId / windowProfileId /
   * `?profile=` の追随は不要)。ファイルは rename コマンドで追随させる
   * (旧削除 + 新書込の並行発火は旧ファイルを孤児化させるため禁止)。
   */
  function renameProfile(profileId: string, newName: string) {
    const profile = profilesData.value.find((p) => p.id === profileId)
    if (!profile) return

    profile.name = newName
    writeProfilesMirror()
    profileVersion.value++
    refreshProfileName()
    emitTauri('deck:profiles-changed').catch(() => {
      // Not running in Tauri (browser dev mode)
    })

    if (!settingsFs.isTauri) return
    // rename の完了を待ってから保存する (並行発火の順序バグ根絶 #913)
    void ready
      .then(async () => {
        const live = profilesData.value.find((p) => p.id === profileId)
        if (!live) return // 既に削除された
        adoptMirrorFileBases([live])
        await profileFiles.renameItemFiles(live, profilesData.value)
        await profileFiles.persistItem(live, profilesData.value)
        setStorageJson(STORAGE_KEYS.deckProfiles, profilesData.value)
        profileVersion.value++
      })
      .catch((e) => console.warn('[deckProfile] failed to rename file:', e))
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
        id: generateProfileId('プロファイル 1'),
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
      initFileStorage()
        .catch((e) =>
          console.warn('[deckProfile] file storage init failed:', e),
        )
        .finally(() => resolveReady?.())
    } else {
      initialized.value = true
      flushConsoleMigrationNotice()
      resolveReady?.()
    }
  }

  async function initFileStorage(): Promise<void> {
    const { items: fileProfiles } = await profileFiles.loadAll()
    const byproducts = drainProfileLoadByproducts()
    pendingConsoleMigrationCount += byproducts.droppedConsoleCount
    pushExtractedWidgets(byproducts.extractedWidgets, byproducts.sidebarSeed)

    // Merge: file profiles are authoritative, but keep in-memory-only
    // profiles that were created before file I/O completed.
    // 同定は「ID 一致 or 名前 + 作成日時一致」(#913 決定録 — ダウングレード
    // 往復でファイル内 ID が剥がれた場合の複製緩和)
    const memOnly = profilesData.value.filter(
      (p) =>
        !fileProfiles.some(
          (f) =>
            f.id === p.id || (f.name === p.name && f.createdAt === p.createdAt),
        ),
    )
    if (fileProfiles.length > 0) {
      profilesData.value = [...fileProfiles, ...memOnly]
      profileVersion.value++
      refreshProfileName()
    }

    // マイグレーション (#913) はメインウィンドウのみが実行する。冪等
    if (settingsFs.isMainDeckWindow()) {
      // (a) 規約外名の copy-adopt 正規化。凍結済み ID (= 旧完全ファイル名) は
      //     不変なので、activeProfileId / `?profile=` はファイル名が変わっても
      //     無追随で整合する
      await profileFiles.migrateItems(profilesData.value)
      // (b) ミラーに在りファイル不在 → 新 slug 名で再作成
      //     (localStorage → ファイルの旧片方向移行もこの経路に統合)
      for (const p of memOnly) {
        p.fileBase = undefined // ミラー由来の旧 fileBase は無効 (ファイル不在)
        await profileFiles
          .persistItem(p, profilesData.value)
          .catch((e) =>
            console.warn(
              '[deckProfile] failed to persist mirror-only profile:',
              e,
            ),
          )
      }
      // マージでミラー複製が落ちた場合のアクティブ参照の修復
      if (
        activeProfileId.value &&
        !profilesData.value.some((p) => p.id === activeProfileId.value)
      ) {
        saveActiveProfileId(profilesData.value[0]?.id ?? null)
      }
    }
    // このウィンドウの表示対象がマージで消えた場合はアクティブへ退避する
    if (
      windowProfileId.value &&
      !profilesData.value.some((p) => p.id === windowProfileId.value)
    ) {
      windowProfileId.value = activeProfileId.value
      refreshProfileName()
    }
    // fileBase 割当 (対応表) をミラーへ同乗させる
    setStorageJson(STORAGE_KEYS.deckProfiles, profilesData.value)

    initialized.value = true
    flushConsoleMigrationNotice()

    // Rewrite files with migrated content so the next load is clean
    if (pendingConsoleMigrationFilesDirty || pendingWidgetExtractionDirty) {
      pendingConsoleMigrationFilesDirty = false
      pendingWidgetExtractionDirty = false
      persistAllProfilesToFiles()
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
