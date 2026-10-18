import { initAdapterFor } from '@/adapters/factory'
import { useMutesStore } from '@/stores/mutes'
import { useAccountSync } from './useAccountSync'

/**
 * 各アカウントのミュート一覧 (mute/list) を取得し mute store を hydrate する（#574）。
 *
 * 起動時 / アカウント追加時に同期することで、前回セッションや他クライアントで
 * ミュート済みのユーザーの過去ノートも、起動直後からリロード無しで非表示になる。
 * App.vue で 1 回呼ぶ。同期の契機と再試行は `useAccountSync`。
 *
 * #1260: 期限も取り込み、手元の非表示を期限で戻す。復帰信号で期限切れを片付ける
 * (スリープ中は timer が進まない)。
 */
export function useMuteSync() {
  const mutesStore = useMutesStore()
  useAccountSync(
    'mute-sync',
    async (accountId, host) => {
      const { adapter } = await initAdapterFor(host, accountId)
      mutesStore.setMutedUsers(accountId, await adapter.api.getMutedUsers())
    },
    () => mutesStore.sweepExpired(),
  )
}
