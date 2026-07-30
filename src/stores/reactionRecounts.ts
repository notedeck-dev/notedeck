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

interface RecountEntry {
  /** serverCounts の JSON。リアクション増減の検知に使う */
  signature: string
  /** 取得時点の可視リアクション列挙 (縮約)。カウントは get 時に照合込みで数える */
  records: VisibleReactionRecord[]
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

  /** 数え直し済みカウント。未取得・リアクション増減後・対象外は null。 */
  function get(
    accountId: string,
    noteId: string,
    serverCounts: Record<string, number>,
  ): Record<string, number> | null {
    const entry = cache.value.get(noteId)
    if (!entry || entry.signature !== signatureOf(serverCounts)) return null
    return recountVisibleReactions(
      serverCounts,
      entry.records,
      (userId) =>
        mutesStore.isUserMuted(accountId, userId) ||
        suspensionsStore.isSuspended(accountId, userId),
    )
  }

  /** 必要なら列挙を取得する。失敗は無視 (サーバー集計のまま表示)。 */
  async function ensure(
    accountId: string,
    noteId: string,
    serverCounts: Record<string, number>,
  ): Promise<void> {
    const signature = signatureOf(serverCounts)
    if (cache.value.get(noteId)?.signature === signature) return
    const total = totalReactionCount(serverCounts)
    if (total === 0 || total > RECOUNT_MAX_TOTAL) return
    if (inflight.has(noteId)) return
    inflight.add(noteId)
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
      })
      triggerRef(cache)
    } catch {
      // 非クリティカル: 取得失敗時はサーバー集計のまま
    } finally {
      inflight.delete(noteId)
    }
  }

  function purgeAll(): void {
    if (cache.value.size === 0) return
    cache.value.clear()
    triggerRef(cache)
  }

  return { get, ensure, purgeAll }
})
