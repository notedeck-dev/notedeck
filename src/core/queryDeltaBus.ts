import { events, type QueryDelta } from '@/bindings'

/**
 * query-delta イベントの単一リスナー多重化 bus。
 *
 * Android では背景化中に Tauri イベントリスナーが失われることがある
 * (adapter の stream-event 側は reconnect() で再登録する前提の実装)。
 * queryDelta を各購読が個別に listen すると復帰時に再登録する術がない
 * ため、Tauri への登録は本 bus の 1 本に集約し、復帰時は
 * reattachQueryDeltaListener() で張り直す。JS 側の handler 集合は
 * 影響を受けない。
 */
type DeltaHandler = (delta: QueryDelta) => void

const handlers = new Set<DeltaHandler>()
let unlisten: (() => void) | null = null
let generation = 0
let started = false

/**
 * queryDelta の購読を登録する。返り値で解除。
 * 初回呼び出し時に Tauri リスナーを遅延アタッチする。
 */
export function onQueryDelta(handler: DeltaHandler): () => void {
  handlers.add(handler)
  if (!started) {
    started = true
    void reattachQueryDeltaListener()
  }
  return () => {
    handlers.delete(handler)
  }
}

/**
 * Tauri リスナーを張り直す (フォアグラウンド復帰時用)。
 * 古い登録は解除してから新規登録する。並行呼び出しは generation で
 * 最後の 1 本だけが生き残る。
 */
export async function reattachQueryDeltaListener(): Promise<void> {
  const gen = ++generation
  unlisten?.()
  unlisten = null
  let fn: () => void
  try {
    fn = await events.queryDelta.listen((event) => {
      for (const h of handlers) {
        try {
          h(event.payload)
        } catch (e) {
          // 1 つの handler の例外で他の購読への配送を止めない
          console.error('[query-delta-bus] handler failed:', e)
        }
      }
    })
  } catch (e) {
    console.error('[query-delta-bus] listen failed:', e)
    return
  }
  if (gen !== generation) {
    // 待機中に新しい reattach が走った — こちらは破棄
    fn()
    return
  }
  unlisten = fn
}
