import { createMisskeyAdapter } from '../misskey'
import type { ServerAdapter, ServerFeatures, ServerInfo } from '../types'

/**
 * Misskey tempura (lqvp/misskey-tempura) 用アダプター。
 *
 * 叩くエンドポイントは本家と同じで、差分は静的に宣言する capability のみ。
 */
export const MISSKEY_TEMPURA_FEATURES: Partial<ServerFeatures> = {
  // リモート絵文字でのリアクション (#630)。本家は `@ホスト名` 付きを ❤ に
  // フォールバックするため、連合キャッシュまで絵文字を探索するフォークのみ。
  // API から判定する手段はないので静的宣言 — 漏れても「押せない」側に落ちる
  remoteEmojiReactions: true,
}

export function createMisskeyTempuraAdapter(
  serverInfo: ServerInfo,
  accountId: string,
  hasToken = true,
): ServerAdapter {
  return createMisskeyAdapter(serverInfo, accountId, hasToken)
}
