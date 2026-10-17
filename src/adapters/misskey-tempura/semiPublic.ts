import type { VisibilityOption } from '@/composables/postFormConstants'
import { i18n } from '@/i18n'
import { commands, unwrap } from '@/utils/tauriInvoke'
import type { NormalizedNote, PostVisibility } from '../types'

/**
 * tempura の公開範囲「セミパブリック」(`public_non_ltl`、#936)。
 *
 * 全員に公開だがローカル TL に載らない。送信は `visibility: 'public_non_ltl'`、
 * 受信ではサーバーが `visibility: 'public'` + `dontShowOnLtl: true` に書き換えて
 * 返すので、往復で値が違う。この非対称をここ 1 箇所で吸収する。
 *
 * 対応サーバーかどうかはロールポリシー `canPublicNonLtlNote` のキーで動的に
 * 判定する (フォーク名は見ない)。false のアカウントが送ると黙って home に
 * 降格されるので、true のときだけ選択肢を出す。
 */
export const SEMI_PUBLIC = 'public_non_ltl' satisfies PostVisibility
export const SEMI_PUBLIC_POLICY = 'canPublicNonLtlNote'

export function canPostSemiPublic(
  policies: Partial<Record<string, boolean>> | null | undefined,
): boolean {
  return policies?.[SEMI_PUBLIC_POLICY] === true
}

/** 受信ノートの実効公開範囲 (public + dontShowOnLtl → public_non_ltl) */
export function effectivePostVisibility(
  note: Pick<NormalizedNote, 'visibility' | 'dontShowOnLtl'>,
): PostVisibility {
  return note.visibility === 'public' && note.dontShowOnLtl === true
    ? SEMI_PUBLIC
    : note.visibility
}

const NARROWNESS: Record<PostVisibility, number> = {
  public: 0,
  public_non_ltl: 1,
  home: 2,
  followers: 3,
  specified: 4,
}

/** 公開範囲の狭い方 (公式 Web の smallerVisibility と同じ順序) */
export function narrowerVisibility(
  a: PostVisibility,
  b: PostVisibility,
): PostVisibility {
  return NARROWNESS[a] >= NARROWNESS[b] ? a : b
}

/**
 * 返信の既定 (公式 Web と同じ 2 規則)。該当しなければ null で、呼び元は
 * 従来の既定 (返信先の公開範囲) を使う。
 * 1. 返信先がセミパブリックなら返信もセミパブリック
 * 2. 自分のセミパブリックへのパブリック返信に返すときもセミパブリック
 */
export function semiPublicReplyDefault(
  replyTo: NormalizedNote,
  myUserId: string | undefined,
  canPost: boolean,
): PostVisibility | null {
  if (!canPost) return null
  if (effectivePostVisibility(replyTo) === SEMI_PUBLIC) return SEMI_PUBLIC
  const parent = replyTo.reply
  if (
    replyTo.visibility === 'public' &&
    parent &&
    myUserId &&
    parent.user.id === myUserId &&
    effectivePostVisibility(parent) === SEMI_PUBLIC
  ) {
    return SEMI_PUBLIC
  }
  return null
}

/** ピッカーの選択肢 (public の直後に置く)。アイコンは broadcast 系 */
export const semiPublicVisibilityOption: VisibilityOption = {
  value: SEMI_PUBLIC,
  get label() {
    return i18n.ts._postFormConstants.publicNonLtl
  },
  icon: 'M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.79M12 12h.01v.01H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z',
}

// 投稿フォーム以外 (素のリノート) から投稿可否を見るためのアカウント単位の
// メモ化。ポリシーは滅多に変わらず、投稿フォームは開くたびに取り直すので
// プロセス内に持ちきりでよい。失敗はキャッシュしない
const canPostByAccount = new Map<string, Promise<boolean>>()

export async function canPostSemiPublicFor(
  accountId: string,
): Promise<boolean> {
  let pending = canPostByAccount.get(accountId)
  if (!pending) {
    pending = commands
      .apiGetUserPolicies(accountId)
      .then((r) => canPostSemiPublic(unwrap(r)))
    canPostByAccount.set(accountId, pending)
    pending.catch(() => canPostByAccount.delete(accountId))
  }
  try {
    return await pending
  } catch {
    return false
  }
}

export function clearSemiPublicCache(): void {
  canPostByAccount.clear()
}

/**
 * 素のリノートで送る公開範囲。元がセミパブリックで、同じアカウントが投稿できる
 * ときだけ public_non_ltl (投稿者の「LTL に出したくない」を引き継ぐ)。それ以外は
 * undefined でサーバー既定に任せる。別アカウント (別サーバーの写し) では連合上
 * ただの public なので引き継がない。
 */
export async function renoteVisibilityFor(
  note: NormalizedNote,
  accountId: string,
): Promise<PostVisibility | undefined> {
  if (effectivePostVisibility(note) !== SEMI_PUBLIC) return undefined
  if (note._accountId !== accountId) return undefined
  return (await canPostSemiPublicFor(accountId)) ? SEMI_PUBLIC : undefined
}
