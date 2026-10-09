import { type ComputedRef, computed, onUnmounted, shallowRef } from 'vue'
import { prefersReducedMotion } from '@/utils/motion'

// maxTouchPoints はタッチスクリーン付き PC でも > 0 になり、マウス操作なのに
// ホバーポップアップが一切出なくなる (#914)。AppTooltip と同じく主ポインタが
// coarse かどうかで判定し、後からマウスを挿しても効くよう参照時に評価する
const coarsePointer = window.matchMedia('(pointer: coarse)')

// Global singleton state — only one hover popup is active at a time
let activeSlotId: number | null = null
let slotCounter = 0
let showTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
const globalVisible = shallowRef(false)
const globalPosition = shallowRef({ x: 0, y: 0 })
/** 表示中のスロットの退場アニメの時間 (ms) */
let activeLeaveDuration = 0
// 退場フェード中のスロット。閉じた後も leaveDuration の間は描画を残し、
// ポップアップ側が退場アニメを流す。次のポップアップと重なってよいよう
// active とは別に持つ (同時に退場中になるのは 1 つだけ)
const leavingSlot = shallowRef<{
  id: number
  pos: { x: number; y: number }
} | null>(null)
let leaveTimer: ReturnType<typeof setTimeout> | null = null

function clearLeave() {
  if (leaveTimer) {
    clearTimeout(leaveTimer)
    leaveTimer = null
  }
  leavingSlot.value = null
}

/** 表示中のスロットを閉じる。退場アニメがあればその間だけ描画を残す */
function closeActive(animate: boolean) {
  const id = activeSlotId
  const delay = prefersReducedMotion() ? 0 : activeLeaveDuration
  if (animate && id !== null && globalVisible.value && delay > 0) {
    clearLeave()
    leavingSlot.value = { id, pos: globalPosition.value }
    leaveTimer = setTimeout(() => {
      leaveTimer = null
      leavingSlot.value = null
    }, delay)
  }
  globalVisible.value = false
  activeSlotId = null
}

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
  // MkUserPopup の退場アニメ (_popup.scss の hoverLeave) と同じ時間
  leaveDuration: 150,
} as const

/**
 * ポップアップ本体から「自分を開いたスロットが退場中か」を読む。
 * 呼び出し元 (MkNote 等) に退場フラグを配線させずに済むよう、setup の時点で
 * 表示中のスロットを持ち主とみなす (ポップアップは持ち主のスロットが表示に
 * なった描画で生まれる)
 */
export function useHoverPopupLeaving(): ComputedRef<boolean> {
  const owner = activeSlotId
  return computed(() => owner !== null && leavingSlot.value?.id === owner)
}

export function useHoverPopup(options?: {
  showDelay?: number
  hideDelay?: number
  hideGuardSelector?: string
  /** 退場アニメの時間 (ms)。0 なら閉じた瞬間に外す */
  leaveDuration?: number
}) {
  const showDelay = options?.showDelay ?? 250
  const hideDelay = options?.hideDelay ?? 0
  const hideGuardSelector = options?.hideGuardSelector
  const leaveDuration = options?.leaveDuration ?? 0

  const slotId = ++slotCounter

  const isLeaving = computed(() => leavingSlot.value?.id === slotId)
  // activeSlotId は reactive ではないが、変わるときは必ず globalVisible か
  // leavingSlot も変わるので computed は追従する
  const isVisible = computed(
    () => (globalVisible.value && activeSlotId === slotId) || isLeaving.value,
  )
  const position = computed(() => {
    const leaving = leavingSlot.value
    if (leaving?.id === slotId && activeSlotId !== slotId) return leaving.pos
    return activeSlotId === slotId ? globalPosition.value : { x: 0, y: 0 }
  })

  function show(pos: { x: number; y: number }) {
    if (coarsePointer.matches || Date.now() < scrollingUntil) return
    // 退場中に戻ってきたら、消しかけたものをそのまま戻す
    if (isLeaving.value) {
      clearShowTimer()
      clearHideTimer()
      if (activeSlotId !== slotId) closeActive(false)
      clearLeave()
      activeSlotId = slotId
      activeLeaveDuration = leaveDuration
      globalPosition.value = pos
      globalVisible.value = true
      return
    }
    // Preempt any pending hide/show from a different slot
    if (activeSlotId !== slotId) {
      clearShowTimer()
      clearHideTimer()
      closeActive(true)
    }
    activeSlotId = slotId
    activeLeaveDuration = leaveDuration
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
          // 退場中のポップアップと並ぶことがあるので全部見る
          const els = document.querySelectorAll(hideGuardSelector)
          if ([...els].some((el) => el.matches(':hover'))) return
        }
        closeActive(true)
      }, hideDelay)
    } else {
      closeActive(true)
    }
  }

  function cancelHide() {
    if (activeSlotId === slotId) clearHideTimer()
  }

  // ポップアップから離れた / Escape で閉じるときも退場アニメを流す
  function forceClose() {
    if (activeSlotId !== slotId) return
    clearShowTimer()
    clearHideTimer()
    closeActive(true)
  }

  onUnmounted(() => {
    if (activeSlotId === slotId) {
      clearShowTimer()
      clearHideTimer()
      closeActive(false)
    }
    if (isLeaving.value) clearLeave()
  })

  return { isVisible, position, show, hide, cancelHide, forceClose }
}
