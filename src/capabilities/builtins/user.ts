import type { Command } from '@/commands/registry'
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
