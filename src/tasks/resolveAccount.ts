/**
 * タスク実行時のアカウント解決規則 (#782)。
 * 明示 id → 最初のトークン保持アカウントの順でフォールバックする
 * (「アクティブアカウント」は #941 で廃止)。UI (toast) 結合は taskRunner
 * store 側の責務。
 */

export interface TaskAccountCandidate {
  id: string
  host: string
  hasToken: boolean
}

export type TaskAccountResolution =
  | { ok: true; id: string | null; host: string | null }
  | { ok: false; reason: 'not-found'; requestedId: string }
  | { ok: false; reason: 'no-account' }

export function resolveTaskAccount(
  accounts: readonly TaskAccountCandidate[],
  defAccountId: string | null | undefined,
): TaskAccountResolution {
  if (typeof defAccountId === 'string') {
    const acc = accounts.find((a) => a.id === defAccountId)
    if (!acc)
      return { ok: false, reason: 'not-found', requestedId: defAccountId }
    return { ok: true, id: acc.id, host: acc.host }
  }
  const acc = accounts.find((a) => a.hasToken) ?? null
  if (!acc) return { ok: false, reason: 'no-account' }
  return { ok: true, id: acc.id, host: acc.host }
}
