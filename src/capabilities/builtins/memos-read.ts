import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

/** `memos.list` — tag / 日付 / キーワードで絞り込んでメモを列挙 */
export const memosListCapability = implementCore('memos.list')

/** `memos.search` — 部分一致 + recency boost で本文検索 */
export const memosSearchCapability = implementCore('memos.search')

/** `memos.backlinks` — 指定 memo を `[name](memo:<id>)` で参照しているメモを返す (#494) */
export const memosBacklinksCapability = implementCore('memos.backlinks')

export const MEMOS_READ_BUILTIN_CAPABILITIES: readonly Command[] = [
  memosListCapability,
  memosSearchCapability,
  memosBacklinksCapability,
]
