/**
 * MFM cache layer — wraps the pure parser (mfmParser.ts) with an LRU cache.
 * Re-exports parser types and functions for convenience.
 */

import type { MfmNode, ParseOptions } from '@/services/mfmParser'
import { parseTokens } from '@/services/mfmParser'
import { usePerformanceStore } from '@/stores/performance'

export type { MfmNode, ParseOptions } from '@/services/mfmParser'
export { parseTokens } from '@/services/mfmParser'

// 標準 MFM と memo 向け拡張は別 cache (ノード構造が異なるため key を分ける)
const parseCache = new Map<string, MfmNode[]>()
const parseCacheMd = new Map<string, MfmNode[]>()
const MAX_MFM_LENGTH = 10000

function getMfmCacheMax(): number {
  try {
    return usePerformanceStore().get('mfmCacheMax')
  } catch {
    return 256
  }
}

export function parseMfm(text: string, opts?: ParseOptions): MfmNode[] {
  if (!text) return []

  // Prevent excessive CPU/memory from extremely long MFM input
  if (text.length > MAX_MFM_LENGTH) {
    return [{ type: 'text', props: { text } }]
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
export function warmCache(text: string, tokens: MfmNode[]): void {
  if (parseCache.has(text)) return
  const cacheMax = getMfmCacheMax()
  if (parseCache.size >= cacheMax) {
    const first = parseCache.keys().next().value
    if (first !== undefined) parseCache.delete(first)
  }
  parseCache.set(text, tokens)
}
