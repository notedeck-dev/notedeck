/**
 * 経過時間の相対表示 (#704 H)。
 *
 * 以前はタイムラインだけ英語 (5m / 3h) で、他の画面はそれぞれ独自の和文実装を
 * 持っていた。同じ「5 分前」が画面ごとに違う書き方になるので、表記は
 * Intl.RelativeTimeFormat に委ねてここを唯一の実装にする。
 *
 * 未来向きの表示 (予約投稿の「あと 30 分」) は語彙も丸め方も別物なので
 * scheduleFormat.ts が持つ。こちらは過去向き専用。
 */

// 表示言語は日本語固定 (i18n は #135)
const RELATIVE = new Intl.RelativeTimeFormat('ja', { numeric: 'always' })
const ABSOLUTE = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

// Cache keyed on "iso:currentMinute" to avoid repeated Date allocations
const timeCache = new Map<string, string>()
let lastMinute = -1

/**
 * ISO 文字列または epoch ミリ秒を「5 分前」の形にする。
 *
 * `nowMs` は定期更新する ref を渡すためのもの (渡さなければ現在時刻)。
 * 呼び出し側がタイマーで再描画したいとき、その ref をここへ通せば
 * リアクティブな依存になる。
 */
export function formatTime(
  at: string | number | null | undefined,
  nowMs = Date.now(),
): string {
  if (at === null || at === undefined || at === '') return ''
  const currentMinute = Math.floor(nowMs / 60000)

  // Invalidate cache every minute
  if (currentMinute !== lastMinute) {
    timeCache.clear()
    lastMinute = currentMinute
  }

  const key = String(at)
  const cached = timeCache.get(key)
  if (cached) return cached

  const atMs = typeof at === 'number' ? at : new Date(at).getTime()
  if (Number.isNaN(atMs)) return ''
  const result = relative(nowMs - atMs)

  timeCache.set(key, result)
  return result
}

function relative(diffMs: number): string {
  const minutes = Math.floor(diffMs / 60000)
  // 未来の時刻 (サーバーとの時計ずれ等) は「N 分後」にせず現在扱いにする
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return RELATIVE.format(-minutes, 'minute')

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return RELATIVE.format(-hours, 'hour')

  const days = Math.floor(hours / 24)
  if (days < 30) return RELATIVE.format(-days, 'day')

  const months = Math.floor(days / 30)
  if (months < 12) return RELATIVE.format(-months, 'month')

  return RELATIVE.format(-Math.floor(days / 365), 'year')
}

/** <time> の title に出す絶対時刻 ("2025/06/15 20:45")。 */
export function formatAbsoluteTime(
  at: string | number | null | undefined,
): string {
  if (at === null || at === undefined || at === '') return ''
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  return ABSOLUTE.format(date)
}

/** <time datetime> 属性の値 (ISO 8601)。読めない値では属性ごと落とす。 */
export function toDatetimeAttr(
  at: string | number | null | undefined,
): string | undefined {
  if (at === null || at === undefined || at === '') return undefined
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}
