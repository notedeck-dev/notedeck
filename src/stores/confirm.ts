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
   * 指定された場合、actions の上に「次回から確認しない」系のチェックボックスを
   * 表示する。チェック状態は `confirmWithDecision` の戻り値 `remember` で受け取る。
   * dispatcher が capability の `onConfirmRemember` を呼ぶかの判断に使う。
   * `confirm` (boolean 版) で開いたダイアログでは無視される。
   */
  rememberLabel?: string
  /**
   * MisStore でストア配布されている 4 種類 (plugin / widget / theme / skill)
   * のインストール / 更新 / 削除 / ロールバックを確認するときに、ストアカード
   * 風の構造化プレビューを表示する。指定された場合 AppConfirm が `message` の
   * 下、`code` の上にレンダリングする。AI tool calling 経由の各 write
   * capability で「ストアタブと統一感のある確認 UI」を出すために使う。
   *
   * `permissions` は plugin / widget の Misskey 互換 permission 配列。
   * theme / skill では未使用 (空配列か省略)。
   */
  installPreview?: {
    kind: 'plugin' | 'widget' | 'theme' | 'skill'
    name: string
    version?: string
    author?: string
    description?: string
    permissions?: string[]
  }
}

/**
 * 確認ダイアログの結果。`accepted` が OK 押下、`remember` は `rememberLabel`
 * 付きダイアログでチェックボックスが ON だったか。
 */
export interface ConfirmDecision {
  accepted: boolean
  remember: boolean
}

const visible = ref(false)
const options = ref<ConfirmOptions>({ title: '', message: '' })
let resolvePromise: ((value: ConfirmDecision) => void) | null = null

export function useConfirm() {
  /**
   * 確認ダイアログを出し、OK 押下なら true を返す。既存呼び出しの主経路。
   * `rememberLabel` を使いたい場合は `confirmWithDecision` を使う。
   */
  function confirm(opts: ConfirmOptions): Promise<boolean> {
    return confirmWithDecision(opts).then((d) => d.accepted)
  }

  /**
   * 確認ダイアログを出し、OK/キャンセルと remember チェック状態を返す。
   * dispatcher が `rememberLabel` 付き capability の確認に使う。
   */
  function confirmWithDecision(opts: ConfirmOptions): Promise<ConfirmDecision> {
    if (resolvePromise) {
      resolvePromise({ accepted: false, remember: false })
    }
    options.value = opts
    visible.value = true
    return new Promise<ConfirmDecision>((resolve) => {
      resolvePromise = resolve
    })
  }

  function resolve(decision: ConfirmDecision) {
    visible.value = false
    resolvePromise?.(decision)
    resolvePromise = null
  }

  return { visible, options, confirm, confirmWithDecision, resolve }
}
