import { nextTick, watch } from 'vue'

/**
 * 編集バッファを持つエディタが、外部からの変更を取り込むための共通規則
 * (#981)。履歴からの revert / AI の編集 / 外部エディタでの書き換えを、
 * 開いたままのエディタへ反映する。
 *
 * 規則は 3 つ。どれが欠けてもユーザーの編集が消えるか、巻き戻しが無言で
 * 打ち消される:
 *
 * 1. バッファと同じ値なら何もしない — 自分の書込みが store 経由で戻って
 *    きたときに再取り込みのループを作らない
 * 2. 未保存の編集があるときは取り込まない — revert より本人の編集のほうが
 *    新しい。保存すれば本人の内容で上書きされる (= 明示操作)
 * 3. 取り込み中は `isSyncing()` が true — エディタ側の「バッファが変わったら
 *    保存する」watch をここで止める。止めないと、取り込んだ内容を保存し返す
 *    (エディタによっては再構築した内容に化ける)
 *
 * エディタごとにバッファの形も dirty 判定も違うので、判定そのものは
 * 呼び出し側から受け取る。
 */
export interface ExternalEditSyncOptions<T> {
  /** store 側の現在値。対象が無ければ undefined */
  source: () => T | undefined
  /** 編集バッファの現在値 */
  current: () => T
  /** 未保存の編集があるか */
  isDirty: () => boolean
  /** バッファへ取り込む */
  apply: (value: T) => void
}

export function useExternalEditSync<T>(opts: ExternalEditSyncOptions<T>): {
  isSyncing: () => boolean
} {
  let syncing = false
  watch(opts.source, (value) => {
    if (value === undefined) return
    if (value === opts.current()) return
    if (opts.isDirty()) return
    syncing = true
    opts.apply(value)
    void nextTick(() => {
      syncing = false
    })
  })
  return { isSyncing: () => syncing }
}
