/**
 * 予約投稿の日時表示ユーティリティ。
 */

import { i18n } from '@/i18n'

const z2 = (n: number) => String(n).padStart(2, '0')
const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0)

/** "今日 14:30" / "明日 09:00" / "12/5(金) 14:30" / "2027/2/3(水) 10:00" */
export function formatScheduleAbsolute(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  const time = { hour: '2-digit', minute: '2-digit' } as const
  const diff = Math.round(
    (startOfDay(d.getTime()) - startOfDay(now)) / 86400000,
  )
  if (diff >= -1 && diff <= 1) {
    const day = new Intl.RelativeTimeFormat(i18n.lang, {
      numeric: 'auto',
    }).format(diff, 'day')
    const hm = new Intl.DateTimeFormat(i18n.lang, time).format(d)
    return i18n.tsx._scheduleFormat.dayAt({ day, time: hm })
  }
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(i18n.lang, {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    ...time,
  }).format(d)
}

/** "あと30分" / "あと2時間15分" / "期限切れ" / 7日以上先は絶対表示 */
export function formatScheduleRelative(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now
  const past = diff < 0
  const min = Math.floor(Math.abs(diff) / 60000)
  if (min < 1)
    return past ? i18n.ts._scheduleFormat.expired : i18n.ts._scheduleFormat.soon
  if (min < 60)
    return past
      ? i18n.tsx._scheduleFormat.minutesAgo({ minutes: min })
      : i18n.tsx._scheduleFormat.inMinutes({ minutes: min })
  const h = Math.floor(min / 60)
  if (h < 24) {
    const m = min % 60
    if (m)
      return past
        ? i18n.tsx._scheduleFormat.hoursMinutesAgo({ hours: h, minutes: m })
        : i18n.tsx._scheduleFormat.inHoursMinutes({ hours: h, minutes: m })
    return past
      ? i18n.tsx._scheduleFormat.hoursAgo({ hours: h })
      : i18n.tsx._scheduleFormat.inHours({ hours: h })
  }
  const day = Math.floor(h / 24)
  if (day < 7)
    return past
      ? i18n.tsx._scheduleFormat.daysAgo({ days: day })
      : i18n.tsx._scheduleFormat.inDays({ days: day })
  return formatScheduleAbsolute(iso, now)
}

export const isPastSchedule = (iso: string, now = Date.now()) =>
  new Date(iso).getTime() < now

/** 日時ピッカーのプリセット。`at(now)` で実時刻を算出する。 */
export const SCHEDULE_PRESETS: readonly {
  label: string
  at: (now: Date) => Date
}[] = [
  {
    get label() {
      return i18n.ts._scheduleFormat.in30Minutes
    },
    at: (n) => new Date(n.getTime() + 30 * 60_000),
  },
  {
    get label() {
      return i18n.ts._scheduleFormat.in1Hour
    },
    at: (n) => new Date(n.getTime() + 60 * 60_000),
  },
  {
    get label() {
      return i18n.ts._scheduleFormat.in3Hours
    },
    at: (n) => new Date(n.getTime() + 180 * 60_000),
  },
  {
    get label() {
      return i18n.ts._scheduleFormat.tomorrow9
    },
    at: (n) => {
      const d = new Date(n)
      d.setDate(d.getDate() + 1)
      d.setHours(9, 0, 0, 0)
      return d
    },
  },
  {
    get label() {
      return i18n.ts._scheduleFormat.in1Week
    },
    at: (n) => new Date(n.getTime() + 7 * 24 * 60 * 60_000),
  },
] as const

/** input[type=date] 用 "YYYY-MM-DD"（ローカル時刻） */
export const toLocalDateInput = (d: Date) =>
  `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}`

/** input[type=time] 用 "HH:MM"（ローカル時刻） */
export const toLocalTimeInput = (d: Date) =>
  `${z2(d.getHours())}:${z2(d.getMinutes())}`

/** datetime-local input 用の "YYYY-MM-DDTHH:MM"（ローカル時刻） */
export const toLocalDatetimeInput = (d: Date) =>
  `${toLocalDateInput(d)}T${toLocalTimeInput(d)}`
