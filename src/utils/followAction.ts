import { hapticLight } from '@/utils/haptics'

export interface FollowApi {
  followUser(userId: string): Promise<void>
  unfollowUser(userId: string): Promise<void>
  cancelFollowRequest(userId: string): Promise<void>
}

export interface FollowState {
  isFollowing: boolean
  hasPendingFollowRequestFromYou: boolean
}

/**
 * フォローボタンの状態遷移 (#752)。旧 toggleFollow (NormalizedUserDetail を
 * 直接変異) を置き換える純関数版で、成功時のみ遷移後の状態を返す。
 * 反映は呼び出し側 (MkFollowButton の emit) が行う。
 *
 * - pending → リクエストキャンセル (following/delete は notFollowing エラーに
 *   なるため別エンドポイント)
 * - フォロー中 → 解除
 * - 未フォロー: 鍵アカウントは承認待ち扱い。鍵か不明な文脈 (フォロー一覧など
 *   detail を持たない一覧) は resolvePending でサーバーの relation から確定する
 */
export async function executeFollowAction(
  api: FollowApi,
  userId: string,
  state: FollowState,
  options: {
    isLocked?: boolean
    resolvePending?: () => Promise<boolean>
  } = {},
): Promise<FollowState> {
  hapticLight()

  if (state.hasPendingFollowRequestFromYou) {
    await api.cancelFollowRequest(userId)
    return { isFollowing: false, hasPendingFollowRequestFromYou: false }
  }

  if (state.isFollowing) {
    await api.unfollowUser(userId)
    return { isFollowing: false, hasPendingFollowRequestFromYou: false }
  }

  await api.followUser(userId)
  if (options.isLocked === true) {
    return { isFollowing: false, hasPendingFollowRequestFromYou: true }
  }
  if (options.isLocked === undefined && options.resolvePending) {
    try {
      if (await options.resolvePending()) {
        return { isFollowing: false, hasPendingFollowRequestFromYou: true }
      }
    } catch {
      // relation 取得失敗時はフォロー中扱い (従来どおり)
    }
  }
  return { isFollowing: true, hasPendingFollowRequestFromYou: false }
}
