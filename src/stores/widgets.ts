import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { registerSettingsFileHandler } from '@/services/settingsFileSync'
import {
  createSidecarCollection,
  META_SUFFIX,
  type SidecarItemFile,
} from '@/services/sidecarFileCollection'
import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import { type EditAttribution, pushSnapshot } from '@/utils/historyFs'
import * as settingsFs from '@/utils/settingsFs'
import {
  getStorageByPrefix,
  getStorageJson,
  removeStorageByPrefix,
  STORAGE_KEYS,
  setStorageJson,
  setStorageString,
} from '@/utils/storage'
import { notifyWarningToast } from '@/utils/toastNotify'

export interface WidgetMeta extends SidecarItemFile {
  installId: string
  name: string
  src: string
  autoRun: boolean
  storeId?: string
  /** インストール/更新時に照合済みの配布ソース SHA-512 (#913。更新検知 #1040 の baseline) */
  storeSha512?: string
  /** インストール/更新時の registry バージョン (#913) */
  storeVersion?: string
  createdAt: number
  updatedAt: number
  /** 個別アイコン URL (MisStore registry の iconUrl 互換) */
  iconUrl?: string
  /**
   * 実行アカウントの安定キー (`accountScopeKey`、#1018 / #1061)。全アカウントの
   * カラムに置いたウィジェットは、カラムからアカウントを決められないので
   * インストール時に選んだものをここに持つ。同じ storeId でもキーが違えば
   * 別個体 (Mk:save 領域が個体単位なので本体を共有しない)。
   * per-account カラムのウィジェットは未設定 — カラムの accountId で動く。
   */
  accountKey?: string
  /**
   * 旧形式の実行アカウント (内部 UUID)。ファイルから読んだ直後だけ持ち、
   * accounts ロード後の migrateScopes で accountKey へ置換して消える。
   */
  legacyAccountId?: string
}

/** Metadata fields stored in *.meta.json5 (everything except src). */
interface WidgetFileMeta {
  installId: string
  name: string
  autoRun: boolean
  storeId?: string
  storeSha512?: string
  storeVersion?: string
  createdAt: number
  updatedAt: number
  iconUrl?: string
  accountKey?: string
  /** @deprecated 旧形式 (内部 UUID)。読取専用 — migrateScopes で accountKey へ移行 */
  accountId?: string
}

/** .is + .meta.json5 ペアのファイル永続化 (#782 Phase 2、plugins と共通) */
const widgetFiles = createSidecarCollection<WidgetMeta, WidgetFileMeta>({
  logTag: 'widgets',
  notify: notifyWarningToast,
  kindFallback: 'widget',
  idKey: 'installId',
  // 直接参照ではなくアロー包みで遅延参照する (テストの部分モックと相性を保つ)
  list: () => settingsFs.listWidgetFiles(),
  read: (filename) => settingsFs.readWidgetFile(filename),
  write: (filename, content) => settingsFs.writeWidgetFile(filename, content),
  remove: (filename) => settingsFs.deleteWidgetFile(filename),
  rename: (oldFilename, newFilename) =>
    settingsFs.renameWidgetFile(oldFilename, newFilename),
  idOf: (w) => w.installId,
  nameOf: (w) => w.name,
  srcOf: (w) => w.src,
  // ストアインストールはファイル名 = storeId (#913。占有時は連番 suffix)
  preferredBase: (w) => w.storeId,
  mirrorSrcById: (id) =>
    loadWidgetsFromStorage().find((w) => w.installId === id)?.src,
  toFileMeta: (w) => ({
    installId: w.installId,
    name: w.name,
    autoRun: w.autoRun,
    ...(w.storeId ? { storeId: w.storeId } : {}),
    ...(w.storeSha512 ? { storeSha512: w.storeSha512 } : {}),
    ...(w.storeVersion ? { storeVersion: w.storeVersion } : {}),
    ...(w.iconUrl ? { iconUrl: w.iconUrl } : {}),
    ...(w.accountKey ? { accountKey: w.accountKey } : {}),
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  }),
  fromFile: (meta, src, metaFile) => ({
    installId: meta.installId || metaFile,
    name: meta.name || metaFile,
    src,
    autoRun: meta.autoRun ?? false,
    storeId: meta.storeId,
    storeSha512: meta.storeSha512,
    storeVersion: meta.storeVersion,
    iconUrl: meta.iconUrl,
    accountKey: meta.accountKey,
    legacyAccountId: meta.accountKey ? undefined : meta.accountId,
    createdAt: meta.createdAt ?? Date.now(),
    updatedAt: meta.updatedAt ?? Date.now(),
  }),
})

function loadWidgetsFromStorage(): WidgetMeta[] {
  // 旧ミラーは実行アカウントを内部 UUID の accountId で直接持つ (#1061)。
  // ファイル経由 (fromFile) と同じ形に正規化しないと、ミラーだけに在る個体
  // (ブラウザ実行・ファイル欠損からの復旧) が移行対象から漏れる
  return getStorageJson<WidgetMeta[]>(STORAGE_KEYS.widgets, []).map((w) => {
    const legacy = (w as WidgetMeta & { accountId?: string }).accountId
    if (!legacy) return w
    const { accountId: _drop, ...rest } = w as WidgetMeta & {
      accountId?: string
    }
    return w.accountKey ? rest : { ...rest, legacyAccountId: legacy }
  })
}

function saveWidgetsToStorage(widgets: WidgetMeta[]) {
  setStorageJson(STORAGE_KEYS.widgets, widgets)
}

function loadSidebarOrderFromStorage(): string[] {
  return getStorageJson<string[]>(STORAGE_KEYS.widgetsSidebarOrder, [])
}

function saveSidebarOrderToStorage(ids: string[]) {
  setStorageJson(STORAGE_KEYS.widgetsSidebarOrder, ids)
}

export function generateWidgetId(): string {
  return `wgt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export const useWidgetsStore = defineStore('widgets', () => {
  const widgets = ref<WidgetMeta[]>([])
  /**
   * sidebar widget カラム (ナビバートグルで開閉される 1 個固定) に並べる widget の順序。
   * カラムのライフサイクル外で永続化されるので、カラムを閉じても並びが消えない。
   * non-sidebar widget カラムで作られた widget はここに自動追加されない。
   */
  const sidebarWidgetIds = ref<string[]>([])
  let loaded = false
  const initialized = ref(false)
  // 変更系操作 (新規作成・リネーム・保存・削除) のファイル反映は
  // 「初回読込 (対応表確定) + 初回移行」の完了を待つゲート (#913)
  let resolveReady: (() => void) | undefined
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  function ensureLoaded() {
    if (loaded) return
    loaded = true
    widgets.value = loadWidgetsFromStorage()
    sidebarWidgetIds.value = loadSidebarOrderFromStorage()

    if (settingsFs.isTauri) {
      initFileStorage()
        .catch((e) => console.warn('[widgets] file storage init failed:', e))
        .finally(() => resolveReady?.())
    } else {
      initialized.value = true
      resolveReady?.()
      scheduleScopeMigration()
    }
  }

  /** sidebar 並び順から不在 widget を排除 (起動時のクリーンアップ) */
  function pruneSidebarOrder() {
    const present = new Set(widgets.value.map((w) => w.installId))
    const filtered = sidebarWidgetIds.value.filter((id) => present.has(id))
    if (filtered.length !== sidebarWidgetIds.value.length) {
      sidebarWidgetIds.value = filtered
      saveSidebarOrderToStorage(filtered)
    }
  }

  /** 保存・削除の直前にミラーの対応表を読み直す (別ウィンドウのリネーム追随)。 */
  function adoptMirrorFileBase(widget: WidgetMeta) {
    const mirrored = loadWidgetsFromStorage().find(
      (w) => w.installId === widget.installId,
    )
    if (mirrored?.fileBase) widget.fileBase = mirrored.fileBase
  }

  function persist(widget?: WidgetMeta) {
    saveWidgetsToStorage(widgets.value)
    if (!settingsFs.isTauri) return
    void ready
      .then(async () => {
        if (widget) {
          // ref の深い reactivity で widgets.value の要素は proxy になるため、
          // 占有判定の「操作対象自身は占有とみなさない」参照一致が崩れない
          // よう live 要素 (proxy) を渡す
          const live =
            widgets.value.find((w) => w.installId === widget.installId) ??
            widget
          adoptMirrorFileBase(live)
          await widgetFiles.persistItem(live, widgets.value)
        } else {
          await widgetFiles.persistAll(widgets.value, widgets.value)
        }
        // fileBase 割当をミラーへ反映
        saveWidgetsToStorage(widgets.value)
      })
      .catch((e) => console.warn('[widgets] failed to persist to files:', e))
  }

  /** Load widgets from files. Files are source of truth. */
  async function initFileStorage(): Promise<void> {
    const { items: fileWidgets } = await widgetFiles.loadAll()

    // 初期化 (この async 関数が走る間) にメモリ追加された widget と、
    // ミラーにだけ在る widget (過去の書込が黙って失敗した個体) の集合。
    const fileIds = new Set(fileWidgets.map((w) => w.installId))
    const memoryOnly = widgets.value.filter((w) => !fileIds.has(w.installId))

    if (fileWidgets.length > 0) {
      // 並び順を確定するため createdAt 昇順でソート (ファイル列挙順は OS 依存)
      fileWidgets.sort((a, b) => a.createdAt - b.createdAt)
      widgets.value = [...fileWidgets, ...memoryOnly]
    }

    // マイグレーション (#913) はメインウィンドウのみが実行する。冪等
    if (settingsFs.isMainDeckWindow()) {
      // (a) 規約外名の copy-adopt 正規化
      await widgetFiles.migrateItems(widgets.value)
      // (b) ミラー在・ファイル不在 → 新 slug 名で再作成
      //     (空ソースは書かない — 読取専用ガードを消さないため)
      for (const w of memoryOnly) {
        if (w.readOnly || !w.src) continue
        w.fileBase = undefined // ミラー由来の旧 fileBase は無効 (ファイル不在)
        await widgetFiles
          .persistItem(w, widgets.value)
          .catch((e) =>
            console.warn('[widgets] failed to persist memory-only widgets:', e),
          )
      }
      // 履歴 sweep: 主ファイルと対応の取れない .history.json5 を削除
      await widgetFiles
        .sweepHistory()
        .catch((e) => console.warn('[widgets] history sweep failed:', e))
    }

    saveWidgetsToStorage(widgets.value)
    initialized.value = true
    pruneSidebarOrder()
    // 実行アカウントの安定キー化 (#1061)。files が source of truth に
    // なった後で走らせる
    scheduleScopeMigration()
  }

  function addWidget(widget: WidgetMeta) {
    ensureLoaded()
    widgets.value.push(widget)
    persist(widget)
  }

  /** widget を削除する。undo トースト用に復元関数を返す (ファイル再書込方式) */
  function removeWidget(installId: string): (() => void) | undefined {
    ensureLoaded()
    const idx = widgets.value.findIndex((w) => w.installId === installId)
    const removed = widgets.value[idx]
    // ミラー上書き前に対応表を読み直す (別ウィンドウのリネーム後の削除が
    // stale なファイル名で空振りしないように)
    if (removed && settingsFs.isTauri) adoptMirrorFileBase(removed)
    // AiScript の Mk:save 領域を一掃 (storagePrefix='app-${installId}')。
    // undo で戻せるよう消す前にスナップショットを取る
    const storagePrefix = STORAGE_KEYS.aiscriptStorage(`app-${installId}`)
    const savedStorage = getStorageByPrefix(storagePrefix)
    removeStorageByPrefix(storagePrefix)
    widgets.value = widgets.value.filter((w) => w.installId !== installId)
    saveWidgetsToStorage(widgets.value)
    // sidebar 並びからも自動的に剥がす
    const sidebarIdx = sidebarWidgetIds.value.indexOf(installId)
    if (sidebarIdx >= 0) {
      sidebarWidgetIds.value = sidebarWidgetIds.value.filter(
        (id) => id !== installId,
      )
      saveSidebarOrderToStorage(sidebarWidgetIds.value)
    }
    if (settingsFs.isTauri && removed) {
      void ready
        .then(() => widgetFiles.deleteItemFiles(removed))
        .catch((e) =>
          console.warn('[widgets] failed to delete widget files:', e),
        )
    }
    if (!removed) return undefined
    return () => {
      if (widgets.value.some((w) => w.installId === installId)) return
      const at = Math.min(idx, widgets.value.length)
      widgets.value = [
        ...widgets.value.slice(0, at),
        removed,
        ...widgets.value.slice(at),
      ]
      saveWidgetsToStorage(widgets.value)
      for (const [key, value] of Object.entries(savedStorage)) {
        setStorageString(key, value)
      }
      if (sidebarIdx >= 0 && !sidebarWidgetIds.value.includes(installId)) {
        const sidebarAt = Math.min(sidebarIdx, sidebarWidgetIds.value.length)
        sidebarWidgetIds.value = [
          ...sidebarWidgetIds.value.slice(0, sidebarAt),
          installId,
          ...sidebarWidgetIds.value.slice(sidebarAt),
        ]
        saveSidebarOrderToStorage(sidebarWidgetIds.value)
      }
      if (settingsFs.isTauri) {
        void ready
          .then(() => widgetFiles.persistItem(removed, widgets.value))
          .then(() => saveWidgetsToStorage(widgets.value))
          .catch((e) =>
            console.warn('[widgets] failed to restore widget files:', e),
          )
      }
    }
  }

  function addToSidebar(installId: string) {
    ensureLoaded()
    if (sidebarWidgetIds.value.includes(installId)) return
    sidebarWidgetIds.value = [...sidebarWidgetIds.value, installId]
    saveSidebarOrderToStorage(sidebarWidgetIds.value)
  }

  function removeFromSidebar(installId: string) {
    ensureLoaded()
    if (!sidebarWidgetIds.value.includes(installId)) return
    sidebarWidgetIds.value = sidebarWidgetIds.value.filter(
      (id) => id !== installId,
    )
    saveSidebarOrderToStorage(sidebarWidgetIds.value)
  }

  function reorderSidebar(ids: string[]) {
    ensureLoaded()
    sidebarWidgetIds.value = ids
    saveSidebarOrderToStorage(ids)
  }

  // --- AI 経由の再実行シグナル (#744) ---
  // widgets.update capability だけが requestRerun を発火し、マウント中の
  // WidgetAiScript が rerunSignal を watch して新 src で再実行する。
  // ユーザーの widget-edit ウィンドウでの編集 (debounce 自動保存) では発火しない。
  const rerunSignals = ref<Map<string, number>>(new Map())
  const mountedCounts = ref<Map<string, number>>(new Map())

  function registerMounted(installId: string) {
    mountedCounts.value.set(
      installId,
      (mountedCounts.value.get(installId) ?? 0) + 1,
    )
  }

  function unregisterMounted(installId: string) {
    const n = (mountedCounts.value.get(installId) ?? 0) - 1
    if (n > 0) mountedCounts.value.set(installId, n)
    else mountedCounts.value.delete(installId)
  }

  /** マウント中インスタンスに再実行を要求する。返り値は対象インスタンス数 (0 = 発火なし) */
  function requestRerun(installId: string): number {
    const mounted = mountedCounts.value.get(installId) ?? 0
    if (mounted > 0) {
      rerunSignals.value.set(
        installId,
        (rerunSignals.value.get(installId) ?? 0) + 1,
      )
    }
    return mounted
  }

  /** WidgetAiScript が watch する再実行シグナル (単調増加カウンタ) */
  function rerunSignal(installId: string): number {
    return rerunSignals.value.get(installId) ?? 0
  }

  /** マウント中インスタンス数 (シグナルを発火しない read-only 版) */
  function mountedCount(installId: string): number {
    return mountedCounts.value.get(installId) ?? 0
  }

  /**
   * 読取専用 (ソース欠損) の個体は変更を拒否する (#1111)。保存できず端末
   * ローカルにだけ載って次回起動で巻き戻るため、ミラーに書く前に抜ける
   */
  function rejectIfReadOnly(widget: WidgetMeta | undefined): boolean {
    if (!widget?.readOnly) return false
    console.warn('[widgets] read-only widget — change rejected')
    return true
  }

  /** false = 読取専用で拒否 (#913 / #1111)。 */
  function updateSrc(
    installId: string,
    src: string,
    attribution?: EditAttribution,
  ): boolean {
    ensureLoaded()
    const widget = widgets.value.find((w) => w.installId === installId)
    if (!widget) return false
    if (rejectIfReadOnly(widget)) return false
    // 編集前 src を history sidecar に push (fire-and-forget)。
    // 履歴キーは対応表の fileBase (未割当 = ファイル未作成なら履歴も無し)。
    // 内容が同じ保存では積まない (plugins.updateSrc と同じ理由)
    if (widget.fileBase && widget.src !== src) {
      pushSnapshot(
        'widget',
        widget.fileBase,
        {
          src: widget.src,
          name: widget.name,
          autoRun: widget.autoRun,
        },
        attribution,
      ).catch((e) => console.warn('[widgets] history push failed:', e))
    }
    widget.src = src
    widget.updatedAt = Date.now()
    persist(widget)
    return true
  }

  /**
   * 実行アカウントを固定する (#1018)。全アカウントのカラムに置いたウィジェットが
   * どのアカウントで動くかは、カラムからは決まらないのでここに持つ。
   */
  function setAccountKey(
    installId: string,
    accountKey: string | undefined,
  ): boolean {
    ensureLoaded()
    const widget = widgets.value.find((w) => w.installId === installId)
    if (!widget) return false
    if (rejectIfReadOnly(widget)) return false
    widget.accountKey = accountKey
    widget.updatedAt = Date.now()
    persist(widget)
    return true
  }

  let scopesMigrated = false

  /**
   * 実行アカウントの安定キー化 (#1061、plugins の migrateScopes と同型)。
   * アカウント一覧が必要なので accounts ロード後に 1 回だけ走る。
   * - 旧 accountId (UUID) → 現行アカウントに該当すれば安定キーへ置換
   * - 該当しない UUID / 現存しない安定キー (バックアップ復元の孤児) →
   *   「アカウント無し」へ戻す。次回実行時にアカウントを選び直させる
   */
  function migrateScopes() {
    const accountsStore = useAccountsStore()
    if (!accountsStore.isLoaded || scopesMigrated) return
    scopesMigrated = true
    ensureLoaded()

    const uuidToKey = new Map(
      accountsStore.accounts.map((a) => [a.id, accountScopeKey(a)]),
    )
    const liveKeys = new Set(uuidToKey.values())

    for (const widget of widgets.value) {
      let next = widget.accountKey
      if (widget.legacyAccountId) {
        next = uuidToKey.get(widget.legacyAccountId)
      }
      if (next && !liveKeys.has(next)) next = undefined
      if (next === widget.accountKey && !widget.legacyAccountId) continue
      widget.accountKey = next
      widget.legacyAccountId = undefined
      persist(widget)
    }
  }

  /** accounts のロード完了を待って migrateScopes を 1 回だけ実行する。 */
  function scheduleScopeMigration() {
    const accountsStore = useAccountsStore()
    if (accountsStore.isLoaded) {
      migrateScopes()
      return
    }
    const stop = watch(
      () => accountsStore.isLoaded,
      (ready) => {
        if (!ready) return
        stop()
        migrateScopes()
      },
    )
  }

  /**
   * アカウント削除時に、そのアカウントに固定された個体をすべて消す (#1061)。
   * カラムからの参照剥がしは呼び出し側 (deck) の責務。削除した installId を返す。
   */
  function purgeAccount(accountKey: string): string[] {
    ensureLoaded()
    const targets = widgets.value
      .filter((w) => w.accountKey === accountKey)
      .map((w) => w.installId)
    for (const id of targets) removeWidget(id)
    return targets
  }

  /** false = 読取専用で拒否 (#1111)。 */
  function setAutoRun(installId: string, autoRun: boolean): boolean {
    ensureLoaded()
    const widget = widgets.value.find((w) => w.installId === installId)
    if (!widget) return false
    if (rejectIfReadOnly(widget)) return false
    widget.autoRun = autoRun
    widget.updatedAt = Date.now()
    persist(widget)
    return true
  }

  /**
   * ストア再インストール (#913): 本体 (src) とストア由来メタを上書き更新する。
   * ローカル値 (name の改名・autoRun) は維持。ソース欠損の readOnly 個体は
   * 検証済み配布ソースで復旧する (persist 抑止を解除)。
   */
  function applyStoreUpdate(
    installId: string,
    patch: {
      src: string
      iconUrl?: string
      storeSha512: string
      storeVersion: string
    },
  ): WidgetMeta | undefined {
    ensureLoaded()
    const widget = widgets.value.find((w) => w.installId === installId)
    if (!widget) return undefined
    // 編集前 src を history sidecar に push (updateSrc と同じ undo リング)
    if (widget.fileBase && !widget.readOnly) {
      pushSnapshot('widget', widget.fileBase, {
        src: widget.src,
        name: widget.name,
        autoRun: widget.autoRun,
      }).catch((e) => console.warn('[widgets] history push failed:', e))
    }
    widget.src = patch.src
    widget.iconUrl = patch.iconUrl
    widget.storeSha512 = patch.storeSha512
    widget.storeVersion = patch.storeVersion
    widget.updatedAt = Date.now()
    widget.readOnly = undefined
    persist(widget)
    return widget
  }

  /**
   * 更新検知の基準記録 (#1040)。storeSha512 未記録のストア由来 widget へ
   * registry 現行値を無通知で記録する。本体・ローカル値・updatedAt には
   * 触れない (履歴 push もしない)。
   */
  function recordStoreBaseline(
    installId: string,
    patch: { storeSha512: string; storeVersion: string },
  ): void {
    ensureLoaded()
    const widget = widgets.value.find((w) => w.installId === installId)
    if (!widget) return
    widget.storeSha512 = patch.storeSha512
    widget.storeVersion = patch.storeVersion
    persist(widget)
  }

  function setStoreId(installId: string, storeId: string | undefined) {
    ensureLoaded()
    const widget = widgets.value.find((w) => w.installId === installId)
    if (widget) {
      widget.storeId = storeId
      widget.updatedAt = Date.now()
      persist(widget)
    }
  }

  /** false = 読取専用で拒否 (#1111)。 */
  function renameWidget(installId: string, newName: string): boolean {
    ensureLoaded()
    const widget = widgets.value.find((w) => w.installId === installId)
    if (!widget) return false
    if (rejectIfReadOnly(widget)) return false

    widget.name = newName
    widget.updatedAt = Date.now()
    saveWidgetsToStorage(widgets.value)
    if (!settingsFs.isTauri) return true
    // ファイルは rename で追随させる (ID 不変・旧削除 + 新書込の並行発火禁止)。
    // rename の完了を待ってから保存する
    void ready
      .then(async () => {
        adoptMirrorFileBase(widget)
        await widgetFiles.renameItemFiles(widget, widgets.value)
        await widgetFiles.persistItem(widget, widgets.value)
        saveWidgetsToStorage(widgets.value)
      })
      .catch((e) => console.warn('[widgets] failed to rename widget files:', e))
    return true
  }

  function getWidget(installId: string): WidgetMeta | undefined {
    ensureLoaded()
    return widgets.value.find((w) => w.installId === installId)
  }

  // notecore がウィジェットのファイルを書いた (AI の widgets.* は notecore の本体が
  // 書く, #1133) → その個体だけ写しを揃え、ソースが変わっていれば表示中の
  // インスタンスに再実行を要求する。削除は Mk:save 領域とサイドバーの並びも掃除
  registerSettingsFileHandler('widgets', async (change) => {
    if (!change.name.endsWith(META_SUFFIX)) return
    ensureLoaded()
    await ready
    const fileBase = change.name.slice(0, -META_SUFFIX.length)
    if (change.op === 'delete') {
      const removed = widgets.value.find((w) => w.fileBase === fileBase)
      if (!removed) return
      removeStorageByPrefix(
        STORAGE_KEYS.aiscriptStorage(`app-${removed.installId}`),
      )
      widgets.value = widgets.value.filter((w) => w !== removed)
      saveWidgetsToStorage(widgets.value)
      if (sidebarWidgetIds.value.includes(removed.installId)) {
        sidebarWidgetIds.value = sidebarWidgetIds.value.filter(
          (id) => id !== removed.installId,
        )
        saveSidebarOrderToStorage(sidebarWidgetIds.value)
      }
      return
    }
    let item: WidgetMeta | undefined
    try {
      item = await widgetFiles.loadOne(change.name)
    } catch (e) {
      console.warn(`[widgets] reload ${change.name} failed:`, e)
      return
    }
    if (!item) return
    const next = item
    const prev = widgets.value.find(
      (w) => w.installId === next.installId || w.fileBase === fileBase,
    )
    widgets.value = prev
      ? widgets.value.map((w) => (w === prev ? next : w))
      : [...widgets.value, next]
    saveWidgetsToStorage(widgets.value)
    if (prev && prev.src !== next.src) requestRerun(next.installId)
  })

  return {
    widgets,
    sidebarWidgetIds,
    initialized,
    ensureLoaded,
    addWidget,
    removeWidget,
    updateSrc,
    setAutoRun,
    setAccountKey,
    migrateScopes,
    purgeAccount,
    applyStoreUpdate,
    recordStoreBaseline,
    setStoreId,
    renameWidget,
    getWidget,
    addToSidebar,
    removeFromSidebar,
    reorderSidebar,
    registerMounted,
    unregisterMounted,
    requestRerun,
    rerunSignal,
    mountedCount,
  }
})
