import type { Command } from '@/commands/registry'
import { i18n } from '@/i18n'
import { useMutesStore } from '@/stores/mutes'
import { getApiAdapter, resolveAccountId } from '../accountContext'
import { implement, implementCore } from '../declare'

/**
 * `user.lookup` — username (+ optional host) から Misskey ユーザー情報を引く。
 *
 * AI が `@hitalin@yami.ski` 形式の文字列を受け取ったとき、`notes.user` に渡せる
 * 内部 user ID を取り出す動線。`notes.user` は内部 ID 必須なのでこの 1 段挟む。
 *
 * Misskey の `users/show` を使う。host は `@hitalin@yami.ski` の `yami.ski` 部分
 * (ローカル / 自インスタンスのときは省略可)。
 */
export const userLookupCapability = implementCore('user.lookup')

/**
 * `user.search` — username / display name の部分一致でユーザーを探す。
 *
 * `user.lookup` は完全一致な `@user@host` から 1 件引く動線、こちらは「○○ さん
 * 誰だっけ?」のようなあいまい検索で複数候補を返す。Misskey `users/search-by-username-and-name`
 * を使う。adapter 経由ではなく `apiSearchUsersByQuery` を直接叩く
 * (NormalizedUser 配列に正規化済み)。
 */
export const userSearchCapability = implementCore('user.search')

/**
 * Mute / RenoteMute 系 — 相手に通知されない静かな見え方制御。
 * AI 経路で開放可。block (対外性高) とは別軸 — block は塞ぐリスト
 * (memory: feedback_ai_capability_scope)。
 *
 * 確認 UI は normal (= danger ではない)。可逆操作 (unmute / unrenoteMute あり)
 * かつ相手側に通知が飛ばないため心理的負荷が低い。
 */
function muteConfirm(
  text: (userId: string) => {
    title: string
    message: string
    okLabel: string
  },
) {
  return (params: Record<string, unknown> | undefined) => {
    const userId = typeof params?.userId === 'string' ? params.userId : ''
    return {
      ...text(userId),
      cancelLabel: i18n.ts._common.cancel,
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

export const userMuteCapability = implement('user.mute', {
  requiresConfirmation: muteConfirm((userId) => ({
    title: i18n.ts._userCapability.muteTitle,
    message: i18n.tsx._userCapability.muteMessage({ userId }),
    okLabel: i18n.ts._common.mute,
  })),
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
  requiresConfirmation: muteConfirm((userId) => ({
    title: i18n.ts._userCapability.unmuteTitle,
    message: i18n.tsx._userCapability.unmuteMessage({ userId }),
    okLabel: i18n.ts._userCapability.unmuteOk,
  })),
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
  requiresConfirmation: muteConfirm((userId) => ({
    title: i18n.ts._userCapability.renoteMuteTitle,
    message: i18n.tsx._userCapability.renoteMuteMessage({ userId }),
    okLabel: i18n.ts._userCapability.renoteMuteOk,
  })),
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
  requiresConfirmation: muteConfirm((userId) => ({
    title: i18n.ts._userCapability.unrenoteMuteTitle,
    message: i18n.tsx._userCapability.unrenoteMuteMessage({ userId }),
    okLabel: i18n.ts._userCapability.unrenoteMuteOk,
  })),
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

export const userFollowCapability = implementCore('user.follow')

export const userUnfollowCapability = implementCore('user.unfollow')

export const userFollowersCapability = implementCore('user.followers')

export const userFollowingCapability = implementCore('user.following')

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
