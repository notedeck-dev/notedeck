import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  createSidecarCollection,
  type SidecarItemFile,
} from '@/services/sidecarFileCollection'
import { pushSnapshot } from '@/utils/historyFs'
import * as settingsFs from '@/utils/settingsFs'
import {
  getStorageByPrefix,
  getStorageJson,
  removeStorageByPrefix,
  STORAGE_KEYS,
  setStorageJson,
  setStorageString,
} from '@/utils/storage'

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
}

/** .is + .meta.json5 ペアのファイル永続化 (#782 Phase 2、plugins と共通) */
const widgetFiles = createSidecarCollection<WidgetMeta, WidgetFileMeta>({
  logTag: 'widgets',
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
    createdAt: meta.createdAt ?? Date.now(),
    updatedAt: meta.updatedAt ?? Date.now(),
  }),
})

function loadWidgetsFromStorage(): WidgetMeta[] {
  return getStorageJson<WidgetMeta[]>(STORAGE_KEYS.widgets, [])
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

  function updateSrc(installId: string, src: string) {
    ensureLoaded()
    const widget = widgets.value.find((w) => w.installId === installId)
    if (widget) {
      if (widget.readOnly) {
        // ソース欠損の読取専用個体: 内容編集と保存を抑止 (#913)
        console.warn('[widgets] read-only widget — src update suppressed')
        return
      }
      // 編集前 src を history sidecar に push (fire-and-forget)。
      // 履歴キーは対応表の fileBase (未割当 = ファイル未作成なら履歴も無し)
      if (widget.fileBase) {
        pushSnapshot('widget', widget.fileBase, {
          src: widget.src,
          name: widget.name,
          autoRun: widget.autoRun,
        }).catch((e) => console.warn('[widgets] history push failed:', e))
      }
      widget.src = src
      widget.updatedAt = Date.now()
      persist(widget)
    }
  }

  function setAutoRun(installId: string, autoRun: boolean) {
    ensureLoaded()
    const widget = widgets.value.find((w) => w.installId === installId)
    if (widget) {
      widget.autoRun = autoRun
      widget.updatedAt = Date.now()
      persist(widget)
    }
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

  function setStoreId(installId: string, storeId: string | undefined) {
    ensureLoaded()
    const widget = widgets.value.find((w) => w.installId === installId)
    if (widget) {
      widget.storeId = storeId
      widget.updatedAt = Date.now()
      persist(widget)
    }
  }

  function renameWidget(installId: string, newName: string) {
    ensureLoaded()
    const widget = widgets.value.find((w) => w.installId === installId)
    if (!widget) return

    widget.name = newName
    widget.updatedAt = Date.now()
    saveWidgetsToStorage(widgets.value)
    if (!settingsFs.isTauri) return
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
  }

  function getWidget(installId: string): WidgetMeta | undefined {
    ensureLoaded()
    return widgets.value.find((w) => w.installId === installId)
  }

  return {
    widgets,
    sidebarWidgetIds,
    initialized,
    ensureLoaded,
    addWidget,
    removeWidget,
    updateSrc,
    setAutoRun,
    applyStoreUpdate,
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
