import type {
  NormalizedNote,
  NormalizedNotification,
  NormalizedUser,
  ReactionInfo,
} from '@/adapters/types'
import { useAccountsStore } from '@/stores/accounts'
import { useMutesStore } from '@/stores/mutes'
import { useNoteStore } from '@/stores/notes'
import { useSuspensionsStore } from '@/stores/suspensions'

/**
 * 述語の opt-out オプション（#828 / #831 §1.1）。
 *
 * 判定材料は 2 種類に分かれる:
 * - **対象由来**（userMute / instanceMute / renoteMute / suspension）= 「誰か」に紐づく
 * - **内容由来**（wordMute / tombstone）= 「何が書かれているか・存在するか」
 *
 * 明示的に開いた面（プロフィール等）は前者を貫通させ、後者は常に適用する。
 */
export interface VisibilityOpts {
  /** 凍結のみ無視する。保存面（お気に入り・自クリップ・祖先スレッド）用 */
  ignoreSuspension?: boolean
  /** 対象の同一性に由来する材料を全て無視する。明示的に開いた面（プロフィール）用 */
  ignoreSubject?: boolean
}

/**
 * ノートの表示可視性述語。
 *
 * 「データは保持し、表示時に boolean 述語で隠す/戻す」という方針の単一入口
 * （#602 で導入）。取り込み時フィルタや物理削除と違いデータを破棄しないため、
 * 即時・遡及・解除復活が可能で、#574（ミュート遡及非表示）/ 魚拓（削除ノート
 * 保持）の土台を兼ねる。
 *
 * 述語の合成は storage 層（noteStore）でなくこの consumption 層に集約する。
 * mute/archive は account 層の関心事で、noteStore に OR 合成させると
 * 上方向依存（layering smell）になるため。
 */
export function useNoteVisibility() {
  const noteStore = useNoteStore()
  const mutesStore = useMutesStore()
  const accountsStore = useAccountsStore()
  const suspensionsStore = useSuspensionsStore()

  /** ワードミュートのマッチ対象テキスト（本家準拠で cw + text）。 */
  function noteMatchText(note: NormalizedNote): string {
    return `${note.cw ?? ''}\n${note.text ?? ''}`
  }

  /** 自分のノートか（本家準拠でワードミュート対象外にする）。 */
  function isOwnNote(note: NormalizedNote): boolean {
    return (
      accountsStore.accountMap.get(note._accountId)?.userId === note.user.id
    )
  }

  /**
   * 表示から隠すべきノートか。判定材料:
   * - 削除 tombstone（#602, 非 reactive・再読込復活を抑止）
   * - ミュート（#574, per-account reactive・投稿者/reply先/renote元のいずれか）
   * - 凍結（#828, サーバー側の事実・投稿者/reply先/renote元のいずれか）
   * ミュート・凍結は reactive なので、この述語を読む computed は解除で即復活する。
   *
   * `opts` は明示的に開いた面・保存した面のための opt-out（既定は全適用 = 安全側）。
   */
  function isHidden(note: NormalizedNote, opts?: VisibilityOpts): boolean {
    if (noteStore.isDeleted(note.id)) return true
    const acc = note._accountId
    const subject = !opts?.ignoreSubject
    return (
      (subject &&
        (mutesStore.isUserMuted(acc, note.user.id) ||
          mutesStore.isUserMuted(acc, note.reply?.user?.id) ||
          mutesStore.isUserMuted(acc, note.renote?.user?.id))) ||
      isHardWordMuted(note) ||
      (subject && isRenoteMuted(note)) ||
      (subject && isInstanceMuted(note)) ||
      (subject && !opts?.ignoreSuspension && isSuspendedNote(note))
    )
    // 将来の OR 合成点: || archiveStore.isArchived(...)  // 魚拓
  }

  /** 表示用に述語を適用した列を返す。独自 ref の面（検索・詳細等）が使う。 */
  function filterVisible(
    notes: NormalizedNote[],
    opts?: VisibilityOpts,
  ): NormalizedNote[] {
    return notes.filter((n) => !isHidden(n, opts))
  }

  /**
   * 凍結（#828）。本家 `generateSuspendedUserQueryForNote` に合わせて
   * note / reply先 / renote元 の 3 者で判定する。
   */
  function isSuspendedNote(note: NormalizedNote): boolean {
    const acc = note._accountId
    return (
      suspensionsStore.isSuspended(acc, note.user.id) ||
      suspensionsStore.isSuspended(acc, note.reply?.user?.id) ||
      suspensionsStore.isSuspended(acc, note.renote?.user?.id)
    )
  }

  /**
   * リノートミュート（#614）。純粋リノート（`renote && text===null`）の
   * リノート主（note.user）が renote mute 対象なら隠す。引用（text あり）は対象外。
   */
  function isRenoteMuted(note: NormalizedNote): boolean {
    if (note.renote == null || note.text != null) return false
    return mutesStore.isRenoteMuted(note._accountId, note.user.id)
  }

  /**
   * インスタンスミュート（#613）。本家準拠で note / reply先 / renote元 の
   * 投稿者 host のいずれかが mutedInstances に含まれれば隠す。
   */
  function isInstanceMuted(note: NormalizedNote): boolean {
    const acc = note._accountId
    return (
      mutesStore.isInstanceMuted(acc, note.user.host) ||
      mutesStore.isInstanceMuted(acc, note.reply?.user?.host) ||
      mutesStore.isInstanceMuted(acc, note.renote?.user?.host)
    )
  }

  /**
   * hardMutedWords にマッチするか（#610、完全非表示）。本家準拠で
   * note 本体 + reply先 + renote元 の cw/text を対象にする。isHidden に合成。
   */
  function isHardWordMuted(note: NormalizedNote): boolean {
    if (isOwnNote(note)) return false
    const acc = note._accountId
    return (
      mutesStore.matchesHardWord(acc, noteMatchText(note)) ||
      (note.reply != null &&
        mutesStore.matchesHardWord(acc, noteMatchText(note.reply))) ||
      (note.renote != null &&
        mutesStore.matchesHardWord(acc, noteMatchText(note.renote)))
    )
  }

  /**
   * mutedWords にマッチするか（#610、soft = 隠して展開可）。isHidden には
   * 入れず、MkNote 側で折りたたみ表示の判定に使う。対象は hard と同じ。
   */
  function isSoftWordMuted(note: NormalizedNote): boolean {
    if (isOwnNote(note)) return false
    const acc = note._accountId
    return (
      mutesStore.matchesSoftWord(acc, noteMatchText(note)) ||
      (note.reply != null &&
        mutesStore.matchesSoftWord(acc, noteMatchText(note.reply))) ||
      (note.renote != null &&
        mutesStore.matchesSoftWord(acc, noteMatchText(note.renote)))
    )
  }

  /** ミュート済み or 凍結済みのユーザーか（grouped 通知の除外判定） */
  function isHiddenUser(
    accountId: string,
    userId: string | null | undefined,
  ): boolean {
    return (
      mutesStore.isUserMuted(accountId, userId) ||
      suspensionsStore.isSuspended(accountId, userId)
    )
  }

  /** grouped reaction 通知から、ミュート/凍結済みリアクターを除いた一覧（#575 / #828） */
  function visibleReactions(notif: NormalizedNotification): ReactionInfo[] {
    if (!notif.reactions) return []
    return notif.reactions.filter(
      (r) => !isHiddenUser(notif._accountId, r.user.id),
    )
  }

  /** grouped renote 通知から、ミュート/凍結済みリノーターを除いた一覧（#575 / #828） */
  function visibleGroupedUsers(
    notif: NormalizedNotification,
  ): NormalizedUser[] {
    if (!notif.users) return []
    return notif.users.filter((u) => !isHiddenUser(notif._accountId, u.id))
  }

  /**
   * 表示から隠すべき通知か（#606 / #575）。
   * - notifier（reaction/follow/mention 等の発生元ユーザー）がミュート済み or 凍結
   *   = 本家 read-time フィルタ（NotificationEntityService#filterValidNotifier）相当
   * - 関連ノートが削除 / ミュート投稿者（isHidden 経由）
   * - grouped 通知でリアクター/リノーターが全員ミュート済み（#575）。
   *   本家は grouped reactors を貫通させる（漏れ）が、NoteDeck は「存在ごと
   *   隠す」ため独自に除外する。一部のみミュートなら通知は残し、表示側で
   *   visibleReactions / visibleGroupedUsers により当該ユーザーを除外する。
   */
  function isNotificationHidden(notif: NormalizedNotification): boolean {
    if (isHiddenUser(notif._accountId, notif.user?.id)) return true
    if (notif.note && isHidden(notif.note)) return true
    if (notif.type === 'reaction:grouped' && notif.reactions?.length) {
      return visibleReactions(notif).length === 0
    }
    if (notif.type === 'renote:grouped' && notif.users?.length) {
      return visibleGroupedUsers(notif).length === 0
    }
    return false
  }

  return {
    isHidden,
    filterVisible,
    isSoftWordMuted,
    isNotificationHidden,
    visibleReactions,
    visibleGroupedUsers,
  }
}
