/// <reference lib="webworker" />

import {
  createDegradedBatchRunner,
  type DegradedFilterSpec,
  type InvalidFilter,
} from '../services/columnQuery/degradedBatch'
import type { FilterVerdict } from '../services/columnQuery/referenceEvaluator'

/**
 * 🐢 降格フィルタの評価 Worker (#783 Phase 2 / V15)。
 *
 * AiScript Interpreter の per-note 評価は同期実行で外部から中断できず、
 * step 予算もメモリ確保 (`arr.repeat` 等) を縛れない。確実に止める手段は
 * `Worker.terminate()` しかないので、評価は必ずこの Worker で行う。
 *
 * ノートは structured clone でカラムごとに独立したコピーが渡るため、
 * `Obj:set` や代入による破壊的変更がフィルタ間へ波及しない (V23)。
 */

export interface ColumnQueryWorkerRequest {
  id: number
  filters: DegradedFilterSpec[]
  notes: unknown[]
}

export type ColumnQueryWorkerResponse =
  | { type: 'begin'; id: number; key: string }
  | {
      type: 'done'
      id: number
      verdicts: FilterVerdict[]
      invalidFilters: InvalidFilter[]
    }

const runner = createDegradedBatchRunner()

self.onmessage = (event: MessageEvent<ColumnQueryWorkerRequest>) => {
  const { id, filters, notes } = event.data
  const outcome = runner.run(filters, notes, {
    onFilterBegin: (key) => {
      // 暴走して terminate されたとき、どのフィルタで止まったかを
      // メインスレッド側が帰属できるようにする (V23 の評価開始マーカー)
      const mark: ColumnQueryWorkerResponse = { type: 'begin', id, key }
      self.postMessage(mark)
    },
  })
  const done: ColumnQueryWorkerResponse = {
    type: 'done',
    id,
    verdicts: outcome.verdicts,
    invalidFilters: outcome.invalidFilters,
  }
  self.postMessage(done)
}
