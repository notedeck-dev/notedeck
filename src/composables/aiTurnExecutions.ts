/**
 * ターン単位の実行要求の台帳 (#1133 縦切り 1)。
 *
 * notecore のターン実行器はデバイスへ capability の実行要求を投げ、デバイス側の
 * dispatcher が確認ダイアログを出しうる。ユーザーがターンを中断したとき、その
 * ターンのために待っている確認を閉じるために、実行要求ごとの AbortController を
 * turn id で引けるようにしておく。store を import しない (apiBridge と
 * useAiTurn の両方から使う)。
 */

const controllers = new Map<string, Set<AbortController>>()

/** 実行要求の開始。返した controller は完了時に `endTurnExecution` で外す */
export function beginTurnExecution(turnId: string): AbortController {
  const controller = new AbortController()
  let set = controllers.get(turnId)
  if (!set) {
    set = new Set()
    controllers.set(turnId, set)
  }
  set.add(controller)
  return controller
}

export function endTurnExecution(
  turnId: string,
  controller: AbortController,
): void {
  const set = controllers.get(turnId)
  if (!set) return
  set.delete(controller)
  if (set.size === 0) controllers.delete(turnId)
}

/** ターン中断: 進行中の実行要求 (確認待ちを含む) を全部 abort する */
export function cancelTurnExecutions(turnId: string): void {
  const set = controllers.get(turnId)
  if (!set) return
  controllers.delete(turnId)
  for (const c of set) c.abort()
}

/** test 用 */
export function _resetTurnExecutionsForTest(): void {
  controllers.clear()
}
