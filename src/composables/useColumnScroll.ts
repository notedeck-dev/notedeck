import { type Ref, ref } from 'vue'
import { smoothScrollBehavior } from '@/utils/motion'

type ScrollOwner = 'user' | 'program'

interface UseColumnScrollOptions {
  containerRef: Ref<HTMLElement | null>
  isCompact: Ref<boolean>
  windowLayout: Ref<readonly string[][]>
  onActiveColumnDetected: (columnId: string) => void
}

interface UseColumnScrollReturn {
  /** Passive scroll event handler — attach to the container's @scroll */
  onScroll: () => void
  /** Scroll the container to bring a column into view (smooth unless reduced-motion) */
  scrollToColumnId: (columnId: string) => void
  /** Dispatch a custom event to scroll to the top of a column */
  scrollColumnToTop: (index: number) => void
  /** Instantly snap to a column (used for compact ↔ desktop transitions) */
  snapToColumnId: (columnId: string) => void
  /** Current scroll owner (exposed for debugging/testing) */
  scrollOwner: Ref<ScrollOwner>
}

/**
 * Manages scroll ↔ active column synchronization with an ownership state machine.
 *
 * Two ownership states:
 * - 'user': the user is physically scrolling. Scroll position drives activeColumnId.
 * - 'program': code initiated a scroll animation. Scroll events are ignored.
 *
 * A monotonic counter ensures rapid sequential programmatic scrolls (e.g. holding
 * a keyboard shortcut) don't release ownership prematurely when an earlier
 * scrollend event fires.
 */
export function useColumnScroll(
  options: UseColumnScrollOptions,
): UseColumnScrollReturn {
  const { containerRef, isCompact, windowLayout, onActiveColumnDetected } =
    options

  const scrollOwner = ref<ScrollOwner>('user')
  let programScrollId = 0

  function claimProgramScroll(): number {
    const id = ++programScrollId
    scrollOwner.value = 'program'
    return id
  }

  function releaseProgramScroll(id: number) {
    if (id === programScrollId) {
      scrollOwner.value = 'user'
    }
  }

  // ---------------------------------------------------------------------------
  // Detection: scroll position → active column
  // ---------------------------------------------------------------------------

  /**
   * Desktop detection algorithm: sliding viewpoint.
   *
   * The detection point slides from left-of-viewport to right-of-viewport
   * proportionally to scroll progress. This ensures edge columns can be
   * detected as "active" even when they can't be centered in the viewport.
   */
  function detectActiveColumn(): string | undefined {
    const el = containerRef.value
    if (!el) return undefined
    const layout = windowLayout.value

    if (isCompact.value) {
      const w = el.clientWidth
      if (w === 0) return undefined
      const idx = Math.round(el.scrollLeft / w)
      return layout[idx]?.[0]
    }

    const maxScroll = el.scrollWidth - el.clientWidth
    const progress = maxScroll > 0 ? el.scrollLeft / maxScroll : 0
    const viewPoint = el.scrollLeft + el.clientWidth * progress
    const sections = el.querySelectorAll<HTMLElement>(':scope > section')

    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < layout.length; i++) {
      const section = sections[i]
      if (!section) continue
      const center = section.offsetLeft + section.offsetWidth / 2
      const dist = Math.abs(center - viewPoint)
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = i
      }
    }
    return layout[bestIdx]?.[0]
  }

  function onScroll() {
    if (!containerRef.value || scrollOwner.value === 'program') return
    const colId = detectActiveColumn()
    if (colId) onActiveColumnDetected(colId)
  }

  // ---------------------------------------------------------------------------
  // Programmatic scroll: active column → scroll position
  // ---------------------------------------------------------------------------

  function scrollToColumnId(columnId: string) {
    const el = containerRef.value
    if (!el) return

    if (isCompact.value) {
      const layout = windowLayout.value
      const index = layout.findIndex((group) => group.includes(columnId))
      if (index < 0) return
      const left = index * el.clientWidth
      if (Math.abs(el.scrollLeft - left) < 1) return
      // 指でスワイプ中に中点を越えて切り替わった分は scroll-snap が寄せる。
      // ここで追いかけてスクロールすると指の動きと取り合う
      if (
        scrollOwner.value === 'user' &&
        Math.round(el.scrollLeft / el.clientWidth) === index
      ) {
        return
      }
      // ナビのタップでのカラム移動は瞬時に切り替える。本家 Misskey の
      // スマホ表示はボタンからの画面切替にスクロールのアニメーションを
      // 持たないので合わせる (smooth にすると移動がもたついて見えた)
      const id = claimProgramScroll()
      el.scrollTo({ left, behavior: 'instant' })
      releaseProgramScroll(id)
      return
    }

    // Desktop: find the target element
    const target = el.querySelector(
      `.stack-cell[data-column-id="${CSS.escape(columnId)}"]`,
    )
    if (!target) return

    // Skip if already fully visible (no-op scroll would not fire scrollend)
    const targetRect = target.getBoundingClientRect()
    const containerRect = el.getBoundingClientRect()
    if (
      targetRect.left >= containerRect.left &&
      targetRect.right <= containerRect.right
    ) {
      return
    }

    const id = claimProgramScroll()
    const behavior = smoothScrollBehavior()
    target.scrollIntoView({
      behavior,
      block: 'nearest',
      inline: 'nearest',
    })
    if (behavior === 'smooth') releaseOnScrollEnd(el, id)
    else releaseProgramScroll(id)
  }

  // Release ownership when scroll animation completes.
  // Safety timeout: if scrollend never fires (e.g. element wasn't scrollable),
  // release after 1s to avoid permanently blocking user scroll detection.
  function releaseOnScrollEnd(el: HTMLElement, id: number) {
    let released = false
    const safetyTimer = setTimeout(() => {
      if (!released) {
        released = true
        releaseProgramScroll(id)
      }
    }, 1000)
    el.addEventListener(
      'scrollend',
      () => {
        if (!released) {
          released = true
          clearTimeout(safetyTimer)
          releaseProgramScroll(id)
        }
      },
      { once: true },
    )
  }

  function snapToColumnId(columnId: string) {
    const el = containerRef.value
    if (!el) return
    const layout = windowLayout.value
    const index = layout.findIndex((group) => group.includes(columnId))
    if (index < 0) return

    // Instant snap — claim and immediately release to suppress any
    // synchronous scroll events that might fire during scrollTo.
    const id = claimProgramScroll()
    el.scrollTo({
      left: index * el.clientWidth,
      behavior: 'instant',
    })
    // Release on next frame to ensure any synchronous scroll events are skipped
    requestAnimationFrame(() => {
      releaseProgramScroll(id)
    })
  }

  function scrollColumnToTop(index: number) {
    const el = containerRef.value
    if (!el) return
    const sections = el.querySelectorAll<HTMLElement>(':scope > section')
    const section = sections[index]
    if (!section) return
    section.dispatchEvent(
      new CustomEvent('nd:scroll-to-top', { bubbles: true }),
    )
  }

  return {
    onScroll,
    scrollToColumnId,
    scrollColumnToTop,
    snapToColumnId,
    scrollOwner,
  }
}
