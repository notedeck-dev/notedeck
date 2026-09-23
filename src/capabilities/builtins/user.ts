import type { Command } from '@/commands/registry'
import { stripCredentials } from '@/composables/useAiSystemContext'
import { useMutesStore } from '@/stores/mutes'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { getApiAdapter, resolveAccountId } from '../accountContext'
import { implement } from '../declare'

/**
 * `user.lookup` — username (+ optional host) から Misskey ユーザー情報を引く。
 *
 * AI が `@hitalin@yami.ski` 形式の文字列を受け取ったとき、`notes.user` に渡せる
 * 内部 user ID を取り出す動線。`notes.user` は内部 ID 必須なのでこの 1 段挟む。
 *
 * Misskey の `users/show` を使う。host は `@hitalin@yami.ski` の `yami.ski` 部分
 * (ローカル / 自インスタンスのときは省略可)。
 */
export const userLookupCapability = implement('user.lookup', {
  execute: async (params, ctx) => {
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
    const api = await getApiAdapter(params?.accountId, ctx)
    const user = await api.lookupUser(username, host)
    return stripCredentials(user)
  },
})

/**
 * `user.search` — username / display name の部分一致でユーザーを探す。
 *
 * `user.lookup` は完全一致な `@user@host` から 1 件引く動線、こちらは「○○ さん
 * 誰だっけ?」のようなあいまい検索で複数候補を返す。Misskey `users/search-by-username-and-name`
 * を使う。adapter 経由ではなく `apiSearchUsersByQuery` を直接叩く
 * (NormalizedUser 配列に正規化済み)。
 */
export const userSearchCapability = implement('user.search', {
  execute: async (params, ctx) => {
    const query = typeof params?.query === 'string' ? params.query : ''
    const limitRaw = typeof params?.limit === 'number' ? params.limit : 10
    const limit = Math.max(1, Math.min(100, Math.floor(limitRaw)))
    const id = resolveAccountId(params?.accountId, ctx)
    const raw = unwrap(await commands.apiSearchUsersByQuery(id, query, limit))
    if (!Array.isArray(raw)) return []
    return raw.map((u) => stripCredentials(u as Record<string, unknown>))
  },
})

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

const _USER_ID_PARAM = {
  type: 'string' as const,
  description: '対象 userId (user.lookup / search で取得)',
}
const _ACCOUNT_ID_PARAM = {
  type: 'string' as const,
  description: '操作元アカウント。未指定なら active。',
  optional: true,
}

export const userMuteCapability = implement('user.mute', {
  requiresConfirmation: muteConfirm('ミュート', 'ノート + 通知'),
  execute: async (params, ctx) => {
    const userId = pickUserId(params, 'user.mute')
    const accountId = resolveAccountId(params?.accountId, ctx)
    const api = await getApiAdapter(accountId, ctx)
    await api.muteUser(userId)
    // 過去ノートを即時非表示に（#574）。UserProfileContent と同じ楽観反映。
    useMutesStore().muteUser(accountId, userId)
    return { muted: true, userId }
  },
})

export const userUnmuteCapability = implement('user.unmute', {
  requiresConfirmation: muteConfirm('解除', 'ノート + 通知'),
  execute: async (params, ctx) => {
    const userId = pickUserId(params, 'user.unmute')
    const accountId = resolveAccountId(params?.accountId, ctx)
    const api = await getApiAdapter(accountId, ctx)
    await api.unmuteUser(userId)
    // 隠れていた過去ノートを即時復活（#574）。
    useMutesStore().unmuteUser(accountId, userId)
    return { unmuted: true, userId }
  },
})

export const userRenoteMuteCapability = implement('user.renoteMute', {
  requiresConfirmation: muteConfirm('リノートミュート', 'リノートだけ'),
  execute: async (params, ctx) => {
    const userId = pickUserId(params, 'user.renoteMute')
    const accountId = resolveAccountId(params?.accountId, ctx)
    const api = await getApiAdapter(accountId, ctx)
    await api.renoteMuteUser(userId)
    // 並んでいるリノートを即時非表示（#614）。
    useMutesStore().muteRenote(accountId, userId)
    return { renoteMuted: true, userId }
  },
})

export const userUnrenoteMuteCapability = implement('user.unrenoteMute', {
  requiresConfirmation: muteConfirm('リノートミュート解除', 'リノートだけ'),
  execute: async (params, ctx) => {
    const userId = pickUserId(params, 'user.unrenoteMute')
    const accountId = resolveAccountId(params?.accountId, ctx)
    const api = await getApiAdapter(accountId, ctx)
    await api.unrenoteMuteUser(userId)
    // 隠れていたリノートを即時復活（#614）。
    useMutesStore().unmuteRenote(accountId, userId)
    return { renoteUnmuted: true, userId }
  },
})

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

export const userFollowCapability = implement('user.follow', {
  requiresConfirmation: followConfirm('送る'),
  execute: async (params, ctx) => {
    const userId = pickUserId(params, 'user.follow')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.followUser(userId)
    return { followed: true, userId }
  },
})

export const userUnfollowCapability = implement('user.unfollow', {
  requiresConfirmation: followConfirm('解除'),
  execute: async (params, ctx) => {
    const userId = pickUserId(params, 'user.unfollow')
    const api = await getApiAdapter(params?.accountId, ctx)
    await api.unfollowUser(userId)
    return { unfollowed: true, userId }
  },
})

/**
 * `user.followers` / `user.following` — 指定ユーザーのフォロワー / フォロー一覧。
 *
 * Misskey の users/followers / users/following。read-only、公開設定 (= 鍵垢の
 * 場合は本人または承認済みフォロワーのみ) はサーバー側で制御される。
 * 軽量 read なので account.read で十分。
 */
const _FOLLOW_LIMIT_PARAM = {
  type: 'number' as const,
  description: '取得件数 (default 30)',
  optional: true,
}
const _UNTIL_ID_PARAM = {
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

export const userFollowersCapability = implement('user.followers', {
  execute: async (params, ctx) => {
    const userId = pickUserId(params, 'user.followers')
    const api = await getApiAdapter(params?.accountId, ctx)
    return await api.getFollowers(userId, {
      limit: pickLimit(params),
      untilId: pickUntilId(params),
    })
  },
})

export const userFollowingCapability = implement('user.following', {
  execute: async (params, ctx) => {
    const userId = pickUserId(params, 'user.following')
    const api = await getApiAdapter(params?.accountId, ctx)
    return await api.getFollowing(userId, {
      limit: pickLimit(params),
      untilId: pickUntilId(params),
    })
  },
})

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
