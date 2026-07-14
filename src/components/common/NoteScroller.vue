<script setup lang="ts" generic="T extends { id: string }">
import { useVirtualizer } from '@tanstack/vue-virtual'
import { computed, ref, watch } from 'vue'
import { usePerformanceStore } from '@/stores/performance'

const perfStore = usePerformanceStore()

const props = withDefaults(
  defineProps<{
    items: T[]
    /** Estimated item height for virtualizer sizing */
    estimatedHeight?: number
    /** When set, highlights the focused item (passed through, not used internally) */
    focusedId?: string
    /** Set of note IDs currently animating (slide-in for new streaming notes) */
    animatingIds?: ReadonlySet<string>
    /** Called with items beyond nearViewport that should be image-prefetched */
    prefetch?: (items: T[]) => void
  }>(),
  {
    estimatedHeight: 150,
    focusedId: undefined,
    animatingIds: () => new Set(),
    prefetch: undefined,
  },
)

const emit = defineEmits<{
  scroll: [event: Event]
  'near-end': []
}>()

const scrollContainer = ref<HTMLElement | null>(null)

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

const virtualizerOptions = computed(() => ({
  count: props.items.length,
  getScrollElement: () => scrollContainer.value,
  estimateSize: () => dynamicEstimate.value,
  overscan: perfStore.get('overscan'),
  getItemKey: (index: number) => props.items[index]?.id ?? index,
}))

const virtualizer = useVirtualizer(virtualizerOptions)

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
  /** スクロール位置復元用アンカー: 先頭可視アイテムの id + その上端からのオフセット。
   *  ピクセル scrollTop は仮想スクローラの再測定でズレるため、id 基準で保存する */
  getScrollAnchor: (): { id: string; offset: number } | null => {
    const el = scrollContainer.value
    if (!el || el.scrollTop <= 0) return null
    const scrollTop = el.scrollTop
    for (const item of virtualizer.value.getVirtualItems()) {
      if (item.end > scrollTop) {
        const id = props.items[item.index]?.id
        if (id == null) return null
        return { id: String(id), offset: scrollTop - item.start }
      }
    }
    return null
  },
  /** アンカー id へ復元する。id が見つからなければ false (呼び出し側で scrollTop にフォールバック) */
  restoreScrollAnchor: (id: string, offset: number): boolean => {
    const index = props.items.findIndex((it) => it.id === id)
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
    @scroll.passive="onScroll"
  >
    <slot name="prepend" />
    <div :class="$style.noteList" :style="{ height: `${totalSize}px` }">
      <div
        v-for="vRow in virtualItems"
        :key="props.items[vRow.index]!.id"
        :ref="measureElement"
        :data-index="vRow.index"
        :class="[
          $style.noteItem,
          animatingIds.has(props.items[vRow.index]!.id) && $style.enterAnimation,
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

/* Misskey-style slide-in animation for streaming notes.
   Uses CSS @keyframes instead of TransitionGroup — Vapor Mode compatible.
   Positioning uses the `translate` property (set via inline style),
   so `transform` is free for animation without conflict. */
.enterAnimation {
  animation:
    noteSlideIn var(--nd-duration-tl-enter) var(--nd-ease-slide),
    nd-note-highlight 0.6s 0.25s var(--nd-ease-decel) both;
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
