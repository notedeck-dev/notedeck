import JSON5 from 'json5'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { pushSnapshot } from '@/utils/historyFs'
import * as settingsFs from '@/utils/settingsFs'
import {
  getStorageJson,
  removeStorageByPrefix,
  STORAGE_KEYS,
  setStorageJson,
} from '@/utils/storage'

export interface WidgetMeta {
  installId: string
  name: string
  src: string
  autoRun: boolean
  storeId?: string
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
  createdAt: number
  updatedAt: number
  iconUrl?: string
}

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

  function ensureLoaded() {
    if (loaded) return
    loaded = true
    widgets.value = loadWidgetsFromStorage()
    sidebarWidgetIds.value = loadSidebarOrderFromStorage()

    if (settingsFs.isTauri) {
      initFileStorage().catch((e) =>
        console.warn('[widgets] file storage init failed:', e),
      )
    } else {
      initialized.value = true
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

  function persist(widget?: WidgetMeta) {
    saveWidgetsToStorage(widgets.value)
    if (initialized.value) {
      const task = widget ? persistSingleWidget(widget) : persistAllToFiles()
      task.catch((e) =>
        console.warn('[widgets] failed to persist to files:', e),
      )
    }
  }

  async function persistSingleWidget(widget: WidgetMeta): Promise<void> {
    const baseName = widget.name || widget.installId
    const srcFilename = settingsFs.widgetSrcFilename(baseName)
    const metaFilename = settingsFs.widgetMetaFilename(baseName)

    const meta: WidgetFileMeta = {
      installId: widget.installId,
      name: widget.name,
      autoRun: widget.autoRun,
      ...(widget.storeId ? { storeId: widget.storeId } : {}),
      ...(widget.iconUrl ? { iconUrl: widget.iconUrl } : {}),
      createdAt: widget.createdAt,
      updatedAt: widget.updatedAt,
    }
    await Promise.all([
      settingsFs.writeWidgetFile(srcFilename, widget.src),
      settingsFs.writeWidgetFile(metaFilename, JSON5.stringify(meta, null, 2)),
    ])
  }

  async function persistAllToFiles(): Promise<void> {
    await Promise.all(widgets.value.map((w) => persistSingleWidget(w)))
  }

  async function deleteWidgetFiles(widget: WidgetMeta): Promise<void> {
    const baseName = widget.name || widget.installId
    await Promise.all([
      settingsFs.deleteWidgetFile(settingsFs.widgetSrcFilename(baseName)),
      settingsFs.deleteWidgetFile(settingsFs.widgetMetaFilename(baseName)),
    ])
  }

  /** Load widgets from files. Files are source of truth. */
  async function initFileStorage(): Promise<void> {
    const allFiles = await settingsFs.listWidgetFiles()
    const metaFiles = allFiles.filter((f) => f.endsWith('.meta.json5'))

    if (metaFiles.length > 0) {
      const results = await Promise.all(
        metaFiles.map(async (metaFile) => {
          try {
            const srcFile = metaFile.replace(/\.meta\.json5$/, '.is')
            const [metaContent, src] = await Promise.all([
              settingsFs.readWidgetFile(metaFile),
              allFiles.includes(srcFile)
                ? settingsFs.readWidgetFile(srcFile)
                : Promise.resolve(''),
            ])
            const meta = JSON5.parse(metaContent) as WidgetFileMeta
            return {
              installId: meta.installId || metaFile,
              name: meta.name || metaFile,
              src,
              autoRun: meta.autoRun ?? false,
              storeId: meta.storeId,
              iconUrl: meta.iconUrl,
              createdAt: meta.createdAt ?? Date.now(),
              updatedAt: meta.updatedAt ?? Date.now(),
            } as WidgetMeta
          } catch (e) {
            console.warn(`[widgets] failed to parse ${metaFile}:`, e)
            return null
          }
        }),
      )
      const fileWidgets = results.filter((w): w is WidgetMeta => w !== null)

      if (fileWidgets.length > 0) {
        // 並び順を確定するため createdAt 昇順でソート (ファイル列挙順は OS 依存)
        fileWidgets.sort((a, b) => a.createdAt - b.createdAt)
        // 初期化 (この async 関数が走る間) にメモリ追加された widget は
        // ファイルにはまだ無いのでマージしないと消える。installId で dedup。
        const fileIds = new Set(fileWidgets.map((w) => w.installId))
        const memoryOnly = widgets.value.filter(
          (w) => !fileIds.has(w.installId),
        )
        widgets.value = [...fileWidgets, ...memoryOnly]
        saveWidgetsToStorage(widgets.value)
        // 在メモリだけだった widget をファイル化 (次回起動時に消えないように)
        if (memoryOnly.length > 0) {
          Promise.all(memoryOnly.map((w) => persistSingleWidget(w))).catch(
            (e) =>
              console.warn(
                '[widgets] failed to persist memory-only widgets:',
                e,
              ),
          )
        }
      }
    }

    initialized.value = true
    pruneSidebarOrder()

    // localStorage 由来のデータがあるが files が無い場合の片方向移行
    if (metaFiles.length === 0 && widgets.value.length > 0) {
      persistAllToFiles().catch((e) =>
        console.warn('[widgets] migration to files failed:', e),
      )
    }
  }

  function addWidget(widget: WidgetMeta) {
    ensureLoaded()
    widgets.value.push(widget)
    persist(widget)
  }

  function removeWidget(installId: string) {
    ensureLoaded()
    const removed = widgets.value.find((w) => w.installId === installId)
    // AiScript の Mk:save 領域を一掃 (storagePrefix='app-${installId}')
    removeStorageByPrefix(STORAGE_KEYS.aiscriptStorage(`app-${installId}`))
    widgets.value = widgets.value.filter((w) => w.installId !== installId)
    saveWidgetsToStorage(widgets.value)
    // sidebar 並びからも自動的に剥がす
    if (sidebarWidgetIds.value.includes(installId)) {
      sidebarWidgetIds.value = sidebarWidgetIds.value.filter(
        (id) => id !== installId,
      )
      saveSidebarOrderToStorage(sidebarWidgetIds.value)
    }
    if (initialized.value && removed) {
      deleteWidgetFiles(removed).catch((e) =>
        console.warn('[widgets] failed to delete widget files:', e),
      )
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

  function updateSrc(installId: string, src: string) {
    ensureLoaded()
    const widget = widgets.value.find((w) => w.installId === installId)
    if (widget) {
      // 編集前 src を history sidecar に push (fire-and-forget)
      pushSnapshot('widget', widget.name || widget.installId, {
        src: widget.src,
        name: widget.name,
        autoRun: widget.autoRun,
      }).catch((e) => console.warn('[widgets] history push failed:', e))
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

    const oldBaseName = widget.name || widget.installId
    widget.name = newName
    widget.updatedAt = Date.now()
    persist(widget)

    if (initialized.value && oldBaseName !== newName) {
      deleteWidgetFiles({ ...widget, name: oldBaseName } as WidgetMeta).catch(
        (e) => console.warn('[widgets] failed to delete old widget files:', e),
      )
    }
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
    setStoreId,
    renameWidget,
    getWidget,
    addToSidebar,
    removeFromSidebar,
    reorderSidebar,
  }
})
