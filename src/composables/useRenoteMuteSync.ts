import { watch } from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import { useAccountsStore } from '@/stores/accounts'
import { useRenoteMuteStore } from '@/stores/renoteMutes'
import { catchLog } from '@/utils/logger'

/**
 * 各アカウントの renote mute 一覧（renote-mute/list）を取得し store を hydrate
 * する（#614）。`useMuteSync` と同型。起動時 / アカウント追加時に同期する。
 */
export function useRenoteMuteSync() {
  const accountsStore = useAccountsStore()
  const renoteMuteStore = useRenoteMuteStore()
  const synced = new Set<string>()

  async function syncAccount(accountId: string, host: string) {
    if (synced.has(accountId)) return
    synced.add(accountId)
    try {
      const { adapter } = await initAdapterFor(host, accountId)
      renoteMuteStore.setMuted(
        accountId,
        await adapter.api.getRenoteMutedUsers(),
      )
    } catch (e) {
      synced.delete(accountId) // 次の accounts 変化で再試行できるように
      catchLog('renote-mute-sync')(e)
    }
  }

  watch(
    () => accountsStore.accounts,
    (accounts) => {
      for (const acc of accounts) {
        if (acc.hasToken) void syncAccount(acc.id, acc.host)
      }
    },
    { immediate: true },
  )
}
