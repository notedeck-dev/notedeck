import { describe, expect, it, vi } from 'vitest'
import { executeFollowAction } from './followAction'
import { hapticLight } from './haptics'

vi.mock('@/utils/haptics', () => ({ hapticLight: vi.fn() }))

// 状態遷移は src/services/followTransition.test.ts。ここは utils 側の触覚だけ

describe('executeFollowAction', () => {
  it('触覚を鳴らしてから遷移を委譲する', async () => {
    const api = {
      followUser: vi.fn().mockResolvedValue(undefined),
      unfollowUser: vi.fn().mockResolvedValue(undefined),
      cancelFollowRequest: vi.fn().mockResolvedValue(undefined),
    }
    const next = await executeFollowAction(api, 'u1', {
      isFollowing: false,
      hasPendingFollowRequestFromYou: false,
    })
    expect(hapticLight).toHaveBeenCalledTimes(1)
    expect(api.followUser).toHaveBeenCalledWith('u1')
    expect(next.isFollowing).toBe(true)
  })
})
