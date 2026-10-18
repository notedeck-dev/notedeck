import { defineStore } from 'pinia'
import { shallowRef, triggerRef } from 'vue'
import type { MutedWord } from '@/bindings'
import {
  expiredKeys,
  type MutedUser,
  nextExpiryDelay,
  partitionMutings,
} from '@/services/muteExpiry'
import { matchMutedWords } from '@/services/wordMuteMatch'

/**
 * per-account の Set<string> reactive 状態。
 * shallowRef + triggerRef なのは、orderedIds の再代入を伴わず表示を更新する
 * 必要があるため（削除 tombstone の plain Set と違い reactive 必須）。
 */
function createAccountSet() {
  const byAccount = shallowRef(new Map<string, Set<string>>())
  /**
   * 集合が縮みうる変更 (remove / replace) だけで増えるバージョン。
   * 追加はクライアント照合で即時反映できるが、解除は「除外済みの列挙から
   * 欠落したまま」になるため取り直しが要る — その判定用 (#575)。
   */
  const removalVersion = shallowRef(0)

  function has(accountId: string, value: string | null | undefined): boolean {
    if (!value) return false
    return byAccount.value.get(accountId)?.has(value) ?? false
  }

  function add(accountId: string, value: string) {
    let set = byAccount.value.get(accountId)
    if (!set) {
      set = new Set()
      byAccount.value.set(accountId, set)
    }
    set.add(value)
    triggerRef(byAccount)
  }

  function remove(accountId: string, value: string) {
    byAccount.value.get(accountId)?.delete(value)
    removalVersion.value++
    triggerRef(byAccount)
  }

  /** サーバ同期。アカウントの集合を丸ごと置き換える。 */
  function replace(accountId: string, values: string[]) {
    byAccount.value.set(accountId, new Set(values))
    removalVersion.value++
    triggerRef(byAccount)
  }

  return { has, add, remove, replace, removalVersion }
}

interface AccountWordMutes {
  soft: MutedWord[]
  hard: MutedWord[]
}

/**
 * ミュート状態の per-account reactive ストア。
 * 表示述語 `useNoteVisibility().isHidden` の判定材料で、ミュート操作で状態が
 * 変わると全カラムの notes computed が再評価され、既に並んでいる過去ノートも
 * リロード無しで即時非表示になる（解除で復活）。
 *
 * - user (#574): muted userId の集合。mute/list から hydrate + 操作で更新
 * - renote (#614): リノートミュート。純粋リノート（renote && text===null）の
 *   リノート主で判定。renote-mute/list から hydrate
 * - instance (#613): ホスト名（`user.host`）の集合。Misskey `i` の
 *   mutedInstances から read のみで hydrate（NoteDeck からは編集しない）
 * - word (#610): mutedWords（soft = 折りたたみ）/ hardMutedWords（hard =
 *   完全非表示）。Misskey `i` から read のみで hydrate
 */
export const useMutesStore = defineStore('mutes', () => {
  const users = createAccountSet()
  const renoters = createAccountSet()
  const instances = createAccountSet()
  const words = shallowRef(new Map<string, AccountWordMutes>())

  // --- word mute ---

  /** `i` から取得した語句で account 分を置き換える（read 同期用）。 */
  function setMutedWords(
    accountId: string,
    soft: MutedWord[],
    hard: MutedWord[],
  ) {
    words.value.set(accountId, { soft, hard })
    triggerRef(words)
  }

  function matchesWord(
    kind: keyof AccountWordMutes,
    accountId: string | null | undefined,
    text: string | null | undefined,
  ): boolean {
    if (!accountId) return false
    const w = words.value.get(accountId)
    return w ? matchMutedWords(text, w[kind]) : false
  }

  // 期限つきミュートの手元の解除予約 (アカウント × ユーザー) と期限の値 (#1260)。
  // 付け直し・解除・同期の置き換えで取り消す。判定は services/muteExpiry の純関数、
  // ここは集合と timer への反映だけ。reactive なのは mutedUntil を表示に使うため
  const expiry = shallowRef(
    new Map<
      string,
      { expiresAt: number; timer: ReturnType<typeof setTimeout> }
    >(),
  )

  function expiryKey(accountId: string, userId: string) {
    return `${accountId}\n${userId}`
  }

  function clearExpiry(key: string) {
    const entry = expiry.value.get(key)
    if (!entry) return
    clearTimeout(entry.timer)
    expiry.value.delete(key)
    triggerRef(expiry)
  }

  function scheduleExpiry(
    accountId: string,
    userId: string,
    expiresAt: number,
  ) {
    const key = expiryKey(accountId, userId)
    const delay = nextExpiryDelay(expiresAt, Date.now())
    if (delay === null) {
      expiry.value.delete(key)
      triggerRef(expiry)
      users.remove(accountId, userId)
      return
    }
    // setTimeout は約 24.8 日までしか待てないので、上限ごとに予約し直す
    expiry.value.set(key, {
      expiresAt,
      timer: setTimeout(
        () => scheduleExpiry(accountId, userId, expiresAt),
        delay,
      ),
    })
    triggerRef(expiry)
  }

  /** `expiresAt` (UNIX ms) を渡すと、その時刻に手元のミュートも外す */
  function muteUser(accountId: string, userId: string, expiresAt?: number) {
    clearExpiry(expiryKey(accountId, userId))
    users.add(accountId, userId)
    if (expiresAt !== undefined) scheduleExpiry(accountId, userId, expiresAt)
  }

  function unmuteUser(accountId: string, userId: string) {
    clearExpiry(expiryKey(accountId, userId))
    users.remove(accountId, userId)
  }

  /** 手元で知っている期限 (UNIX ms)。無期限・未知・期限切れは null */
  function mutedUntil(accountId: string, userId: string): number | null {
    const at = expiry.value.get(expiryKey(accountId, userId))?.expiresAt
    if (at === undefined || at <= Date.now()) return null
    return at
  }

  function clearAccountExpiry(accountId: string) {
    const prefix = `${accountId}\n`
    for (const [key, entry] of expiry.value) {
      if (key.startsWith(prefix)) {
        clearTimeout(entry.timer)
        expiry.value.delete(key)
      }
    }
    triggerRef(expiry)
  }

  /**
   * サーバ同期 (mute/list)。アカウントの集合を丸ごと置き換え、古い予約を捨てて
   * 期限つきを予約し直す。期限が過ぎているものは入れない (#1260)。
   */
  function setMutedUsers(accountId: string, entries: readonly MutedUser[]) {
    clearAccountExpiry(accountId)
    const { active, expiring } = partitionMutings(entries, Date.now())
    users.replace(accountId, active)
    for (const e of expiring) scheduleExpiry(accountId, e.userId, e.expiresAt)
  }

  /**
   * 復帰時の掃除 (#1260)。スリープ中は timer が進まないので、期限が過ぎたものを
   * 外し、残りは残り時間で予約し直す。消すものが無ければ集合に触らない (冪等)。
   */
  function sweepExpired() {
    const now = Date.now()
    const entries = Array.from(expiry.value, ([key, e]) => [key, e] as const)
    const expired = new Set(
      expiredKeys(
        entries.map(([key, e]) => [key, e.expiresAt]),
        now,
      ),
    )
    for (const [key, e] of entries) {
      const [accountId, userId] = key.split('\n') as [string, string]
      clearTimeout(e.timer)
      if (expired.has(key)) {
        expiry.value.delete(key)
        users.remove(accountId, userId)
      } else {
        scheduleExpiry(accountId, userId, e.expiresAt)
      }
    }
    if (entries.length > 0) triggerRef(expiry)
  }

  /** アカウント削除時にそのアカウントのユーザーミュートの集合と予約を捨てる */
  function purgeAccount(accountId: string) {
    clearAccountExpiry(accountId)
    users.replace(accountId, [])
  }

  return {
    // user mute
    isUserMuted: users.has,
    muteUser,
    unmuteUser,
    mutedUntil,
    setMutedUsers,
    sweepExpired,
    purgeAccount,
    /** 集合が縮んだときだけ増えるバージョン (派生キャッシュの purge 用、#575) */
    mutedUsersRemovalVersion: users.removalVersion,
    // renote mute
    isRenoteMuted: renoters.has,
    muteRenote: renoters.add,
    unmuteRenote: renoters.remove,
    setMutedRenoters: renoters.replace,
    // instance mute
    isInstanceMuted: instances.has,
    setMutedInstances: instances.replace,
    // word mute
    setMutedWords,
    /** hard ミュート（完全非表示）にマッチするか。 */
    matchesHardWord: (
      accountId: string | null | undefined,
      text: string | null | undefined,
    ) => matchesWord('hard', accountId, text),
    /** soft ミュート（折りたたみ表示）にマッチするか。 */
    matchesSoftWord: (
      accountId: string | null | undefined,
      text: string | null | undefined,
    ) => matchesWord('soft', accountId, text),
  }
})
