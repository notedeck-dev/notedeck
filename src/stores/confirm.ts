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
  /**
   * `message` に続けて表示するコードブロック (JSON / AiScript / markdown 等)。
   * 指定された場合 AppConfirm が `<pre>` でシンタックスハイライト表示する。
   * 「capability の引数 JSON」「skill / widget / plugin の編集前後 diff」など
   * 構造化テキストを見せるのに使う。
   */
  code?: string
  /** code 用の言語キー (default: 'json')。`highlightCode` の lang と一致。 */
  codeLanguage?: string
  /**
   * プラグイン / ウィジェットのインストール / 更新を確認するときに、MisStore の
   * カード風の構造化プレビューを表示する。指定された場合 AppConfirm が
   * `message` の下、`code` の上にレンダリングする。AI tool calling 経由の
   * `plugins.create` / `widgets.create` 等で「ストアタブと統一感のある確認 UI」
   * を出すために使う。
   */
  installPreview?: {
    kind: 'plugin' | 'widget'
    name: string
    version?: string
    author?: string
    description?: string
    permissions?: string[]
  }
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
