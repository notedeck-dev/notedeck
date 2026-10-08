<script setup lang="ts" generic="T extends { id?: string; _accountId?: string; rowKey?: string }">
import { useVirtualizer } from '@tanstack/vue-virtual'
import { computed, ref, watch } from 'vue'
import { variantKey } from '@/services/noteKey'
import { usePerformanceStore } from '@/stores/performance'

const perfStore = usePerformanceStore()

function defaultKeyOf(item: {
  id?: string
  _accountId?: string
  rowKey?: string
}): string {
  if (item.rowKey != null) return item.rowKey
  const id = item.id ?? ''
  return item._accountId ? variantKey(item._accountId, id) : id
}

const props = withDefaults(
  defineProps<{
    items: T[]
    /** Estimated item height for virtualizer sizing */
    estimatedHeight?: number
    /**
     * 行キー。既定はアイテムに `_accountId` があれば variant key (取得元アカウント +
     * id、#1010)、無ければ id。focusedId / animatingIds / leavingIds /
     * スクロールアンカーはすべてこのキー空間で受ける
     */
    keyOf?: (item: T) => string
    /** When set, highlights the focused item (passed through, not used internally) */
    focusedId?: string
    /** 行キーのうちアニメーション中のもの (slide-in for new streaming notes) */
    animatingIds?: ReadonlySet<string>
    /** 削除中の行キー (leave フェードアウト + 後続行のスライドアップ) */
    leavingIds?: ReadonlySet<string>
    /** Called with items beyond nearViewport that should be image-prefetched */
    prefetch?: (items: T[]) => void
  }>(),
  {
    estimatedHeight: 150,
    keyOf: undefined,
    focusedId: undefined,
    animatingIds: () => new Set(),
    leavingIds: () => new Set(),
    prefetch: undefined,
  },
)

const emit = defineEmits<{
  scroll: [event: Event]
  'near-end': []
}>()

const scrollContainer = ref<HTMLElement | null>(null)

// 削除・新着アニメ中とその直後だけ行の translate をトランジションさせ、
// 後続行が FLIP 風にスライドして詰まる / 押し下がるように見せる。
// 常時 transition を付けるとスクロール中の再測定でジッターするため限定する
const shifting = ref(false)
let shiftTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => props.leavingIds.size + props.animatingIds.size,
  (size) => {
    if (size > 0) {
      if (shiftTimer) clearTimeout(shiftTimer)
      shifting.value = true
    } else if (shifting.value) {
      if (shiftTimer) clearTimeout(shiftTimer)
      shiftTimer = setTimeout(() => {
        shifting.value = false
        shiftTimer = null
      }, 300)
    }
  },
)

// Dynamic estimateSize — exponential moving average (EMA) of measured item heights.
// Converges fast during bootstrap (first 10), then tracks recent height trends.
// Update is deferred to next frame to break ResizeObserver feedback loops:
//   measureElement → dynamicEstimate change → estimateSize change → layout → ResizeObserver re-fire
const EMA_ALPHA = 0.3
const BOOTSTRAP_COUNT = 10
let _emaValue = props.estimatedHeight
let _measuredCount = 0
const dynamicEstimate = ref(props.estimatedHeight)
let _estimateRafScheduled = false

const rowKey = (item: T): string => (props.keyOf ?? defaultKeyOf)(item)

const virtualizerOptions = computed(() => ({
  count: props.items.length,
  getScrollElement: () => scrollContainer.value,
  estimateSize: () => dynamicEstimate.value,
  overscan: perfStore.get('overscan'),
  getItemKey: (index: number) => {
    const item = props.items[index]
    return item ? rowKey(item) : index
  },
}))

const virtualizer = useVirtualizer(virtualizerOptions)

// 行の高さが変わったときにスクロール位置を補正するか。既定は「行の上端が
// スクロール位置より上なら補正、ただし上スクロール中の再測定は補正しない」で、
// 画面上端にかかった行で CW / もっと見る / 投票を押すと押した場所が上へ逃げ、
// 上スクロール中に画面より上の行が伸びると見ている内容が下へ跳ねる。
// - 完全に画面より上の行: 方向に関係なく補正する (見ている内容を動かさない)
// - 上端にかかっている行: 初回測定 (推定値 → 実測) だけ補正する。再測定は
//   見えている部分 (押した場所やリアクション行) が伸びた結果であることが多く、
//   補正すると見ている内容のほうが動く
watch(
  virtualizer,
  (v) => {
    v.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
      const offset = instance.scrollOffset ?? 0
      if (item.start >= offset) return false
      if (item.end <= offset) return true
      return !instance.itemSizeCache.has(item.key)
    }
  },
  { immediate: true },
)

// 画面より上の行が消えた / 差し込まれたとき (他人の削除・ミュート切替・
// Renote の道連れ・スクロール中のマージ)、仮想スクローラは位置を保持しない
// (anchorTo: 'start')。描画前に先頭可視行を覚え、描画後にその行が同じ位置に
// 来るよう scrollTop を合わせる
let pendingAnchor: { id: string; offset: number } | null = null
watch(
  () => props.items,
  () => {
    pendingAnchor = getScrollAnchor()
  },
  { flush: 'pre' },
)
watch(
  () => props.items,
  () => {
    const anchor = pendingAnchor
    pendingAnchor = null
    const el = scrollContainer.value
    if (!anchor || !el) return
    const index = props.items.findIndex((it) => rowKey(it) === anchor.id)
    if (index < 0) return
    // getVirtualItems が測定のメモを更新する (描画で呼ばれているが念のため)
    virtualizer.value.getVirtualItems()
    const start = virtualizer.value.measurementsCache[index]?.start
    if (start == null) return
    const target = start + anchor.offset
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target
  },
  { flush: 'post' },
)

/** スクロール位置復元用アンカー: 先頭可視アイテムの id + その上端からのオフセット。
 *  ピクセル scrollTop は仮想スクローラの再測定でズレるため、id 基準で保存する */
function getScrollAnchor(): { id: string; offset: number } | null {
  const el = scrollContainer.value
  if (!el || el.scrollTop <= 0) return null
  const scrollTop = el.scrollTop
  for (const item of virtualizer.value.getVirtualItems()) {
    if (item.end > scrollTop) {
      const target = props.items[item.index]
      if (!target) return null
      return { id: rowKey(target), offset: scrollTop - item.start }
    }
  }
  return null
}

const virtualItems = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

/** Indices of items near the viewport (visible + 2 overscan) for eager image loading */
const nearViewportRange = computed(() => {
  const items = virtualItems.value
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) return { start: 0, end: 0 }
  const el = scrollContainer.value
  if (!el) return { start: first.index, end: last.index }
  const scrollTop = el.scrollTop
  const viewEnd = scrollTop + el.clientHeight
  let start = first.index
  let end = last.index
  for (const item of items) {
    if (item.end >= scrollTop) {
      start = Math.max(0, item.index - perfStore.get('nearViewportBuffer'))
      break
    }
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item && item.start <= viewEnd) {
      end = item.index + perfStore.get('nearViewportBuffer')
      break
    }
  }
  return { start, end }
})

// Prefetch zone: items beyond nearViewport that should have images preloaded.
// Extends both directions — ahead aggressively, behind moderately.
const prefetchZone = computed(() => {
  const near = nearViewportRange.value
  const start = Math.max(0, near.start - perfStore.get('prefetchBehind'))
  const end = Math.min(
    near.end + perfStore.get('prefetchAhead'),
    props.items.length - 1,
  )
  return { start, end: Math.max(start, end) }
})

watch(
  prefetchZone,
  (zone) => {
    if (!props.prefetch || zone.start > zone.end) return
    const near = nearViewportRange.value
    const items: T[] = []
    for (let i = zone.start; i <= zone.end; i++) {
      // Skip items already in nearViewport (they get eager loading via DOM)
      if (i >= near.start && i <= near.end) continue
      const item = props.items[i]
      if (item) items.push(item)
    }
    if (items.length > 0) props.prefetch(items)
  },
  { immediate: true },
)

function measureElement(el: unknown) {
  if (!(el instanceof HTMLElement)) return
  virtualizer.value.measureElement(el)
  const h = el.offsetHeight
  if (h <= 0) return

  _measuredCount++
  if (_measuredCount <= BOOTSTRAP_COUNT) {
    // Bootstrap: simple incremental average for fast convergence
    _emaValue += (h - _emaValue) / _measuredCount
  } else {
    _emaValue = EMA_ALPHA * h + (1 - EMA_ALPHA) * _emaValue
  }
  // Defer reactive update to next frame to avoid ResizeObserver loop:
  // same-frame estimateSize change would trigger re-layout → re-observe → loop
  if (!_estimateRafScheduled) {
    _estimateRafScheduled = true
    requestAnimationFrame(() => {
      _estimateRafScheduled = false
      dynamicEstimate.value = Math.round(_emaValue)
    })
  }
}

// Near-end detection for load-more, throttled to 200ms.
let _lastNearEnd = 0
function onScroll(e: Event) {
  emit('scroll', e)
  const now = Date.now()
  if (now - _lastNearEnd < 100) return
  const items = virtualizer.value.getVirtualItems()
  const last = items[items.length - 1]
  if (last && last.index >= props.items.length - 10) {
    _lastNearEnd = now
    emit('near-end')
  }
}

// NOTE: Do NOT call virtualizer.measure() on items.length change.
// measure() clears the entire itemSizeCache, forcing all items back to estimateSize.
// TanStack recalculates automatically when options.count changes via the computed.

defineExpose({
  getElement: () => scrollContainer.value,
  scrollToIndex: (
    index: number,
    opts?: {
      align?: 'auto' | 'start' | 'center' | 'end'
      behavior?: ScrollBehavior
    },
  ) => {
    virtualizer.value.scrollToIndex(index, {
      align: opts?.align ?? 'auto',
      behavior: opts?.behavior ?? 'smooth',
    })
  },
  getScrollAnchor,
  /** アンカー id へ復元する。id が見つからなければ false (呼び出し側で scrollTop にフォールバック) */
  restoreScrollAnchor: (id: string, offset: number): boolean => {
    const index = props.items.findIndex((it) => rowKey(it) === id)
    if (index < 0) return false
    virtualizer.value.scrollToIndex(index, { align: 'start', behavior: 'auto' })
    // 動的高さの再測定で位置が動くため、次フレームで再アンカーしてから offset を足す
    requestAnimationFrame(() => {
      virtualizer.value.scrollToIndex(index, {
        align: 'start',
        behavior: 'auto',
      })
      const el = scrollContainer.value
      if (el) el.scrollTop += offset
    })
    return true
  },
})

defineSlots<{
  default(props: { item: T; index: number; nearViewport: boolean }): unknown
  prepend(): unknown
  append(): unknown
}>()
</script>

<template>
  <div
    ref="scrollContainer"
    :class="$style.noteScroller"
    :style="{ '--nd-note-enter': `${perfStore.get('noteAnimationDuration')}ms` }"
    @scroll.passive="onScroll"
  >
    <slot name="prepend" />
    <div :class="$style.noteList" :style="{ height: `${totalSize}px` }">
      <div
        v-for="vRow in virtualItems"
        :key="rowKey(props.items[vRow.index]!)"
        :ref="measureElement"
        :data-index="vRow.index"
        :class="[
          $style.noteItem,
          animatingIds.has(rowKey(props.items[vRow.index]!)) && $style.enterAnimation,
          leavingIds.has(rowKey(props.items[vRow.index]!)) && $style.leaveAnimation,
          shifting && $style.shifting,
        ]"
        :style="{ translate: `0 ${vRow.start}px` }"
      >
        <slot :item="props.items[vRow.index]!" :index="vRow.index" :near-viewport="vRow.index >= nearViewportRange.start && vRow.index <= nearViewportRange.end" />
      </div>
    </div>
    <slot name="append" />
  </div>
</template>

<style lang="scss" module>
.noteScroller {
  overflow-y: auto;
  /* 位置の保持は仮想スクローラ側 (上の watch) で行う。Chromium の
     scroll anchoring と二重に補正しないよう切る */
  overflow-anchor: none;
  height: 100%;
  overscroll-behavior: contain;
  position: relative;
  contain: layout style;
  /* classic scrollbar 環境でバー出現時に中身が横ズレしないよう予約 */
  scrollbar-gutter: stable;

  /* Scroll-edge fade: subtle shadow that appears when content is scrollable */
  &::after {
    content: '';
    position: sticky;
    bottom: 0;
    left: 0;
    display: block;
    width: 100%;
    height: 24px;
    margin-top: -24px;
    background: linear-gradient(to top, var(--nd-panel, var(--nd-bg)), transparent);
    opacity: 0.6;
    pointer-events: none;
    z-index: 1;
    transition: opacity var(--nd-duration-base);
  }
}

.noteList {
  position: relative;
  width: 100%;
}

.noteItem {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}

/* 削除中のフェードアウト (positioning は translate、transform は自由) */
.leaveAnimation {
  animation: note-leave 0.18s var(--nd-ease-decel) both;
  pointer-events: none;
}

@keyframes note-leave {
  to {
    opacity: 0;
    transform: scale(0.97);
  }
}

/* 削除直後だけ行位置の変化を滑らかにする (FLIP 風スライドアップ) */
.shifting {
  transition: translate 0.2s var(--nd-ease-decel);
}

/* Misskey-style slide-in animation for streaming notes.
   Uses CSS @keyframes instead of TransitionGroup — Vapor Mode compatible.
   Positioning uses the `translate` property (set via inline style),
   so `transform` is free for animation without conflict. */
.enterAnimation {
  /* スライドの時間はパフォーマンス設定 (noteAnimationDuration)。クラスを外す
     タイマー (useStreamingBatch) と同じ値なので途中で切れない */
  animation:
    noteSlideIn var(--nd-note-enter, var(--nd-duration-tl-enter)) var(--nd-ease-slide),
    nd-note-highlight var(--nd-note-enter, var(--nd-duration-tl-enter)) var(--nd-ease-decel) both;
  will-change: transform, opacity;
  isolation: isolate;
}

@keyframes noteSlideIn {
  from {
    opacity: 0;
    transform: translateY(max(-64px, -100%));
  }
  /* `to` is omitted — browser resolves to the element's computed style
     (transform: none), so the slide naturally lands at the positioned offset. */
}

</style>
