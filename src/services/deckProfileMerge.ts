import type { DeckProfile } from '@/stores/deck'

/**
 * ファイル読込の完了前にメモリ上だけに出来ていたプロファイルのうち、ファイル側に
 * 無いものを選ぶ (ファイルが正)。
 *
 * - 同定は「ID 一致 or 名前 + 作成日時一致」(#913 決定録 — ダウングレード往復で
 *   ファイル内 ID が剥がれた場合の複製緩和)
 * - ミラーが空だったので初回起動とみなして作った仮プロファイル
 *   (`firstRunPlaceholderId`) は、ファイルにプロファイルがあれば初回起動では
 *   なかったので捨てる (既定デッキ (#1011) 入りの複製を書き出さない)
 */
export function selectMemoryOnlyProfiles(
  memory: readonly DeckProfile[],
  file: readonly DeckProfile[],
  firstRunPlaceholderId: string | null,
): DeckProfile[] {
  if (file.length === 0) return [...memory]
  return memory.filter(
    (p) =>
      p.id !== firstRunPlaceholderId &&
      !file.some(
        (f) =>
          f.id === p.id || (f.name === p.name && f.createdAt === p.createdAt),
      ),
  )
}
