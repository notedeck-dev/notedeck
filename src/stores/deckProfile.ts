import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { i18n } from '@/i18n'
import { migrateWidgetColumns } from '@/services/deckProfileCodec'
import {
  createProfileFiles,
  drainProfileLoadByproducts,
} from '@/services/deckProfileFiles'
import { migrateSearchColumns } from '@/services/searchFilter'
import { registerSettingsFileHandler } from '@/services/settingsFileSync'
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
import { notifyWarningToast } from '@/utils/toastNotify'

const profileFiles = createProfileFiles(notifyWarningToast)

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
/** 検索カラムの絞り込みを旧属性から移したので、古い形を残さず書き戻す (#1180) */
let pendingSearchMigrationDirty = false

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
   * ブラウザ dev モード (Tauri 外) だけの永続化。Tauri ではファイルが唯一の正で、
   * localStorage には書かない (#1042。ウィンドウ間の追随は変更通知で行う)
   */
  function saveProfilesMirror() {
    if (settingsFs.isTauri) return
    setStorageJson(STORAGE_KEYS.deckProfiles, profilesData.value)
  }

  /** プロファイル 1 件をファイルへ反映する (ready 待ち)。 */
  function persistProfileToFile(profileId: string) {
    if (!settingsFs.isTauri) return
    void ready
      .then(async () => {
        // 直近の状態を参照する (別ウィンドウの変更通知でオブジェクトが入れ替わる)
        const live = profilesData.value.find((p) => p.id === profileId)
        if (!live) return // 既に削除された
        await profileFiles.persistItem(live, profilesData.value)
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
      saveProfilesMirror()
      const profile = currentProfile.value
      // Async: write changed profile to file (他ウィンドウへの通知は書込側が流す)
      if (profile) persistProfileToFile(profile.id)
    } catch (e) {
      console.warn('[deckProfile] failed to persist:', e)
    }
  }

  // --- Cross-window sync ---

  // 別の書き手 (他のウィンドウ / notecore の復元, #1042) がプロファイルのファイルを
  // 書いた → その 1 件だけ写しを揃える。rename は「新名の write → 旧名の delete」で
  // 届くので、write で個体を新名へ移した後の delete は何にも当たらない。
  // 履歴ファイルは写しを持たないので無視する
  registerSettingsFileHandler('profiles', async (change) => {
    if (!change.name.endsWith(settingsFs.PROFILE_EXT)) return
    await ready
    const fileBase = change.name.slice(0, -settingsFs.PROFILE_EXT.length)
    if (change.op === 'delete') {
      const removed = profilesData.value.find((p) => p.fileBase === fileBase)
      if (!removed) return
      profilesData.value = profilesData.value.filter((p) => p !== removed)
    } else {
      const next = await profileFiles.loadOne(change.name)
      // widget 抽出などの副産物は書いた側が処理済み。ここでは捨てる
      drainProfileLoadByproducts()
      if (!next) return
      const prev = profilesData.value.find(
        (p) => p.id === next.id || p.fileBase === fileBase,
      )
      profilesData.value = prev
        ? profilesData.value.map((p) => (p === prev ? next : p))
        : [...profilesData.value, next]
    }
    profileVersion.value++
    // アクティブは localStorage 経由で全ウィンドウ共有なので読み直す
    loadActiveProfileId()
    if (
      windowProfileId.value &&
      !profilesData.value.some((p) => p.id === windowProfileId.value)
    ) {
      windowProfileId.value = activeProfileId.value
    }
    refreshProfileName()
  })

  // --- Internal helpers ---

  /** Update currentProfileName from current windowProfileId. */
  function refreshProfileName() {
    currentProfileName.value = currentProfile.value?.name ?? null
  }

  /** ブラウザ dev モード (Tauri 外) の読込。Tauri ではファイルから読む (preloadFiles)。 */
  function loadProfilesFromStorage(): DeckProfile[] {
    const raw = getStorageJson<DeckProfile[]>(STORAGE_KEYS.deckProfiles, [])
    // 同じ ID が並んでいたら先勝ちで 1 件にする (ファイル読込と同じ規則)
    const seen = new Set<string>()
    return raw
      .filter((p) => {
        if (seen.has(p.id)) return false
        seen.add(p.id)
        return true
      })
      .map((p) => {
        const {
          columns: widgetMigrated,
          droppedConsoleCount,
          extractedWidgets,
          sidebarSeed,
        } = migrateWidgetColumns(p.columns ?? [])
        pendingConsoleMigrationCount += droppedConsoleCount
        pushExtractedWidgets(extractedWidgets, sidebarSeed)
        const { columns, migrated } = migrateSearchColumns(widgetMigrated)
        if (migrated > 0) pendingSearchMigrationDirty = true
        return { ...p, columns }
      })
  }

  /** Persist profiles: write profilesData to files (他ウィンドウへの通知は書込側が流す)。 */
  function saveProfiles(profiles: DeckProfile[]) {
    profilesData.value = profiles
    saveProfilesMirror()
    profileVersion.value++
    persistAllProfilesToFiles()
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
      const candidate = i18n.tsx._deckProfile.defaultName({ n: i })
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
    saveProfilesMirror()
    profileVersion.value++
    persistProfileToFile(profileId)
  }

  function switchProfile(
    newProfileId: string,
  ): { columns: DeckColumn[]; layout: string[][] } | null {
    const profiles = profilesData.value
    const newProfile = profiles.find((p) => p.id === newProfileId)
    if (!newProfile) return null

    saveProfilesMirror()
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
    const profiles = profilesData.value.filter((p) => p.id !== profileId)
    profilesData.value = profiles
    saveProfilesMirror()
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
    saveProfilesMirror()
    profileVersion.value++
    refreshProfileName()

    if (!settingsFs.isTauri) return
    // rename の完了を待ってから保存する (並行発火の順序バグ根絶 #913)
    void ready
      .then(async () => {
        const live = profilesData.value.find((p) => p.id === profileId)
        if (!live) return // 既に削除された
        await profileFiles.renameItemFiles(live, profilesData.value)
        await profileFiles.persistItem(live, profilesData.value)
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

  /**
   * ファイルからプロファイルを読む (Tauri のみ)。Vue の初回描画前に main.ts が待つ
   * ので、デッキは最初からファイルの内容で描かれる (#1042 — localStorage の
   * ミラーで即時復元していたのをやめた)。移行や書き戻しは ensureDefaults 後の
   * initFileStorage が行う
   */
  async function preloadFiles(): Promise<void> {
    if (!settingsFs.isTauri) return
    try {
      const { items } = await profileFiles.loadAll()
      const byproducts = drainProfileLoadByproducts()
      pendingConsoleMigrationCount += byproducts.droppedConsoleCount
      if (byproducts.migratedSearchColumns > 0) {
        pendingSearchMigrationDirty = true
      }
      pushExtractedWidgets(byproducts.extractedWidgets, byproducts.sidebarSeed)
      profilesData.value = items
    } catch (e) {
      console.warn('[deckProfile] failed to load profile files:', e)
    }
  }

  /** Ensure profiles exist on first load. Discards legacy format profiles. */
  function ensureDefaults(
    fallbackColumns: DeckColumn[],
    fallbackLayout: string[][],
  ) {
    // Tauri はファイルから読み終えている (preloadFiles)。ブラウザ dev モードは
    // localStorage から
    if (!settingsFs.isTauri) profilesData.value = loadProfilesFromStorage()
    const profiles = profilesData.value

    // Fix blank names
    let needsSave = false
    for (const [i, profile] of profiles.entries()) {
      if (!profile.name || profile.name.trim() === '') {
        profile.name = i18n.tsx._deckProfile.defaultName({ n: i + 1 })
        needsSave = true
      }
    }
    if (needsSave) saveProfiles(profiles)

    if (profiles.length === 0) {
      const name = i18n.tsx._deckProfile.defaultName({ n: 1 })
      const profile: DeckProfile = {
        id: generateProfileId(name),
        name,
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
    // マイグレーション (#913) はメインウィンドウのみが実行する。冪等
    if (settingsFs.isMainDeckWindow()) {
      // 規約外名の copy-adopt 正規化。凍結済み ID (= 旧完全ファイル名) は
      // 不変なので、activeProfileId / `?profile=` はファイル名が変わっても
      // 無追随で整合する
      await profileFiles.migrateItems(profilesData.value)
    }
    // このウィンドウの表示対象 (`?profile=`) が無ければアクティブへ退避する
    if (
      windowProfileId.value &&
      !profilesData.value.some((p) => p.id === windowProfileId.value)
    ) {
      windowProfileId.value = activeProfileId.value
      refreshProfileName()
    }

    initialized.value = true
    flushConsoleMigrationNotice()

    // Rewrite files with migrated content so the next load is clean
    if (
      pendingConsoleMigrationFilesDirty ||
      pendingWidgetExtractionDirty ||
      pendingSearchMigrationDirty
    ) {
      pendingConsoleMigrationFilesDirty = false
      pendingWidgetExtractionDirty = false
      pendingSearchMigrationDirty = false
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
          i18n.tsx._deckProfile.consoleWidgetsRemoved_plural({ count }),
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
    preloadFiles,
    flushPersist,
    schedulePersist,
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
