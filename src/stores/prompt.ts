import { ref } from 'vue'

export interface PromptOptions {
  title: string
  message?: string
  placeholder?: string
  defaultValue?: string
  okLabel?: string
  cancelLabel?: string
  /** 複数行入力 (textarea)。キャプション編集など (#753) */
  multiline?: boolean
  /** 空文字での確定を許可 (既存値のクリア用途)。resolve は '' を返す */
  allowEmpty?: boolean
}

const visible = ref(false)
const options = ref<PromptOptions>({ title: '' })
let resolvePromise: ((value: string | null) => void) | null = null

export function usePrompt() {
  function prompt(opts: PromptOptions): Promise<string | null> {
    if (resolvePromise) {
      resolvePromise(null)
    }
    options.value = opts
    visible.value = true
    return new Promise<string | null>((resolve) => {
      resolvePromise = resolve
    })
  }

  function resolve(result: string | null) {
    visible.value = false
    resolvePromise?.(result)
    resolvePromise = null
  }

  return { visible, options, prompt, resolve }
}
