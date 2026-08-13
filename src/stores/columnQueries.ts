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
 * - スコープはプラグインと同型 (#1018): 全体 / アカウント別 / ライブラリのみ。
 *   クエリ自体は純粋 (アカウント状態を参照しない) だが、どのアカウントの
 *   カラムで選べるかを持たせて、アカウントごとに使い分けられるようにする
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
  /**
   * 全体スコープ参加 (#1018、プラグインの #771 と同型)。true なら全アカウント
   * (後から追加した分も含む) のカラムで選べる。
   */
  global?: boolean
  /**
   * アカウント別スコープ参加。`accountScopeKey` (host:userId) の配列。
   * 再ログインで再生成される内部 UUID ではなく安定キーで持つ。
   * global と installedFor の両方が無いものはライブラリのみ (どこでも選べない)。
   */
  installedFor?: string[]
  /**
   * スコープ機構に載った個体の印。これが無いものはスコープ導入前に作られた
   * ので、初回読込で全体スコープへ移行する。ライブラリ状態 (どのスコープにも
   * 属さない) を再起動後も保てるよう、移行済みかどうかを個体側に持たせる。
   */
  scoped?: boolean
  createdAt: number
  updatedAt: number
}

/** インストール/追加先スコープ (#1018)。カラムの文脈から決まる。 */
export type QueryScope = { kind: 'global' } | { kind: 'account'; key: string }

/**
 * クエリが scopeKey (`accountScopeKey`) のアカウントで選べるか。
 * scopeKey=null は「アカウント文脈なし」= 全体スコープのみ有効。
 */
export function isQueryEffectiveFor(
  query: NamedQueryMeta,
  scopeKey: string | null,
): boolean {
  if (query.global) return true
  if (!scopeKey) return false
  return query.installedFor?.includes(scopeKey) ?? false
}

interface QueryFileMeta {
  id: string
  name: string
  description?: string
  storeId?: string
  storeSha512?: string
  storeVersion?: string
  iconUrl?: string
  global?: boolean
  installedFor?: string[]
  scoped?: boolean
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
    ...(q.global ? { global: true } : {}),
    ...(q.installedFor?.length ? { installedFor: q.installedFor } : {}),
    ...(q.scoped ? { scoped: true } : {}),
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
    global: meta.global,
    installedFor: meta.installedFor,
    scoped: meta.scoped,
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
    migrateScopes(queries.value)
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
        migrateScopes(queries.value)
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

  /**
   * スコープ導入前 (#1018 以前) のクエリを全体スコープへ移行する。
   * 当時のクエリはどのカラムからも選べる 1 つのプールだったので、その意味を
   * 保つ全体スコープに倒す。`scoped` を印として書き戻すので、ここで移行した
   * 個体をあとでライブラリへ落としても再起動で復活しない。
   */
  function migrateScopes(list: NamedQueryMeta[]) {
    let changed = false
    for (const q of list) {
      if (q.scoped) continue
      q.scoped = true
      q.global = true
      changed = true
    }
    if (changed) void Promise.all(list.map((q) => persist(q)))
  }

  /** 全体スコープに参加させる。全アカウントのカラムからの作成/追加用。 */
  function linkGlobalScope(id: string) {
    ensureLoaded()
    const query = queries.value.find((q) => q.id === id)
    if (!query || query.global) return
    query.global = true
    query.scoped = true
    void persist(query)
  }

  /** 全体スコープから外す。本体はライブラリに残る。 */
  function unlinkGlobalScope(id: string) {
    ensureLoaded()
    const query = queries.value.find((q) => q.id === id)
    if (!query?.global) return
    query.global = undefined
    query.scoped = true
    void persist(query)
  }

  /** アカウント別スコープ (`accountScopeKey`) に参加させる (union)。 */
  function linkAccountScope(id: string, scopeKey: string) {
    ensureLoaded()
    const query = queries.value.find((q) => q.id === id)
    if (!query) return
    const existing = query.installedFor ?? []
    if (existing.includes(scopeKey)) return
    query.installedFor = [...existing, scopeKey]
    query.scoped = true
    void persist(query)
  }

  /** アカウント別スコープから外す。本体はライブラリに残る。 */
  function unlinkAccountScope(id: string, scopeKey: string) {
    ensureLoaded()
    const query = queries.value.find((q) => q.id === id)
    if (!query?.installedFor) return
    const remaining = query.installedFor.filter((k) => k !== scopeKey)
    query.installedFor = remaining.length > 0 ? remaining : undefined
    query.scoped = true
    void persist(query)
  }

  /** scope に応じて全体 / アカウント別へ振り分ける。 */
  function linkScope(id: string, scope: QueryScope) {
    if (scope.kind === 'global') linkGlobalScope(id)
    else linkAccountScope(id, scope.key)
  }

  function unlinkScope(id: string, scope: QueryScope) {
    if (scope.kind === 'global') unlinkGlobalScope(id)
    else unlinkAccountScope(id, scope.key)
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
      > & {
        /** 参加させるスコープ (#1018)。省略時はライブラリのみ */
        scope?: QueryScope
      },
  ): Promise<NamedQueryMeta> {
    ensureLoaded()
    const now = Date.now()
    const { scope, ...rest } = input
    const query: NamedQueryMeta = {
      id: generateQueryId(),
      createdAt: now,
      updatedAt: now,
      // 新規個体は最初からスコープ機構に載っているので移行対象にしない
      scoped: true,
      ...(scope?.kind === 'global' ? { global: true } : {}),
      ...(scope?.kind === 'account' ? { installedFor: [scope.key] } : {}),
      ...rest,
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
    linkScope,
    unlinkScope,
    updateQuery,
    applyStoreUpdate,
    recordStoreBaseline,
    removeQuery,
    refCountByQueryId,
  }
})
