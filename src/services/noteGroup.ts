/**
 * 複数サーバーから見た同一ノートの束ね (#1058 §5)。
 *
 * 1 つのカラムの順序配列 (variant の列) を identity で畳み、group ごとに主ビューを
 * 選ぶ純関数。ストアには依存せず、述語は ctx で受ける (ユニットテストで固定する)。
 *
 * - variant: あるアカウントを通して取得した 1 つのノート
 * - group: 同一 identity の variant の集合 + 主ビュー。束ねる面の表示単位
 * - 主ビュー: 描画と既定操作に使う実在の variant。数 (reactions / renoteCount /
 *   repliesCount) は主ビューの値をそのまま使い、合算も max もしない
 *   (Like は origin と反応者のフォロワー先の両方に配送されるので足すと二重計上、
 *   max は取消が一方にしか届かないと膨らむ)
 */

import type { NormalizedNote } from '@/adapters/types'
import {
  type NoteIdentity,
  nestedVariantKey,
  noteIdentityOf,
  type VariantKey,
  variantKeyOf,
} from '@/services/noteKey'
import {
  type CanonicalReactionKey,
  canonicalReactionKey,
} from '@/services/reactionKey'

export interface NoteGroup {
  /** 仮想スクローラの行キー。正規 group は identity、不整合 variant は variant key */
  rowKey: string
  identity: NoteIdentity
  /** 主ビュー (実在の variant そのもの。複製しない) */
  primary: NormalizedNote
  /** 主ビュー候補をランク順、続けて非候補をランク順 */
  variants: NormalizedNote[]
  /** 自分のリアクションの和集合: 正規キー → 押したアカウント ID */
  reactedBy: Map<CanonicalReactionKey, string[]>
}

export interface NoteGroupContext {
  /** アカウント一覧の並び順 (最終タイブレーク) */
  accountOrder: readonly string[]
  hasToken: (accountId: string) => boolean
  /** そのアカウントのサーバー内 userId (投稿者一致の判定) */
  userIdOf: (accountId: string) => string | undefined
  /** origin の variant が削除された identity か (サーバー判断の権威) */
  isDeletedAtOrigin: (identity: NoteIdentity) => boolean
  /** variant (入れ子含む) が削除 tombstone か */
  isDeleted: (key: VariantKey) => boolean
  /** サーバーの判断: その variant の投稿者 (reply / renote 元を含む) が凍結されているか */
  isSuspended: (note: NormalizedNote) => boolean
  /** ユーザーの意思: ミュート (ユーザー / ワード / インスタンス / リノート) で隠すか */
  isUserHidden: (note: NormalizedNote) => boolean
}

/** テスト・照会カラムなど、述語を持たない呼び出し側の既定 */
export function defaultGroupContext(
  partial: Partial<NoteGroupContext> = {},
): NoteGroupContext {
  return {
    accountOrder: [],
    hasToken: () => true,
    userIdOf: () => undefined,
    isDeletedAtOrigin: () => false,
    isDeleted: () => false,
    isSuspended: () => false,
    isUserHidden: () => false,
    ...partial,
  }
}

/** visibility の階級。狭い順。未知の値 (フォーク独自) は public 階級 */
function visibilityClass(v: string): number {
  if (v === 'specified') return 0
  if (v === 'followers') return 1
  return 2
}

/** 描画される側 (純粋 Renote なら renote 元) */
function effective(note: NormalizedNote): NormalizedNote {
  return note.renote && note.text == null ? note.renote : note
}

/**
 * 埋め込み (Renote 元 / 返信先) が「非 origin 由来の削除」で隠されている、
 * または欠落 (`renoteId` あり + `renote` なし = 誰の判断か分からない) か。
 * origin 由来の削除は §5.5 で group ごと隠すので、ここでは見ない。
 */
function embeddedDegraded(
  note: NormalizedNote,
  ctx: NoteGroupContext,
): boolean {
  if (note.renoteId && !note.renote) return true
  for (const nested of [note.renote, note.reply]) {
    if (!nested) continue
    if (ctx.isDeleted(nestedVariantKey(note, nested.id)) && !nested._isOrigin)
      return true
  }
  return false
}

/** 埋め込みが origin で削除されているか (group を隠す根拠) */
function embeddedDeletedAtOrigin(
  note: NormalizedNote,
  ctx: NoteGroupContext,
): boolean {
  for (const nested of [note.renote, note.reply]) {
    if (!nested) continue
    if (
      nested._isOrigin &&
      (ctx.isDeleted(nestedVariantKey(note, nested.id)) ||
        ctx.isDeletedAtOrigin(noteIdentityOf(nested)))
    )
      return true
  }
  return false
}

/**
 * 主ビューの選択 (§5.2)。静的な事実だけで決め、取得順・反応数・アクティブ
 * アカウントには依存しない。戻り値は [候補をランク順, 非候補をランク順]。
 */
export function rankVariants(
  variants: readonly NormalizedNote[],
  ctx: NoteGroupContext,
): NormalizedNote[] {
  // 前処理: 最も狭い階級に一致する variant だけが候補。投稿者の設定で origin
  // だけが followers に書き換わっている場合、本文を持つ連合先の public 複製を
  // 主にすると投稿者の意図に反する
  const narrowest = Math.min(
    ...variants.map((v) => visibilityClass(v.visibility)),
  )
  const orderIndex = new Map(ctx.accountOrder.map((id, i) => [id, i]))
  const score = (v: NormalizedNote): number[] => {
    const isCandidate = visibilityClass(v.visibility) === narrowest ? 1 : 0
    const hasToken = ctx.hasToken(v._accountId) ? 1 : 0
    // followers / specified 階級のときだけ本文の有無を見る。public 階級では
    // 投稿者の「古いノートを隠す」設定を尊重して origin の隠した状態を出す
    const visibleBody = narrowest <= 1 && effective(v).contentHidden ? 0 : 1
    const embeddedOk = embeddedDegraded(v, ctx) ? 0 : 1
    // 凍結は非 origin なら候補から外す (origin なら §5.5 で group ごと隠れる)
    const notSuspended = !v._isOrigin && ctx.isSuspended(v) ? 0 : 1
    const isAuthor = ctx.userIdOf(v._accountId) === v.user.id ? 1 : 0
    const isOrigin = v._isOrigin ? 1 : 0
    const updated = v.updatedAt ?? ''
    const order = -(orderIndex.get(v._accountId) ?? Number.MAX_SAFE_INTEGER)
    return [
      isCandidate,
      hasToken,
      visibleBody,
      embeddedOk,
      notSuspended,
      isAuthor,
      isOrigin,
      // updatedAt は文字列比較なので数値化: 辞書順で大きいほど新しい
      updated.length === 0 ? 0 : 1,
      order,
    ]
  }
  const compare = (a: number[], b: number[], ua: string, ub: string) => {
    for (let i = 0; i < a.length; i++) {
      // updatedAt の桁 (index 7) は同点なら文字列で比較
      if (i === 7 && (a[i] ?? 0) === (b[i] ?? 0) && ua !== ub) {
        return ua > ub ? 1 : -1
      }
      const d = (a[i] ?? 0) - (b[i] ?? 0)
      if (d !== 0) return d
    }
    return 0
  }
  const scored = variants.map((v, i) => ({ v, s: score(v), i }))
  scored.sort((x, y) => {
    const c = compare(y.s, x.s, y.v.updatedAt ?? '', x.v.updatedAt ?? '')
    return c !== 0 ? c : x.i - y.i
  })
  return scored.map((x) => x.v)
}

export function selectPrimary(
  variants: readonly NormalizedNote[],
  ctx: NoteGroupContext,
): NormalizedNote {
  const ranked = rankVariants(variants, ctx)
  // biome-ignore lint/style/noNonNullAssertion: caller guarantees non-empty
  return ranked[0]!
}

/** 全 variant (純粋 Renote なら renote 元) の myReaction の和集合 */
export function reactedByOf(
  variants: readonly NormalizedNote[],
): Map<CanonicalReactionKey, string[]> {
  const map = new Map<CanonicalReactionKey, string[]>()
  for (const v of variants) {
    const my = effective(v).myReaction
    if (!my) continue
    const key = canonicalReactionKey(my, v._serverHost)
    const list = map.get(key)
    if (list) list.push(v._accountId)
    else map.set(key, [v._accountId])
  }
  return map
}

/**
 * 同一 `_accountId` の variant が複数ある場合 (ap/show 経由の 2 行目) は
 * 辞書順で小さい id (先に存在していた行) だけを採る。内容は等価。
 */
function dedupeSameAccount(variants: NormalizedNote[]): NormalizedNote[] {
  const byAccount = new Map<string, NormalizedNote>()
  for (const v of variants) {
    const cur = byAccount.get(v._accountId)
    if (!cur || v.id < cur.id) byAccount.set(v._accountId, v)
  }
  if (byAccount.size === variants.length) return variants
  return variants.filter((v) => byAccount.get(v._accountId) === v)
}

/**
 * 順序配列を identity で畳む。group の並び位置は最初に現れた variant の位置。
 * 整合検査を通らない variant (`_identityTrusted` が偽) は束ねず、variant key を
 * 行キーにした 1 個 group として単独表示する。
 */
export function buildNoteGroups(
  notes: readonly NormalizedNote[],
  ctx: NoteGroupContext,
): NoteGroup[] {
  const order: string[] = []
  const members = new Map<string, NormalizedNote[]>()
  for (const n of notes) {
    const rowKey = n._identityTrusted ? n._identity : variantKeyOf(n)
    const list = members.get(rowKey)
    if (list) list.push(n)
    else {
      members.set(rowKey, [n])
      order.push(rowKey)
    }
  }
  const groups: NoteGroup[] = []
  for (const rowKey of order) {
    // biome-ignore lint/style/noNonNullAssertion: populated above
    const raw = members.get(rowKey)!
    const variants = rankVariants(dedupeSameAccount(raw), ctx)
    // biome-ignore lint/style/noNonNullAssertion: non-empty by construction
    const primary = variants[0]!
    groups.push({
      rowKey,
      identity: noteIdentityOf(primary),
      primary,
      variants,
      reactedBy: reactedByOf(variants),
    })
  }
  return groups
}

/**
 * 可視性 (§5.5)。材料の種類で規則を分ける:
 * - ユーザーの意思 (ミュート): variant の OR。どれかのアカウントで隠すと決めたなら隠す
 * - サーバーの判断 (削除 / 凍結): 判断の対象ノート自身の origin で下されたときだけ
 *   権威。非 origin の判断 (連合先モデレーター) は variant を候補から外すだけ
 * origin 不在の group で全 variant が外れれば配列から消えるので自然に消える。
 */
export function isGroupHidden(
  group: NoteGroup,
  ctx: NoteGroupContext,
): boolean {
  if (ctx.isDeletedAtOrigin(group.identity)) return true
  for (const v of group.variants) {
    if (ctx.isUserHidden(v)) return true
    if (v._isOrigin && ctx.isSuspended(v)) return true
    if (embeddedDeletedAtOrigin(v, ctx)) return true
  }
  return false
}

/**
 * 同 identity の variant を最初の出現位置の直後に寄せる (§4 の不変条件)。
 * 一括取得の結果は createdAt のずれで同じ identity が離れて並ぶことがあり、
 * そのままだと先頭 variant の消失で group の位置が飛び、group 数の切り詰めで
 * 遠い variant が黙って落ちる。
 */
export function clusterByIdentity(notes: NormalizedNote[]): NormalizedNote[] {
  const buckets = new Map<string, NormalizedNote[]>()
  const order: string[] = []
  for (const n of notes) {
    const key = n._identityTrusted ? n._identity : variantKeyOf(n)
    const b = buckets.get(key)
    if (b) b.push(n)
    else {
      buckets.set(key, [n])
      order.push(key)
    }
  }
  if (order.length === notes.length) return notes
  const out: NormalizedNote[] = []
  // biome-ignore lint/style/noNonNullAssertion: keys come from the map
  for (const key of order) out.push(...buckets.get(key)!)
  return out
}

/**
 * 上限を group (行) 数で数えて切り詰める。variant 数で数えると N アカウントで
 * 行数が N 分の 1 になり、投稿が疎なアカウントの分から落ちる。
 * 入力は `clusterByIdentity` 済み (同 identity が隣接) を前提にする。
 */
export function truncateByGroups(
  notes: NormalizedNote[],
  maxGroups: number,
): NormalizedNote[] {
  let groups = 0
  let last: string | null = null
  let end = notes.length
  for (let i = 0; i < notes.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounded loop
    const n = notes[i]!
    const key = n._identityTrusted ? n._identity : variantKeyOf(n)
    if (key !== last) {
      groups++
      last = key
      if (groups > maxGroups) {
        end = i
        break
      }
    }
  }
  return end === notes.length ? notes : notes.slice(0, end)
}
