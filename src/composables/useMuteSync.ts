import { watch } from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import { type SyncFailure, shouldRetrySync } from '@/services/muteExpiry'
import { useAccountsStore } from '@/stores/accounts'
import { useMutesStore } from '@/stores/mutes'
import { useUiStore } from '@/stores/ui'
import { AppError } from '@/utils/errors'
import { catchLog } from '@/utils/logger'

/**
 * 各アカウントのミュート一覧 (mute/list) を取得し mute store を hydrate する（#574）。
 *
 * 起動時 / アカウント追加時に同期することで、前回セッションや他クライアントで
 * ミュート済みのユーザーの過去ノートも、起動直後からリロード無しで非表示になる。
 * App.vue で 1 回呼び、accounts の変化を watch して未同期アカウントを埋める。
 *
 * #1260: 期限も取り込み、手元の非表示を期限で戻す。復帰信号 (スリープ復帰 /
 * 表示復帰) で期限切れを片付け、失敗した同期を取り直す (認証エラーは除く、
 * アカウント単位で間隔を空ける)。ログアウト → 再ログインでも取り直す。
 * 同期済みアカウントの再同期はしない (起動中に他クライアントで付けたものは
 * 次の起動まで入らない)。
 */
export function useMuteSync() {
  const accountsStore = useAccountsStore()
  const mutesStore = useMutesStore()
  const uiStore = useUiStore()
  const synced = new Set<string>()
  const inFlight = new Set<string>()
  const failures = new Map<string, SyncFailure>()

  async function syncAccount(accountId: string, host: string) {
    if (synced.has(accountId) || inFlight.has(accountId)) return
    inFlight.add(accountId)
    try {
      const { adapter } = await initAdapterFor(host, accountId)
      mutesStore.setMutedUsers(accountId, await adapter.api.getMutedUsers())
      synced.add(accountId)
      failures.delete(accountId)
    } catch (e) {
      failures.set(accountId, {
        at: Date.now(),
        auth: AppError.from(e).isAuth,
      })
      catchLog('mute-sync')(e)
    } finally {
      inFlight.delete(accountId)
    }
  }

  watch(
    () =>
      accountsStore.accounts.map((a) => ({
        id: a.id,
        host: a.host,
        hasToken: a.hasToken,
      })),
    (accounts) => {
      for (const acc of accounts) {
        // 認証済みアカウントのみ（ゲスト/匿名は mute 一覧を持たない）
        if (acc.hasToken) {
          void syncAccount(acc.id, acc.host)
        } else {
          // ログアウト: 再ログインで取り直せるように
          synced.delete(acc.id)
          failures.delete(acc.id)
        }
      }
    },
    { immediate: true },
  )

  watch(
    () => uiStore.deckResumeSignal,
    () => {
      mutesStore.sweepExpired()
      const now = Date.now()
      for (const acc of accountsStore.accounts) {
        if (!acc.hasToken || synced.has(acc.id)) continue
        if (shouldRetrySync(failures.get(acc.id), now)) {
          void syncAccount(acc.id, acc.host)
        }
      }
    },
  )
}
