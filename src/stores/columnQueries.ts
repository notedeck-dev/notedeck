import { defineStore } from 'pinia'
import { computed } from 'vue'
import { releaseSharedSuspension } from '@/services/columnQuery/degradedRunner'
import {
  type DistributableScope,
  isInScope,
  type ScopeTarget,
  withScopeTarget,
} from '@/services/distributable'
import {
  type QueryItem,
  queryCodec,
} from '@/services/distributableCodecs/queryCodec'
import {
  sidecarCollectionFor,
  sidecarFileBaseOf,
} from '@/services/distributableCodecs/sidecar'
import { useDeckStore } from '@/stores/deck'
import { createDistributableStore } from '@/stores/distributableStore'
import * as settingsFs from '@/utils/settingsFs'
import { STORAGE_KEYS } from '@/utils/storage'
import { notifyWarningToast } from '@/utils/toastNotify'

/**
 * 名前付きカラムクエリのプール (#783 Phase 1.5、仕様追補 A)。
 *
 * - 個体は envelope (`QueryItem`、#1202 段階 1)。本文 (`content`) は AiScript
 *   ソース、`extra.active` が本体の有効 (#1043)、`extra.scoped` はスコープ
 *   機構に載った印 (#1018)
 * - スコープはプラグインと同型 (#1018): 全体 / アカウント別 / ライブラリのみ。
 *   クエリ自体は純粋 (アカウント状態を参照しない) だが、どのアカウントの
 *   カラムで選べるかを持たせて、アカウントごとに使い分けられるようにする
 * - 保存はウィジェットと同じ sidecar 形式 (`queries/<name>.is` + `.meta.json5`)。
 *   projection は `queryCodec`
 * - カラムは id で参照する (DeckColumn.noteQueryRefs)。参照消失は
 *   useNoteColumn 側で fail-closed (捨てない、仕様追補 A)
 * - MisStore 配布クエリは `store` を持つ (導入・差分承認は Phase 3.5)
 */

export type { QueryItem } from '@/services/distributableCodecs/queryCodec'

/** 本体の有効 (#1043)。判定は codec の宣言 1 箇所 */
export function isQueryActive(query: QueryItem): boolean {
  return queryCodec.enabled.get(query)
}

/**
 * フィルタメニューの候補に出すか (#1043)。
 * - 有効でスコープ内: 出す
 * - 無効で未適用: 出さない (使えない選択肢で場所と認知負荷を食わない)
 * - 適用済み: スコープ外でも無効でも出す (外す導線と、効いていない理由を
 *   追えるように。行には「無効」チップが付く)
 */
export function isQueryOfferedFor(
  query: QueryItem,
  scopeKey: string | null,
  applied: ReadonlySet<string>,
): boolean {
  if (applied.has(query.id)) return true
  return isQueryActive(query) && isInScope(query.scope, scopeKey)
}

/**
 * アカウントに紐づかないカラム (全アカウント TL / クライアント検索) で選べるか。
 * 面はログイン中の全アカウントを横断するので、どれかのアカウントのスコープに
 * 入っているクエリも候補に出す (全体スコープだけだと、アカウントのカラムで
 * 作ったクエリが 1 つも出ずトグルの節ごと消える、2026-10-04)。アカウントが
 * 1 つも無ければ全体スコープだけ
 */
export function isQueryOfferedForAny(
  query: QueryItem,
  scopeKeys: readonly string[],
  applied: ReadonlySet<string>,
): boolean {
  if (applied.has(query.id)) return true
  if (!isQueryActive(query)) return false
  if (scopeKeys.length === 0) return isInScope(query.scope, null)
  return scopeKeys.some((key) => isInScope(query.scope, key))
}

const queryFiles = sidecarCollectionFor(queryCodec, {
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
})

export function generateQueryId(): string {
  return `qry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const LIBRARY_ONLY: DistributableScope = {
  kind: 'shared',
  global: false,
  installedFor: [],
}

/**
 * スコープ導入前 (#1018 以前) のクエリを全体スコープへ移行する。
 * 当時のクエリはどのカラムからも選べる 1 つのプールだったので、その意味を
 * 保つ全体スコープに倒す。`scoped` を印として書き戻すので、ここで移行した
 * 個体をあとでライブラリへ落としても再起動で復活しない。
 */
function migrateScopes(list: QueryItem[]): QueryItem[] {
  const changed: QueryItem[] = []
  for (const q of list) {
    if (q.extra.scoped) continue
    q.extra = { ...q.extra, scoped: true }
    q.scope = withScopeTarget(q.scope, { kind: 'global' })
    changed.push(q)
  }
  return changed
}

export const useColumnQueriesStore = defineStore('columnQueries', () => {
  const base = createDistributableStore<string, QueryItem>({
    logTag: 'columnQueries',
    codec: queryCodec,
    files: queryFiles,
    settingsScope: 'queries',
    fileBaseOf: sidecarFileBaseOf,
    browserStorageKey: STORAGE_KEYS.columnQueries,
    generateId: generateQueryId,
    // 履歴の形は `queries.revert` (notecore) とエディタの履歴窓が読むので
    // キー名は on-disk の互換を保つ (src / name / description)
    history: {
      kind: 'query',
      snapshot: (q) => ({
        src: q.content,
        name: q.name,
        description: q.description,
      }),
    },
    // アカウント削除時は紐付けを外すだけ (#1114)。本体はライブラリに残る
    purgeAccount: 'unlink',
    hooks: {
      migrate: migrateScopes,
      // ソースが変わったら暴走サスペンドを解除する (#783 追補 D / #1112)。
      // 有効 / 無効の切替では解除しない (解除は明示の「再開」かソース編集だけ)
      afterContentChange: (q) => releaseSharedSuspension(q.id),
    },
  })

  /** 新規作成。参加先を省略すればライブラリのみ (#1018) */
  function add(
    input: Pick<QueryItem, 'name' | 'content'> &
      Partial<Pick<QueryItem, 'id' | 'description' | 'iconUrl' | 'store'>> & {
        scope?: ScopeTarget
      },
  ): Promise<QueryItem> {
    const { scope, ...rest } = input
    return base.add({
      ...rest,
      scope: scope ? withScopeTarget(LIBRARY_ONLY, scope) : LIBRARY_ONLY,
      // 新規個体は最初からスコープ機構に載っているので移行対象にしない
      extra: { scoped: true, active: true },
    })
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

  return { ...base, add, refCountByQueryId }
})
