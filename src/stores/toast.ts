import { ref } from 'vue'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastItem {
  id: number
  text: string
  type: 'success' | 'info' | 'warning' | 'error'
  action?: ToastAction
}

const toasts = ref<ToastItem[]>([])
let nextId = 0

const DURATION: Record<ToastItem['type'], number> = {
  success: 2000,
  info: 2000,
  warning: 3000,
  error: 4000,
}

/** undo 等のアクション付きトーストは押す猶予を長めに取る */
const ACTION_DURATION = 6000

export function useToast() {
  function show(
    text: string,
    type: ToastItem['type'] = 'info',
    options?: { action?: ToastAction },
  ) {
    const id = nextId++
    toasts.value.push({ id, text, type, action: options?.action })
    setTimeout(
      () => dismiss(id),
      options?.action ? ACTION_DURATION : DURATION[type],
    )
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function runAction(item: ToastItem) {
    item.action?.onClick()
    dismiss(item.id)
  }

  return { toasts, show, dismiss, runAction }
}
