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
 */
export function useHorizontalWheel(
  options: UseHorizontalWheelOptions,
): UseHorizontalWheelReturn {
  const { containerRef, columnSelector } = options

  let pendingScroll = 0
  let rafId = 0
  let unlistenHWheel: (() => void) | null = null

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

  async function attach() {
    containerRef.value?.addEventListener('wheel', onWheel, { passive: true })

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
    if (rafId) cancelAnimationFrame(rafId)
    unlistenHWheel?.()
    unlistenHWheel = null
  }

  return { attach, detach }
}
