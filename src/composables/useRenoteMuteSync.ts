import { initAdapterFor } from '@/adapters/factory'
import { useMutesStore } from '@/stores/mutes'
import { useAccountSync } from './useAccountSync'

/**
 * 各アカウントの renote mute 一覧（renote-mute/list）を取得し store を hydrate
 * する（#614）。`useMuteSync` と同型。同期の契機と再試行は `useAccountSync`。
 */
export function useRenoteMuteSync() {
  const mutesStore = useMutesStore()
  useAccountSync('renote-mute-sync', async (accountId, host) => {
    const { adapter } = await initAdapterFor(host, accountId)
    mutesStore.setMutedRenoters(
      accountId,
      await adapter.api.getRenoteMutedUsers(),
    )
  })
}
