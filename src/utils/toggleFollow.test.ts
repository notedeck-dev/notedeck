import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedUserDetail } from '@/adapters/types'
import { toggleFollow } from './toggleFollow'

vi.mock('@/utils/haptics', () => ({ hapticLight: vi.fn() }))

function makeUser(
  overrides: Partial<NormalizedUserDetail> = {},
): NormalizedUserDetail {
  return {
    id: 'u1',
    username: 'alice',
    host: null,
    name: 'Alice',
    avatarUrl: null,
    isFollowing: false,
    isFollowed: false,
    followersCount: 10,
    ...overrides,
  } as NormalizedUserDetail
}

function makeApi() {
  return {
    followUser: vi.fn().mockResolvedValue(undefined),
    unfollowUser: vi.fn().mockResolvedValue(undefined),
    cancelFollowRequest: vi.fn().mockResolvedValue(undefined),
  }
}

describe('toggleFollow', () => {
  let api: ReturnType<typeof makeApi>

  beforeEach(() => {
    api = makeApi()
  })

  it('鍵アカウントへの follow は pending にし isFollowing/followersCount を触らない', async () => {
    const user = makeUser({ isLocked: true })
    await toggleFollow(api, user)

    expect(api.followUser).toHaveBeenCalledWith('u1')
    expect(user.hasPendingFollowRequestFromYou).toBe(true)
    expect(user.isFollowing).toBe(false)
    expect(user.followersCount).toBe(10)
  })

  it('鍵アカウント follow 失敗時は pending を戻す', async () => {
    const user = makeUser({ isLocked: true })
    api.followUser.mockRejectedValueOnce(new Error('boom'))

    await expect(toggleFollow(api, user)).rejects.toThrow('boom')
    expect(user.hasPendingFollowRequestFromYou).toBe(false)
    expect(user.isFollowing).toBe(false)
    expect(user.followersCount).toBe(10)
  })

  it('非鍵アカウントへの follow は従来どおり楽観更新する', async () => {
    const user = makeUser({ isLocked: false })
    await toggleFollow(api, user)

    expect(api.followUser).toHaveBeenCalledWith('u1')
    expect(user.isFollowing).toBe(true)
    expect(user.followersCount).toBe(11)
    expect(user.hasPendingFollowRequestFromYou).toBeUndefined()
  })

  it('pending 状態での再押下は cancelFollowRequest を呼ぶ', async () => {
    const user = makeUser({
      isLocked: true,
      hasPendingFollowRequestFromYou: true,
    })
    await toggleFollow(api, user)

    expect(api.cancelFollowRequest).toHaveBeenCalledWith('u1')
    expect(api.followUser).not.toHaveBeenCalled()
    expect(user.hasPendingFollowRequestFromYou).toBe(false)
  })

  it('follow 中の unfollow は従来どおり', async () => {
    const user = makeUser({ isFollowing: true, followersCount: 10 })
    await toggleFollow(api, user)

    expect(api.unfollowUser).toHaveBeenCalledWith('u1')
    expect(user.isFollowing).toBe(false)
    expect(user.followersCount).toBe(9)
  })
})
