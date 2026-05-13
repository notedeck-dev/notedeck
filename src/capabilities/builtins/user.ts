import { initAdapterFor } from '@/adapters/factory'
import type { ApiAdapter } from '@/adapters/types'
import type { Command } from '@/commands/registry'
import { stripCredentials } from '@/composables/useAiSystemContext'
import { useAccountsStore } from '@/stores/accounts'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * `user.lookup` — username (+ optional host) から Misskey ユーザー情報を引く。
 *
 * AI が `@hitalin@yami.ski` 形式の文字列を受け取ったとき、`notes.user` に渡せる
 * 内部 user ID を取り出す動線。`notes.user` は内部 ID 必須なのでこの 1 段挟む。
 *
 * Misskey の `users/show` を使う。host は `@hitalin@yami.ski` の `yami.ski` 部分
 * (ローカル / 自インスタンスのときは省略可)。
 */
async function getApiAdapter(
  accountId: string | undefined,
): Promise<ApiAdapter> {
  const store = useAccountsStore()
  const id = accountId ?? store.activeAccountId
  if (!id) throw new Error('No active account')
  const acc = store.accounts.find((a) => a.id === id)
  if (!acc) throw new Error(`Account "${id}" not found`)
  const { adapter } = await initAdapterFor(acc.host, acc.id)
  return adapter.api
}

export const userLookupCapability: Command = {
  id: 'user.lookup',
  label: 'ユーザー検索',
  icon: 'ti-user-search',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.read'],
  signature: {
    description:
      'username (+ 任意で host) から Misskey ユーザー情報を取得する。' +
      ' `@user@example.com` 形式から userId を引いて notes.user に渡す動線で使う。' +
      ' 戻り値の id が Misskey 内部の user ID。' +
      ' 別サーバー視点で lookup したいときは `<currentColumn>.accountId` を渡す。',
    params: {
      username: {
        type: 'string',
        description: 'username (先頭の `@` は不要)',
      },
      host: {
        type: 'string',
        description:
          'リモートホスト (例: `yami.ski`)。同インスタンス内ユーザーなら省略。',
        optional: true,
      },
      accountId: {
        type: 'string',
        description:
          'どのアカウントの adapter で lookup するか。未指定なら active アカウント。' +
          ' 別サーバーのカラムを操作中なら `<currentColumn>.accountId` を渡す。',
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description:
        'NormalizedUser (id / username / host / name / avatarUrl 等)',
    },
  },
  visible: false,
  execute: async (params) => {
    const rawUsername =
      typeof params?.username === 'string' ? params.username.trim() : ''
    if (!rawUsername) throw new Error('user.lookup: username is required')
    // 入力の先頭 `@` を除去 (`@hitalin` → `hitalin`)
    const username = rawUsername.startsWith('@')
      ? rawUsername.slice(1)
      : rawUsername
    const host =
      typeof params?.host === 'string' && params.host.trim().length > 0
        ? params.host.trim()
        : null
    const accountId =
      typeof params?.accountId === 'string' &&
      params.accountId.trim().length > 0
        ? params.accountId.trim()
        : undefined
    const api = await getApiAdapter(accountId)
    const user = await api.lookupUser(username, host)
    return stripCredentials(user)
  },
}

/**
 * `user.search` — username / display name の部分一致でユーザーを探す。
 *
 * `user.lookup` は完全一致な `@user@host` から 1 件引く動線、こちらは「○○ さん
 * 誰だっけ?」のようなあいまい検索で複数候補を返す。Misskey `users/search-by-username-and-name`
 * を使う。adapter 経由ではなく `apiSearchUsersByQuery` を直接叩く
 * (NormalizedUser 配列に正規化済み)。
 */
export const userSearchCapability: Command = {
  id: 'user.search',
  label: 'ユーザーをあいまい検索',
  icon: 'ti-search',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.read'],
  signature: {
    description:
      'username / display name の部分一致でユーザーを検索する (Misskey ' +
      '`users/search-by-username-and-name` 相当)。空 query なら最近やり取りした' +
      'ユーザー一覧。完全一致での 1 件引きは user.lookup を使う。',
    params: {
      query: {
        type: 'string',
        description: '検索文字列 (空文字なら最近のユーザー一覧)',
      },
      limit: {
        type: 'number',
        description: '取得件数 (1-100, default 10)',
        optional: true,
      },
      accountId: {
        type: 'string',
        description:
          'どのアカウントの adapter で検索するか。未指定なら active アカウント。',
        optional: true,
      },
    },
    returns: {
      type: 'array',
      description:
        'NormalizedUser の配列 (id / username / host / name / avatarUrl)',
    },
    cheap: true,
  },
  visible: false,
  execute: async (params) => {
    const query = typeof params?.query === 'string' ? params.query : ''
    const limitRaw = typeof params?.limit === 'number' ? params.limit : 10
    const limit = Math.max(1, Math.min(100, Math.floor(limitRaw)))
    const accountId =
      typeof params?.accountId === 'string' &&
      params.accountId.trim().length > 0
        ? params.accountId.trim()
        : null
    const store = useAccountsStore()
    const id = accountId ?? store.activeAccountId
    if (!id) throw new Error('user.search: no active account')
    const raw = unwrap(await commands.apiSearchUsersByQuery(id, query, limit))
    if (!Array.isArray(raw)) return []
    return raw.map((u) => stripCredentials(u as Record<string, unknown>))
  },
}

export const USER_BUILTIN_CAPABILITIES: readonly Command[] = [
  userLookupCapability,
  userSearchCapability,
]
