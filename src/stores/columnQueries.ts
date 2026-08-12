import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  createSidecarCollection,
  type SidecarItemFile,
} from '@/services/sidecarFileCollection'
import { useDeckStore } from '@/stores/deck'
import * as settingsFs from '@/utils/settingsFs'
import { getStorageJson, STORAGE_KEYS, setStorageJson } from '@/utils/storage'
import { notifyWarningToast } from '@/utils/toastNotify'

/**
 * 名前付きカラムクエリのプール (#783 Phase 1.5、仕様追補 A)。
 *
 * - クエリは純粋 (アカウント状態を参照しない) なので全体プールのみ (#771 の
 *   アカウント別プールは不要)。アカウント文脈はカラムへの適用が与える
 * - 保存はウィジェットと同じ sidecar 形式 (`queries/<name>.is` + `.meta.json5`)
 * - カラムは id で参照する (DeckColumn.noteQueryRefs)。参照消失は
 *   useNoteColumn 側で fail-closed (捨てない、仕様追補 A)
 * - MisStore 配布クエリは storeId を持つ (導入・差分承認は Phase 3.5)
 */

export interface NamedQueryMeta extends SidecarItemFile {
  id: string
  name: string
  description?: string
  src: string
  storeId?: string
  /** インストール/更新時に照合済みの配布ソース SHA-512 (#913。更新検知 #1040 の baseline) */
  storeSha512?: string
  /** インストール/更新時の registry バージョン (#913) */
  storeVersion?: string
  /** ストア配布物のアイコン (任意)。他の配布物カードと表示を揃える */
  iconUrl?: string
  /** 組込シードのクエリ (スキルの builtIn と同じ分類軸) */
  builtIn?: boolean
  createdAt: number
  updatedAt: number
}

interface QueryFileMeta {
  id: string
  name: string
  description?: string
  storeId?: string
  storeSha512?: string
  storeVersion?: string
  iconUrl?: string
  builtIn?: boolean
  createdAt: number
  updatedAt: number
}

const queryFiles = createSidecarCollection<NamedQueryMeta, QueryFileMeta>({
  logTag: 'columnQueries',
  notify: notifyWarningToast,
  kindFallback: 'query',
  idKey: 'id',
  list: () => settingsFs.listQueryFiles(),
  read: (filename) => settingsFs.readQueryFile(filename),
  write: (filename, content) => settingsFs.writeQueryFile(filename, content),
  remove: (filename) => settingsFs.deleteQueryFile(filename),
  rename: (oldFilename, newFilename) =>
    settingsFs.renameQueryFile(oldFilename, newFilename),
  idOf: (q) => q.id,
  nameOf: (q) => q.name,
  srcOf: (q) => q.src,
  // ストアインストールはファイル名 = storeId (#913。占有時は連番 suffix)
  preferredBase: (q) => q.storeId,
  mirrorSrcById: (id) =>
    getStorageJson<NamedQueryMeta[]>(STORAGE_KEYS.columnQueries, []).find(
      (q) => q.id === id,
    )?.src,
  toFileMeta: (q) => ({
    id: q.id,
    name: q.name,
    ...(q.description ? { description: q.description } : {}),
    ...(q.storeId ? { storeId: q.storeId } : {}),
    ...(q.storeSha512 ? { storeSha512: q.storeSha512 } : {}),
    ...(q.storeVersion ? { storeVersion: q.storeVersion } : {}),
    ...(q.iconUrl ? { iconUrl: q.iconUrl } : {}),
    ...(q.builtIn ? { builtIn: true } : {}),
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  }),
  fromFile: (meta, src, metaFile) => ({
    id: meta.id || metaFile,
    name: meta.name || metaFile,
    description: meta.description,
    src,
    storeId: meta.storeId,
    storeSha512: meta.storeSha512,
    storeVersion: meta.storeVersion,
    iconUrl: meta.iconUrl,
    builtIn: meta.builtIn,
    createdAt: meta.createdAt ?? Date.now(),
    updatedAt: meta.updatedAt ?? Date.now(),
  }),
})

export function generateQueryId(): string {
  return `qry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export const useColumnQueriesStore = defineStore('columnQueries', () => {
  const queries = ref<NamedQueryMeta[]>([])
  let loaded = false
  // 変更系操作 (新規作成・リネーム・保存・削除) のファイル反映は
  // 「初回読込 (対応表確定) + 初回移行」の完了を待つゲート (#913)
  let resolveReady: (() => void) | undefined
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  function ensureLoaded() {
    if (loaded) return
    loaded = true
    queries.value = getStorageJson<NamedQueryMeta[]>(
      STORAGE_KEYS.columnQueries,
      [],
    )
    if (settingsFs.isTauri) {
      void initFileStorage().finally(() => resolveReady?.())
    } else {
      resolveReady?.()
    }
  }

  async function initFileStorage() {
    try {
      const { items } = await queryFiles.loadAll()

      // 初期化中にメモリ追加されたクエリと、ミラーにだけ在るクエリ
      // (過去の書込が黙って失敗した個体) の集合。
      const fileIds = new Set(items.map((q) => q.id))
      const memoryOnly = queries.value.filter((q) => !fileIds.has(q.id))

      if (items.length > 0) {
        // ファイルが正なので localStorage ミラーを上書き (メモリ分はマージ)
        queries.value = [...items, ...memoryOnly]
      }

      // マイグレーション (#913) はメインウィンドウのみが実行する。冪等
      if (settingsFs.isMainDeckWindow()) {
        // (a) 規約外名の copy-adopt 正規化
        await queryFiles.migrateItems(queries.value)
        // (b) ミラー在・ファイル不在 → 新 slug 名で再作成 (空ソースは書かない)
        for (const q of memoryOnly) {
          if (q.readOnly || !q.src) continue
          q.fileBase = undefined // ミラー由来の旧 fileBase は無効 (ファイル不在)
          await queryFiles
            .persistItem(q, queries.value)
            .catch((e) =>
              console.warn(
                '[columnQueries] failed to persist memory-only query:',
                e,
              ),
            )
        }
        // 履歴 sweep: 主ファイルと対応の取れない .history.json5 を削除
        await queryFiles
          .sweepHistory()
          .catch((e) =>
            console.warn('[columnQueries] history sweep failed:', e),
          )
      }

      persistMirror()
    } catch (e) {
      console.warn('[columnQueries] file storage init failed', e)
    }
  }

  function persistMirror() {
    setStorageJson(STORAGE_KEYS.columnQueries, queries.value)
  }

  /** 保存・削除の直前にミラーの対応表を読み直す (別ウィンドウのリネーム追随)。 */
  function adoptMirrorFileBase(query: NamedQueryMeta) {
    const mirrored = getStorageJson<NamedQueryMeta[]>(
      STORAGE_KEYS.columnQueries,
      [],
    ).find((q) => q.id === query.id)
    if (mirrored?.fileBase) query.fileBase = mirrored.fileBase
  }

  async function persist(query: NamedQueryMeta) {
    persistMirror()
    if (settingsFs.isTauri) {
      await ready
      try {
        // ref の深い reactivity で queries.value の要素は proxy になるため、
        // 占有判定の「操作対象自身は占有とみなさない」参照一致が崩れない
        // よう live 要素 (proxy) を渡す
        const live = queries.value.find((q) => q.id === query.id) ?? query
        adoptMirrorFileBase(live)
        await queryFiles.persistItem(live, queries.value)
        // fileBase 割当をミラーへ反映
        persistMirror()
      } catch (e) {
        console.warn('[columnQueries] persist failed', e)
      }
    }
  }

  function getQuery(id: string): NamedQueryMeta | undefined {
    ensureLoaded()
    return queries.value.find((q) => q.id === id)
  }

  async function createQuery(
    input: Pick<NamedQueryMeta, 'name' | 'src'> &
      Partial<
        Pick<
          NamedQueryMeta,
          | 'id'
          | 'description'
          | 'storeId'
          | 'iconUrl'
          | 'storeSha512'
          | 'storeVersion'
        >
      >,
  ): Promise<NamedQueryMeta> {
    ensureLoaded()
    const now = Date.now()
    const query: NamedQueryMeta = {
      id: generateQueryId(),
      createdAt: now,
      updatedAt: now,
      ...input,
    }
    queries.value = [...queries.value, query]
    await persist(query)
    return query
  }

  async function updateQuery(
    id: string,
    updates: Partial<Pick<NamedQueryMeta, 'name' | 'description' | 'src'>>,
  ): Promise<void> {
    ensureLoaded()
    const idx = queries.value.findIndex((q) => q.id === id)
    if (idx < 0) return
    const prev = queries.value[idx]
    if (!prev) return
    if (prev.readOnly && updates.src !== undefined) {
      // ソース欠損の読取専用個体: 内容編集と保存を抑止 (#913)
      console.warn('[columnQueries] read-only query — src update suppressed')
      return
    }
    const next = { ...prev, ...updates, updatedAt: Date.now() }
    queries.value = queries.value.map((q) => (q.id === id ? next : q))
    // 改名はファイルを rename で追随させる (ID 不変)。完了を待ってから保存
    if (settingsFs.isTauri && updates.name && updates.name !== prev.name) {
      await ready
      try {
        adoptMirrorFileBase(next)
        await queryFiles.renameItemFiles(next, queries.value)
      } catch (e) {
        console.warn('[columnQueries] rename failed', e)
      }
    }
    await persist(next)
  }

  /**
   * ストア再インストール (#913): 本体 (src) とストア由来メタを上書き更新する。
   * ローカル値 (name の改名) は維持。ソース欠損の readOnly 個体は
   * 検証済み配布ソースで復旧する (persist 抑止を解除)。
   */
  async function applyStoreUpdate(
    id: string,
    patch: {
      src: string
      description?: string
      iconUrl?: string
      storeSha512: string
      storeVersion: string
    },
  ): Promise<void> {
    ensureLoaded()
    const idx = queries.value.findIndex((q) => q.id === id)
    const prev = queries.value[idx]
    if (!prev) return
    const next: NamedQueryMeta = {
      ...prev,
      ...patch,
      readOnly: undefined,
      updatedAt: Date.now(),
    }
    queries.value = queries.value.map((q) => (q.id === id ? next : q))
    await persist(next)
  }

  /**
   * 更新検知の基準記録 (#1040)。storeSha512 未記録のストア由来クエリへ
   * registry 現行値を無通知で記録する。本体・ローカル値・updatedAt には
   * 触れない。
   */
  async function recordStoreBaseline(
    id: string,
    patch: { storeSha512: string; storeVersion: string },
  ): Promise<void> {
    ensureLoaded()
    const prev = queries.value.find((q) => q.id === id)
    if (!prev) return
    const next: NamedQueryMeta = { ...prev, ...patch }
    queries.value = queries.value.map((q) => (q.id === id ? next : q))
    await persist(next)
  }

  /**
   * クエリを削除する。削除を取り消す undo を返す (#988 — skill / widget と同じ
   * 「confirm → 削除 → 元に戻すトースト」に揃えるため)。未知の id なら undefined。
   * カラム側の参照 (noteQueryRefs) は削除時に剥がしていないので、undo で復活
   * すれば fail-closed だったカラムがそのまま元に戻る。
   */
  async function removeQuery(id: string): Promise<(() => void) | undefined> {
    ensureLoaded()
    const idx = queries.value.findIndex((q) => q.id === id)
    const target = queries.value[idx]
    if (!target) return undefined
    // ミラー上書き前に対応表を読み直す (別ウィンドウのリネーム後の削除が
    // stale なファイル名で空振りしないように)
    if (settingsFs.isTauri) adoptMirrorFileBase(target)
    queries.value = queries.value.filter((q) => q.id !== id)
    persistMirror()
    if (settingsFs.isTauri) {
      await ready
      try {
        await queryFiles.deleteItemFiles(target)
      } catch (e) {
        console.warn('[columnQueries] delete failed', e)
      }
    }
    return () => {
      if (queries.value.some((q) => q.id === id)) return
      const at = Math.min(idx, queries.value.length)
      queries.value = [
        ...queries.value.slice(0, at),
        target,
        ...queries.value.slice(at),
      ]
      void persist(target)
    }
  }

  /** クエリ id → 適用中のカラム数 (管理カラムの表示用)。 */
  const refCountByQueryId = computed<Record<string, number>>(() => {
    const deckStore = useDeckStore()
    const counts: Record<string, number> = {}
    for (const col of deckStore.columns) {
      for (const id of col.noteQueryRefs ?? []) {
        counts[id] = (counts[id] ?? 0) + 1
      }
    }
    return counts
  })

  return {
    queries,
    ensureLoaded,
    getQuery,
    createQuery,
    updateQuery,
    applyStoreUpdate,
    recordStoreBaseline,
    removeQuery,
    refCountByQueryId,
  }
})
