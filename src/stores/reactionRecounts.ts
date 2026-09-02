import { defineStore } from 'pinia'
import { shallowRef, triggerRef, watch } from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import { createBoundedCache } from '@/services/boundedCache'
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
export const RECOUNT_CACHE_CAP = 500

/** settled 履歴の上限。noteId 文字列のみなのでキャッシュ本体より緩くてよい */
const SETTLED_CAP = 5000

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
  /**
   * serverCounts の JSON。リアクション増減の検知に使う。
   * 空文字は「取得失敗の確定」— どの実 signature とも一致しないため、
   * 次の ensure がクールダウン明けに再試行する (negative cache を恒久化させない)
   */
  signature: string
  /**
   * 取得時点の可視リアクション列挙 (縮約)。カウントは get 時に照合込みで
   * 数える。null は取得失敗 = サーバー集計へのフォールバックで確定 (#1081)
   */
  records: VisibleReactionRecord[] | null
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
  const cache = shallowRef(
    createBoundedCache<string, RecountEntry>(
      RECOUNT_CACHE_CAP,
      'reactionRecounts',
    ),
  )
  const inflight = new Set<string>()
  /**
   * 一度でも取得が完了 (成功・失敗とも) したノート (#1084 レビュー)。
   * LRU 破棄でエントリが消えたノートを pending に戻すと、可視ノートが
   * CACHE_CAP を超えたとき evict → 再取得 → evict の自己増幅ループに
   * なるため、破棄後はサーバー集計へのフォールバックで受ける。
   * 変更は必ず cache の triggerRef と同時に行う (reactive 化はしない)。
   */
  const settledOnce = createBoundedCache<string, true>(
    SETTLED_CAP,
    'reactionRecounts:settled',
  )

  /**
   * purgeAll (ミュート解除) の世代。in-flight の応答は解除前の除外設定で
   * 数えたものなので、着弾時に世代が進んでいたら捨てて取り直す。
   */
  let generation = 0

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

  /** 列挙取得の対象か。0 件と総数超過は対象外 (サーバー集計のまま表示)。 */
  function isRecountTarget(serverCounts: Record<string, number>): boolean {
    const total = totalReactionCount(serverCounts)
    return total > 0 && total <= RECOUNT_MAX_TOTAL
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
    if (!entry?.records) return null
    // 総数が取得上限を超えたら stale を使い続けず、サーバー集計に戻す
    if (!isRecountTarget(serverCounts)) return null
    return recountVisibleReactions(
      serverCounts,
      entry.records,
      (userId) =>
        mutesStore.isUserMuted(accountId, userId) ||
        suspensionsStore.isSuspended(accountId, userId),
    )
  }

  /**
   * 列挙の初回取得がまだ終わっていないか (#1081)。true の間は未フィルタの
   * サーバー集計を描画せず保留する (見えてから消えるのを防ぐ)。
   * 対象外 (0 件 / 総数超過)・取得失敗 (フォールバック確定)・取得後に
   * LRU 破棄されたノートは false。
   */
  function isPending(
    noteId: string,
    serverCounts: Record<string, number>,
  ): boolean {
    if (!isRecountTarget(serverCounts)) return false
    return !cache.value.has(noteId) && !settledOnce.has(noteId)
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
    if (!isRecountTarget(serverCounts)) return
    if (inflight.has(noteId)) return
    // 取得済みのノートは連射を避けてクールダウン明けにまとめて取り直す
    if (entry && Date.now() - entry.fetchedAt < REFETCH_COOLDOWN_MS) {
      scheduleDeferred(accountId, noteId, serverCounts)
      return
    }
    const gen = generation
    inflight.add(noteId)
    try {
      await withFetchSlot(() => fetchAndStore(accountId, noteId, signature))
    } finally {
      inflight.delete(noteId)
    }
    // 実行中に purge された場合、応答は fetchAndStore が捨てている。
    // purge 直後の ensure (watch 駆動) は inflight で弾かれていたので、
    // ここで取り直さないと pending のまま誰も駆動しなくなる
    if (gen !== generation) void ensure(accountId, noteId, serverCounts)
  }

  function setEntry(
    noteId: string,
    signature: string,
    records: VisibleReactionRecord[] | null,
  ): void {
    // boundedCache が LRU 退避を担う。settledOnce も set で末尾に移る
    // (再 settle したホットなノートが先に退避されない)
    settledOnce.set(noteId, true)
    cache.value.set(noteId, { signature, records, fetchedAt: Date.now() })
    triggerRef(cache)
  }

  async function fetchAndStore(
    accountId: string,
    noteId: string,
    signature: string,
  ): Promise<void> {
    const gen = generation
    try {
      const account = useAccountsStore().accounts.find(
        (a) => a.id === accountId,
      )
      if (account) {
        const { adapter } = await initAdapterFor(account.host, account.id, {
          pinnedReactions: false,
          hasToken: account.hasToken,
        })
        const reactions = await adapter.api.getNoteReactions(
          noteId,
          undefined,
          RECOUNT_MAX_TOTAL,
        )
        // purge (ミュート解除) をまたいだ応答は解除前の除外設定で数えた
        // もの。書き戻すと取り直しの成果が古い列挙で上書きされるので捨てる
        if (gen !== generation) return
        setEntry(
          noteId,
          signature,
          reactions.map((r) => ({ type: r.type, userId: r.user.id })),
        )
        // サーバーは凍結ユーザーを列挙から除外しないため、リアクターを
        // 凍結検知 (#828) に回す。検知されれば get の照合で reactive に消える
        suspensionsStore.probe(
          accountId,
          reactions.map((r) => r.user.id),
        )
        return
      }
    } catch (e) {
      // 非クリティカル: 取得失敗時はサーバー集計のまま (原因は診断できるよう残す)
      console.warn('[reaction-recount] fetch failed:', noteId, e)
    }
    if (gen !== generation) return
    // 取り直しの失敗は手元の正常な列挙を捨てない (stale-while-revalidate)。
    // fetchedAt だけ更新して連射を抑え、signature は古いまま残して回復後の
    // ensure に取り直させる
    const existing = cache.value.get(noteId)
    if (existing?.records) {
      setEntry(noteId, existing.signature, existing.records)
      return
    }
    // 初回の取得失敗もエントリで確定させる (#1081): isPending を解いて
    // サーバー集計を表示させ、隠したまま固まるのを防ぐ。signature は
    // 空のまま残し、一時的な失敗が恒久的な negative cache にならないようにする
    setEntry(noteId, '', null)
  }

  function purgeAll(): void {
    // in-flight の応答と保留中の取り直しは解除前の除外設定で数えたもの。
    // 世代を進めて着弾時に捨てさせ、無意味になった deferred も破棄する
    generation++
    deferred.clear()
    if (deferredTimer) {
      clearTimeout(deferredTimer)
      deferredTimer = null
    }
    if (cache.value.size === 0 && settledOnce.size === 0) return
    // settled 履歴ごと消して pending に戻す: ミュート解除の取り直し中に
    // 古い列挙由来の値やサーバー集計を見せない (隠しすぎ側に倒す)
    settledOnce.clear()
    cache.value.clear()
    triggerRef(cache)
  }

  return { get, isPending, ensure, purgeAll }
})
