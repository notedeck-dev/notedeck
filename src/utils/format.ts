import { i18n } from '@/i18n'

/** Format a large number with K/M suffix */
export function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
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
