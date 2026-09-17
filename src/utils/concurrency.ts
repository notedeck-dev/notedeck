/** onSettled に渡す進捗。done は完了 (fulfilled / rejected とも) した件数 */
export interface SettleProgress {
  done: number
  total: number
}

/**
 * Run async tasks with limited concurrency (like p-limit but zero-dependency).
 * Returns PromiseSettledResult[] in the same order as the input items.
 *
 * `onSettled` を渡すと 1 件終わるごとに完了順で呼ぶ (#1095 の段階表示用)。
 * コールバックは直列に実行し (前のが終わるまで次を始めない)、全部終わってから
 * resolve する。呼び出し側は「到着した分をマージして描画」を素直に書ける。
 * コールバックが 1 つ失敗しても残りは呼び切り、最初のエラーを最後に投げる
 * (途中で止めると「1 件終わるごとに呼ぶ」契約が破れる)。
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number,
  onSettled?: (
    result: PromiseSettledResult<R>,
    item: T,
    progress: SettleProgress,
  ) => void | Promise<void>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let idx = 0
  let done = 0
  let chain: Promise<void> = Promise.resolve()
  const callbackErrors: unknown[] = []

  async function worker() {
    while (idx < items.length) {
      const i = idx++
      // biome-ignore lint/style/noNonNullAssertion: idx is always within bounds
      const item = items[i]!
      let result: PromiseSettledResult<R>
      try {
        result = { status: 'fulfilled', value: await fn(item) }
      } catch (reason) {
        result = { status: 'rejected', reason }
      }
      results[i] = result
      done++
      if (onSettled) {
        const progress = { done, total: items.length }
        chain = chain.then(async () => {
          try {
            await onSettled(result, item, progress)
          } catch (reason) {
            callbackErrors.push(reason)
          }
        })
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
  await chain
  if (callbackErrors.length > 0) throw callbackErrors[0]
  return results
}
