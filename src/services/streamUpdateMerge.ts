/**
 * ストリームイベント (noteUpdated / chat react) のマージ規則 (#782)。
 *
 * notes / chatMessageStore が持っていた reaction・poll・reactor の正規化を
 * 純関数として抽出し、フレームワーク非依存で直接テストする。store 側は
 * reactive Map への反映 (set + trigger) のみを持つ。
 *
 * notecli への完全移設 (イベント適用済みの note を Rust が流す形) は、
 * notecli が note のライブ状態を持つ notecli#30 (notes キャッシュ再設計) が
 * 前提になるため、その中間段階。マージ規則がここに隔離されていれば、
 * 移設時はこのモジュールの porting だけで済む。
 */

import type {
  ChatMessage,
  NormalizedNote,
  NoteUpdateEvent,
} from '@/adapters/types'

/**
 * `bindings.ChatReactionUser` (string | null) と `ChatMessageReaction['user']`
 * (string | undefined) の両方を受けるための広めの reactor 型。
 * 内部で null → undefined に正規化してから格納する。
 */
export type ChatReactorInput = {
  id: string
  username: string
  name?: string | null
  host?: string | null
  avatarUrl?: string | null
} | null

export type ChatMessageUpdateEvent =
  | {
      type: 'reacted'
      messageId: string
      userId?: string | null
      reaction: string
      reactor?: ChatReactorInput
    }
  | {
      type: 'unreacted'
      messageId: string
      userId?: string | null
      reaction: string
      reactor?: ChatReactorInput
    }
  | {
      type: 'deleted'
      messageId: string
    }

export function noteUpdateSig(event: NoteUpdateEvent): string {
  const b = event.body
  return `${event.type}${b.userId ?? ''}${b.reaction ?? ''}${b.choice ?? ''}`
}

export function chatUpdateSig(event: ChatMessageUpdateEvent): string {
  if (event.type === 'deleted') return 'deleted'
  return `${event.type}${event.userId ?? ''}${event.reaction ?? ''}`
}

/**
 * reactions キーの正規化: ローカルマーカー (`:name@.:` → `:name:`) を剥がす。
 * 楽観的更新はピッカー形式 (`:name:`)、サーバーイベントは正規形で届くことが
 * あるため、素の一致比較では自己イベントの echo 判定とキー合流に失敗する。
 */
function normalizeReactionKey(key: string): string {
  return key.replace(/@\.:$/, ':')
}

/** reaction と (形式差を含めて) 同一視できる既存キーを探す。無ければそのまま */
function findReactionKey(
  reactions: Record<string, number>,
  reaction: string,
): string {
  if (reaction in reactions) return reaction
  const norm = normalizeReactionKey(reaction)
  for (const key of Object.keys(reactions)) {
    if (normalizeReactionKey(key) === norm) return key
  }
  return reaction
}

/**
 * noteUpdated イベントをノートへ適用した新オブジェクトを返す。適用不要は null。
 *
 * 自ユーザのイベントは楽観的更新 (toggleReaction) の echo なら無視し、
 * 楽観が反映されていない場合 (別ウィンドウ・別デバイスからの操作、楽観の
 * 効かない面) は自己修復として適用する。
 */
export function mergeNoteUpdate(
  note: NormalizedNote,
  event: NoteUpdateEvent,
  myUserId: string | undefined,
): NormalizedNote | null {
  switch (event.type) {
    case 'reacted': {
      const reaction = event.body.reaction
      if (!reaction) return null
      // myUserId != null: guest (undefined) × userId 欠落イベントの undefined
      // 同士一致を「自分」と誤判定しない (pollVoted と同じ規約)
      const isMine = myUserId != null && event.body.userId === myUserId
      if (isMine) {
        // 楽観反映済みの echo → 二重加算しない
        if (
          note.myReaction &&
          normalizeReactionKey(note.myReaction) ===
            normalizeReactionKey(reaction)
        ) {
          return null
        }
      }
      let newReactionEmojis = note.reactionEmojis
      if (event.body.emoji) {
        // Strip colons to match API convention (reactionEmojis keys have no colons)
        const shortcode =
          reaction.startsWith(':') && reaction.endsWith(':')
            ? reaction.slice(1, -1)
            : reaction
        const emojiUrl =
          typeof event.body.emoji === 'string'
            ? event.body.emoji
            : event.body.emoji.url
        newReactionEmojis = { ...note.reactionEmojis, [shortcode]: emojiUrl }
      }
      // 形式違いの既存キー (:name: と :name@.:) は合流させ、別チップを作らない
      const key = findReactionKey(note.reactions, reaction)
      return {
        ...note,
        reactions: {
          ...note.reactions,
          [key]: (note.reactions[key] ?? 0) + 1,
        },
        reactionEmojis: newReactionEmojis,
        ...(isMine ? { myReaction: reaction } : {}),
      }
    }
    case 'unreacted': {
      const reaction = event.body.reaction
      if (!reaction) return null
      if (myUserId != null && event.body.userId === myUserId) {
        // 自分の取消: myReaction が一致するなら自己修復として取り消す。
        // カウントは「楽観減算済みの echo」と「別デバイス操作」を区別できない
        // ため触らない (二重減算の方が害が大きい)。既に null なら echo
        if (
          note.myReaction &&
          normalizeReactionKey(note.myReaction) ===
            normalizeReactionKey(reaction)
        ) {
          return { ...note, myReaction: null }
        }
        return null
      }
      const key = findReactionKey(note.reactions, reaction)
      const newReactions = { ...note.reactions }
      const count = (newReactions[key] ?? 0) - 1
      if (count <= 0) delete newReactions[key]
      else newReactions[key] = count
      return { ...note, reactions: newReactions }
    }
    case 'pollVoted': {
      const choice = event.body.choice
      if (choice == null || !note.poll) return null
      const isMine = !!myUserId && event.body.userId === myUserId
      const newChoices = note.poll.choices.map((c, i) =>
        i === choice
          ? { ...c, votes: c.votes + 1, ...(isMine ? { isVoted: true } : {}) }
          : c,
      )
      return { ...note, poll: { ...note.poll, choices: newChoices } }
    }
    default:
      return null
  }
}

/**
 * chat の react/unreact イベントをメッセージへ適用した新オブジェクトを返す。
 * 適用不要 (一致する reaction なし等) は null。
 */
export function mergeChatUpdate(
  msg: ChatMessage,
  event: ChatMessageUpdateEvent,
): ChatMessage | null {
  switch (event.type) {
    case 'reacted': {
      const r = event.reactor
      const user = r
        ? {
            id: r.id,
            username: r.username,
            name: r.name ?? undefined,
            host: r.host ?? undefined,
            avatarUrl: r.avatarUrl ?? undefined,
          }
        : null
      const reactions = [
        ...(msg.reactions ?? []),
        { user, reaction: event.reaction },
      ]
      return { ...msg, reactions }
    }
    case 'unreacted': {
      if (!msg.reactions) return null
      // (userId, reaction) が一致する最初の 1 件を削除
      const idx = msg.reactions.findIndex(
        (r) =>
          r.reaction === event.reaction &&
          (r.user?.id ?? null) === (event.userId ?? null),
      )
      if (idx === -1) return null
      const reactions = [...msg.reactions]
      reactions.splice(idx, 1)
      return { ...msg, reactions }
    }
    default:
      return null
  }
}

export interface UpdateDeduper {
  /**
   * この (id, sig) を適用してよいか。true を返した場合は窓の間、同一 sig を
   * 弾くよう記録する。別 sig が来ると上書きされる (同ユーザの逐次
   * react→unreact は別 sig として通る)。
   */
  shouldApply(id: string, sig: string): boolean
}

/**
 * 複数配信経路 (channel auto-capture + subNote 等) からの同一イベント重複を
 * 短い窓で弾く deduper。notes / chat 両 store で同型実装だったものを共通化。
 */
export function createUpdateDeduper(windowMs: number): UpdateDeduper {
  const recentSigs = new Map<string, string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  function shouldApply(id: string, sig: string): boolean {
    if (recentSigs.get(id) === sig) return false
    recentSigs.set(id, sig)
    const existing = timers.get(id)
    if (existing != null) clearTimeout(existing)
    const timer = setTimeout(() => {
      recentSigs.delete(id)
      timers.delete(id)
    }, windowMs)
    timers.set(id, timer)
    return true
  }

  return { shouldApply }
}
