import { commands } from '@/utils/tauriInvoke'
import { createMisskeyAdapter } from '../misskey'
import { createContext, unwrapAny } from '../misskey/api/context'
import type {
  NormalizedNote,
  SearchOptions,
  ServerAdapter,
  ServerInfo,
} from '../types'

/**
 * はなみすきー (hanamisskey/misskey) 用アダプター。
 *
 * 本家との差分はノート検索のみ。ロールポリシー `canSearchNotes` が false で
 * `notes/search` が常に UNAVAILABLE を返すため、独自エンドポイント
 * `notes/hanamisearch-v1` に差し替える (#917)。
 */
export function createHanamisskeyAdapter(
  serverInfo: ServerInfo,
  accountId: string,
  hasToken = true,
): ServerAdapter {
  const base = createMisskeyAdapter(serverInfo, accountId, hasToken)
  const ctx = createContext(accountId, hasToken)

  return {
    ...base,
    api: {
      ...base.api,
      async searchNotes(
        query: string,
        options: SearchOptions = {},
      ): Promise<NormalizedNote[]> {
        // notes/hanamisearch-v1 は requireCredential: false だが、トークンなしだと
        // サーバー側が user.id を触って 500 になるためゲストは手前で弾く
        ctx.requireAuth()
        return unwrapAny(
          await commands.apiSearchNotesHanami(accountId, query, {
            limit: options.limit ?? 20,
            sinceId: options.sinceId ?? null,
            untilId: options.untilId ?? null,
            sinceDate: options.sinceDate ?? null,
            untilDate: options.untilDate ?? null,
            userId: options.userId ?? null,
          }),
        )
      },
    },
  }
}
