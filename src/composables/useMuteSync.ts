import { watch } from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import { useAccountsStore } from '@/stores/accounts'
import { useMuteStore } from '@/stores/mutes'
import { catchLog } from '@/utils/logger'

/**
 * 各アカウントのミュート一覧 (mute/list) を取得し mute store を hydrate する（#574）。
 *
 * 起動時 / アカウント追加時に同期することで、前回セッションや他クライアントで
 * ミュート済みのユーザーの過去ノートも、起動直後からリロード無しで非表示になる。
 * App.vue で 1 回呼び、accounts の変化を watch して未同期アカウントを埋める。
 */
export function useMuteSync() {
  const accountsStore = useAccountsStore()
  const muteStore = useMuteStore()
  const synced = new Set<string>()

  async function syncAccount(accountId: string, host: string) {
    if (synced.has(accountId)) return
    synced.add(accountId)
    try {
      const { adapter } = await initAdapterFor(host, accountId)
      muteStore.setMuted(accountId, await adapter.api.getMutedUsers())
    } catch (e) {
      synced.delete(accountId) // 次の accounts 変化で再試行できるように
      catchLog('mute-sync')(e)
    }
  }

  watch(
    () => accountsStore.accounts,
    (accounts) => {
      for (const acc of accounts) {
        // 認証済みアカウントのみ（ゲスト/匿名は mute 一覧を持たない）
        if (acc.hasToken) void syncAccount(acc.id, acc.host)
      }
    },
    { immediate: true },
  )
}
