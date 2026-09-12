/**
 * ノートを一意に指すキー (#1058 / #1010)。
 *
 * Misskey のノート ID はサーバー内でしか一意でない (aidx の nodeId は起動時乱数)。
 * 複数アカウントを 1 画面に混ぜる面では、別サーバー由来の同じ ID が衝突して片方が
 * 黙って消える。そこで「取得元アカウント + ノート ID」の複合を唯一の行キーにし、
 * ノート ID 単独をキーにする箇所を残さない。
 *
 * - `VariantKey`: (accountId, noteId) の複合。ストア・順序配列・tombstone・退避のキー
 * - `NoteIdentity`: 正規化 AP object id (`NormalizedNote._identity`)。同じノートを
 *   サーバーを跨いで束ねるキー。導出は notecli 側で、TS では組み立てない
 *
 * どちらも branded type にして、生の string と取り違えたら型で落ちるようにする。
 */

import type { NormalizedNote } from '@/adapters/types'

export type VariantKey = string & { readonly __brand: 'VariantKey' }
export type NoteIdentity = string & { readonly __brand: 'NoteIdentity' }

/** ID にもアカウント ID にも現れない制御文字 (U+001F) で連結する */
const SEP = ''

export function variantKey(accountId: string, noteId: string): VariantKey {
  return `${accountId}${SEP}${noteId}` as VariantKey
}

export function variantKeyOf(
  note: Pick<NormalizedNote, '_accountId' | 'id'>,
): VariantKey {
  return variantKey(note._accountId, note.id)
}

/** 入れ子 (renote / reply) は親の取得元アカウントに属する */
export function nestedVariantKey(
  parent: Pick<NormalizedNote, '_accountId'>,
  nestedId: string,
): VariantKey {
  return variantKey(parent._accountId, nestedId)
}

export function parseVariantKey(key: VariantKey): {
  accountId: string
  noteId: string
} {
  const idx = key.indexOf(SEP)
  if (idx < 0) return { accountId: '', noteId: key }
  return { accountId: key.slice(0, idx), noteId: key.slice(idx + 1) }
}

export function noteIdentityOf(
  note: Pick<NormalizedNote, '_identity'>,
): NoteIdentity {
  return note._identity as NoteIdentity
}
