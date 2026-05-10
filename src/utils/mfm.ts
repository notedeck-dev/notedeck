/**
 * MFM cache layer — wraps the pure parser (mfmParser.ts) with an LRU cache.
 * Re-exports parser types and functions for convenience.
 */
import { usePerformanceStore } from '@/stores/performance'
import type { MfmToken, ParseOptions } from './mfmParser'
import { parseTokens } from './mfmParser'

export type { MfmToken, ParseOptions } from './mfmParser'
export { parseTokens } from './mfmParser'

// 標準 MFM と markdown 拡張は別 cache (token 構造が異なるため key を分ける)
const parseCache = new Map<string, MfmToken[]>()
const parseCacheMd = new Map<string, MfmToken[]>()
const MAX_MFM_LENGTH = 10000

function getMfmCacheMax(): number {
  try {
    return usePerformanceStore().get('mfmCacheMax')
  } catch {
    return 256
  }
}

export function parseMfm(text: string, opts?: ParseOptions): MfmToken[] {
  if (!text) return []

  // Prevent excessive CPU/memory from extremely long MFM input
  if (text.length > MAX_MFM_LENGTH) {
    return [{ type: 'text', value: text }]
  }

  const cache = opts?.markdown ? parseCacheMd : parseCache

  const cached = cache.get(text)
  if (cached) {
    // LRU: move to end so it's evicted last
    cache.delete(text)
    cache.set(text, cached)
    return cached
  }

  const tokens = parseTokens(text, opts)

  const cacheMax = getMfmCacheMax()
  if (cache.size >= cacheMax) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  cache.set(text, tokens)

  return tokens
}

/** Check if a text is already in the parse cache. */
export function parseCacheHas(text: string): boolean {
  return parseCache.has(text)
}

/** Inject pre-parsed tokens into the cache (e.g. from a Web Worker). */
export function warmCache(text: string, tokens: MfmToken[]): void {
  if (parseCache.has(text)) return
  const cacheMax = getMfmCacheMax()
  if (parseCache.size >= cacheMax) {
    const first = parseCache.keys().next().value
    if (first !== undefined) parseCache.delete(first)
  }
  parseCache.set(text, tokens)
}
