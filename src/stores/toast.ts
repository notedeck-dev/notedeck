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

const timers = new Map<number, ReturnType<typeof setTimeout>>()

export function useToast() {
  function show(
    text: string,
    type: ToastItem['type'] = 'info',
    options?: { action?: ToastAction },
  ) {
    // 同一内容が表示中なら積み直さず表示時間だけ延長する (連続発火の多重表示防止)
    if (!options?.action) {
      const dup = toasts.value.find(
        (t) => t.text === text && t.type === type && !t.action,
      )
      if (dup) {
        const old = timers.get(dup.id)
        if (old) clearTimeout(old)
        timers.set(
          dup.id,
          setTimeout(() => dismiss(dup.id), DURATION[type]),
        )
        return
      }
    }
    const id = nextId++
    toasts.value.push({ id, text, type, action: options?.action })
    timers.set(
      id,
      setTimeout(
        () => dismiss(id),
        options?.action ? ACTION_DURATION : DURATION[type],
      ),
    )
  }

  function dismiss(id: number) {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function runAction(item: ToastItem) {
    item.action?.onClick()
    dismiss(item.id)
  }

  return { toasts, show, dismiss, runAction }
}
