import { onUnmounted, type Ref, ref, watch } from 'vue'

import { usePerformanceStore } from '@/stores/performance'
import { isFromNestedOverlay } from '@/utils/gesture'
import { hapticMedium } from '@/utils/haptics'

// Misskey 本家と同じパラメータ
const SCROLL_STOP = 10
const DIRECTION_THRESHOLD = 8 // px — same as useSwipeTab
const MAX_PULL_DISTANCE = Infinity
const PULL_BRAKE_BASE = 1.5
const PULL_BRAKE_FACTOR = 170
const RELEASE_TRANSITION_DURATION = 200

export function usePullToRefresh(
  scrollerRef: Ref<HTMLElement | null>,
  onRefresh: () => Promise<void>,
) {
  const FIRE_THRESHOLD = usePerformanceStore().get('pullFireThreshold')
  const isPulling = ref(false)
  const isPulledEnough = ref(false)
  const isRefreshing = ref(false)
  const pullDistance = ref(0)

  let startScreenY: number | null = null
  let startScreenX: number | null = null
  let direction: 'vertical' | 'horizontal' | null = null
  let boundEl: HTMLElement | null = null

  function getEl(): HTMLElement | null {
    return scrollerRef.value
  }

  /** 表示上の高さ（非線形ブレーキ） */
  function displayHeight(): number {
    return Math.round(
      pullDistance.value /
        (PULL_BRAKE_BASE + pullDistance.value / PULL_BRAKE_FACTOR),
    )
  }

  function getScreenY(e: TouchEvent): number {
    return e.touches[0]?.screenY ?? 0
  }

  function getScreenX(e: TouchEvent): number {
    return e.touches[0]?.screenX ?? 0
  }

  function moveBySystem(to: number): Promise<void> {
    return new Promise((resolve) => {
      const startHeight = pullDistance.value
      const overHeight = startHeight - to
      if (overHeight < 1) {
        pullDistance.value = to
        resolve()
        return
      }
      const startTime = performance.now()

      function animate(now: number) {
        const elapsed = now - startTime
        if (elapsed >= RELEASE_TRANSITION_DURATION) {
          pullDistance.value = to
          resolve()
          return
        }
        const nextHeight =
          startHeight - (overHeight / RELEASE_TRANSITION_DURATION) * elapsed
        if (pullDistance.value >= nextHeight) {
          pullDistance.value = nextHeight
        }
        requestAnimationFrame(animate)
      }
      requestAnimationFrame(animate)
    })
  }

  async function fixOverContent() {
    if (pullDistance.value > FIRE_THRESHOLD) {
      await moveBySystem(FIRE_THRESHOLD)
    }
  }

  async function closeContent() {
    if (pullDistance.value > 0) {
      await moveBySystem(0)
    }
  }

  function onTouchStart(e: TouchEvent) {
    if (isRefreshing.value) return
    const el = getEl()
    if (!el || el.scrollTop > 0) return
    if (isFromNestedOverlay(e.target, el)) return

    isPulling.value = true
    startScreenY = getScreenY(e)
    startScreenX = getScreenX(e)
    direction = null
    pullDistance.value = 0
  }

  function onTouchMove(e: TouchEvent) {
    if (!isPulling.value || isRefreshing.value) return
    const el = getEl()
    if (!el) return

    if (el.scrollTop > SCROLL_STOP + pullDistance.value) {
      pullDistance.value = 0
      isPulledEnough.value = false
      onTouchEnd()
      return
    }

    if (startScreenY === null) {
      startScreenY = getScreenY(e)
      startScreenX = getScreenX(e)
    }

    // Lock to dominant axis on first significant move
    if (direction === null && startScreenX !== null) {
      const absDx = Math.abs(getScreenX(e) - startScreenX)
      const absDy = Math.abs(getScreenY(e) - startScreenY)
      if (absDx >= DIRECTION_THRESHOLD || absDy >= DIRECTION_THRESHOLD) {
        direction = absDy >= absDx ? 'vertical' : 'horizontal'
      }
    }

    // Horizontal gesture — let useSwipeTab handle it
    if (direction === 'horizontal') {
      pullDistance.value = 0
      isPulledEnough.value = false
      isPulling.value = false
      return
    }

    const moveScreenY = getScreenY(e)
    // biome-ignore lint/style/noNonNullAssertion: guaranteed by null check above
    const moveHeight = moveScreenY - startScreenY!
    pullDistance.value = Math.min(Math.max(moveHeight, 0), MAX_PULL_DISTANCE)

    const wasEnough = isPulledEnough.value
    isPulledEnough.value = pullDistance.value >= FIRE_THRESHOLD
    if (!wasEnough && isPulledEnough.value) {
      hapticMedium()
    }

    if (pullDistance.value > 0) {
      e.preventDefault()
    }
  }

  async function onTouchEnd() {
    startScreenY = null
    startScreenX = null
    direction = null
    if (isPulledEnough.value) {
      isPulledEnough.value = false
      isRefreshing.value = true
      await fixOverContent()
      try {
        await onRefresh()
      } finally {
        await closeContent()
        isPulling.value = false
        isRefreshing.value = false
      }
    } else {
      await closeContent()
      isPulling.value = false
    }
  }

  function bind(el: HTMLElement) {
    if (boundEl === el) return
    unbind()
    boundEl = el
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
  }

  function unbind() {
    if (!boundEl) return
    boundEl.removeEventListener('touchstart', onTouchStart)
    boundEl.removeEventListener('touchmove', onTouchMove)
    boundEl.removeEventListener('touchend', onTouchEnd)
    boundEl = null
  }

  watch(
    scrollerRef,
    (v) => {
      if (v) bind(v)
      else unbind()
    },
    { flush: 'post' },
  )

  onUnmounted(unbind)

  return {
    isPulling,
    isPulledEnough,
    isRefreshing,
    pullDistance,
    displayHeight,
  }
}
