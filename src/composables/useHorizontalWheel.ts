import type { Ref } from 'vue'

interface UseHorizontalWheelOptions {
  containerRef: Ref<HTMLElement | null>
  /** CSS selector for elements that handle their own vertical scroll */
  columnSelector: string
}

interface UseHorizontalWheelReturn {
  attach: () => Promise<void>
  detach: () => void
}

/**
 * Passive wheel handler + Tauri hwheel event → horizontal scroll conversion.
 *
 * - deltaX dominant: browser handles natively via overflow-x: auto
 * - deltaY inside a column: browser handles vertical scroll
 * - deltaY outside a column: converted to horizontal scroll via rAF batch
 * - Windows WebView2 Shift+Wheel: deltaY→deltaX re-mapping
 * - Shift+Wheel inside a column: converted to horizontal scroll of the deck.
 *   カラムの縦スクロールを止めるため preventDefault が要るが、非 passive の
 *   wheel 購読はカラムの縦スクロールを毎回メインスレッド待ちにするので、
 *   Shift を押している間だけ購読する
 */
export function useHorizontalWheel(
  options: UseHorizontalWheelOptions,
): UseHorizontalWheelReturn {
  const { containerRef, columnSelector } = options

  let pendingScroll = 0
  let rafId = 0
  let unlistenHWheel: (() => void) | null = null
  let shiftListening = false

  function scheduleScroll(delta: number) {
    pendingScroll += delta
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        if (containerRef.value) {
          containerRef.value.scrollLeft += pendingScroll
        }
        pendingScroll = 0
        rafId = 0
      })
    }
  }

  function onWheel(e: WheelEvent) {
    if (!containerRef.value) return
    if ((e.target as HTMLElement | null)?.closest(columnSelector)) return

    // Shift+Wheel on Windows WebView2: deltaY is sent instead of deltaX
    const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX
    const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY

    // deltaX dominant → browser handles natively
    if (Math.abs(dx) > Math.abs(dy)) return

    // deltaY dominant + outside column → convert to horizontal scroll
    scheduleScroll(dy)
  }

  /** カラム内で Shift+ホイールを横に回せる要素 (コードブロック等) があればそれに任せる */
  function hasOwnHorizontalScroller(target: Element, column: Element): boolean {
    for (
      let el: Element | null = target;
      el && el !== column;
      el = el.parentElement
    ) {
      if (el.scrollWidth <= el.clientWidth) continue
      const ox = getComputedStyle(el).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
    return false
  }

  function onShiftWheel(e: WheelEvent) {
    if (!e.shiftKey) return
    const target = e.target as Element | null
    const column = target?.closest(columnSelector)
    // カラムの外は onWheel が受け持つ
    if (!target || !column) return
    if (hasOwnHorizontalScroller(target, column)) return
    const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY
    if (delta === 0) return
    e.preventDefault()
    scheduleScroll(delta)
  }

  function startShiftListening() {
    if (shiftListening || !containerRef.value) return
    shiftListening = true
    containerRef.value.addEventListener('wheel', onShiftWheel, {
      passive: false,
    })
  }

  function stopShiftListening() {
    if (!shiftListening) return
    shiftListening = false
    containerRef.value?.removeEventListener('wheel', onShiftWheel)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Shift') startShiftListening()
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.key === 'Shift') stopShiftListening()
  }

  async function attach() {
    containerRef.value?.addEventListener('wheel', onWheel, { passive: true })
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', stopShiftListening)

    // Windows hwheel: Tauri event → same rAF batch
    if ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__) {
      const { listenTauri } = await import('@/utils/tauriEvents')
      unlistenHWheel = await listenTauri('nd:hwheel', (delta) => {
        scheduleScroll(delta)
      })
    }
  }

  function detach() {
    containerRef.value?.removeEventListener('wheel', onWheel)
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', stopShiftListening)
    stopShiftListening()
    if (rafId) cancelAnimationFrame(rafId)
    unlistenHWheel?.()
    unlistenHWheel = null
  }

  return { attach, detach }
}
