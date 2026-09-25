import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

/** `notes.create` — 新規ノートを投稿する */
export const notesCreateCapability = implementCore('notes.create')

/** `notes.react` — ノートにリアクションする */
export const notesReactCapability = implementCore('notes.react')

/** `notes.unreact` — 自分が付けたリアクションを解除する。
 *
 * Misskey の API は `notes/reactions/delete` で reaction 種別を指定せず削除
 * (= 1 ノートに付けられる reaction は 1 つだけだから一意に決まる)。
 * notes.react と対称、可逆操作なので確認 UI は標準 (danger だが内容は軽い)。
 */
export const notesUnreactCapability = implementCore('notes.unreact')

/**
 * `notes.delete` — 自分のノートを削除する (慎重カテゴリ、不可逆)。
 *
 * 削除済みノートは復元できない (Misskey の挙動)。確認 UI は関数形式で
 * `type: 'danger'` を明示し、戻せないことをメッセージに書く。AI が
 * 「整理しといて」と気軽に呼ばないよう、permission も notes.write を要求
 * (= safe preset では通らない)。
 */
export const notesDeleteCapability = implementCore('notes.delete')

/**
 * `notes.pin` / `notes.unpin` — 自分のプロファイルにノートを pin / 解除する。
 * 公開プロファイルの top に表示される。可逆操作 (unpin あり) なので確認 UI は
 * 標準 (danger だが内容は軽い)。Misskey の上限は通常 5 件。
 */
export const notesPinCapability = implementCore('notes.pin')

export const notesUnpinCapability = implementCore('notes.unpin')

export const NOTES_WRITE_BUILTIN_CAPABILITIES: readonly Command[] = [
  notesCreateCapability,
  notesReactCapability,
  notesUnreactCapability,
  notesDeleteCapability,
  notesPinCapability,
  notesUnpinCapability,
]
