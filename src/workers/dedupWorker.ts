/// <reference lib="webworker" />

import type { NormalizedNote } from '../adapters/types'
import { variantKeyOf } from '../services/noteKey'

export interface DedupRequest {
  type: 'dedup'
  id: number
  notes: NormalizedNote[]
  /** 既存の行キー (variant key) */
  existingKeys: string[] | null
}

export interface DedupResponse {
  id: number
  notes: NormalizedNote[]
}

/** 既存の行キー (取得元アカウント + note id、#1010) を除外し、createdAt降順でソート */
function dedup(
  incoming: NormalizedNote[],
  existingKeys?: Set<string>,
): NormalizedNote[] {
  const seen = existingKeys ?? new Set<string>()
  return incoming
    .filter((n) => {
      const key = variantKeyOf(n)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

self.onmessage = (event: MessageEvent<DedupRequest>) => {
  const { id, notes, existingKeys } = event.data
  const existing = existingKeys ? new Set(existingKeys) : undefined
  const result = dedup(notes, existing)
  const response: DedupResponse = { id, notes: result }
  self.postMessage(response)
}
