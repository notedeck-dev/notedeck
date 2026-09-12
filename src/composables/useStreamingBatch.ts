import { computed, onScopeDispose, ref, shallowRef } from 'vue'
import type { NormalizedNote } from '@/adapters/types'
import { useFrameScheduler } from '@/composables/useFrameScheduler'
import { type VariantKey, variantKeyOf } from '@/services/noteKey'
import { usePerformanceStore } from '@/stores/performance'
import { insertIntoSorted } from '@/utils/sortNotes'

export interface UseStreamingBatchOptions {
  notes: { value: NormalizedNote[] }
  /** 列のメンバーシップ (variant key)。useNoteList の noteKeys と共有する */
  noteKeys: Set<VariantKey>
  scroller: { value: HTMLElement | null }
  maxNotes?: number
  onNewNotes?: (notes: NormalizedNote[]) => void
  /** Called once when the buffer overflows (emergency cap reached). */
  onOverflow?: () => void
}

export function useStreamingBatch(options: UseStreamingBatchOptions) {
  const perfStore = usePerformanceStore()
  const { schedule, cancel } = useFrameScheduler()
  const MAX_NOTES = options.maxNotes ?? perfStore.get('noteListMax')
  /** Streaming notes accumulated while the user is scrolled down */
  const pendingNotes = shallowRef<NormalizedNote[]>([])
  /** Tab-switch diff-fetch notes — NOT auto-flushed, banner-tap only */
  const queuedNotes = shallowRef<NormalizedNote[]>([])
  const isAtTop = ref(true)
  /** Combined count: presence (>0) drives the "新しいノート" banner visibility */
  const pendingCount = computed(
    () => pendingNotes.value.length + queuedNotes.value.length,
  )
  /** 行キー (variant key) のうちスライドインアニメーション中のもの */
  const animatingIds = shallowRef<ReadonlySet<VariantKey>>(new Set())
  const _animTimers = new Set<ReturnType<typeof setTimeout>>()
  let rafBuffer: NormalizedNote[] = []
  let rafScheduled = false
  let _paused = false

  /** IDs waiting to be cleared from animatingIds, batched into a single timer */
  let _pendingClearIds: Set<VariantKey> | null = null
  let _clearTimer: ReturnType<typeof setTimeout> | null = null

  function enableAnimation(batchIds: VariantKey[]) {
    if (batchIds.length === 0) return
    const next = new Set(animatingIds.value)
    for (const id of batchIds) next.add(id)
    animatingIds.value = next

    // Batch all pending clears into a single timer to reduce allocations
    if (!_pendingClearIds) _pendingClearIds = new Set()
    for (const id of batchIds) _pendingClearIds.add(id)

    if (_clearTimer) clearTimeout(_clearTimer)
    _clearTimer = setTimeout(() => {
      _clearTimer = null
      if (!_pendingClearIds || _pendingClearIds.size === 0) return
      const after = new Set(animatingIds.value)
      for (const id of _pendingClearIds) after.delete(id)
      _pendingClearIds = null
      animatingIds.value = after
    }, perfStore.get('noteAnimationDuration'))
    _animTimers.add(_clearTimer)
  }

  function syncNoteKeys() {
    options.noteKeys.clear()
    for (const n of options.notes.value) options.noteKeys.add(variantKeyOf(n))
  }

  function setPaused(paused: boolean) {
    _paused = paused
  }

  function flushRafBuffer() {
    rafScheduled = false
    if (rafBuffer.length === 0) return
    const batch = rafBuffer
    rafBuffer = []
    if (isAtTop.value) {
      enableAnimation(batch.map(variantKeyOf))
      for (const n of batch) options.noteKeys.add(variantKeyOf(n))
      const merged = insertIntoSorted(options.notes.value, batch)
      const truncated = merged.length > MAX_NOTES
      if (truncated) merged.length = MAX_NOTES
      options.notes.value = merged
      if (truncated) syncNoteKeys()
      options.onNewNotes?.(batch)
    } else {
      const merged = insertIntoSorted(pendingNotes.value, batch)
      if (merged.length > MAX_NOTES) merged.length = MAX_NOTES
      pendingNotes.value = merged
    }
  }

  let _overflowNotified = false

  function enqueueNote(note: NormalizedNote) {
    if (_paused) return
    // Emergency cap: prevent unbounded buffer growth (e.g. from listener leaks)
    if (rafBuffer.length >= MAX_NOTES * 2) {
      if (!_overflowNotified) {
        _overflowNotified = true
        options.onOverflow?.()
      }
      return
    }
    _overflowNotified = false
    rafBuffer.push(note)
    if (!rafScheduled) {
      rafScheduled = true
      schedule(flushRafBuffer, 'normal')
    }
  }

  function flushPending() {
    if (pendingNotes.value.length === 0) return
    const newNotes = pendingNotes.value.filter(
      (n) => !options.noteKeys.has(variantKeyOf(n)),
    )
    if (newNotes.length === 0) {
      pendingNotes.value = []
      return
    }
    enableAnimation(newNotes.map(variantKeyOf))
    for (const n of newNotes) options.noteKeys.add(variantKeyOf(n))
    const merged = insertIntoSorted(options.notes.value, newNotes)
    const truncated = merged.length > MAX_NOTES
    if (truncated) merged.length = MAX_NOTES
    options.notes.value = merged
    if (truncated) syncNoteKeys()
    pendingNotes.value = []
  }

  function handleScroll() {
    const el = options.scroller.value ?? undefined
    if (el) {
      isAtTop.value = el.scrollTop <= 10
      if (isAtTop.value && pendingNotes.value.length > 0) {
        flushPending()
      }
    }
  }

  /** Flush all pending/queued notes into the list without scrolling.
   *  Scroll is handled by the caller (useNoteColumn.scrollToTop). */
  function flushToTop() {
    isAtTop.value = true
    // Merge queued into pending for unified flush with animation
    if (queuedNotes.value.length > 0) {
      pendingNotes.value = insertIntoSorted(
        pendingNotes.value,
        queuedNotes.value,
      )
      queuedNotes.value = []
    }
    flushPending()
  }

  function removePending(key: VariantKey) {
    rafBuffer = rafBuffer.filter((n) => variantKeyOf(n) !== key)
    if (pendingNotes.value.some((n) => variantKeyOf(n) === key)) {
      pendingNotes.value = pendingNotes.value.filter(
        (n) => variantKeyOf(n) !== key,
      )
    }
    if (queuedNotes.value.some((n) => variantKeyOf(n) === key)) {
      queuedNotes.value = queuedNotes.value.filter(
        (n) => variantKeyOf(n) !== key,
      )
    }
  }

  /** Add notes to the deferred queue (tab-switch diff fetch).
   *  Not auto-flushed — only revealed on explicit banner tap / scrollToTop. */
  function addQueued(newNotes: NormalizedNote[]) {
    if (newNotes.length === 0) return
    const deduped = newNotes.filter(
      (n) => !options.noteKeys.has(variantKeyOf(n)),
    )
    if (deduped.length === 0) return
    const merged = insertIntoSorted(queuedNotes.value, deduped)
    if (merged.length > MAX_NOTES) merged.length = MAX_NOTES
    queuedNotes.value = merged
  }

  function resetBatch() {
    rafBuffer = []
    if (rafScheduled) {
      cancel(flushRafBuffer)
      rafScheduled = false
    }
    for (const t of _animTimers) clearTimeout(t)
    _animTimers.clear()
    _pendingClearIds = null
    _clearTimer = null
    animatingIds.value = new Set()
    pendingNotes.value = []
    queuedNotes.value = []
    isAtTop.value = true
  }

  onScopeDispose(resetBatch)

  return {
    pendingNotes,
    pendingCount,
    isAtTop,
    animatingIds,
    enqueueNote,
    addQueued,
    flushPending,
    handleScroll,
    flushToTop,
    removePending,
    resetBatch,
    setPaused,
  }
}
