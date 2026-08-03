import {
  createReferenceFilter,
  type FilterVerdict,
  type ReferenceFilter,
} from '@/services/columnQuery/referenceEvaluator'

/**
 * 🐢 降格フィルタのバッチ評価 (#783 Phase 2 / V23)。
 *
 * QIR にコンパイルできない純粋な式を AiScript Interpreter で per-note 評価する。
 * Worker の中で動かす前提だが、Worker 境界に依存しない純ロジックとして切り出して
 * あるので単体でテストできる (Worker 側はこれを呼ぶだけの薄い層)。
 *
 * V23 の実行規律のうち、ここが担うのは:
 *   - per-filter 逐次バッチ (フィルタ外側・ノート内側のループ)
 *   - フィルタ単位の評価開始マーカー。暴走して terminate するとき、
 *     どのフィルタで止まったかを呼び出し側が帰属できるようにする
 *   - step 予算とインスタンス汚染回避は referenceEvaluator 側の責務
 *
 * ノート単位のマーカーは出さない。postMessage の往復コストに対して、
 * サスペンド対象がフィルタ単位である以上、得られる情報が釣り合わないため。
 */

export interface DegradedFilterSpec {
  key: string
  source: string
}

export interface DegradedBatchOptions {
  /** フィルタの評価を始めるたびに呼ばれる (犯人特定のマーカー) */
  onFilterBegin?: (key: string) => void
}

export interface InvalidFilter {
  key: string
  message: string
}

export interface DegradedBatchOutcome {
  /** notes と同じ長さ。全フィルタの And 合成後の判定 */
  verdicts: FilterVerdict[]
  /** ソース自体が実行不能だったフィルタ (保存時に弾けなかった残留) */
  invalidFilters: InvalidFilter[]
}

export interface DegradedBatchRunner {
  run(
    filters: readonly DegradedFilterSpec[],
    notes: readonly unknown[],
    options?: DegradedBatchOptions,
  ): DegradedBatchOutcome
  /** キャッシュ済みフィルタの key 一覧 (テスト・診断用) */
  cachedKeys(): string[]
  dispose(): void
}

interface CacheEntry {
  source: string
  filter: ReferenceFilter
}

export function createDegradedBatchRunner(): DegradedBatchRunner {
  const cache = new Map<string, CacheEntry>()

  function release(key: string): void {
    const entry = cache.get(key)
    if (!entry) return
    entry.filter.dispose()
    cache.delete(key)
  }

  /** source が変わっていれば作り直す。実行不能なら null */
  function acquire(spec: DegradedFilterSpec): ReferenceFilter | null {
    const cached = cache.get(spec.key)
    if (cached && cached.source === spec.source) return cached.filter
    if (cached) release(spec.key)
    const filter = createReferenceFilter(spec.source)
    cache.set(spec.key, { source: spec.source, filter })
    return filter
  }

  return {
    run(filters, notes, options) {
      // 既定は match。以降のフィルタで非 match が出たら確定して短絡する
      const verdicts: FilterVerdict[] = notes.map(() => 'match')
      const invalidFilters: InvalidFilter[] = []

      for (const spec of filters) {
        options?.onFilterBegin?.(spec.key)
        let filter: ReferenceFilter | null = null
        try {
          filter = acquire(spec)
        } catch (e) {
          // ソースが実行不能: そのフィルタは全ノートを除外する (fail-closed)
          invalidFilters.push({ key: spec.key, message: String(e) })
          for (let i = 0; i < verdicts.length; i++) {
            if (verdicts[i] === 'match') verdicts[i] = 'error'
          }
          continue
        }
        if (!filter) continue
        for (let i = 0; i < notes.length; i++) {
          // 既に除外が確定したノートは評価しない
          if (verdicts[i] !== 'match') continue
          verdicts[i] = filter.evaluate(notes[i])
        }
      }

      return { verdicts, invalidFilters }
    },

    cachedKeys() {
      return [...cache.keys()]
    },

    dispose() {
      for (const key of [...cache.keys()]) release(key)
    },
  }
}
