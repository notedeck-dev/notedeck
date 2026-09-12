import type { NormalizedNote } from '@/adapters/types'
import { type VariantKey, variantKeyOf } from '@/services/noteKey'

/**
 * Sort notes by createdAt in descending order (newest first).
 * In-place sort — caller must pass a new array (e.g. from spread).
 */
export function sortByCreatedAtDesc(notes: NormalizedNote[]): NormalizedNote[] {
  return notes.sort((a, b) =>
    a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0,
  )
}

/**
 * Merge two already-sorted (desc) note arrays into one sorted array.
 * Deduplicates by variant key (取得元アカウント + note id、#1010) — when the same key appears in both arrays,
 * the entry from `a` (typically the newer/fresher data) wins.
 * O(n + m) instead of O((n+m) log(n+m)).
 */
export function mergeSortedNotes(
  a: NormalizedNote[],
  b: NormalizedNote[],
): NormalizedNote[] {
  const result: NormalizedNote[] = []
  const seen = new Set<VariantKey>()
  let i = 0
  let j = 0
  let ai = a[0]
  let bj = b[0]
  while (ai && bj) {
    if (ai.createdAt >= bj.createdAt) {
      if (!seen.has(variantKeyOf(ai))) {
        seen.add(variantKeyOf(ai))
        result.push(ai)
      }
      ai = a[++i]
    } else {
      if (!seen.has(variantKeyOf(bj))) {
        seen.add(variantKeyOf(bj))
        result.push(bj)
      }
      bj = b[++j]
    }
  }
  while (ai) {
    if (!seen.has(variantKeyOf(ai))) {
      seen.add(variantKeyOf(ai))
      result.push(ai)
    }
    ai = a[++i]
  }
  while (bj) {
    if (!seen.has(variantKeyOf(bj))) {
      seen.add(variantKeyOf(bj))
      result.push(bj)
    }
    bj = b[++j]
  }
  return result
}

/**
 * Insert a small batch of notes into an already-sorted (desc) array.
 * Sorts the batch first, then merges. O(m log m + n + m) ≈ O(n) when m << n.
 */
export function insertIntoSorted(
  sorted: NormalizedNote[],
  batch: NormalizedNote[],
): NormalizedNote[] {
  if (batch.length === 0) return sorted
  if (sorted.length === 0) {
    if (batch.length <= 1) return batch
    return sortByCreatedAtDesc([...batch])
  }
  // Fast path: single-element batch (most common for streaming) needs no copy/sort
  if (batch.length === 1) return mergeSortedNotes(batch, sorted)
  // Skip copy+sort if batch is already in descending order
  if (isDescending(batch)) return mergeSortedNotes(batch, sorted)
  return mergeSortedNotes(sortByCreatedAtDesc([...batch]), sorted)
}

function isDescending(notes: NormalizedNote[]): boolean {
  for (let i = 1; i < notes.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounded loop
    if (notes[i - 1]!.createdAt < notes[i]!.createdAt) return false
  }
  return true
}
