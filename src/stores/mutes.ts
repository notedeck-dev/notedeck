import { defineStore } from 'pinia'
import { shallowRef, triggerRef } from 'vue'
import type { MutedWord } from '@/bindings'
import {
  expiredKeys,
  type LocalMuteOp,
  type MutedUser,
  nextExpiryDelay,
  partitionMutings,
  reconcileIds,
  reconcileMutedUsers,
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

  // 手元で行った操作の記録 (アカウント × ユーザー、#1268)。取り込み結果と
  // 競合したとき「取り込みを始めた後の操作」を勝たせる判定に使う。純ロジックは
  // services/muteExpiry の reconcile*、ここは記録と反映だけ
  const localUserOps = new Map<string, Map<string, LocalMuteOp>>()
  const localRenoteOps = new Map<string, Map<string, LocalMuteOp>>()

  function recordOp(
    ops: Map<string, Map<string, LocalMuteOp>>,
    accountId: string,
    id: string,
    op: LocalMuteOp,
  ) {
    let m = ops.get(accountId)
    if (!m) {
      m = new Map()
      ops.set(accountId, m)
    }
    m.set(id, op)
  }

  // 期限が分からない手元のミュート (ALREADY_MUTING で手元だけ合わせたもの)。
  // 取り込みでサーバーの期限が分かれば外れる
  const unknownExpiry = shallowRef(new Set<string>())

  function setUnknownExpiry(key: string, unknown: boolean) {
    if (unknown) unknownExpiry.value.add(key)
    else unknownExpiry.value.delete(key)
    triggerRef(unknownExpiry)
  }

  /**
   * `expiresAt`: 数値 (UNIX ms) ならその時刻に手元のミュートも外す。null は無期限、
   * undefined は「期限が分からない」(サーバーが既にミュート中と答えたとき)
   */
  function muteUser(
    accountId: string,
    userId: string,
    expiresAt?: number | null,
  ) {
    const key = expiryKey(accountId, userId)
    clearExpiry(key)
    setUnknownExpiry(key, expiresAt === undefined)
    users.add(accountId, userId)
    if (typeof expiresAt === 'number') {
      scheduleExpiry(accountId, userId, expiresAt)
    }
    recordOp(localUserOps, accountId, userId, {
      kind: 'mute',
      at: Date.now(),
      expiresAt,
    })
  }

  function unmuteUser(accountId: string, userId: string) {
    const key = expiryKey(accountId, userId)
    clearExpiry(key)
    setUnknownExpiry(key, false)
    users.remove(accountId, userId)
    recordOp(localUserOps, accountId, userId, {
      kind: 'unmute',
      at: Date.now(),
    })
  }

  /** 手元で知っている期限 (UNIX ms)。無期限・未知・期限切れは null */
  function mutedUntil(accountId: string, userId: string): number | null {
    const at = expiry.value.get(expiryKey(accountId, userId))?.expiresAt
    if (at === undefined || at <= Date.now()) return null
    return at
  }

  /**
   * ミュート中の相手の期限の種類 (#1268)。`until` は期限つき (mutedUntil が値を
   * 返す)、`indefinite` は無期限と分かっている、`unknown` は期限が分からない。
   * ミュート中でなければ null
   */
  function muteExpiryKind(
    accountId: string,
    userId: string,
  ): 'until' | 'indefinite' | 'unknown' | null {
    if (!users.has(accountId, userId)) return null
    const key = expiryKey(accountId, userId)
    if (unknownExpiry.value.has(key)) return 'unknown'
    return mutedUntil(accountId, userId) === null ? 'indefinite' : 'until'
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
    for (const key of unknownExpiry.value) {
      if (key.startsWith(prefix)) unknownExpiry.value.delete(key)
    }
    triggerRef(unknownExpiry)
  }

  /**
   * サーバ同期 (mute/list)。アカウントの集合を置き換え、古い予約を捨てて期限つきを
   * 予約し直す。期限が過ぎているものは入れない (#1260)。`startedAt` (取り込みを
   * 始めた時刻) より後の手元の操作は結果で上書きしない (#1268)
   */
  function setMutedUsers(
    accountId: string,
    entries: readonly MutedUser[],
    startedAt: number = Date.now(),
  ) {
    const ops = localUserOps.get(accountId) ?? new Map<string, LocalMuteOp>()
    const r = reconcileMutedUsers(entries, ops, startedAt)
    for (const id of r.staleOps) ops.delete(id)
    clearAccountExpiry(accountId)
    for (const id of r.unknownExpiry) {
      unknownExpiry.value.add(expiryKey(accountId, id))
    }
    triggerRef(unknownExpiry)
    const { active, expiring } = partitionMutings(r.entries, Date.now())
    users.replace(accountId, active)
    for (const e of expiring) scheduleExpiry(accountId, e.userId, e.expiresAt)
  }

  // --- renote mute (#614) ---

  function muteRenote(accountId: string, userId: string) {
    renoters.add(accountId, userId)
    recordOp(localRenoteOps, accountId, userId, {
      kind: 'mute',
      at: Date.now(),
    })
  }

  function unmuteRenote(accountId: string, userId: string) {
    renoters.remove(accountId, userId)
    recordOp(localRenoteOps, accountId, userId, {
      kind: 'unmute',
      at: Date.now(),
    })
  }

  /** サーバ同期 (renote-mute/list)。規則は setMutedUsers と同じ (#1268) */
  function setMutedRenoters(
    accountId: string,
    ids: readonly string[],
    startedAt: number = Date.now(),
  ) {
    const ops = localRenoteOps.get(accountId) ?? new Map<string, LocalMuteOp>()
    const r = reconcileIds(ids, ops, startedAt)
    for (const id of r.staleOps) ops.delete(id)
    renoters.replace(accountId, r.ids)
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

  /** アカウント削除時にそのアカウントのミュート状態 (全種) と予約を捨てる */
  function purgeAccount(accountId: string) {
    clearAccountExpiry(accountId)
    localUserOps.delete(accountId)
    localRenoteOps.delete(accountId)
    users.replace(accountId, [])
    renoters.replace(accountId, [])
    instances.replace(accountId, [])
    words.value.delete(accountId)
    triggerRef(words)
  }

  return {
    // user mute
    isUserMuted: users.has,
    muteUser,
    unmuteUser,
    mutedUntil,
    muteExpiryKind,
    setMutedUsers,
    sweepExpired,
    purgeAccount,
    /** 集合が縮んだときだけ増えるバージョン (派生キャッシュの purge 用、#575) */
    mutedUsersRemovalVersion: users.removalVersion,
    // renote mute
    isRenoteMuted: renoters.has,
    muteRenote,
    unmuteRenote,
    setMutedRenoters,
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
