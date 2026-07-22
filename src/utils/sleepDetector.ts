/**
 * OS スリープ復帰の検知 (#791)。
 *
 * デスクトップにはスリープ復帰を報せる DOM イベントがなく、visibilitychange は
 * ウィンドウが可視のまま復帰したケースでは発火しない。スリープ中は setInterval
 * が停止することを利用し、tick 間の実測経過時間が閾値を超えたら復帰とみなす。
 */
export const SLEEP_TICK_INTERVAL_MS = 30_000
export const SLEEP_JUMP_THRESHOLD_MS = 90_000

/** スリープ復帰の監視を開始し、停止関数を返す */
export function startSleepDetector(onWake: () => void): () => void {
  let lastTickAt = Date.now()
  const timer = setInterval(() => {
    const now = Date.now()
    const elapsed = now - lastTickAt
    lastTickAt = now
    if (elapsed > SLEEP_JUMP_THRESHOLD_MS) onWake()
  }, SLEEP_TICK_INTERVAL_MS)
  return () => clearInterval(timer)
}
