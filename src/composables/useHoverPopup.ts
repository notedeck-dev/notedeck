import { computed, onUnmounted, shallowRef } from 'vue'

const IS_TOUCH = navigator.maxTouchPoints > 0

// Global singleton state — only one hover popup is active at a time
let activeSlotId: number | null = null
let slotCounter = 0
let showTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
const globalVisible = shallowRef(false)
const globalPosition = shallowRef({ x: 0, y: 0 })

function clearShowTimer() {
  if (showTimer) {
    clearTimeout(showTimer)
    showTimer = null
  }
}

// 慣性スクロール中はカーソル下を要素が通過するだけで mouseenter が発火する。
// 最後のスクロールから 150ms は show を抑止し、pending 中の show も潰す
let scrollingUntil = 0
document.addEventListener(
  'scroll',
  () => {
    scrollingUntil = Date.now() + 150
    clearShowTimer()
  },
  { capture: true, passive: true },
)

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

/**
 * ユーザーホバーポップアップ (MkUserPopup) 用の共通オプション。
 * hideDelay で「アバター → ポップアップ」へマウスが移動する猶予を作り、
 * ポップアップ上にカーソルがある間は hideGuardSelector が消失を防ぐ
 * (リアクションポップアップと同じパターン #704 M)。
 */
export const USER_POPUP_HOVER = {
  hideDelay: 300,
  hideGuardSelector: '.user-hover-popup',
} as const

export function useHoverPopup(options?: {
  showDelay?: number
  hideDelay?: number
  hideGuardSelector?: string
}) {
  const showDelay = options?.showDelay ?? 250
  const hideDelay = options?.hideDelay ?? 0
  const hideGuardSelector = options?.hideGuardSelector

  const slotId = ++slotCounter

  const isVisible = computed(
    () => globalVisible.value && activeSlotId === slotId,
  )
  const position = computed(() =>
    activeSlotId === slotId ? globalPosition.value : { x: 0, y: 0 },
  )

  function show(pos: { x: number; y: number }) {
    if (IS_TOUCH || Date.now() < scrollingUntil) return
    // Preempt any pending hide/show from a different slot
    if (activeSlotId !== slotId) {
      clearShowTimer()
      clearHideTimer()
      globalVisible.value = false
    }
    activeSlotId = slotId
    clearHideTimer()
    globalPosition.value = pos
    if (globalVisible.value && activeSlotId === slotId) return
    clearShowTimer()
    showTimer = setTimeout(() => {
      globalVisible.value = true
    }, showDelay)
  }

  function hide() {
    if (activeSlotId !== slotId) return
    clearShowTimer()
    if (!globalVisible.value) return
    if (hideDelay > 0) {
      clearHideTimer()
      hideTimer = setTimeout(() => {
        if (hideGuardSelector) {
          const el = document.querySelector(hideGuardSelector)
          if (el?.matches(':hover')) return
        }
        globalVisible.value = false
        activeSlotId = null
      }, hideDelay)
    } else {
      globalVisible.value = false
      activeSlotId = null
    }
  }

  function cancelHide() {
    if (activeSlotId === slotId) clearHideTimer()
  }

  function forceClose() {
    if (activeSlotId !== slotId) return
    clearShowTimer()
    clearHideTimer()
    globalVisible.value = false
    activeSlotId = null
  }

  onUnmounted(() => {
    if (activeSlotId === slotId) {
      clearShowTimer()
      clearHideTimer()
      globalVisible.value = false
      activeSlotId = null
    }
  })

  return { isVisible, position, show, hide, cancelHide, forceClose }
}
