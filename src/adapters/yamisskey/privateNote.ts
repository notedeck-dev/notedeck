import type { VisibilityOption } from '@/composables/postFormConstants'
import { i18n } from '@/i18n'
import type { FormVisibility, NormalizedNote, PostVisibility } from '../types'

/**
 * yamisskey の公開範囲「プライベート」(自分のみに公開、#1265)。
 *
 * 公開範囲の値ではなく「ダイレクトで宛先が空 (または投稿者自身だけ)」の派生。
 * 送信はダイレクト + ローカルのみ (サーバーも localOnly を強制する)、応答は
 * 生の値のまま返るので、見分けは受信側の predicate で行う。
 *
 * 選択肢を出すかは API から判定できないので、yamisskey の adapter が
 * `ServerFeatures.privateNote` を静的に宣言する。表示 (predicate) はどの
 * サーバーでも成立するので、宣言の有無を見ない。
 */
export const PRIVATE = 'private' satisfies FormVisibility

/** ダイレクトで宛先が空か投稿者自身だけ = 自分にしか見えないノート */
export function isPrivateNote(
  note: Pick<NormalizedNote, 'visibility' | 'visibleUserIds' | 'user'>,
): boolean {
  if (note.visibility !== 'specified') return false
  const ids = note.visibleUserIds ?? []
  if (ids.length === 0) return true
  return ids.length === 1 && ids[0] === note.user.id
}

/** フォームの選択値を送信値に落とす。プライベートはダイレクト + ローカルのみ */
export function toPostVisibility(
  visibility: FormVisibility,
  localOnly: boolean,
): { visibility: PostVisibility; localOnly: boolean } {
  if (visibility === PRIVATE)
    return { visibility: 'specified', localOnly: true }
  // ダイレクトはローカルのみを送らない (従来どおり)
  if (visibility === 'specified') return { visibility, localOnly: false }
  return { visibility, localOnly }
}

/**
 * 返信の既定。返信先がプライベートなら返信もプライベート (サーバーが連鎖を
 * 強制するので、画面の既定も合わせる)。該当しなければ null
 */
export function privateReplyDefault(
  replyTo: NormalizedNote,
  canPost: boolean,
): FormVisibility | null {
  if (!canPost) return null
  return isPrivateNote(replyTo) ? PRIVATE : null
}

/** ピッカーの選択肢 (最後に置く)。アイコンは目を閉じた形 */
export const privateVisibilityOption: VisibilityOption = {
  value: PRIVATE,
  get label() {
    return i18n.ts._postFormConstants.private
  },
  icon: 'M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88',
}
