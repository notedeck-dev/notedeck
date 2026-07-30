import { defineStore } from 'pinia'
import { shallowRef, triggerRef, watch } from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import {
  recountVisibleReactions,
  totalReactionCount,
  type VisibleReactionRecord,
} from '@/services/reactionRecount'
import { useAccountsStore } from '@/stores/accounts'
import { useMutesStore } from '@/stores/mutes'
import { useSuspensionsStore } from '@/stores/suspensions'

/**
 * これを超えるリアクション総数のノートは列挙を取得しない (#575)。
 * `notes/reactions` は 1 回 100 件までなので、1 リクエストで全件取れる
 * 範囲だけを対象にする。超えるノートはサーバー集計のまま表示。
 */
export const RECOUNT_MAX_TOTAL = 100

/** キャッシュ肥大の上限 (ノート数)。超えたら古いものから捨てる。 */
const CACHE_CAP = 500

/**
 * 同じノートの列挙を取り直すまでの最短間隔。
 *
 * リアクションが 1 個増えるだけで signature は変わるので、これが無いと
 * 流速の速い TL で可視ノートぶんの `notes/reactions` を連射し、さらにその
 * リアクター全員が凍結検知 (`users/show`) へ流れて増幅する。
 * stale-while-revalidate なので、待っている間も `get` は手元の列挙で
 * 数え直した値を返し続ける (表示が壊れない)。
 */
const REFETCH_COOLDOWN_MS = 5000

interface RecountEntry {
  /** serverCounts の JSON。リアクション増減の検知に使う */
  signature: string
  /** 取得時点の可視リアクション列挙 (縮約)。カウントは get 時に照合込みで数える */
  records: VisibleReactionRecord[]
  /** 取得時刻 (epoch ms)。連射抑制の判定に使う */
  fetchedAt: number
}

/**
 * ミュート・凍結ユーザーを除外したリアクションカウントのキャッシュ (#575)。
 *
 * `notes/reactions` 列挙 (サーバーがミュート/ブロックユーザーを除外して
 * 返す) を縮約保持し、`get` がミュート (#574) ・凍結 (#828) をクライアント
 * 照合しながら数え直す。照合を表示時に行うため、ミュート追加や凍結検知は
 * refetch なしで即時反映される。ミュート解除だけは「解除したユーザーが
 * 列挙から欠落したまま」になりうるため、集合の変更で全 purge して取り直す。
 */
export const useReactionRecountsStore = defineStore('reactionRecounts', () => {
  const cache = shallowRef(new Map<string, RecountEntry>())
  const inflight = new Set<string>()

  const mutesStore = useMutesStore()
  const suspensionsStore = useSuspensionsStore()
  // 追加は get のクライアント照合で即時反映されるので purge しない。
  // 解除・置換 (縮小方向) だけキャッシュを捨てて取り直す。
  watch(
    () => mutesStore.mutedUsersRemovalVersion,
    () => purgeAll(),
  )

  function signatureOf(counts: Record<string, number>): string {
    return JSON.stringify(counts)
  }

  /**
   * 数え直し済みカウント。未取得・対象外 (総数超過) は null。
   *
   * stale-while-revalidate: リアクションが増減して signature が変わっても、
   * 手元の列挙で数え直した値を返し続ける (ensure が裏で取り直す)。
   * ここで null に落とすと、WS でリアクションが増えるたびにサーバー集計へ
   * フォールバックしてミュート済み絵文字が一瞬復活してしまう。
   */
  function get(
    accountId: string,
    noteId: string,
    serverCounts: Record<string, number>,
  ): Record<string, number> | null {
    const entry = cache.value.get(noteId)
    if (!entry) return null
    // 総数が取得上限を超えたら stale を使い続けず、サーバー集計に戻す
    if (totalReactionCount(serverCounts) > RECOUNT_MAX_TOTAL) return null
    return recountVisibleReactions(
      serverCounts,
      entry.records,
      (userId) =>
        mutesStore.isUserMuted(accountId, userId) ||
        suspensionsStore.isSuspended(accountId, userId),
    )
  }

  /** 同時フェッチ上限。トグル ON 直後の TL 表示で一斉に飛ぶのを抑える */
  const MAX_CONCURRENT_FETCH = 4
  let activeFetches = 0
  const fetchQueue: (() => void)[] = []

  async function withFetchSlot<T>(fn: () => Promise<T>): Promise<T> {
    // 起こされた時点で別の呼び出しがスロットを取っていることがあるので再確認する
    while (activeFetches >= MAX_CONCURRENT_FETCH) {
      await new Promise<void>((resolve) => fetchQueue.push(resolve))
    }
    activeFetches++
    try {
      return await fn()
    } finally {
      activeFetches--
      fetchQueue.shift()?.()
    }
  }

  /**
   * クールダウン中に届いた更新。ノートごとに最新の serverCounts だけ残す
   * (途中のカウントは取りに行っても無駄になる)。
   */
  const deferred = new Map<
    string,
    { accountId: string; serverCounts: Record<string, number> }
  >()
  let deferredTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleDeferred(
    accountId: string,
    noteId: string,
    serverCounts: Record<string, number>,
  ): void {
    deferred.set(noteId, { accountId, serverCounts })
    if (deferredTimer) return
    deferredTimer = setTimeout(() => {
      deferredTimer = null
      const batch = [...deferred]
      deferred.clear()
      // ensure を通し直す: まだクールダウン中のノートは再び deferred に戻る
      for (const [id, { accountId: acc, serverCounts: counts }] of batch) {
        void ensure(acc, id, counts)
      }
    }, REFETCH_COOLDOWN_MS)
  }

  /** 必要なら列挙を取得する。失敗は無視 (サーバー集計のまま表示)。 */
  async function ensure(
    accountId: string,
    noteId: string,
    serverCounts: Record<string, number>,
  ): Promise<void> {
    const signature = signatureOf(serverCounts)
    const entry = cache.value.get(noteId)
    if (entry?.signature === signature) return
    const total = totalReactionCount(serverCounts)
    if (total === 0 || total > RECOUNT_MAX_TOTAL) return
    if (inflight.has(noteId)) return
    // 取得済みのノートは連射を避けてクールダウン明けにまとめて取り直す
    if (entry && Date.now() - entry.fetchedAt < REFETCH_COOLDOWN_MS) {
      scheduleDeferred(accountId, noteId, serverCounts)
      return
    }
    inflight.add(noteId)
    try {
      await withFetchSlot(() => fetchAndStore(accountId, noteId, signature))
    } finally {
      inflight.delete(noteId)
    }
  }

  async function fetchAndStore(
    accountId: string,
    noteId: string,
    signature: string,
  ): Promise<void> {
    try {
      const account = useAccountsStore().accounts.find(
        (a) => a.id === accountId,
      )
      if (!account) return
      const { adapter } = await initAdapterFor(account.host, account.id, {
        pinnedReactions: false,
        hasToken: account.hasToken,
      })
      const reactions = await adapter.api.getNoteReactions(
        noteId,
        undefined,
        RECOUNT_MAX_TOTAL,
      )
      if (cache.value.size >= CACHE_CAP) {
        const oldest = cache.value.keys().next().value
        if (oldest !== undefined) cache.value.delete(oldest)
      }
      cache.value.set(noteId, {
        signature,
        records: reactions.map((r) => ({ type: r.type, userId: r.user.id })),
        fetchedAt: Date.now(),
      })
      triggerRef(cache)
      // サーバーは凍結ユーザーを列挙から除外しないため、リアクターを
      // 凍結検知 (#828) に回す。検知されれば get の照合で reactive に消える
      suspensionsStore.probe(
        accountId,
        reactions.map((r) => r.user.id),
      )
    } catch (e) {
      // 非クリティカル: 取得失敗時はサーバー集計のまま (原因は診断できるよう残す)
      console.warn('[reaction-recount] fetch failed:', noteId, e)
    }
  }

  function purgeAll(): void {
    if (cache.value.size === 0) return
    cache.value.clear()
    triggerRef(cache)
  }

  return { get, ensure, purgeAll }
})
