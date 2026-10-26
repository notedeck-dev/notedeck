import type { NormalizedNote } from '@/adapters/types'
import type { CachedSearchFilters } from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'

export type { CachedSearchFilters }

/**
 * 手元のアーカイブ (notecli.db) を引く口 (#1258)。サーバーへは行かない。
 * 引数の並びは Rust 側のコマンドと同じ。bindings の NormalizedNote は
 * `_identity` が任意になっているので adapters の型に寄せる (索引の行は常に持つ)
 */
function asNotes(r: Parameters<typeof unwrap>[0]): NormalizedNote[] {
  return unwrap(r) as unknown as NormalizedNote[]
}

export function searchArchiveNotes(
  accountId: string,
  query: string,
  limit: number | null,
  sinceDate: string | null,
  untilDate: string | null,
  ascending: boolean | null,
): Promise<NormalizedNote[]> {
  return commands
    .apiSearchNotesLocal(
      accountId,
      query,
      limit,
      sinceDate,
      untilDate,
      ascending,
    )
    .then(asNotes)
}

export function searchArchiveNotesAcross(
  accountIds: string[],
  query: string,
  limit: number | null,
  sinceDate: string | null,
  untilDate: string | null,
  ascending: boolean | null,
  filters: CachedSearchFilters | null,
): Promise<NormalizedNote[]> {
  return commands
    .apiSearchNotesCachedAcross(
      accountIds,
      query,
      limit,
      sinceDate,
      untilDate,
      ascending,
      filters,
    )
    .then(asNotes)
}

/** 同一性 (正規化した AP object id) が一致する手元のノート全部 (#1058) */
export function findArchiveNotesByIdentity(
  uri: string,
): Promise<NormalizedNote[]> {
  return commands.apiFindNotesByIdentity(uri).then(asNotes)
}

/** ノートの同一性キーの導出。notecli 側 1 か所 (#1058) */
export function noteIdentityOf(uri: string): Promise<string> {
  return commands.apiNoteIdentity(uri).then(unwrap)
}
