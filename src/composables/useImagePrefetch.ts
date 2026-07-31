import type { NormalizedNote } from '@/adapters/types'
import { usePerformanceStore } from '@/stores/performance'
import { proxyUrl } from '@/utils/mediaProxy'
import { isSafeUrl } from '@/utils/url'

/**
 * Prefetch image URLs from notes that are about to enter the viewport.
 * Uses new Image() to populate the browser cache so images display instantly
 * when the virtual scroller renders the items.
 */

const prefetchedUrls = new Set<string>()

/**
 * プリフェッチの同時実行上限。バックエンドの取得セマフォ (30 並列) は
 * 絵文字・アバターと共有なので、先読みの添付画像で埋めると、いま見えて
 * いる面の画像がソフト予算 (media_proxy::SOFT_WAIT_BUDGET) 超過に
 * 押し出される。先読みは急がないので細く流す。
 */
const MAX_CONCURRENT_PREFETCH = 4

/** 高速スクロールで陳腐化した先読みを溜め込まない上限 (古い順に捨てる) */
const MAX_QUEUE = 100

let activePrefetches = 0
const prefetchQueue: string[] = []

function pumpPrefetchQueue() {
  while (
    activePrefetches < MAX_CONCURRENT_PREFETCH &&
    prefetchQueue.length > 0
  ) {
    const url = prefetchQueue.shift()
    if (url === undefined) break
    activePrefetches++
    const img = new Image()
    const done = () => {
      activePrefetches--
      pumpPrefetchQueue()
    }
    img.onload = done
    img.onerror = done
    img.src = url
  }
}

function enqueuePrefetch(url: string) {
  if (prefetchQueue.length >= MAX_QUEUE) prefetchQueue.shift()
  prefetchQueue.push(url)
  pumpPrefetchQueue()
}

function getTrackedMax(): number {
  try {
    return usePerformanceStore().get('prefetchTrackedMax')
  } catch {
    return 500
  }
}

function evictOldest() {
  if (prefetchedUrls.size <= getTrackedMax()) return
  const iter = prefetchedUrls.values()
  // Remove oldest 100 entries to avoid frequent eviction
  for (let i = 0; i < 100; i++) {
    const v = iter.next().value
    if (v !== undefined) prefetchedUrls.delete(v)
    else break
  }
}

function resolveEffectiveNote(note: NormalizedNote): NormalizedNote {
  // Pure renote → use inner note (same logic as MkNote.effectiveNote)
  return note.renote && note.text === null ? note.renote : note
}

export function prefetchNoteImages(notes: NormalizedNote[]): void {
  // Skip prefetch in low-quality mode (images are blurred/hidden anyway)
  try {
    if (usePerformanceStore().get('cssBlurLevel') === 0) return
  } catch {
    // Store not ready yet — proceed with prefetch
  }
  for (const note of notes) {
    const effective = resolveEffectiveNote(note)
    for (const file of effective.files) {
      if (!file.type.startsWith('image/')) continue
      if (file.isSensitive) continue
      // 実描画 (MkMediaGrid) と URL を一致させる。食い違うと WebView
      // キャッシュが再利用されず二重取得になる (#814)。添付画像は
      // プロキシ経由に統一済み (#815) なので prefetch も同じ変換を通す
      const rawUrl = file.thumbnailUrl || file.url
      if (!rawUrl || !isSafeUrl(rawUrl)) continue
      const url = proxyUrl(rawUrl) ?? rawUrl
      if (prefetchedUrls.has(url)) continue
      evictOldest()
      prefetchedUrls.add(url)
      enqueuePrefetch(url)
    }
  }
}
