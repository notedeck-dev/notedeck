import type { NormalizedNote } from '@/adapters/types'
import { usePerformanceStore } from '@/stores/performance'
import { useSystemStateStore } from '@/stores/systemState'
import { mediaGridImage, previewableMediaCount } from '@/utils/mediaGridImage'

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
interface PrefetchItem {
  src: string
  srcset?: string
}
const prefetchQueue: PrefetchItem[] = []

/** バッテリー駆動・省電力・従量制回線では先読み自体を止める (#931 / #935) */
function isPrefetchSuppressed(): boolean {
  try {
    return useSystemStateStore().adaptation.suppressPrefetch
  } catch {
    // Store not ready yet — proceed with prefetch
    return false
  }
}

/** 抑制に入ったら未開始分を捨てる。取得していない URL は「先読み済み」からも外す (#893 と同じ理由) */
function dropQueuedPrefetches() {
  for (const item of prefetchQueue) prefetchedUrls.delete(item.src)
  prefetchQueue.length = 0
}

function pumpPrefetchQueue() {
  if (isPrefetchSuppressed()) {
    dropQueuedPrefetches()
    return
  }
  while (
    activePrefetches < MAX_CONCURRENT_PREFETCH &&
    prefetchQueue.length > 0
  ) {
    const item = prefetchQueue.shift()
    if (item === undefined) break
    activePrefetches++
    const img = new Image()
    const done = () => {
      activePrefetches--
      pumpPrefetchQueue()
    }
    img.onload = done
    img.onerror = done
    // srcset を src より先に入れる。実描画の <img> と同じ候補 (DPR で 1x/2x)
    // をブラウザに選ばせ、同じ URL をキャッシュに載せるため
    if (item.srcset) img.srcset = item.srcset
    img.src = item.src
  }
}

function enqueuePrefetch(item: PrefetchItem) {
  if (prefetchQueue.length >= MAX_QUEUE) {
    const dropped = prefetchQueue.shift()
    // 捨てた分は一度も取得していないので「先読み済み」からも外す (#893)。
    // 残したままだと、スクロールで戻ったときに永久にスキップされる
    if (dropped !== undefined) prefetchedUrls.delete(dropped.src)
  }
  prefetchQueue.push(item)
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
  if (isPrefetchSuppressed()) return
  for (const note of notes) {
    const effective = resolveEffectiveNote(note)
    const count = previewableMediaCount(effective.files)
    for (const file of effective.files) {
      if (!file.type.startsWith('image/')) continue
      if (file.isSensitive) continue
      // 実描画 (MkMediaGrid) と URL を一致させる。食い違うと WebView
      // キャッシュが再利用されず二重取得になる (#814)。グリッドは表示幅に
      // 縮小した URL を使う (#704 O-3) ので、先読みも原寸ではなくそれを読む
      const item = mediaGridImage(file, count)
      if (!item || prefetchedUrls.has(item.src)) continue
      evictOldest()
      prefetchedUrls.add(item.src)
      enqueuePrefetch(item)
    }
  }
}
