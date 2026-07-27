/**
 * capability のアカウント解決の共通ヘルパ (#821)。
 *
 * 解決順: 明示的な params.accountId → ctx.accountId (呼び出し文脈) →
 * activeAccountId。従来は各 builtin がローカルヘルパで
 * 「params.accountId → activeAccountId」を実装しており、プラグインの
 * ノート/ユーザーアクション経由の呼び出し (ctx.accountId) が常に
 * アクティブアカウントへフォールバックしていた。
 */

import { initAdapterFor } from '@/adapters/factory'
import type { ApiAdapter } from '@/adapters/types'
import { useAccountsStore } from '@/stores/accounts'
import type { CapabilityContext } from './types'

/**
 * AI tool description に共通で使う `accountId` パラメタの説明文。
 * AI が `<currentAccount>` と `<currentColumn>` の差を見て、別サーバーの
 * カラムを操作したいときは `<currentColumn>.accountId` を渡せるよう示唆する。
 */
export const ACCOUNT_ID_PARAM_DESC =
  'どのアカウントで実行するか。未指定なら呼び出し文脈のアカウント' +
  ' (無ければ active アカウント)。' +
  ' 別サーバーのカラムから操作するときは `<currentColumn>.accountId` を渡す。'

/** 入力から空白除去済みの accountId を取り出す (空文字・非文字列は undefined)。 */
export function pickAccountId(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const t = input.trim()
  return t.length > 0 ? t : undefined
}

/**
 * 実行アカウント ID を解決する。
 * 順序: 明示的な input (params.accountId) → ctx.accountId → activeAccountId。
 */
export function resolveAccountId(
  input: unknown,
  ctx?: CapabilityContext,
): string {
  const explicit = pickAccountId(input)
  if (explicit) return explicit
  if (ctx?.accountId) return ctx.accountId
  const id = useAccountsStore().activeAccountId
  if (!id) throw new Error('No active account')
  return id
}

/**
 * 解決したアカウントの API adapter を取得する。adapter は `initAdapterFor`
 * のグローバル cache 経由なので、複数回呼んでも同じインスタンスが返る。
 */
export async function getApiAdapter(
  input: unknown,
  ctx?: CapabilityContext,
): Promise<ApiAdapter> {
  const id = resolveAccountId(input, ctx)
  const store = useAccountsStore()
  const acc = store.accounts.find((a) => a.id === id)
  if (!acc) throw new Error(`Account "${id}" not found`)
  const { adapter } = await initAdapterFor(acc.host, acc.id)
  return adapter.api
}
