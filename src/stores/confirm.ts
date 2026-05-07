import { ref } from 'vue'

export type ConfirmType =
  | 'normal'
  | 'danger'
  | 'warning'
  | 'info'
  | 'success'
  | 'error'
  | 'question'
  | 'waiting'
export type ConfirmIcon =
  | 'info'
  | 'question'
  | 'success'
  | 'warn'
  | 'error'
  | 'waiting'
  | 'none'

export interface ConfirmOptions {
  title: string
  message: string
  okLabel?: string
  cancelLabel?: string
  type?: ConfirmType
  icon?: ConfirmIcon
  hideCancel?: boolean
}

const visible = ref(false)
const options = ref<ConfirmOptions>({ title: '', message: '' })
let resolvePromise: ((value: boolean) => void) | null = null

export function useConfirm() {
  function confirm(opts: ConfirmOptions): Promise<boolean> {
    if (resolvePromise) {
      resolvePromise(false)
    }
    options.value = opts
    visible.value = true
    return new Promise<boolean>((resolve) => {
      resolvePromise = resolve
    })
  }

  function resolve(result: boolean) {
    visible.value = false
    resolvePromise?.(result)
    resolvePromise = null
  }

  return { visible, options, confirm, resolve }
}
