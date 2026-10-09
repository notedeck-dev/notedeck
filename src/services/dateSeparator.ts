/**
 * 新しい順に並ぶ一覧の日付の区切り (本家 timeline-date-separate 相当, #1210)。
 *
 * 隣り合う 2 件の日付 (端末のローカル日付) が違うときだけ、区切りの両側に
 * 出す「月/日」を返す。同じ日なら null。
 */
import { i18n } from '@/i18n'

let formatLang = ''
let MONTH_DAY: Intl.DateTimeFormat

function monthDay(date: Date): string {
  if (formatLang !== i18n.lang) {
    formatLang = i18n.lang
    MONTH_DAY = new Intl.DateTimeFormat(formatLang, {
      month: 'numeric',
      day: 'numeric',
    })
  }
  return MONTH_DAY.format(date)
}

export function dateSeparator(
  newer: string | null | undefined,
  older: string | null | undefined,
): { newerText: string; olderText: string } | null {
  if (!newer || !older) return null
  const a = new Date(newer)
  const b = new Date(older)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  if (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  ) {
    return null
  }
  return { newerText: monthDay(a), olderText: monthDay(b) }
}
