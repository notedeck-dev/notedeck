import type { NormalizedNote, ServerAdapter } from '@/adapters/types'
import type { QirQuery } from '@/bindings'
import { useNoteStore } from '@/stores/notes'
import { usePerformanceStore } from '@/stores/performance'
import { catchLog } from '@/utils/logger'
import { commands, unwrap } from '@/utils/tauriInvoke'

/** Load cached notes from SQLite. */
export async function loadCachedTimeline(
  accountId: string,
  timelineType: string,
  limit?: number,
): Promise<NormalizedNote[]> {
  const effectiveLimit =
    limit ?? usePerformanceStore().get('cachedTimelineLimit')
  return unwrap(
    await commands.apiGetCachedTimeline(
      accountId,
      timelineType,
      effectiveLimit,
    ),
  ) as unknown as NormalizedNote[]
}

/**
 * Load older cached notes before a given cursor.
 *
 * `beforeNoteId` は keyset cursor の tie-break。`before` と同一ノート由来の
 * ペアで渡すこと — 同一 createdAt が limit 以上並ぶバケットでも前進できる
 * (notecli#30 v5 §6-14)。null なら現行互換の createdAt 包含比較。
 */
export async function loadCachedTimelineBefore(
  accountId: string,
  timelineType: string,
  before: string,
  beforeNoteId: string | null,
  limit?: number,
): Promise<NormalizedNote[]> {
  const effectiveLimit =
    limit ?? usePerformanceStore().get('cachedTimelineLimit')
  return unwrap(
    await commands.apiGetCachedTimelineBefore(
      accountId,
      timelineType,
      before,
      beforeNoteId,
      effectiveLimit,
    ),
  ) as unknown as NormalizedNote[]
}

/**
 * Background-verify that cached notes still exist on the server.
 * Uses a single bulk IPC call to verify all notes in parallel on the Rust side.
 * Missing notes are purged from noteStore + DB cache; confirmed notes are refreshed.
 */
export async function purgeStaleCachedNotes(
  _adapter: ServerAdapter,
  idsToVerify: string[],
  isStillMounted: () => boolean,
  accountId: string,
): Promise<void> {
  if (idsToVerify.length === 0 || !isStillMounted()) return

  const noteStore = useNoteStore()
  try {
    const result = unwrap(await commands.apiVerifyNotes(accountId, idsToVerify))

    if (!isStillMounted()) return

    // Update confirmed notes with fresh data
    for (const [id, fresh] of Object.entries(result.verified)) {
      if (fresh) noteStore.update(id, fresh as unknown as NormalizedNote)
    }

    // 削除するのは `missing` (サーバーが NO_SUCH_NOTE を返した = 削除確認済み)
    // のみ。verified にも missing にも無い id は通信エラー・レート制限等の
    // 「生存扱い」なので触らない — 復帰直後の不安定なネットワークでキャッシュを
    // 誤って恒久削除しない (notecli#30 v5 §6-8)。
    // verify-miss を tombstone しないのは従来どおり (false-positive 回避)。
    for (const id of result.missing) {
      noteStore.remove(id, false)
      commands
        .apiDeleteCachedNote(accountId, id)
        .catch(catchLog('delete-cached-note'))
    }
  } catch {
    // Bulk verify failed — silently ignore (notes stay cached)
  }
}

/**
 * カラムクエリでローカルキャッシュを検索する (#783 Phase 3)。
 *
 * FTS5 で粗く絞ってから Rust の QIR 評価器で判定するので、条件に合うノートを
 * 見つけるまで遡れる。`before` より古い側を、走査上限まで読んで探す。
 *
 * `timelineKey` (canonical 形式 — columnCacheKey が導出する) を渡すと、
 * カラムの所属バケットのみを母集合にする。実体/所属分離 (notecli#30) 以前は
 * 所属が後勝ち上書きで種別絞りが取りこぼしになるため全体走査に倒していたが、
 * その妥協は解消済み (notecli#30 v5 §12-9)。null は全所属横断で走査する。
 * カーソルは同じ timelineKey の続き読みにのみ使うこと。
 */
export async function searchCachedNotesByQuery(
  accountId: string,
  query: QirQuery,
  timelineKey: string | null,
  before: { createdAt: string; noteId: string } | null,
  limit: number,
  maxScannedRows: number,
): Promise<{
  notes: NormalizedNote[]
  errors: number
  /** 走査上限で打ち切った位置。null なら読み切っている */
  cursor: { createdAt: string; noteId: string } | null
}> {
  const result = unwrap(
    await commands.qirSearchCache(
      accountId,
      query,
      timelineKey,
      limit,
      maxScannedRows,
      before,
    ),
  )
  return {
    notes: result.notes as unknown as NormalizedNote[],
    errors: result.errors,
    cursor: result.cursor,
  }
}
