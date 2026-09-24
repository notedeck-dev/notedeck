import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

/**
 * `account.current` — 呼び出し文脈のアカウント情報を返す read 系 capability。
 * per-account の AI カラムやノートのメニューから起動したプラグインには文脈
 * アカウントがあり、全アカウントのカラムや HEARTBEAT には無い (null)。
 * 「アクティブアカウント」は廃止した (#941)。
 *
 * `permissions: ['account.read']` を要求するので、ai.json5 が `readonly`
 * 以上のプリセットなら通る。stripCredentials を念のため通して credential
 * 系フィールドを除去する (Account 型自体には現状 token は含まれないが、
 * 将来の漏洩シナリオ対策)。
 */
export const accountCurrentCapability = implementCore('account.current')

/**
 * `account.list` — ログイン中の全アカウントを返す。
 */
export const accountListCapability = implementCore('account.list')

export const ACCOUNT_BUILTIN_CAPABILITIES: readonly Command[] = [
  accountCurrentCapability,
  accountListCapability,
]
