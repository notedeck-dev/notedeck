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

import { i18n } from '@/i18n'

// 表示言語が変わるのはリロード時だけなので、言語ごとに 1 つ作って使い回す
let formatLang = ''
let RELATIVE: Intl.RelativeTimeFormat
let ABSOLUTE: Intl.DateTimeFormat

function formatters() {
  if (formatLang !== i18n.lang) {
    formatLang = i18n.lang
    RELATIVE = new Intl.RelativeTimeFormat(formatLang, { numeric: 'always' })
    ABSOLUTE = new Intl.DateTimeFormat(formatLang, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  }
  return { RELATIVE, ABSOLUTE }
}

// ISO 文字列の parse 結果だけを持つ。ラベルは「今との差」で変わるので
// キャッシュすると 11:59:30 の「たった今」が 12:00:30 まで居座る。
// エントリは分ごとに捨てて、長時間動かしたときに無制限に育つのを防ぐ。
const parsedCache = new Map<string, number>()
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

  if (currentMinute !== lastMinute) {
    parsedCache.clear()
    lastMinute = currentMinute
  }

  let atMs: number
  if (typeof at === 'number') {
    atMs = at
  } else {
    const cached = parsedCache.get(at)
    if (cached !== undefined) {
      atMs = cached
    } else {
      atMs = new Date(at).getTime()
      parsedCache.set(at, atMs)
    }
  }
  if (Number.isNaN(atMs)) return ''
  return relative(nowMs - atMs)
}

function relative(diffMs: number): string {
  const { RELATIVE } = formatters()
  const minutes = Math.floor(diffMs / 60000)
  // 未来の時刻 (サーバーとの時計ずれ等) は「N 分後」にせず現在扱いにする
  if (minutes < 1) return i18n.ts._time.justNow
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
  return formatters().ABSOLUTE.format(date)
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
