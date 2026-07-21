import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeFollowAction } from './followAction'

vi.mock('@/utils/haptics', () => ({ hapticLight: vi.fn() }))

function makeApi() {
  return {
    followUser: vi.fn().mockResolvedValue(undefined),
    unfollowUser: vi.fn().mockResolvedValue(undefined),
    cancelFollowRequest: vi.fn().mockResolvedValue(undefined),
  }
}

describe('executeFollowAction', () => {
  let api: ReturnType<typeof makeApi>

  beforeEach(() => {
    api = makeApi()
  })

  it('pending 中は cancelFollowRequest を呼び未フォロー状態を返す', async () => {
    const next = await executeFollowAction(api, 'u1', {
      isFollowing: false,
      hasPendingFollowRequestFromYou: true,
    })
    expect(api.cancelFollowRequest).toHaveBeenCalledWith('u1')
    expect(api.followUser).not.toHaveBeenCalled()
    expect(next).toEqual({
      isFollowing: false,
      hasPendingFollowRequestFromYou: false,
    })
  })

  it('フォロー中は unfollow して未フォロー状態を返す', async () => {
    const next = await executeFollowAction(api, 'u1', {
      isFollowing: true,
      hasPendingFollowRequestFromYou: false,
    })
    expect(api.unfollowUser).toHaveBeenCalledWith('u1')
    expect(next.isFollowing).toBe(false)
  })

  it('鍵アカウントへの follow は承認待ち状態を返す', async () => {
    const next = await executeFollowAction(
      api,
      'u1',
      { isFollowing: false, hasPendingFollowRequestFromYou: false },
      { isLocked: true },
    )
    expect(api.followUser).toHaveBeenCalledWith('u1')
    expect(next).toEqual({
      isFollowing: false,
      hasPendingFollowRequestFromYou: true,
    })
  })

  it('鍵でないアカウントへの follow はフォロー中状態を返す', async () => {
    const next = await executeFollowAction(
      api,
      'u1',
      { isFollowing: false, hasPendingFollowRequestFromYou: false },
      { isLocked: false },
    )
    expect(next).toEqual({
      isFollowing: true,
      hasPendingFollowRequestFromYou: false,
    })
  })

  it('鍵か不明なら resolvePending で承認待ちを確定する', async () => {
    const next = await executeFollowAction(
      api,
      'u1',
      { isFollowing: false, hasPendingFollowRequestFromYou: false },
      { resolvePending: async () => true },
    )
    expect(next).toEqual({
      isFollowing: false,
      hasPendingFollowRequestFromYou: true,
    })
  })

  it('resolvePending 失敗時はフォロー中扱いにフォールバック', async () => {
    const next = await executeFollowAction(
      api,
      'u1',
      { isFollowing: false, hasPendingFollowRequestFromYou: false },
      {
        resolvePending: async () => {
          throw new Error('relation error')
        },
      },
    )
    expect(next.isFollowing).toBe(true)
  })

  it('API 失敗はそのまま throw し状態を返さない', async () => {
    api.followUser.mockRejectedValueOnce(new Error('boom'))
    await expect(
      executeFollowAction(api, 'u1', {
        isFollowing: false,
        hasPendingFollowRequestFromYou: false,
      }),
    ).rejects.toThrow('boom')
  })
})
