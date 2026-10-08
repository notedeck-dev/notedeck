import { nextTick, onScopeDispose, type Ref, watch } from 'vue'
import { waitForAnimations } from '@/utils/motion'

interface NativeDialogOptions {
  /** Called when user presses Escape (cancel event) */
  onCancel?: () => void
  /** CSS selector for initial focus target inside dialog */
  initialFocus?: string
  /**
   * 退場アニメの上限 (ms)。close() は実際の CSS アニメの終了を待つ。
   * アニメが見つからない / 終わらないときの打ち切りに使う
   */
  leaveDuration?: number
}

/**
 * Vapor-compatible composable wrapping `<dialog>` showModal()/close().
 *
 * Replaces usePortal + useFocusTrap:
 * - showModal() places the dialog in the top layer (no z-index / overflow issues)
 * - Native focus trap keeps Tab cycling inside the dialog
 * - cancel event (Escape key) fires onCancel callback
 * - ::backdrop pseudo-element replaces _dialogBackdrop div
 */
export function useNativeDialog(
  dialogRef: Ref<HTMLDialogElement | null>,
  show: Ref<boolean>,
  options: NativeDialogOptions = {},
) {
  const { leaveDuration = 200 } = options
  // 閉じ始めるたびに進める。待っている間に再び開いたら古い待ちを捨てる
  let closeSeq = 0

  function onCancel(e: Event) {
    e.preventDefault()
    options.onCancel?.()
  }

  // Backdrop click: dialog element itself is the backdrop target
  function onClick(e: MouseEvent) {
    if (e.target === dialogRef.value) {
      options.onCancel?.()
    }
  }

  watch(show, (val) => {
    const seq = ++closeSeq

    const el = dialogRef.value
    if (!el) return

    if (val) {
      if (!el.open) el.showModal()

      // Initial focus
      nextTick(() => {
        if (options.initialFocus) {
          const target = el.querySelector<HTMLElement>(options.initialFocus)
          if (target) {
            target.focus()
            return
          }
        }
      })
    } else {
      // 退場のクラスは次の描画で付くので、それを待ってからアニメの終了を待つ
      void nextTick()
        .then(() => waitForAnimations(el, leaveDuration + 300))
        .then(() => {
          if (seq === closeSeq && el.open) el.close()
        })
    }
  })

  watch(dialogRef, (el, oldEl) => {
    oldEl?.removeEventListener('cancel', onCancel)
    oldEl?.removeEventListener('click', onClick)
    if (el) {
      el.addEventListener('cancel', onCancel)
      el.addEventListener('click', onClick)
      // v-if mount: show watch may have fired before ref was assigned
      if (show.value && !el.open) {
        el.showModal()
        const selector = options.initialFocus
        if (selector) {
          nextTick(() => {
            el.querySelector<HTMLElement>(selector)?.focus()
          })
        }
      }
    }
  })

  onScopeDispose(() => {
    closeSeq++
    dialogRef.value?.removeEventListener('cancel', onCancel)
    dialogRef.value?.removeEventListener('click', onClick)
    if (dialogRef.value?.open) dialogRef.value.close()
  })
}
