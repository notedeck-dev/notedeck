import { commands } from '@/utils/tauriInvoke'
import { createMisskeyAdapter } from '../misskey'
import { unwrapAny } from '../misskey/api/context'
import type {
  NormalizedNote,
  PaginationOptions,
  ServerAdapter,
  ServerFeatures,
  ServerInfo,
} from '../types'

/**
 * Misskey tempura (lqvp/misskey-tempura) 用アダプター。
 *
 * 本家との差分は、静的に宣言する capability と、本家に無い引用一覧 API。
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
  const base = createMisskeyAdapter(serverInfo, accountId, hasToken)

  return {
    ...base,
    api: {
      ...base.api,
      // tempura は `notes/renotes` を純リノートだけに絞り、引用は専用の
      // `notes/quotes` でしか取れない (#1263)。未ログインはサーバーが [] を返す
      async getNoteQuotes(
        noteId: string,
        options: PaginationOptions = {},
      ): Promise<NormalizedNote[]> {
        return unwrapAny(
          await commands.apiGetNoteQuotes(
            accountId,
            noteId,
            options.limit ?? 30,
            options.untilId ?? null,
          ),
        )
      },
    },
  }
}
