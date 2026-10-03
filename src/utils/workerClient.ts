/**
 * Web Worker のシングルトン管理・リクエスト/レスポンスの Promise 化を共通化するファクトリー。
 *
 * 各 Worker は `{ id: number, ... }` 形式のレスポンスを返す前提。
 *
 * `timeoutMs` を渡すと 1 要求ごとに時間上限を張り、超えたら Worker を terminate
 * して作り直す。同期的に走る照合 (正規表現など) は中から止められないので、
 * これが唯一の確実な停止手段。巻き添えになった他の待ちは失敗として即座に
 * 返し、永久に待たせない (カラムクエリの逐次適用と同じ規律)。
 */

interface WorkerResponse {
  id: number
}

export interface WorkerClient<TRes extends WorkerResponse> {
  /** Worker にメッセージを送り、対応するレスポンスを Promise で返す */
  post: (data: Record<string, unknown>) => Promise<TRes>
}

export interface WorkerClientOptions {
  /** 1 要求の時間上限。未指定なら待ち続ける */
  timeoutMs?: number
}

/** 時間上限を超えて Worker を止めた要求 */
export class WorkerTimeoutError extends Error {
  constructor() {
    super('Worker request timed out')
    this.name = 'WorkerTimeoutError'
  }
}

/** 別の要求の時間切れで Worker が止まり、巻き添えになった要求 */
export class WorkerAbortedError extends Error {
  constructor() {
    super('Worker was terminated by another request')
    this.name = 'WorkerAbortedError'
  }
}

interface PendingCallbacks<TRes> {
  resolve: (data: TRes) => void
  reject: (reason: unknown) => void
  timer: ReturnType<typeof setTimeout> | null
}

export function createWorkerClient<TRes extends WorkerResponse>(
  factory: () => Worker,
  options: WorkerClientOptions = {},
): WorkerClient<TRes> {
  let worker: Worker | null = null
  let requestId = 0
  const pending = new Map<number, PendingCallbacks<TRes>>()

  function settle(id: number): PendingCallbacks<TRes> | undefined {
    const cb = pending.get(id)
    if (!cb) return undefined
    pending.delete(id)
    if (cb.timer) clearTimeout(cb.timer)
    return cb
  }

  function rejectAll(reason: () => Error) {
    for (const id of [...pending.keys()]) {
      settle(id)?.reject(reason())
    }
  }

  function getWorker(): Worker {
    if (!worker) {
      worker = factory()
      worker.onmessage = (event: MessageEvent<TRes>) => {
        settle(event.data.id)?.resolve(event.data)
      }
      worker.onerror = (event) => {
        console.error('[WorkerClient] Worker failed to load:', event.message)
        rejectAll(() => new Error(`Worker error: ${event.message}`))
        worker = null
      }
    }
    return worker
  }

  function onTimeout(id: number) {
    const victim = settle(id)
    if (!victim) return
    // 止めるのは当該要求だけだが、Worker は 1 台なので他の待ちも返らなくなる。
    // 永久に待たせず失敗として即座に返し、次の要求は新しい Worker で受ける
    worker?.terminate()
    worker = null
    victim.reject(new WorkerTimeoutError())
    rejectAll(() => new WorkerAbortedError())
  }

  return {
    post(data) {
      return new Promise((resolve, reject) => {
        const id = requestId++
        const timer =
          options.timeoutMs !== undefined
            ? setTimeout(() => onTimeout(id), options.timeoutMs)
            : null
        pending.set(id, { resolve, reject, timer })
        getWorker().postMessage({ ...data, id })
      })
    },
  }
}
