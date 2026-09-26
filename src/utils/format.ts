import { i18n } from '@/i18n'

let compactLang = ''
let COMPACT: Intl.NumberFormat

/**
 * 件数を表示言語の compact 表記で短くする (「1.2万」/「1.2K」、#704)。
 * 端数は小数 1 桁まで、0 なら付けない。正確な数が要る面は辞書の引数に数を
 * そのまま渡す (桁区切りは i18n が表示言語の書式で入れる)。
 */
export function formatCount(n: number): string {
  if (compactLang !== i18n.lang) {
    compactLang = i18n.lang
    COMPACT = new Intl.NumberFormat(compactLang, {
      notation: 'compact',
      maximumFractionDigits: 1,
    })
  }
  return COMPACT.format(n)
}

/** Format an ISO date string to a localized date */
export function formatDate(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(i18n.lang)
}

/** Format a birthday date string (YYYY-MM-DD) to a localized long date */
export function formatBirthday(dateStr: string): string {
  if (!dateStr) return ''
  const parts = dateStr.split('-').map(Number)
  const year = parts[0] ?? 0
  const month = parts[1] ?? 1
  const day = parts[2] ?? 1
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString(i18n.lang, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/** Display a URL in a compact form (hostname + path) */
export function displayUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname + (u.pathname !== '/' ? u.pathname : '')
  } catch {
    return url
  }
}
