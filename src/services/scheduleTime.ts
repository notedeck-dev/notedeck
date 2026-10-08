/**
 * 予約投稿の日時の純関数 (判定と input 値の整形)。表示文言 (i18n) は
 * utils/scheduleFormat。
 */

const z2 = (n: number) => String(n).padStart(2, '0')

export const isPastSchedule = (iso: string, now = Date.now()) =>
  new Date(iso).getTime() < now

/** input[type=date] 用 "YYYY-MM-DD"（ローカル時刻） */
export const toLocalDateInput = (d: Date) =>
  `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}`

/** input[type=time] 用 "HH:MM"（ローカル時刻） */
export const toLocalTimeInput = (d: Date) =>
  `${z2(d.getHours())}:${z2(d.getMinutes())}`

/** datetime-local input 用の "YYYY-MM-DDTHH:MM"（ローカル時刻） */
export const toLocalDatetimeInput = (d: Date) =>
  `${toLocalDateInput(d)}T${toLocalTimeInput(d)}`
