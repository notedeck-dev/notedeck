import { watch } from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import { useAccountsStore } from '@/stores/accounts'
import { useInstanceMuteStore } from '@/stores/instanceMutes'
import { useWordMuteStore } from '@/stores/wordMutes'
import { catchLog } from '@/utils/logger'

/**
 * 各アカウントの mutedWords / hardMutedWords / mutedInstances を `i` から取得し
 * word mute / instance mute store を hydrate する（#610 / #613）。
 * `useMuteSync`（userId ミュート）と同型。read のみ。`i` 取得は 1 回で両方を満たす。
 *
 * Misskey 側で設定済みの語句/インスタンスを起動時から適用するため、App.vue で
 * 1 回呼び、accounts の変化を watch して未同期アカウントを埋める。
 */
export function useWordMuteSync() {
  const accountsStore = useAccountsStore()
  const wordMuteStore = useWordMuteStore()
  const instanceMuteStore = useInstanceMuteStore()
  const synced = new Set<string>()

  async function syncAccount(accountId: string, host: string) {
    if (synced.has(accountId)) return
    synced.add(accountId)
    try {
      const { adapter } = await initAdapterFor(host, accountId)
      const { mutedWords, hardMutedWords, mutedInstances } =
        await adapter.api.getMutedWords()
      wordMuteStore.setWords(accountId, mutedWords, hardMutedWords)
      instanceMuteStore.setMuted(accountId, mutedInstances)
    } catch (e) {
      synced.delete(accountId) // 次の accounts 変化で再試行できるように
      catchLog('word-mute-sync')(e)
    }
  }

  watch(
    () => accountsStore.accounts,
    (accounts) => {
      for (const acc of accounts) {
        // 認証済みアカウントのみ（ゲスト/匿名は i を取得できない）
        if (acc.hasToken) void syncAccount(acc.id, acc.host)
      }
    },
    { immediate: true },
  )
}
