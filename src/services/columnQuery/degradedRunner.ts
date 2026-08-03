import type {
  DegradedFilterSpec,
  InvalidFilter,
} from '@/services/columnQuery/degradedBatch'
import type { FilterVerdict } from '@/services/columnQuery/referenceEvaluator'
import type {
  ColumnQueryWorkerRequest,
  ColumnQueryWorkerResponse,
} from '@/workers/columnQueryWorker'

/**
 * 🐢 降格フィルタの実行管理 (#783 Phase 2 / V15・V23)。
 *
 * 評価そのものは Worker 側 (degradedBatch) が行う。ここが持つのは
 * 「止められない評価を確実に止め、巻き添えを最小にする」責務:
 *
 *   - バッチにタイムアウトを張り、超えたら `terminate()` で強制停止する。
 *     AiScript の同期評価は abort できず、step 予算もメモリ確保を縛れないため
 *     これが唯一の確実な停止手段になる
 *   - 直前に届いた評価開始マーカーから犯人フィルタを特定し、**そのフィルタだけ**
 *     サスペンドする。Worker を作り直して残りのフィルタは評価を続ける
 *   - サスペンド中のフィルタを含むバッチは fail-closed (全件除外) にする。
 *     解除はユーザーの明示操作 (`resume`) に限る (不変条件 (f))
 */

/** バッチ 1 回あたりの判定タイムアウト */
export const DEGRADED_BATCH_TIMEOUT_MS = 3000

export interface DegradedRunResult {
  /** notes と同じ長さ。And 合成後の判定 */
  verdicts: FilterVerdict[]
  invalidFilters: InvalidFilter[]
  /** この呼び出しでサスペンドしたフィルタ */
  suspended: string[]
}

export interface DegradedRunner {
  run(
    filters: readonly DegradedFilterSpec[],
    notes: readonly unknown[],
  ): Promise<DegradedRunResult>
  isSuspended(key: string): boolean
  suspendedKeys(): string[]
  /** ユーザーの明示操作でサスペンドを解除する */
  resume(key: string): void
  dispose(): void
}

export interface DegradedRunnerOptions {
  workerFactory?: () => Worker
  timeoutMs?: number
}

const defaultWorkerFactory = (): Worker =>
  new Worker(new URL('../../workers/columnQueryWorker.ts', import.meta.url), {
    type: 'module',
  })

/**
 * アプリ全体で共有する runner。Worker は 1 台に固定する (V23)。
 *
 * サスペンドはフィルタ key 単位なので、同じ名前付きクエリを複数カラムに
 * 適用していれば 1 度の暴走で全カラムが同時に fail-closed になる。これは
 * 意図した挙動で、暴走するクエリを 1 つのカラムだけで走らせ続けない。
 */
let sharedRunner: DegradedRunner | null = null

export function getSharedDegradedRunner(): DegradedRunner {
  sharedRunner ??= createDegradedRunner()
  return sharedRunner
}

/** テスト用: 共有 runner を破棄する */
export function resetSharedDegradedRunner(): void {
  sharedRunner?.dispose()
  sharedRunner = null
}

export function createDegradedRunner(
  options: DegradedRunnerOptions = {},
): DegradedRunner {
  const factory = options.workerFactory ?? defaultWorkerFactory
  const timeoutMs = options.timeoutMs ?? DEGRADED_BATCH_TIMEOUT_MS
  const suspended = new Set<string>()

  let worker: Worker | null = null
  let nextId = 0

  interface Pending {
    resolve: (outcome: {
      verdicts: FilterVerdict[]
      invalidFilters: InvalidFilter[]
    }) => void
    /** タイムアウト時に犯人を帰属するための、最後に開始したフィルタ */
    lastBegunKey: string | null
    timer: ReturnType<typeof setTimeout>
    onTimeout: () => void
    /** 他バッチの巻き添えで打ち切るとき (犯人を出さずに終わらせる) */
    abort: () => void
  }
  const pending = new Map<number, Pending>()

  function getWorker(): Worker {
    if (worker) return worker
    const w = factory()
    w.onmessage = (event: MessageEvent<ColumnQueryWorkerResponse>) => {
      const msg = event.data
      const entry = pending.get(msg.id)
      if (!entry) return
      if (msg.type === 'begin') {
        entry.lastBegunKey = msg.key
        return
      }
      clearTimeout(entry.timer)
      pending.delete(msg.id)
      entry.resolve({
        verdicts: msg.verdicts,
        invalidFilters: msg.invalidFilters,
      })
    }
    w.onerror = () => {
      // ロード失敗等。誰も暴走していないので犯人は出さず、全部中断扱いにする
      killWorker()
    }
    worker = w
    return w
  }

  /**
   * Worker を捨てる。runner はカラム間で共有なので、terminate すると同時に
   * 走っていた他バッチの応答も永久に来なくなる。放置すると各自のタイムアウトを
   * 待たされたうえ、無実のフィルタが「最後に開始したもの」として犯人扱いされて
   * サスペンドされる。捨てた時点で全部まとめて中断扱いにする。
   *
   * `except` はこの kill を引き起こした本人。犯人特定は呼び出し側で行うため
   * ここでは解決しない。
   */
  function killWorker(except?: number): void {
    worker?.terminate()
    worker = null
    for (const [id, entry] of [...pending]) {
      if (id === except) continue
      clearTimeout(entry.timer)
      pending.delete(id)
      // 巻き添えなので犯人を出さない (culprit=null = サスペンドせず fail-closed)
      entry.abort()
    }
  }

  /** Worker に 1 バッチ投げる。タイムアウトしたら犯人 key を返す */
  function postBatch(
    filters: readonly DegradedFilterSpec[],
    notes: readonly unknown[],
  ): Promise<
    | {
        ok: true
        verdicts: FilterVerdict[]
        invalidFilters: InvalidFilter[]
      }
    | { ok: false; culprit: string | null }
  > {
    return new Promise((resolve) => {
      const id = nextId++
      const onTimeout = () => {
        const entry = pending.get(id)
        pending.delete(id)
        // 止められない評価を止める唯一の手段。自分は犯人を返して解決するので
        // 巻き添え処理の対象から外す
        killWorker(id)
        resolve({ ok: false, culprit: entry?.lastBegunKey ?? null })
      }
      const timer = setTimeout(onTimeout, timeoutMs)
      pending.set(id, {
        resolve: (outcome) => resolve({ ok: true, ...outcome }),
        lastBegunKey: null,
        timer,
        onTimeout,
        abort: () => resolve({ ok: false, culprit: null }),
      })
      const request: ColumnQueryWorkerRequest = {
        id,
        filters: [...filters],
        notes: [...notes],
      }
      getWorker().postMessage(request)
    })
  }

  return {
    async run(filters, notes) {
      if (notes.length === 0) {
        return { verdicts: [], invalidFilters: [], suspended: [] }
      }
      // サスペンド中のフィルタが 1 つでも掛かっていれば fail-closed
      if (filters.some((f) => suspended.has(f.key))) {
        return {
          verdicts: notes.map(() => 'error' as const),
          invalidFilters: [],
          suspended: [],
        }
      }
      if (filters.length === 0) {
        return {
          verdicts: notes.map(() => 'match' as const),
          invalidFilters: [],
          suspended: [],
        }
      }

      const newlySuspended: string[] = []
      let remaining = [...filters]
      // 犯人を 1 つずつ落として再試行する。全滅すれば fail-closed で抜ける
      for (let attempt = 0; attempt <= filters.length; attempt++) {
        const result = await postBatch(remaining, notes)
        if (result.ok) {
          return {
            verdicts: result.verdicts,
            invalidFilters: result.invalidFilters,
            suspended: newlySuspended,
          }
        }
        const culprit = result.culprit
        if (culprit === null) {
          // どのフィルタで止まったか帰属できない。バッチ全体を fail-closed
          break
        }
        suspended.add(culprit)
        newlySuspended.push(culprit)
        remaining = remaining.filter((f) => f.key !== culprit)
        if (remaining.length === 0) break
      }

      return {
        verdicts: notes.map(() => 'error' as const),
        invalidFilters: [],
        suspended: newlySuspended,
      }
    },

    isSuspended(key) {
      return suspended.has(key)
    },

    suspendedKeys() {
      return [...suspended]
    },

    resume(key) {
      suspended.delete(key)
    },

    dispose() {
      for (const [, entry] of pending) clearTimeout(entry.timer)
      pending.clear()
      killWorker()
    },
  }
}
