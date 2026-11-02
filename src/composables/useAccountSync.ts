import { watch } from 'vue'
import {
  type SyncFailure,
  shouldResync,
  shouldRetrySync,
} from '@/services/muteExpiry'
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
 * - 同期済みアカウントも、最後の取り込みから間隔が空いた復帰信号で取り込み直す
 *   (起動中に他クライアントで付けた / 外したものを反映する、#1268)。失敗したら
 *   手元の状態はそのままで、間隔が空いた次の復帰で取り直す
 *
 * `sync` には取り込みを始めた時刻を渡す。取り込み先はそれより後の手元の操作を
 * 結果で上書きしない (規則は services/muteExpiry の reconcile*)。
 * `onResume` は復帰信号のたびに呼ぶ (期限切れの掃除など)。
 */
export function useAccountSync(
  tag: string,
  sync: (accountId: string, host: string, startedAt: number) => Promise<void>,
  onResume?: () => void,
) {
  const accountsStore = useAccountsStore()
  const uiStore = useUiStore()
  const synced = new Set<string>()
  const inFlight = new Set<string>()
  const failures = new Map<string, SyncFailure>()
  const lastSyncedAt = new Map<string, number>()

  async function syncAccount(accountId: string, host: string, resync = false) {
    if (inFlight.has(accountId)) return
    if (!resync && synced.has(accountId)) return
    inFlight.add(accountId)
    const startedAt = Date.now()
    try {
      await sync(accountId, host, startedAt)
      synced.add(accountId)
      lastSyncedAt.set(accountId, startedAt)
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
        if (!acc.hasToken) continue
        if (!shouldRetrySync(failures.get(acc.id), now)) continue
        if (!synced.has(acc.id)) {
          void syncAccount(acc.id, acc.host)
        } else if (shouldResync(lastSyncedAt.get(acc.id), now)) {
          void syncAccount(acc.id, acc.host, true)
        }
      }
    },
  )
}
