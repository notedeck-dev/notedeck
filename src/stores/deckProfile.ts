import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import { i18n } from '@/i18n'
import { rebindColumns } from '@/services/accountRebind'
import { migrateWidgetColumns } from '@/services/deckProfileCodec'
import {
  createProfileFiles,
  drainProfileLoadByproducts,
  serializeProfileConfig,
} from '@/services/deckProfileFiles'
import {
  allocateStateFileName,
  DECK_STATE_EXT,
  type DeckProfileState,
  isEmptyState,
  mergeProfileState,
  parseDeckProfileState,
  serializeDeckProfileState,
  splitProfile,
} from '@/services/deckProfileState'
import type { WidgetItem } from '@/services/distributableCodecs/widgetCodec'
import { migrateSearchColumns } from '@/services/searchFilter'
import { registerSettingsFileHandler } from '@/services/settingsFileSync'
import {
  casefold,
  resolveAvailable,
  slugifyName,
} from '@/services/settingsSlug'
import type { WidgetPlacement } from '@/services/widgetPlacement'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn, DeckProfile, DeckWindowLayout } from '@/stores/deck'
import { useWidgetsStore } from '@/stores/widgets'
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
import { isRepresentativeNow } from '@/windows/roles'

const profileFiles = createProfileFiles(notifyWarningToast)

// --- この機械の状態 `state/deck/<id>.json5` (#1333 §3) ---
//
// 窓の配置 (`windows[]`) とカラムの一時入力 (`windowId` / `aiCurrentSessionId` /
// `query` / `mfmText` / `aiscriptCode` / `aiInitialInput`) は設定 (profiles/) と
// 別のファイルに置く。メモリ上のプロファイルは両方を重ねた形で、保存は変わった側
// だけ書く (窓を動かすたびに設定側を書かない)

/** 状態ファイル名 → プロファイル id */
const stateFiles = new Map<string, string>()
/** 最後に書いた (読んだ) 本文。同じなら書かない */
const lastWritten = new Map<string, { config: string; state: string }>()

function noteWritten(id: string, part: 'config' | 'state', text: string) {
  const prev = lastWritten.get(id) ?? { config: '', state: '' }
  lastWritten.set(id, { ...prev, [part]: text })
}

function stateFileNameOf(id: string): string | undefined {
  for (const [name, owner] of stateFiles) if (owner === id) return name
  return undefined
}

/** state/deck/ を全部読む (id → 状態)。同じ id は先勝ち */
async function loadStateFiles(): Promise<Map<string, DeckProfileState>> {
  const byId = new Map<string, DeckProfileState>()
  stateFiles.clear()
  const names = (await settingsFs.listDeckStateFiles())
    .filter((n) => n.endsWith(DECK_STATE_EXT))
    .sort()
  for (const name of names) {
    try {
      const text = await settingsFs.readDeckState(name)
      const st = parseDeckProfileState(text)
      if (!st) continue
      if (byId.has(st.id)) {
        console.warn(
          `[deckProfile] duplicate state for "${st.id}" in ${name} — skipped`,
        )
        continue
      }
      byId.set(st.id, st)
      stateFiles.set(name, st.id)
      noteWritten(st.id, 'state', text)
    } catch (e) {
      console.warn(`[deckProfile] failed to read ${name}:`, e)
    }
  }
  return byId
}

async function readStateFor(id: string): Promise<DeckProfileState | undefined> {
  const name = stateFileNameOf(id)
  if (!name) return undefined
  try {
    return (
      parseDeckProfileState(await settingsFs.readDeckState(name)) ?? undefined
    )
  } catch {
    return undefined
  }
}

/** 設定側が変わっていれば profiles/ へ書く */
async function persistConfigIfChanged(
  live: DeckProfile,
  all: readonly DeckProfile[],
): Promise<void> {
  // 保存時は accountId と portable な account (user@host) の両方を書く (#1332)
  const filled = rebindColumns(live.columns, useAccountsStore().accounts)
  if (filled.changed) live.columns = filled.columns
  const text = serializeProfileConfig(live)
  if (lastWritten.get(live.id)?.config === text) return
  await profileFiles.persistItem(live, all)
  noteWritten(live.id, 'config', text)
}

/** 状態側が変わっていれば state/deck/ へ書く (空なら消す) */
async function persistStateIfChanged(live: DeckProfile): Promise<void> {
  const { state } = splitProfile(live)
  const text = isEmptyState(state) ? '' : serializeDeckProfileState(state)
  if (lastWritten.get(live.id)?.state === text) return
  const name = allocateStateFileName(live.id, stateFiles)
  if (text === '') {
    if (stateFiles.has(name)) {
      await settingsFs.deleteDeckState(name)
      stateFiles.delete(name)
    }
  } else {
    await settingsFs.writeDeckState(name, text)
    stateFiles.set(name, live.id)
  }
  noteWritten(live.id, 'state', text)
}

async function deleteStateFor(id: string): Promise<void> {
  const name = stateFileNameOf(id)
  lastWritten.delete(id)
  if (!name) return
  stateFiles.delete(name)
  await settingsFs.deleteDeckState(name)
}

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
function pushExtractedWidgets(
  extracted: WidgetItem[],
  sidebarSeed: WidgetPlacement[],
) {
  if (extracted.length === 0 && sidebarSeed.length === 0) return
  pendingWidgetExtractionDirty = true
  const store = useWidgetsStore()
  store.ensureLoaded()
  for (const w of extracted) {
    if (store.get(w.id)) continue
    // 旧 widget.id をそのまま installId に使う (Mk:save キーを保全する最重要不変条件)
    const { createdAt: _c, updatedAt: _u, ...input } = w
    void store.add(input)
  }
  for (const placement of sidebarSeed) {
    store.addToSidebar(placement)
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

  // 起動時の読み込みに失敗したセッションは、プロファイルのファイルに一切書かない。
  // 読めていない状態で既定のプロファイルを書くと、既存と同じ ID のファイルが
  // 起動のたびに 1 つずつ増えていた (ID の重複で読み込みが落ちていた v1.83.0 前)
  let fileLoadFailed = false

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

  // columns / layout はその場で書き換えられる (push / splice)。同じ配列参照を
  // 返すと Vue の computed は「変化なし」として下流 (columnMap / windowLayout) を
  // 再計算しないので、版ごとに浅いコピーを返す (v1.81.0 の退行)

  /** Columns of the current profile (reactive, read-only from outside). */
  const columns = computed<DeckColumn[]>(() => {
    void profileVersion.value
    return [...(currentProfile.value?.columns ?? [])]
  })

  /** Layout of the current profile (reactive, read-only from outside). */
  const layout = computed<string[][]>(() => {
    void profileVersion.value
    return [...(currentProfile.value?.layout ?? [])]
  })

  /**
   * プロファイルを新しいオブジェクトに作り直して読み手へ知らせる。カラムの設定は
   * その場で書き換える (updateColumn の Object.assign 等) ので、オブジェクトが
   * 同じままだと props で受けたカラムが再描画されない。#1042 以前は自分が流した
   * 同期イベントで localStorage から読み直しており、それが同じ効果を持っていた
   */
  function refreshProfiles() {
    // JSON の往復 (以前の localStorage 経由と同じ)。reactive な値が混ざっていても
    // 通る (structuredClone は Proxy で落ちる)
    profilesData.value = JSON.parse(
      JSON.stringify(profilesData.value),
    ) as DeckProfile[]
    profileVersion.value++
    refreshProfileName()
  }

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
    if (!settingsFs.isTauri || fileLoadFailed) return
    void ready
      .then(async () => {
        // 直近の状態を参照する (別ウィンドウの変更通知でオブジェクトが入れ替わる)
        const live = profilesData.value.find((p) => p.id === profileId)
        if (!live) return // 既に削除された
        await persistConfigIfChanged(live, profilesData.value)
        await persistStateIfChanged(live)
        profileVersion.value++
      })
      .catch((e) => console.warn('[deckProfile] failed to persist profile:', e))
  }

  /** 全プロファイルをファイルへ反映する (ready 待ち)。 */
  function persistAllProfilesToFiles() {
    if (!settingsFs.isTauri || fileLoadFailed) return
    void ready
      .then(async () => {
        for (const p of profilesData.value) {
          await persistConfigIfChanged(p, profilesData.value)
          await persistStateIfChanged(p)
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
      refreshProfiles()
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
      const loaded = await profileFiles.loadOne(change.name)
      // widget 抽出などの副産物は書いた側が処理済み。ここでは捨てる
      drainProfileLoadByproducts()
      if (!loaded) return
      const prev = profilesData.value.find(
        (p) => p.id === loaded.id || p.fileBase === fileBase,
      )
      // 設定側だけが届いたので、この機械の状態 (窓の配置 / 一時入力) を重ね直す。
      // 状態ファイルが無ければ今の写しの状態を保つ
      noteWritten(loaded.id, 'config', serializeProfileConfig(loaded))
      const state =
        (await readStateFor(loaded.id)) ??
        (prev ? splitProfile(prev).state : undefined)
      const next = mergeProfileState(loaded, state)
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

  // 別のウィンドウが状態 (窓の配置 / 一時入力) を書いた → 該当プロファイルに重ね直す
  registerSettingsFileHandler('deck-state', async (change) => {
    if (!change.name.endsWith(DECK_STATE_EXT)) return
    await ready
    if (change.op === 'delete') {
      stateFiles.delete(change.name)
      return
    }
    let text: string
    try {
      text = await settingsFs.readDeckState(change.name)
    } catch (e) {
      console.warn('[deckProfile] failed to read the deck state:', e)
      return
    }
    const state = parseDeckProfileState(text)
    if (!state) return
    stateFiles.set(change.name, state.id)
    noteWritten(state.id, 'state', text)
    const prev = profilesData.value.find((p) => p.id === state.id)
    if (!prev) return
    const next = mergeProfileState(splitProfile(prev).config, state)
    profilesData.value = profilesData.value.map((p) => (p === prev ? next : p))
    profileVersion.value++
  })

  // --- アカウントの再結合 (#1332) ---
  //
  // 別の機械から持ち込んだプロファイルのカラムは accountId (機械ごとの UUID) が
  // この機械に無い。`account: user@host` が一致するアカウントに付け替える。
  // 一致が無い列は「アカウント未接続」のまま残し、ログインで一致したら結ぶ
  const accountsStore = useAccountsStore()
  async function rebindAccounts(): Promise<void> {
    if (!accountsStore.isLoaded || !initialized.value) return
    const accounts = accountsStore.accounts
    let touched = false
    const changedIds: string[] = []
    profilesData.value = profilesData.value.map((p) => {
      const r = rebindColumns(p.columns, accounts)
      if (!r.changed) return p
      touched = true
      changedIds.push(p.id)
      return { ...p, columns: r.columns }
    })
    if (!touched) return
    profileVersion.value++
    // ファイルへの書戻しは代表窓だけ (他の窓は写しだけ揃える)
    if (
      settingsFs.isTauri &&
      !fileLoadFailed &&
      (await isRepresentativeNow())
    ) {
      for (const id of changedIds) persistProfileToFile(id)
    }
  }
  watch(
    () =>
      `${accountsStore.isLoaded}:${initialized.value}:${accountsStore.accounts
        .map((a) => a.id)
        .join(',')}`,
    () => {
      void rebindAccounts()
    },
  )

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
          migratedWidgetRefs,
        } = migrateWidgetColumns(p.columns ?? [])
        pendingConsoleMigrationCount += droppedConsoleCount
        if (migratedWidgetRefs > 0) pendingWidgetExtractionDirty = true
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

    if (removed && settingsFs.isTauri && !fileLoadFailed) {
      void ready
        .then(async () => {
          await profileFiles.deleteItemFiles(removed)
          await deleteStateFor(removed.id)
        })
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

    if (!settingsFs.isTauri || fileLoadFailed) return
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
      const { items: loaded } = await profileFiles.loadAll()
      const states = await loadStateFiles()
      // 状態ファイルがあれば重ねる (設定側に残った旧形の一時入力より優先)。
      // 設定側の本文を覚えておき、変わっていなければ書き直さない
      const items = loaded.map((item) => {
        noteWritten(item.id, 'config', serializeProfileConfig(item))
        return mergeProfileState(
          states.has(item.id) ? splitProfile(item).config : item,
          states.get(item.id),
        )
      })
      const byproducts = drainProfileLoadByproducts()
      pendingConsoleMigrationCount += byproducts.droppedConsoleCount
      if (byproducts.migratedSearchColumns > 0) {
        pendingSearchMigrationDirty = true
      }
      if (byproducts.migratedWidgetRefs > 0) {
        pendingWidgetExtractionDirty = true
      }
      pushExtractedWidgets(byproducts.extractedWidgets, byproducts.sidebarSeed)
      profilesData.value = items
    } catch (e) {
      console.warn('[deckProfile] failed to load profile files:', e)
      fileLoadFailed = true
      notifyWarningToast(i18n.ts._deckProfile.loadFailed)
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
      // 読めなかったときは仮の表示なので、次回の起動のアクティブを上書きしない
      if (fileLoadFailed) activeProfileId.value = profile.id
      else saveActiveProfileId(profile.id)
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
    // マイグレーション (#913) は代表窓だけが実行する (#1131)。冪等
    if (!fileLoadFailed && (await isRepresentativeNow())) {
      // 規約外名の copy-adopt 正規化。凍結済み ID (= 旧完全ファイル名) は
      // 不変なので、activeProfileId / `?profile=` はファイル名が変わっても
      // 無追随で整合する
      await profileFiles.migrateItems(profilesData.value)
      // 旧形 (状態が設定側に同居) を分ける / 持ち主の無い状態ファイルを消す (#1333 §3)
      await splitInlineStateAndSweep()
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
    void rebindAccounts()

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

  async function splitInlineStateAndSweep(): Promise<void> {
    try {
      for (const p of profilesData.value) {
        if (isEmptyState(splitProfile(p).state) || stateFileNameOf(p.id))
          continue
        await persistStateIfChanged(p)
        await persistConfigIfChanged(p, profilesData.value)
      }
      const ids = new Set(profilesData.value.map((p) => p.id))
      for (const [name, id] of [...stateFiles]) {
        if (ids.has(id)) continue
        stateFiles.delete(name)
        await settingsFs.deleteDeckState(name)
      }
    } catch (e) {
      console.warn('[deckProfile] failed to split the deck state:', e)
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
