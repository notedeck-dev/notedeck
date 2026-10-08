/**
 * AI セッション ID は Zettelkasten 風の 14 桁ローカル日時文字列
 * (`YYYYMMDDhhmmss`)。同一秒内に複数生成された場合のみ末尾に
 * `a`, `b`, `c`, ... と suffix を付ける。
 *
 * - 辞書ソートで自然に時系列に並ぶ
 * - ファイル名 stem としてそのまま使える
 * - 内部 `id` フィールドと完全一致（自己同定可能）
 */

/** 与えた Date をローカルタイムゾーンの `YYYYMMDDhhmmss` にフォーマット。 */
export function formatLocalTimestamp(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  )
}

/**
 * 同一秒衝突を回避するための suffix を計算する。
 * `existingIds` に `<base>` がなければそのまま、あれば `a`, `b`, ... を試す。
 * 26 個以上で衝突したら `aa`, `ab`, ... と二桁に拡張する。
 */
export function resolveCollisionSuffix(
  base: string,
  existingIds: ReadonlySet<string>,
): string {
  if (!existingIds.has(base)) return base
  // 単文字 a-z
  for (let i = 0; i < 26; i++) {
    const candidate = base + String.fromCharCode(0x61 + i)
    if (!existingIds.has(candidate)) return candidate
  }
  // 二文字 aa-zz (26*26 = 676 通り、同一秒内では現実的に起き得ない)
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const candidate =
        base + String.fromCharCode(0x61 + i) + String.fromCharCode(0x61 + j)
      if (!existingIds.has(candidate)) return candidate
    }
  }
  // 完全に枯渇したら timestamp 自体を 1 秒進める（呼び出し側で再試行する想定）
  throw new Error(
    `aiSessionId: collision suffixes exhausted for ${base} (>702 sessions in one second)`,
  )
}

/**
 * 現在時刻 + 既存 ID 集合から新しいセッション ID を生成する。
 * ファイル名 stem としてそのまま使える文字列を返す（拡張子は呼び出し側で付ける）。
 */
export function generateSessionId(
  now: Date,
  existingIds: ReadonlySet<string>,
): string {
  const base = formatLocalTimestamp(now)
  return resolveCollisionSuffix(base, existingIds)
}

/**
 * Date から生成した base 部分のみを返す（衝突解決前）。マイグレーションで
 * 旧ファイルの `createdAt` から ID を割り当てるときなどに使う。
 */
export function timestampToSessionIdBase(epochMs: number): string {
  return formatLocalTimestamp(new Date(epochMs))
}
