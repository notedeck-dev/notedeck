import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { createSidecarCollection } from '@/services/sidecarFileCollection'
import { useDeckStore } from '@/stores/deck'
import * as settingsFs from '@/utils/settingsFs'
import { getStorageJson, STORAGE_KEYS, setStorageJson } from '@/utils/storage'

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

export interface NamedQueryMeta {
  id: string
  name: string
  description?: string
  src: string
  storeId?: string
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
  iconUrl?: string
  builtIn?: boolean
  createdAt: number
  updatedAt: number
}

const queryFiles = createSidecarCollection<NamedQueryMeta, QueryFileMeta>({
  logTag: 'columnQueries',
  srcFilename: (base) => settingsFs.querySrcFilename(base),
  metaFilename: (base) => settingsFs.queryMetaFilename(base),
  list: () => settingsFs.listQueryFiles(),
  read: (filename) => settingsFs.readQueryFile(filename),
  write: (filename, content) => settingsFs.writeQueryFile(filename, content),
  remove: (filename) => settingsFs.deleteQueryFile(filename),
  baseName: (q) => q.name || q.id,
  srcOf: (q) => q.src,
  toFileMeta: (q) => ({
    id: q.id,
    name: q.name,
    ...(q.description ? { description: q.description } : {}),
    ...(q.storeId ? { storeId: q.storeId } : {}),
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

  function ensureLoaded() {
    if (loaded) return
    loaded = true
    queries.value = getStorageJson<NamedQueryMeta[]>(
      STORAGE_KEYS.columnQueries,
      [],
    )
    if (settingsFs.isTauri) {
      void initFileStorage()
    }
  }

  async function initFileStorage() {
    try {
      const { items, entryFileCount } = await queryFiles.loadAll()
      if (entryFileCount > 0) {
        // ファイルが正なので localStorage ミラーを上書き
        if (items.length > 0) {
          queries.value = items
          persistMirror()
        }
      } else if (queries.value.length > 0) {
        // 初回: localStorage → ファイルへ片方向移行
        await queryFiles.persistAll(queries.value)
      }
    } catch (e) {
      console.warn('[columnQueries] file storage init failed', e)
    }
  }

  function persistMirror() {
    setStorageJson(STORAGE_KEYS.columnQueries, queries.value)
  }

  async function persist(query: NamedQueryMeta) {
    persistMirror()
    if (settingsFs.isTauri) {
      try {
        await queryFiles.persistItem(query)
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
      Partial<Pick<NamedQueryMeta, 'description' | 'storeId' | 'iconUrl'>>,
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
    const next = { ...prev, ...updates, updatedAt: Date.now() }
    queries.value = queries.value.map((q) => (q.id === id ? next : q))
    // 改名でファイル基底名が変わる場合は旧ファイルを消してから書く
    if (settingsFs.isTauri && updates.name && updates.name !== prev.name) {
      try {
        await queryFiles.deleteItemFiles(prev)
      } catch (e) {
        console.warn('[columnQueries] rename cleanup failed', e)
      }
    }
    await persist(next)
  }

  async function removeQuery(id: string): Promise<void> {
    ensureLoaded()
    const target = queries.value.find((q) => q.id === id)
    if (!target) return
    queries.value = queries.value.filter((q) => q.id !== id)
    persistMirror()
    if (settingsFs.isTauri) {
      try {
        await queryFiles.deleteItemFiles(target)
      } catch (e) {
        console.warn('[columnQueries] delete failed', e)
      }
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
    removeQuery,
    refCountByQueryId,
  }
})
