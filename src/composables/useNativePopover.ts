import { nextTick, onScopeDispose, type Ref, watch } from 'vue'
import { waitForAnimations } from '@/utils/motion'

interface NativePopoverOptions {
  /** Called when the popover is dismissed (light dismiss, outside click, or explicit close) */
  onClose?: () => void
  /**
   * 退場アニメの上限 (ms)。hidePopover() は実際の CSS アニメの終了を待つ。
   * アニメが見つからない / 終わらないときの打ち切りに使う
   */
  leaveDuration?: number
  /**
   * Enable manual outside-click dismiss for popover="manual".
   * Uses a delayed pointerdown listener to avoid catching the opening click.
   * Not needed for popover="auto" (which has built-in light dismiss).
   */
  dismissOnOutsideClick?: boolean
  /**
   * Outside-click 判定から除外する要素 (典型的にはトリガーボタン)。
   * 指定しないと、トリガーボタン押下時に pointerdown でいったん閉じ、
   * 続く click でトグル開放されてしまい「閉じない」挙動になる。
   */
  ignoreOutsideClickFor?: Ref<HTMLElement | null | undefined>
}

/**
 * Vapor-compatible composable wrapping the Popover API.
 *
 * Replaces usePortal for popups:
 * - showPopover() places the element in the top layer (no z-index / overflow clip issues)
 * - popover="auto" provides light dismiss (click outside to close)
 * - popover="manual" + dismissOnOutsideClick for manual outside-click handling
 */
export function useNativePopover(
  popoverRef: Ref<HTMLElement | null>,
  show: Ref<boolean>,
  options: NativePopoverOptions = {},
) {
  const { leaveDuration = 200 } = options
  // 閉じ始めるたびに進める。待っている間に再び開いたら古い待ちを捨てる
  let hideSeq = 0
  let pendingAddTimer: ReturnType<typeof setTimeout> | null = null

  // Light dismiss: "auto" popover fires toggle event when dismissed
  function onToggle(e: Event) {
    const toggleEvent = e as ToggleEvent
    if (toggleEvent.newState === 'closed' && show.value) {
      options.onClose?.()
    }
  }

  // Manual outside-click dismiss for popover="manual"
  function onPointerDown(e: PointerEvent) {
    const el = popoverRef.value
    if (!el) return
    const target = e.target as Node
    if (el.contains(target)) return
    if (options.ignoreOutsideClickFor?.value?.contains(target)) return
    options.onClose?.()
  }

  function addOutsideClickListener() {
    // Delay to avoid catching the opening click/contextmenu
    if (pendingAddTimer != null) clearTimeout(pendingAddTimer)
    pendingAddTimer = setTimeout(() => {
      pendingAddTimer = null
      document.addEventListener('pointerdown', onPointerDown)
    }, 0)
  }

  function removeOutsideClickListener() {
    if (pendingAddTimer != null) {
      clearTimeout(pendingAddTimer)
      pendingAddTimer = null
    }
    document.removeEventListener('pointerdown', onPointerDown)
  }

  watch(show, (val) => {
    const seq = ++hideSeq

    const el = popoverRef.value
    if (!el) return

    if (val) {
      try {
        el.showPopover()
      } catch {
        // Already shown or not connected
      }
      if (options.dismissOnOutsideClick) addOutsideClickListener()
    } else {
      if (options.dismissOnOutsideClick) removeOutsideClickListener()
      // 退場のクラスは次の描画で付くので、それを待ってからアニメを拾う
      void nextTick()
        .then(() => waitForAnimations(el, leaveDuration + 300))
        .then(() => {
          if (seq !== hideSeq) return
          try {
            el.hidePopover()
          } catch {
            // Already hidden or not connected
          }
        })
    }
  })

  watch(popoverRef, (el, oldEl) => {
    oldEl?.removeEventListener('toggle', onToggle)
    if (el) {
      el.addEventListener('toggle', onToggle)
      // v-if mount: show watch may have fired before ref was assigned
      if (show.value) {
        nextTick(() => {
          try {
            el.showPopover()
          } catch {
            // Already shown
          }
          if (options.dismissOnOutsideClick) addOutsideClickListener()
        })
      }
    }
  })

  onScopeDispose(() => {
    hideSeq++
    removeOutsideClickListener()
    popoverRef.value?.removeEventListener('toggle', onToggle)
    try {
      popoverRef.value?.hidePopover()
    } catch {
      // Not connected
    }
  })
}
