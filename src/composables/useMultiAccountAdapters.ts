import { initAdapterFor } from '@/adapters/factory'
import type { ServerAdapter } from '@/adapters/types'
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

  async function getOrCreate(accountId: string): Promise<ServerAdapter | null> {
    const cached = adapters.get(accountId)
    if (cached) return cached

    const acc = accountsStore.accounts.find((a) => a.id === accountId)
    if (!acc) return null

    const { adapter } = await initAdapterFor(acc.host, acc.id)
    adapters.set(accountId, adapter)
    return adapter
  }

  /** 生成済みならその adapter (同期)。ストリーム購読の同期など非同期を避けたい場面用 */
  function getCached(accountId: string): ServerAdapter | undefined {
    return adapters.get(accountId)
  }

  function cleanup() {
    // Adapters are shared globally — do NOT call stream.cleanup() here
    // as it would destroy handlers for other columns using the same adapter.
    adapters.clear()
  }

  return { getOrCreate, getCached, cleanup }
}
