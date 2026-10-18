import { watch } from 'vue'
import { type SyncFailure, shouldRetrySync } from '@/services/muteExpiry'
import { useAccountsStore } from '@/stores/accounts'
import { useUiStore } from '@/stores/ui'
import { AppError } from '@/utils/errors'
import { catchLog } from '@/utils/logger'

/**
 * 認証済みアカウントごとに 1 回だけ走る起動時同期の共通部 (#574 / #610 / #614 / #1260)。
 *
 * - 起動時 / アカウント追加時に未同期のアカウントを同期する
 * - 失敗したら復帰信号 (スリープ復帰 / 表示復帰) で取り直す。認証エラーは
 *   再ログインしないと直らないので取り直さない。アカウント単位で間隔を空ける
 * - ログアウト → 再ログイン (hasToken が false → true) で取り直す
 * - 同期済みアカウントの再同期はしない (起動中に他クライアントで変えたものは
 *   次の起動まで入らない)
 *
 * `onResume` は復帰信号のたびに呼ぶ (期限切れの掃除など)。
 */
export function useAccountSync(
  tag: string,
  sync: (accountId: string, host: string) => Promise<void>,
  onResume?: () => void,
) {
  const accountsStore = useAccountsStore()
  const uiStore = useUiStore()
  const synced = new Set<string>()
  const inFlight = new Set<string>()
  const failures = new Map<string, SyncFailure>()

  async function syncAccount(accountId: string, host: string) {
    if (synced.has(accountId) || inFlight.has(accountId)) return
    inFlight.add(accountId)
    try {
      await sync(accountId, host)
      synced.add(accountId)
      failures.delete(accountId)
    } catch (e) {
      failures.set(accountId, {
        at: Date.now(),
        auth: AppError.from(e).isAuth,
      })
      catchLog(tag)(e)
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
        // 認証済みアカウントのみ（ゲスト/匿名は自分の設定を持たない）
        if (acc.hasToken) {
          void syncAccount(acc.id, acc.host)
        } else {
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
      onResume?.()
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
