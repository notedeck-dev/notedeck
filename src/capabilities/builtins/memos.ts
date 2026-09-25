import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

/** `memos.create` — 新規メモを作成する */
export const memosCreateCapability = implementCore('memos.create')

/** `memos.update` — 既存メモの text / tags を更新する */
export const memosUpdateCapability = implementCore('memos.update')

/** `memos.delete` — 既存メモを削除する */
export const memosDeleteCapability = implementCore('memos.delete')

/** `memos.revert` — メモを編集履歴の過去状態に戻す (#981 と同型) */
export const memosRevertCapability = implementCore('memos.revert')

export const MEMOS_BUILTIN_CAPABILITIES: readonly Command[] = [
  memosCreateCapability,
  memosUpdateCapability,
  memosDeleteCapability,
  memosRevertCapability,
]
