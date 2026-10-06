/**
 * 手元の CLI (ACP、#1104) からの確認つき capability の事前承認 (#1191)。
 *
 * CLI は tool を呼ぶ前に ACP の許可要求を送ってくる。NoteDeck はその段階 (人の
 * ペースで待てる) で権限の判定と確認ダイアログを済ませ、承認をここに記録する。
 * 直後に届く同じ tool 呼び出し (MCP) はこの記録を 1 回だけ消費して確認を飛ばす。
 * 記録が無ければ従来どおり実行時に確認する (安全側の fallback)。
 *
 * 鍵は capability id + 引数の正規化 JSON (キー順を揃える)。CLI は許可要求と同じ
 * 引数で呼ぶので一致する。期限は短く、1 回で消える (別の呼び出しに流用されない)。
 */

export const PREAPPROVAL_TTL_MS = 10 * 60 * 1000

interface Entry {
  key: string
  expiresAt: number
}

const entries: Entry[] = []

/** 引数のキー順に依存しない正規化 JSON */
export function canonicalParams(params: unknown): string {
  return JSON.stringify(sortKeys(params ?? {}))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k])
    }
    return out
  }
  return value
}

function keyOf(capabilityId: string, params: unknown): string {
  return `${capabilityId}\u0000${canonicalParams(params)}`
}

function sweep(now: number): void {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e && e.expiresAt <= now) entries.splice(i, 1)
  }
}

/** 許可要求の段階で承認された呼び出しを記録する */
export function grantPreapproval(
  capabilityId: string,
  params: unknown,
  now: number = Date.now(),
): void {
  sweep(now)
  entries.push({
    key: keyOf(capabilityId, params),
    expiresAt: now + PREAPPROVAL_TTL_MS,
  })
}

/** 一致する記録があれば 1 件消費して true */
export function consumePreapproval(
  capabilityId: string,
  params: unknown,
  now: number = Date.now(),
): boolean {
  sweep(now)
  const key = keyOf(capabilityId, params)
  const i = entries.findIndex((e) => e.key === key)
  if (i < 0) return false
  entries.splice(i, 1)
  return true
}

/** テスト用 */
export function _resetPreapprovalsForTest(): void {
  entries.length = 0
}
