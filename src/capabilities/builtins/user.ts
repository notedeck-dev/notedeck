import { initAdapterFor } from '@/adapters/factory'
import type { ApiAdapter } from '@/adapters/types'
import type { Command } from '@/commands/registry'
import { stripCredentials } from '@/composables/useAiSystemContext'
import { useAccountsStore } from '@/stores/accounts'
import { useMuteStore } from '@/stores/mutes'
import { useRenoteMuteStore } from '@/stores/renoteMutes'
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

/**
 * Mute / RenoteMute 系 — 相手に通知されない静かな見え方制御。
 * AI 経路で開放可。block (対外性高) とは別軸 — block は塞ぐリスト
 * (memory: feedback_ai_capability_scope)。
 *
 * 確認 UI は normal (= danger ではない)。可逆操作 (unmute / unrenoteMute あり)
 * かつ相手側に通知が飛ばないため心理的負荷が低い。
 */
function muteConfirm(action: string, scope: string) {
  return (params: Record<string, unknown> | undefined) => {
    const userId = typeof params?.userId === 'string' ? params.userId : ''
    return {
      title: `${scope}を${action}`,
      message: `userId \`${userId}\` を ${scope}${action}します (相手に通知は飛びません)。`,
      okLabel: action,
      cancelLabel: 'やめる' as const,
      type: 'normal' as const,
    }
  }
}

function pickUserId(
  params: Record<string, unknown> | undefined,
  cap: string,
): string {
  const userId = typeof params?.userId === 'string' ? params.userId : ''
  if (!userId) throw new Error(`${cap}: userId is required`)
  return userId
}

function pickAccountId(
  params: Record<string, unknown> | undefined,
): string | undefined {
  if (typeof params?.accountId !== 'string') return undefined
  const trimmed = params.accountId.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const USER_ID_PARAM = {
  type: 'string' as const,
  description: '対象 userId (user.lookup / search で取得)',
}
const ACCOUNT_ID_PARAM = {
  type: 'string' as const,
  description: '操作元アカウント。未指定なら active。',
  optional: true,
}

export const userMuteCapability: Command = {
  id: 'user.mute',
  label: 'ユーザーをミュート',
  icon: 'ti-volume-off',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.write'],
  requiresConfirmation: muteConfirm('ミュート', 'ノート + 通知'),
  signature: {
    description:
      '指定 userId をミュートする (ノート + 通知が見えなくなる)。相手に通知は' +
      '飛ばない。リノートだけ消したいなら user.renoteMute を使う。',
    params: { userId: USER_ID_PARAM, accountId: ACCOUNT_ID_PARAM },
    returns: { type: 'object', description: '{ muted: true, userId }' },
  },
  visible: false,
  execute: async (params) => {
    const userId = pickUserId(params, 'user.mute')
    const rawAccountId = pickAccountId(params)
    const api = await getApiAdapter(rawAccountId)
    await api.muteUser(userId)
    // 過去ノートを即時非表示に（#574）。UserProfileContent と同じ楽観反映。
    const accountId = rawAccountId ?? useAccountsStore().activeAccountId
    if (accountId) useMuteStore().mute(accountId, userId)
    return { muted: true, userId }
  },
}

export const userUnmuteCapability: Command = {
  id: 'user.unmute',
  label: 'ユーザーのミュートを解除',
  icon: 'ti-volume',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.write'],
  requiresConfirmation: muteConfirm('解除', 'ノート + 通知'),
  signature: {
    description: '指定 userId のミュートを解除する。',
    params: { userId: USER_ID_PARAM, accountId: ACCOUNT_ID_PARAM },
    returns: { type: 'object', description: '{ unmuted: true, userId }' },
  },
  visible: false,
  execute: async (params) => {
    const userId = pickUserId(params, 'user.unmute')
    const rawAccountId = pickAccountId(params)
    const api = await getApiAdapter(rawAccountId)
    await api.unmuteUser(userId)
    // 隠れていた過去ノートを即時復活（#574）。
    const accountId = rawAccountId ?? useAccountsStore().activeAccountId
    if (accountId) useMuteStore().unmute(accountId, userId)
    return { unmuted: true, userId }
  },
}

export const userRenoteMuteCapability: Command = {
  id: 'user.renoteMute',
  label: 'リノートだけミュート',
  icon: 'ti-volume-3',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.write'],
  requiresConfirmation: muteConfirm('リノートミュート', 'リノートだけ'),
  signature: {
    description:
      '指定 userId のリノートだけを非表示にする (オリジナル投稿は見える)。' +
      'user.mute と独立に動作。',
    params: { userId: USER_ID_PARAM, accountId: ACCOUNT_ID_PARAM },
    returns: { type: 'object', description: '{ renoteMuted: true, userId }' },
  },
  visible: false,
  execute: async (params) => {
    const userId = pickUserId(params, 'user.renoteMute')
    const rawAccountId = pickAccountId(params)
    const api = await getApiAdapter(rawAccountId)
    await api.renoteMuteUser(userId)
    // 並んでいるリノートを即時非表示（#614）。
    const accountId = rawAccountId ?? useAccountsStore().activeAccountId
    if (accountId) useRenoteMuteStore().mute(accountId, userId)
    return { renoteMuted: true, userId }
  },
}

export const userUnrenoteMuteCapability: Command = {
  id: 'user.unrenoteMute',
  label: 'リノートミュートを解除',
  icon: 'ti-volume-2',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.write'],
  requiresConfirmation: muteConfirm('リノートミュート解除', 'リノートだけ'),
  signature: {
    description: '指定 userId のリノートミュートを解除する。',
    params: { userId: USER_ID_PARAM, accountId: ACCOUNT_ID_PARAM },
    returns: { type: 'object', description: '{ renoteUnmuted: true, userId }' },
  },
  visible: false,
  execute: async (params) => {
    const userId = pickUserId(params, 'user.unrenoteMute')
    const rawAccountId = pickAccountId(params)
    const api = await getApiAdapter(rawAccountId)
    await api.unrenoteMuteUser(userId)
    // 隠れていたリノートを即時復活（#614）。
    const accountId = rawAccountId ?? useAccountsStore().activeAccountId
    if (accountId) useRenoteMuteStore().unmute(accountId, userId)
    return { renoteUnmuted: true, userId }
  },
}

/**
 * Follow / Unfollow — 相手に通知が飛ぶ慎重カテゴリ (memory:
 * feedback_ai_capability_scope の慎重リスト)。確認 UI は warning。
 *
 * 鍵アカウントなら follow リクエストが飛ぶ (= 承認待ち)。AI は承認状態を
 * 知らないので、エラーになっても無視するのではなく上位に伝播させる。
 */
function followConfirm(action: '送る' | '解除') {
  return (params: Record<string, unknown> | undefined) => {
    const userId = typeof params?.userId === 'string' ? params.userId : ''
    return {
      title: `フォロー${action === '送る' ? 'を送る' : 'を解除'}`,
      message:
        action === '送る'
          ? `userId \`${userId}\` にフォローリクエストを送ります (相手に「フォローされた」通知が飛びます)。鍵アカウントなら承認待ち。`
          : `userId \`${userId}\` のフォローを解除します (相手に「フォロワー減少」通知は飛びません)。`,
      okLabel: action === '送る' ? 'フォロー' : 'フォロー解除',
      cancelLabel: 'やめる' as const,
      type: 'warning' as const,
    }
  }
}

export const userFollowCapability: Command = {
  id: 'user.follow',
  label: 'ユーザーをフォロー',
  icon: 'ti-user-plus',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.write'],
  requiresConfirmation: followConfirm('送る'),
  signature: {
    description:
      '指定 userId をフォローする (相手に通知が飛ぶ)。鍵アカウントの場合は ' +
      'フォローリクエスト送信 = 承認待ちになる。userId は user.lookup / search で取得。',
    params: { userId: USER_ID_PARAM, accountId: ACCOUNT_ID_PARAM },
    returns: { type: 'object', description: '{ followed: true, userId }' },
  },
  visible: false,
  execute: async (params) => {
    const userId = pickUserId(params, 'user.follow')
    const api = await getApiAdapter(pickAccountId(params))
    await api.followUser(userId)
    return { followed: true, userId }
  },
}

export const userUnfollowCapability: Command = {
  id: 'user.unfollow',
  label: 'ユーザーのフォローを解除',
  icon: 'ti-user-minus',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.write'],
  requiresConfirmation: followConfirm('解除'),
  signature: {
    description:
      '指定 userId のフォローを解除する (相手にフォロワー減少の通知は飛ばない)。',
    params: { userId: USER_ID_PARAM, accountId: ACCOUNT_ID_PARAM },
    returns: { type: 'object', description: '{ unfollowed: true, userId }' },
  },
  visible: false,
  execute: async (params) => {
    const userId = pickUserId(params, 'user.unfollow')
    const api = await getApiAdapter(pickAccountId(params))
    await api.unfollowUser(userId)
    return { unfollowed: true, userId }
  },
}

/**
 * `user.followers` / `user.following` — 指定ユーザーのフォロワー / フォロー一覧。
 *
 * Misskey の users/followers / users/following。read-only、公開設定 (= 鍵垢の
 * 場合は本人または承認済みフォロワーのみ) はサーバー側で制御される。
 * 軽量 read なので account.read で十分。
 */
const FOLLOW_LIMIT_PARAM = {
  type: 'number' as const,
  description: '取得件数 (default 30)',
  optional: true,
}
const UNTIL_ID_PARAM = {
  type: 'string' as const,
  description: 'untilId (古い方向のページング)',
  optional: true,
}

function pickLimit(params: Record<string, unknown> | undefined): number {
  const v = params?.limit
  return typeof v === 'number' && Number.isFinite(v) ? v : 30
}

function pickUntilId(
  params: Record<string, unknown> | undefined,
): string | undefined {
  if (typeof params?.untilId !== 'string') return undefined
  const t = params.untilId.trim()
  return t.length > 0 ? t : undefined
}

export const userFollowersCapability: Command = {
  id: 'user.followers',
  label: 'フォロワー一覧',
  icon: 'ti-users',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.read'],
  signature: {
    description:
      '指定 userId のフォロワー一覧を返す (read-only)。鍵垢の場合は本人 / 承認済み' +
      'フォロワーのみ参照可 (= サーバー側で制御)。',
    params: {
      userId: USER_ID_PARAM,
      limit: FOLLOW_LIMIT_PARAM,
      untilId: UNTIL_ID_PARAM,
      accountId: ACCOUNT_ID_PARAM,
    },
    returns: { type: 'array', description: 'FollowRelation の配列' },
    cheap: true,
  },
  visible: false,
  execute: async (params) => {
    const userId = pickUserId(params, 'user.followers')
    const api = await getApiAdapter(pickAccountId(params))
    return await api.getFollowers(userId, {
      limit: pickLimit(params),
      untilId: pickUntilId(params),
    })
  },
}

export const userFollowingCapability: Command = {
  id: 'user.following',
  label: 'フォロー一覧',
  icon: 'ti-user-check',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.read'],
  signature: {
    description:
      '指定 userId がフォローしているユーザー一覧を返す (read-only)。' +
      '鍵垢の場合は本人 / 承認済みフォロワーのみ参照可。',
    params: {
      userId: USER_ID_PARAM,
      limit: FOLLOW_LIMIT_PARAM,
      untilId: UNTIL_ID_PARAM,
      accountId: ACCOUNT_ID_PARAM,
    },
    returns: { type: 'array', description: 'FollowRelation の配列' },
    cheap: true,
  },
  visible: false,
  execute: async (params) => {
    const userId = pickUserId(params, 'user.following')
    const api = await getApiAdapter(pickAccountId(params))
    return await api.getFollowing(userId, {
      limit: pickLimit(params),
      untilId: pickUntilId(params),
    })
  },
}

export const USER_BUILTIN_CAPABILITIES: readonly Command[] = [
  userLookupCapability,
  userSearchCapability,
  userMuteCapability,
  userUnmuteCapability,
  userRenoteMuteCapability,
  userUnrenoteMuteCapability,
  userFollowCapability,
  userUnfollowCapability,
  userFollowersCapability,
  userFollowingCapability,
]
