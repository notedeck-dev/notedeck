/**
 * タスク実行時のアカウント解決規則 (#782)。
 * 明示 id → アクティブアカウント → 最初のトークン保持アカウントの順で
 * フォールバックする。UI (toast) 結合は taskRunner store 側の責務。
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
  activeAccount: TaskAccountCandidate | null | undefined,
  defAccountId: string | null | undefined,
): TaskAccountResolution {
  if (typeof defAccountId === 'string') {
    const acc = accounts.find((a) => a.id === defAccountId)
    if (!acc)
      return { ok: false, reason: 'not-found', requestedId: defAccountId }
    return { ok: true, id: acc.id, host: acc.host }
  }
  const acc = activeAccount ?? accounts.find((a) => a.hasToken) ?? null
  if (!acc) return { ok: false, reason: 'no-account' }
  return { ok: true, id: acc.id, host: acc.host }
}
