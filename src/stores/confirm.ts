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

export interface ConfirmAction {
  value: string
  label: string
  primary?: boolean
  /** true のとき、このボタンはキャンセル扱い（confirmWithAction は null を返す）。 */
  cancel?: boolean
}

export interface ConfirmOptions {
  title: string
  message: string
  /**
   * 誰がこの操作を要求しているかの帰属表示 (#712 §3.3)。dispatcher が principal
   * から actor ラベルのみ注入する (例: 「HEARTBEAT」「ウィジェット「clock」」 —
   * 操作名はタイトル行が示すので繰り返さない)。本人操作 (user principal) では
   * 注入されない。ダイアログ冒頭に必須表示される。
   */
  attribution?: string
  okLabel?: string
  cancelLabel?: string
  type?: ConfirmType
  icon?: ConfirmIcon
  hideCancel?: boolean
  /** 指定した場合、OK/Cancel の代わりにこの配列のボタンを表示する。 */
  actions?: ConfirmAction[]
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
  /**
   * NoteDeck 本体の権限確認であることを示す信頼マーカー (#720)。dispatcher が
   * capability 確認を出すときにのみ true を注入する。AppConfirm はこのとき
   * 偽装不能な視覚バッジ (盾アイコン + ラベル) を表示する。プラグインの
   * `Mk:confirm` / `Mk:dialog` は title / message しか制御できずこのフラグを
   * 立てられないので、システムの権限確認になりすませない。
   */
  trusted?: boolean
  /**
   * 同一操作をまとめる不透明な識別子 (#720)。このダイアログが「今後確認しない」
   * チェック付きで許可されると、キューで待機している同じ `dedupKey` のダイアログも
   * 同じ許可で自動解決される (再度聞かない)。confirm 層はこの文字列の意味を
   * 解釈しない — dispatcher が `scope:capabilityId` を渡し、「一度の同意を同一
   * 操作の待機分へ波及させる」#716 の理想を満たす。
   */
  dedupKey?: string
}

/**
 * 確認ダイアログの結果。`accepted` が OK 押下、`remember` は `rememberLabel`
 * 付きダイアログでチェックボックスが ON だったか。
 * `action` は `actions` 配列を使ったダイアログで押されたボタンの value。
 */
export interface ConfirmDecision {
  accepted: boolean
  remember: boolean
  action?: string
}

const visible = ref(false)
const options = ref<ConfirmOptions>({ title: '', message: '' })
let resolvePromise: ((value: ConfirmDecision) => void) | null = null

// 同時に複数の確認要求が来たときの待ち行列 (#716)。表示中のダイアログを
// 横取りキャンセルせず、解決後に FIFO で順番に表示する — 起動時に複数の
// autoRun ウィジェットが一斉に http.fetch の確認を要求しても全件確認できる。
const queue: Array<{
  opts: ConfirmOptions
  resolve: (value: ConfirmDecision) => void
}> = []

// 次のダイアログは前のダイアログの leave transition (200ms) が終わってから
// 出す。即時差し替えだと直前のダイアログへの連打・Enter がそのまま次の確認を
// 許可してしまう (権限確認なので誤許可を作らない)。
const NEXT_DIALOG_DELAY_MS = 250
// leave transition 待ちの間 (visible=false かつ次のダイアログ未表示) を表す。
// この間に来た新規要求もキュー末尾に並べる。
let drainScheduled = false

// キューの上限 (#720)。単一の principal (プラグイン等) が Mk:confirm を無制限に
// 呼んでキューを埋め尽くし、正当な確認を後方へ押し込む DoS を防ぐ。起動時の
// autoRun ウィジェット群の正当な同時確認を妨げないよう十分に大きく取り、
// 超過分は自動的にキャンセル扱い (accepted:false) で即解決する。
const MAX_QUEUE = 32

function show(entry: (typeof queue)[number]): void {
  options.value = entry.opts
  visible.value = true
  resolvePromise = entry.resolve
}

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
   * 表示中のダイアログがあればキューに積まれ、順番が来るまで解決しない。
   */
  function confirmWithDecision(opts: ConfirmOptions): Promise<ConfirmDecision> {
    return new Promise<ConfirmDecision>((resolve) => {
      const entry = { opts, resolve }
      if (resolvePromise || drainScheduled) {
        // キューが上限に達したら自動キャンセル (#720)。埋め尽くし DoS 防止。
        if (queue.length >= MAX_QUEUE) {
          resolve({ accepted: false, remember: false })
          return
        }
        queue.push(entry)
      } else {
        show(entry)
      }
    })
  }

  /**
   * `actions` 配列を持つダイアログを出し、押されたボタンの value を返す。
   * キャンセル（ESC / ダイアログ外クリック）は null を返す。
   */
  function confirmWithAction(opts: ConfirmOptions): Promise<string | null> {
    return confirmWithDecision(opts).then((d) => d.action ?? null)
  }

  function resolve(decision: ConfirmDecision) {
    visible.value = false
    const dedupKey = options.value.dedupKey
    resolvePromise?.(decision)
    resolvePromise = null
    // 「今後確認しない」で許可されたら、キューで待つ同一操作 (同じ dedupKey) を
    // 同じ許可で自動解決する (#720/#716: 一度の同意を同一操作の待機分へ波及)。
    // remember は記録済みなので重複記録を避けるため false で返す。
    if (decision.accepted && decision.remember && dedupKey) {
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i]?.opts.dedupKey === dedupKey) {
          const [removed] = queue.splice(i, 1)
          removed?.resolve({ accepted: true, remember: false })
        }
      }
    }
    if (queue.length > 0) {
      drainScheduled = true
      setTimeout(() => {
        drainScheduled = false
        const next = queue.shift()
        if (next) show(next)
      }, NEXT_DIALOG_DELAY_MS)
    }
  }

  return {
    visible,
    options,
    confirm,
    confirmWithDecision,
    confirmWithAction,
    resolve,
  }
}

/** @internal テスト用。module-scope の state を初期化する。 */
export function _resetConfirmForTest(): void {
  visible.value = false
  options.value = { title: '', message: '' }
  resolvePromise = null
  queue.length = 0
  drainScheduled = false
}
