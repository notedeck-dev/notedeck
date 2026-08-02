import { createMisskeyAdapter } from '../misskey'
import type { ServerAdapter, ServerInfo } from '../types'

/**
 * yamisskey (yamisskey-dev/yamisskey) 用アダプター。
 *
 * 現状 API・capability ともに本家との差分はない。yami モードやカスタム TL は
 * ポリシー API と `/api/endpoints` スキャンで動的に検出しており (`customTimelines.ts`)、
 * 数字の非表示は CSS プリセット側で扱う (#593/#594)。
 * 静的な差分が出たときにここへ足す。
 */
export function createYamisskeyAdapter(
  serverInfo: ServerInfo,
  accountId: string,
  hasToken = true,
): ServerAdapter {
  return createMisskeyAdapter(serverInfo, accountId, hasToken)
}
