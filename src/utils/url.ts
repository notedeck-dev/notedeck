/** Returns true only for http: and https: URLs. Blocks javascript:, data:, etc. */
export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Open a URL via Tauri opener if it passes safety check. */
export async function openSafeUrl(
  url: string | null | undefined,
): Promise<void> {
  if (!url || !isSafeUrl(url)) return
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url)
}

/** Misskey WebUI (`https://<host>`) の URL を組み立てる。委譲導線は全てここを通す。 */
export function webUiUrl(host: string, path = ''): string {
  return `https://${host}${path}`
}

/**
 * Match `memo:<id>` link scheme. id は Zettelkasten 形式 (`YYYYMMDDHHmmss`、14 桁数字)。
 * `useMemos.generateMemoKey` 形式に合わせる。
 *
 * - `isSafeUrl` は変更しない (http/https 限定維持) — `memo:` は app 内 navigation
 *   専用 scheme で OS の opener には流さないため、別経路で判定する。
 */
export function isMemoUrl(url: string): { id: string } | null {
  const m = /^memo:(\d{14})$/.exec(url)
  if (!m) return null
  return { id: m[1] as string }
}

/** Sanitize a URL for use in CSS url(). Returns 'none' for invalid/unsafe URLs. */
export function safeCssUrl(url: string | null | undefined): string {
  if (!url) return 'none'
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'none'
    const safe = u.href.replace(/[()'"\\]/g, (c) => `\\${c}`)
    return `url(${safe})`
  } catch {
    return 'none'
  }
}
