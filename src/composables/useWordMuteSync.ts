import { initAdapterFor } from '@/adapters/factory'
import { useMutesStore } from '@/stores/mutes'
import { useAccountSync } from './useAccountSync'

/**
 * 各アカウントの mutedWords / hardMutedWords / mutedInstances を `i` から取得し
 * word mute / instance mute store を hydrate する（#610 / #613）。
 * `useMuteSync`（userId ミュート）と同型。read のみ。`i` 取得は 1 回で両方を満たす。
 *
 * Misskey 側で設定済みの語句/インスタンスを起動時から適用するため、App.vue で
 * 1 回呼ぶ。同期の契機と再試行は `useAccountSync`。
 */
export function useWordMuteSync() {
  const mutesStore = useMutesStore()
  useAccountSync('word-mute-sync', async (accountId, host) => {
    const { adapter } = await initAdapterFor(host, accountId)
    const { mutedWords, hardMutedWords, mutedInstances } =
      await adapter.api.getMutedWords()
    mutesStore.setMutedWords(accountId, mutedWords, hardMutedWords)
    mutesStore.setMutedInstances(accountId, mutedInstances)
  })
}
