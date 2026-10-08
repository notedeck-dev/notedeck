import type { ColumnCacheKeyDeps } from '@/services/columnCacheKey'
import { useAccountsStore } from '@/stores/accounts'

/**
 * accountsStore ベースの既定 deps (`columnCacheKey` の guest 判定)。pinia が
 * 有効な文脈 (setup / ハンドラ) で呼ぶこと。テストでは deps を直接組んで
 * 純粋関数として検証する。
 */
export function accountsCacheKeyDeps(): ColumnCacheKeyDeps {
  const accountsStore = useAccountsStore()
  return {
    isGuestAccount: (accountId) =>
      accountsStore.accountMap.get(accountId)?.hasToken === false,
  }
}
