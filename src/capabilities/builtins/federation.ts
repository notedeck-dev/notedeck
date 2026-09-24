import type { Command } from '@/commands/registry'
import { implementCore } from '../declare'

/**
 * Federation (Misskey 連合) 系 capability。サーバー間連合の統計と
 * 連合先インスタンス情報を AI から read-only で取得できる。
 *
 * permission: `account.read`。サーバー側公開情報を返すだけ、認証なしでも
 * 一部取れるが NoteDeck の adapter は ログイン状態を前提にしているので
 * account.read に乗せる。
 *
 * adapter にあるが本 PR では未公開:
 * - getServerNotesChart / getServerUsersChart / getApRequestChart /
 *   getServerDriveChart … サーバー管理者向けで AI 利用シナリオが薄い
 */

export const federationChartCapability = implementCore('federation.chart')

export const federationInstancesCapability = implementCore(
  'federation.instances',
)

export const federationInstanceCapability = implementCore('federation.instance')

export const FEDERATION_BUILTIN_CAPABILITIES: readonly Command[] = [
  federationChartCapability,
  federationInstancesCapability,
  federationInstanceCapability,
]
