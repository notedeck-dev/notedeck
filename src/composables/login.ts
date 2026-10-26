import type { AuthSession } from '@/adapters/types'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * ログインの締め (#1258)。MiAuth の完了 / ゲスト口座の作成を Rust に頼み、
 * 返った口座を accounts store に足して返す
 */
export async function completeLogin(
  session: AuthSession,
  software: string,
): Promise<Account> {
  const account = unwrap(
    await commands.authCompleteAndSave(session, software),
  ) as unknown as Account
  useAccountsStore().addAccount(account)
  return account
}

export async function addGuestAccount(
  host: string,
  software: string,
): Promise<Account> {
  const account = unwrap(
    await commands.createGuestAccount(host, software),
  ) as unknown as Account
  useAccountsStore().addAccount(account)
  return account
}
