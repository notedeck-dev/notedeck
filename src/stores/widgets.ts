import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { withScopeTarget } from '@/services/distributable'
import {
  sidecarCollectionFor,
  sidecarFileBaseOf,
} from '@/services/distributableCodecs/sidecar'
import {
  type WidgetItem,
  widgetCodec,
} from '@/services/distributableCodecs/widgetCodec'
import {
  legacyWidgetStoragePrefix,
  rewritePlacements,
  samePlacement,
  type WidgetPlacement,
  type WidgetPlacementRewrite,
  widgetStoragePrefix,
} from '@/services/widgetPlacement'
import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import { createDistributableStore } from '@/stores/distributableStore'
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
import { notifyWarningToast } from '@/utils/toastNotify'

/**
 * ウィジェット本体のプール。
 *
 * - 個体は envelope (`WidgetItem`、#1202 段階 1)。本文 (`content`) は AiScript
 *   ソース、`extra.autoRun` は mount 時の自動実行 (有効フラグではない)
 * - 本体は紐付け配列で共有する (決定 (b))。どのアカウントのカラムで選べるかは
 *   `scope`、実行アカウントはカラム側の配置 (`services/widgetPlacement.ts`) が
 *   持ち、Mk:save の状態は実行アカウントで名前空間が分かれる (決定 (g) / (h))
 * - 保存は sidecar 形式 (`widgets/<name>.is` + `.meta.json5`)。projection は
 *   `widgetCodec`
 * - サイドバーのウィジェットカラム (ナビバートグルで開閉される 1 個固定) の
 *   配置はカラムのライフサイクル外で持つ (localStorage)。再実行シグナルと
 *   マウント数も store 外の状態としてここに置く
 */

export type { WidgetItem } from '@/services/distributableCodecs/widgetCodec'

const widgetFiles = sidecarCollectionFor(widgetCodec, {
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
})

export function generateWidgetId(): string {
  return `wgt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * この本体の Mk:save 領域の鍵の prefix (旧来の `app-<id>:` と名前空間つきの
 * `app-<id>/` の 2 つ。区切りの違いは `services/widgetPlacement.ts` を参照)
 */
function storageAreaOf(installId: string): string[] {
  const legacy = STORAGE_KEYS.aiscriptStorage(
    legacyWidgetStoragePrefix(installId),
  )
  return [legacy, `${legacy.slice(0, -1)}/`]
}

function snapshotStorageArea(installId: string): Record<string, string> {
  return Object.assign(
    {},
    ...storageAreaOf(installId).map((p) => getStorageByPrefix(p)),
  )
}

function removeStorageArea(installId: string): void {
  for (const p of storageAreaOf(installId)) removeStorageByPrefix(p)
}

/**
 * Mk:save の状態を別の名前空間へ写す (複製の統合 / 固定の解除)。既にある鍵は
 * 上書きしない (生き残る本体の状態を優先)
 */
function moveStorageArea(
  fromPrefix: string,
  toPrefix: string,
  overwrite: boolean,
): void {
  const from = STORAGE_KEYS.aiscriptStorage(fromPrefix)
  const to = STORAGE_KEYS.aiscriptStorage(toPrefix)
  for (const [key, value] of Object.entries(getStorageByPrefix(from))) {
    const next = to + key.slice(from.length)
    if (!overwrite && localStorage.getItem(next) !== null) continue
    setStorageString(next, value)
  }
  removeStorageByPrefix(from)
}

function loadSidebar(): WidgetPlacement[] {
  const raw = getStorageJson<unknown[]>(STORAGE_KEYS.widgetsSidebarOrder, [])
  // 旧形式 (installId の配列) は実行アカウント無しの配置として読む
  return raw.flatMap((p): WidgetPlacement[] => {
    if (typeof p === 'string') return [{ id: p }]
    if (
      p &&
      typeof p === 'object' &&
      typeof (p as WidgetPlacement).id === 'string'
    ) {
      return [p as WidgetPlacement]
    }
    return []
  })
}

interface UndoSnapshot {
  storage: Record<string, string>
  sidebar: { index: number; placement: WidgetPlacement }[]
}

export const useWidgetsStore = defineStore('widgets', () => {
  /**
   * sidebar widget カラムに並べる配置。カラムのライフサイクル外で永続化される
   * ので、カラムを閉じても並びが消えない。non-sidebar カラムで作られた
   * ウィジェットはここに自動追加されない
   */
  const sidebarPlacements = ref<WidgetPlacement[]>(loadSidebar())
  function saveSidebar(): void {
    setStorageJson(STORAGE_KEYS.widgetsSidebarOrder, sidebarPlacements.value)
  }

  /**
   * 移行で決まった配置の書き換え (旧 id → 本体 id + 実行アカウント)。デッキの
   * プロファイルは deck store の持ち物なので、ここでは積むだけで deck が取り出す
   */
  const pendingPlacementRewrites = ref<WidgetPlacementRewrite[]>([])
  function takePlacementRewrites(): WidgetPlacementRewrite[] {
    const out = pendingPlacementRewrites.value
    pendingPlacementRewrites.value = []
    return out
  }

  // --- AI 経由の再実行シグナル (#744) ---
  // widgets.update capability と別の書き手の変更通知だけが requestRerun を発火し、
  // マウント中の WidgetAiScript が rerunSignal を watch して新 src で再実行する。
  // ユーザーの widget-edit ウィンドウでの編集 (debounce 自動保存) では発火しない
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
   * 初回読込後の移行 (#1202 段階 1)。副作用 (ファイル削除 / Mk:save の移動 /
   * 配置の書き換え) はメインウィンドウだけが行い、他のウィンドウは写しを揃える
   * だけ (ファイルの削除は変更通知で届く)
   * 1. 並び順を確定するため createdAt 昇順にする (ファイル列挙順は OS 依存)
   * 2. 同じ storeId の複製を最古の本体に統合する (決定 (i)): 紐付けを束ね、
   *    分岐した本文は本体の履歴へ、Mk:save は本体の名前空間へ写す
   * 3. 旧形式で 1 アカウントに固定されていた本体は、その実行アカウントを配置へ
   *    移す (決定 (g))。Mk:save も名前空間つきへ
   * 4. サイドバーの並びから不在の本体を外す
   */
  function migrateLoaded(items: WidgetItem[]): WidgetItem[] {
    const effects = settingsFs.isMainDeckWindow()
    const changed = new Set<WidgetItem>()
    const rewrites: WidgetPlacementRewrite[] = []
    items.sort((a, b) => a.createdAt - b.createdAt)

    // 2. 複製の統合
    const byStore = new Map<string, WidgetItem[]>()
    for (const w of items) {
      if (!w.store) continue
      const list = byStore.get(w.store.id) ?? []
      list.push(w)
      byStore.set(w.store.id, list)
    }
    for (const [body, ...copies] of byStore.values()) {
      if (!body || copies.length === 0) continue
      for (const copy of copies) {
        const key =
          copy.extra.legacyAccountKey ??
          (copy.scope.kind === 'shared'
            ? copy.scope.installedFor[0]
            : undefined)
        if (copy.scope.kind === 'shared') {
          for (const k of copy.scope.installedFor) {
            body.scope = withScopeTarget(body.scope, {
              kind: 'account',
              key: k,
            })
          }
          if (copy.scope.global) {
            body.scope = withScopeTarget(body.scope, { kind: 'global' })
          }
        }
        if (effects) {
          if (copy.content !== body.content && body.fileBase) {
            void pushSnapshot('widget', body.fileBase, {
              src: copy.content,
              name: copy.name,
              autoRun: copy.extra.autoRun,
            }).catch((e) => console.warn('[widgets] history push failed:', e))
          }
          moveStorageArea(
            legacyWidgetStoragePrefix(copy.id),
            widgetStoragePrefix(body.id, key),
            false,
          )
          if (settingsFs.isTauri) {
            void widgetFiles
              .deleteItemFiles(copy)
              .catch((e) => console.warn('[widgets] merge delete failed:', e))
          }
        }
        rewrites.push({ from: copy.id, to: { id: body.id, accountKey: key } })
        items.splice(items.indexOf(copy), 1)
      }
      changed.add(body)
    }

    // 3. 固定の解除
    for (const w of items) {
      const key = w.extra.legacyAccountKey
      if (!key) continue
      if (effects) {
        moveStorageArea(
          legacyWidgetStoragePrefix(w.id),
          widgetStoragePrefix(w.id, key),
          false,
        )
      }
      rewrites.push({ from: w.id, to: { id: w.id, accountKey: key } })
      w.extra = { ...w.extra, legacyAccountKey: undefined }
      changed.add(w)
    }

    // 配置の書き換え: サイドバーは自分で、カラムは deck が取り出して行う
    let sidebarChanged = false
    if (rewrites.length > 0) {
      const next = rewritePlacements(sidebarPlacements.value, rewrites)
      if (next.changed) {
        sidebarPlacements.value = next.placements
        sidebarChanged = true
      }
      if (effects) pendingPlacementRewrites.value.push(...rewrites)
    }
    // 4. サイドバーの掃除
    const present = new Set(items.map((w) => w.id))
    const pruned = sidebarPlacements.value.filter((p) => present.has(p.id))
    if (pruned.length !== sidebarPlacements.value.length) {
      sidebarPlacements.value = pruned
      sidebarChanged = true
    }
    if (sidebarChanged) saveSidebar()
    return [...changed]
  }

  function snapshotForUndo(w: WidgetItem): UndoSnapshot {
    return {
      storage: snapshotStorageArea(w.id),
      sidebar: sidebarPlacements.value
        .map((placement, index) => ({ index, placement }))
        .filter((e) => e.placement.id === w.id),
    }
  }

  function afterRemove(w: WidgetItem): void {
    removeStorageArea(w.id)
    if (sidebarPlacements.value.some((p) => p.id === w.id)) {
      sidebarPlacements.value = sidebarPlacements.value.filter(
        (p) => p.id !== w.id,
      )
      saveSidebar()
    }
  }

  function restoreFromUndo(_w: WidgetItem, snapshot: unknown): void {
    const snap = snapshot as UndoSnapshot
    for (const [key, value] of Object.entries(snap.storage)) {
      setStorageString(key, value)
    }
    if (snap.sidebar.length > 0) {
      const next = [...sidebarPlacements.value]
      for (const { index, placement } of snap.sidebar) {
        if (next.some((p) => samePlacement(p, placement))) continue
        next.splice(Math.min(index, next.length), 0, placement)
      }
      sidebarPlacements.value = next
      saveSidebar()
    }
  }

  const base = createDistributableStore<string, WidgetItem>({
    logTag: 'widgets',
    codec: widgetCodec,
    files: widgetFiles,
    settingsScope: 'widgets',
    fileBaseOf: sidecarFileBaseOf,
    browserStorageKey: STORAGE_KEYS.widgets,
    generateId: generateWidgetId,
    // 履歴の形は `widgets.revert` (notecore) とエディタの履歴窓が読むので
    // キー名は on-disk の互換を保つ (src / name / autoRun)
    history: {
      kind: 'widget',
      snapshot: (w) => ({
        src: w.content,
        name: w.name,
        autoRun: w.extra.autoRun,
      }),
    },
    // アカウント削除時は紐付けを外すだけ。配置の掃除は deck 側 (#1061)
    purgeAccount: 'unlink',
    hooks: {
      migrate: migrateLoaded,
      // 別の書き手 (notecore の widgets.* / 他のウィンドウ) がソースを変えたら
      // 表示中のインスタンスに再実行を要求する。自分の編集 (エディタの自動保存)
      // では発火しない (#744。AI 経由の保存は capability が明示的に発火する)
      afterContentChange: (w, _prev, source) => {
        if (source === 'external') requestRerun(w.id)
      },
      snapshotForUndo,
      restoreFromUndo,
      afterRemove,
    },
  })

  /**
   * 旧々形式 (内部 UUID の accountId) の紐付けを安定キーへ写す (#1061)。
   * アカウント一覧が要るので accounts ロード後に 1 回だけ走る。該当する
   * アカウントが無ければ全体スコープへ (次に使うカラムで選び直せる)
   */
  let legacyAccountsMigrated = false
  async function migrateLegacyAccountIds(): Promise<void> {
    const accountsStore = useAccountsStore()
    if (!accountsStore.isLoaded || legacyAccountsMigrated) return
    legacyAccountsMigrated = true
    await base.whenReady()
    const uuidToKey = new Map(
      accountsStore.accounts.map((a) => [a.id, accountScopeKey(a)]),
    )
    for (const w of [...base.items.value]) {
      const uuid = w.extra.legacyAccountId
      if (!uuid) continue
      const key = uuidToKey.get(uuid)
      await base.link(w.id, key ? { kind: 'account', key } : { kind: 'global' })
      await base.updateExtra(w.id, { legacyAccountId: undefined })
    }
  }
  let legacyMigrationScheduled = false
  function scheduleLegacyAccountMigration(): void {
    if (legacyMigrationScheduled) return
    legacyMigrationScheduled = true
    const accountsStore = useAccountsStore()
    if (accountsStore.isLoaded) {
      void migrateLegacyAccountIds()
      return
    }
    const stop = watch(
      () => accountsStore.isLoaded,
      (loaded) => {
        if (!loaded) return
        stop()
        void migrateLegacyAccountIds()
      },
    )
  }

  function ensureLoaded(): void {
    base.ensureLoaded()
    scheduleLegacyAccountMigration()
  }

  /** mount 時の自動実行の切替。false = 読取専用で拒否 (#1111) */
  function setAutoRun(installId: string, autoRun: boolean): Promise<boolean> {
    return base.updateExtra(installId, { autoRun })
  }

  function addToSidebar(placement: WidgetPlacement) {
    if (sidebarPlacements.value.some((p) => samePlacement(p, placement))) return
    sidebarPlacements.value = [...sidebarPlacements.value, placement]
    saveSidebar()
  }

  function removeFromSidebar(placement: WidgetPlacement) {
    const next = sidebarPlacements.value.filter(
      (p) => !samePlacement(p, placement),
    )
    if (next.length === sidebarPlacements.value.length) return
    sidebarPlacements.value = next
    saveSidebar()
  }

  function reorderSidebar(placements: WidgetPlacement[]) {
    sidebarPlacements.value = placements
    saveSidebar()
  }

  return {
    ...base,
    ensureLoaded,
    setAutoRun,
    sidebarPlacements,
    pendingPlacementRewrites,
    takePlacementRewrites,
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
