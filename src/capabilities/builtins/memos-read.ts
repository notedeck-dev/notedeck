import type { Command } from '@/commands/registry'
import {
  ensureMemosLoaded,
  loadAllMemos,
  type StoredMemo,
} from '@/composables/useMemos'
import { extractMemoRefs } from '@/utils/memoLinks'
import { implement } from '../declare'
import type { CapabilityContext } from '../types'

/**
 * memos.read 系 capability (#492) — AI がローカルメモを「列挙 / 検索」する
 * 軽量 read capability。embedding は使わず substring + recency boost で
 * 80% カバー (= キーワード検索を AI のクエリ書換えに任せる方針)。
 *
 * 全 capability cheap=true (= ローカルメモリのみ、API 呼び出しなし)。
 * permissions: ['memos.read'] — readonly preset でもデフォルト許可。
 */

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

interface ProjectedMemoRow {
  id: string
  text: string
  updatedAt: string
  tags?: string[]
  author?: { id: string; displayName: string; avatarUrl?: string }
  /** ラベル付き (tainted なセッションが書いた) メモ (#1103) */
  tainted?: boolean
}

function pickString(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const t = input.trim()
  return t.length > 0 ? t : undefined
}

function clampLimit(input: unknown, fallback = DEFAULT_LIMIT): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(input)))
}

function pickPositiveNumber(input: unknown): number | undefined {
  if (typeof input !== 'number' || !Number.isFinite(input)) return undefined
  if (input <= 0) return undefined
  return input
}

function projectRow(memoKey: string, memo: StoredMemo): ProjectedMemoRow {
  const row: ProjectedMemoRow = {
    id: memoKey,
    text: memo.data.text,
    updatedAt: memo.updatedAt,
  }
  if (memo.data.tags.length > 0) row.tags = memo.data.tags
  if (memo.data.author) row.author = { ...memo.data.author }
  if (memo.data.tainted) row.tainted = true
  return row
}

/** 返す行にラベル付きメモが含まれたら申告する (読んだセッションが tainted になる) */
function reportTaint(
  rows: ProjectedMemoRow[],
  ctx: CapabilityContext | undefined,
): ProjectedMemoRow[] {
  if (rows.some((r) => r.tainted)) ctx?.markTainted?.()
  return rows
}

function compareUpdatedAtDesc(a: StoredMemo, b: StoredMemo): number {
  if (a.updatedAt < b.updatedAt) return 1
  if (a.updatedAt > b.updatedAt) return -1
  return 0
}

/** `memos.list` — tag / 日付 / キーワードで絞り込んでメモを列挙 */
export const memosListCapability = implement('memos.list', {
  execute: async (params, ctx) => {
    await ensureMemosLoaded()
    const tag = pickString(params?.tag)
    const authorIdFilter = pickString(params?.authorId)
    const olderThanDays = pickPositiveNumber(params?.olderThanDays)
    const queryRaw = pickString(params?.query)
    const queryLower = queryRaw?.toLowerCase()
    const limit = clampLimit(params?.limit)

    const olderThanIso = olderThanDays
      ? new Date(Date.now() - olderThanDays * 86_400_000).toISOString()
      : null

    const all = loadAllMemos()
    const entries: Array<[string, StoredMemo]> = Object.entries(all)
    const filtered = entries.filter(([, memo]) => {
      if (tag && !memo.data.tags.includes(tag)) return false
      if (authorIdFilter) {
        // "self" sentinel = author 未設定 (= ユーザー本人) のみ
        if (authorIdFilter === 'self') {
          if (memo.data.author) return false
        } else if (memo.data.author?.id !== authorIdFilter) {
          return false
        }
      }
      if (olderThanIso && memo.updatedAt > olderThanIso) return false
      if (queryLower && !memo.data.text.toLowerCase().includes(queryLower)) {
        return false
      }
      return true
    })
    filtered.sort(([, a], [, b]) => compareUpdatedAtDesc(a, b))
    return reportTaint(
      filtered.slice(0, limit).map(([key, memo]) => projectRow(key, memo)),
      ctx,
    )
  },
})

/** `memos.search` — 部分一致 + recency boost で本文検索 */
export const memosSearchCapability = implement('memos.search', {
  execute: async (params, ctx) => {
    await ensureMemosLoaded()
    const query = pickString(params?.query)
    if (!query) throw new Error('memos.search: query is required')
    const authorIdFilter = pickString(params?.authorId)
    const limit = clampLimit(params?.limit)
    const queryLower = query.toLowerCase()

    const all = loadAllMemos()
    const entries: Array<[string, StoredMemo]> = Object.entries(all)
    const hits = entries.filter(([, memo]) => {
      if (!memo.data.text.toLowerCase().includes(queryLower)) return false
      if (authorIdFilter) {
        if (authorIdFilter === 'self') {
          if (memo.data.author) return false
        } else if (memo.data.author?.id !== authorIdFilter) {
          return false
        }
      }
      return true
    })
    // recency boost: 単純に updatedAt 降順 (= 新しいほど上位)。
    // 本格的な BM25 / TF-IDF はオーバーキル、まず使い始めて必要なら拡張。
    hits.sort(([, a], [, b]) => compareUpdatedAtDesc(a, b))
    return reportTaint(
      hits.slice(0, limit).map(([key, memo]) => projectRow(key, memo)),
      ctx,
    )
  },
})

/** `memos.backlinks` — 指定 memo を `[name](memo:<id>)` で参照しているメモを返す (#494) */
export const memosBacklinksCapability = implement('memos.backlinks', {
  execute: async (params, ctx) => {
    const targetId = pickString(params?.id)
    if (!targetId) throw new Error('memos.backlinks: id is required')
    // 対象 memo 自体の存在は要求しない (= 削除済 id でも参照側は返す)。ただ
    // 引数 validation として「14 桁数字」程度は accountId resolve より先に確認。
    if (!/^\d{14}$/.test(targetId)) {
      throw new Error(
        'memos.backlinks: id must be a Zettelkasten key (14-digit number)',
      )
    }
    await ensureMemosLoaded()
    const all = loadAllMemos()
    const hits: [string, StoredMemo][] = []
    for (const [key, memo] of Object.entries(all)) {
      if (key === targetId) continue
      const refs = extractMemoRefs(memo.data.text)
      if (refs.includes(targetId)) hits.push([key, memo])
    }
    hits.sort(([, a], [, b]) => compareUpdatedAtDesc(a, b))
    return reportTaint(
      hits.map(([key, memo]) => projectRow(key, memo)),
      ctx,
    )
  },
})

export const MEMOS_READ_BUILTIN_CAPABILITIES: readonly Command[] = [
  memosListCapability,
  memosSearchCapability,
  memosBacklinksCapability,
]
