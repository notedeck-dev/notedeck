import { initAdapterFor } from '@/adapters/factory'
import type { ApiAdapter, ServerAdapter } from '@/adapters/types'
import { i18n } from '@/i18n'
import { useAccountsStore } from '@/stores/accounts'

/**
 * Lazily creates and caches per-account adapters for cross-account features.
 *
 * Delegates to the global adapter cache in adapters/factory.ts.
 * Local Map tracks which adapters this composable instance has used
 * so callers can iterate over them if needed.
 */
export function useMultiAccountAdapters() {
  const accountsStore = useAccountsStore()

  // Local reference set — the actual caching is handled by initAdapterFor()
  const adapters = new Map<string, ServerAdapter>()

  /** adapter を作った時点のログイン状態。変わっていたら factory 側は作り直している */
  const tokenAt = new Map<string, boolean>()

  /**
   * 手元の参照が現在のアカウント状態と合うときだけ返す。ログアウト → 再ログインで
   * factory が adapter を作り直した (destroyAdapter) あとに古い adapter を使い続けると、
   * 購読は外れたまま、Note Capture は購読済みのつもり、になる
   */
  function fresh(accountId: string): ServerAdapter | undefined {
    const cached = adapters.get(accountId)
    if (!cached) return undefined
    const acc = accountsStore.accounts.find((a) => a.id === accountId)
    if (acc && acc.hasToken === tokenAt.get(accountId)) return cached
    adapters.delete(accountId)
    tokenAt.delete(accountId)
    return undefined
  }

  /**
   * `options` は factory にそのまま渡す。ウィンドウ / ポップアップは
   * `{ pinnedReactions: false, hasToken: acc.hasToken }` で呼ぶ (ログアウト中の
   * アカウントでも読取だけは anon adapter で描く)。省略時は factory の既定
   */
  async function getOrCreate(
    accountId: string,
    options?: Parameters<typeof initAdapterFor>[2],
  ): Promise<ServerAdapter | null> {
    const cached = fresh(accountId)
    if (cached) return cached

    const acc = accountsStore.accounts.find((a) => a.id === accountId)
    if (!acc) return null

    const { adapter } = await initAdapterFor(acc.host, acc.id, options)
    adapters.set(accountId, adapter)
    tokenAt.set(accountId, acc.hasToken)
    return adapter
  }

  /**
   * ウィンドウ / ポップアップ向けの既定: ピン留めリアクションは引かず、
   * アカウントのログイン状態どおりの adapter を返す (#1258)
   */
  function forView(accountId: string): Promise<ServerAdapter | null> {
    const acc = accountsStore.accounts.find((a) => a.id === accountId)
    if (!acc) return Promise.resolve(null)
    return getOrCreate(accountId, {
      pinnedReactions: false,
      hasToken: acc.hasToken,
    })
  }

  /** 生成済みならその adapter (同期)。ストリーム購読の同期など非同期を避けたい場面用 */
  function getCached(accountId: string): ServerAdapter | undefined {
    return fresh(accountId)
  }

  function cleanup() {
    // Adapters are shared globally — do NOT call stream.cleanup() here
    // as it would destroy handlers for other columns using the same adapter.
    adapters.clear()
    tokenAt.clear()
  }

  /**
   * ウィンドウ向けの API (forView と同じ既定)。口座が無ければ投げるので、
   * 呼び出し側は既存の catch でそのまま表示に落とせる
   */
  async function apiFor(accountId: string): Promise<ApiAdapter> {
    const adapter = await forView(accountId)
    if (!adapter) throw new Error(i18n.ts._common.accountNotFound)
    return adapter.api
  }

  return { getOrCreate, forView, apiFor, getCached, cleanup }
}
