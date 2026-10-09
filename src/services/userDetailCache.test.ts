import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedUserDetail } from '@/adapters/types'
import {
  clearUserDetailCache,
  fetchUserDetail,
  getCachedUserDetail,
  USER_DETAIL_CACHE_TTL,
} from './userDetailCache'

function detail(id: string): NormalizedUserDetail {
  return { id } as NormalizedUserDetail
}

describe('userDetailCache', () => {
  afterEach(() => {
    clearUserDetailCache()
  })

  it('取得したものを TTL の間だけ返す', async () => {
    const d = detail('u1')
    await fetchUserDetail('a1', 'u1', async () => d, 1000)
    expect(getCachedUserDetail('a1', 'u1', 1000)).toBe(d)
    expect(getCachedUserDetail('a1', 'u1', 1000 + USER_DETAIL_CACHE_TTL)).toBe(
      d,
    )
    expect(
      getCachedUserDetail('a1', 'u1', 1001 + USER_DETAIL_CACHE_TTL),
    ).toBeNull()
  })

  it('アカウントが違えば別のエントリ', async () => {
    await fetchUserDetail('a1', 'u1', async () => detail('u1'), 0)
    expect(getCachedUserDetail('a2', 'u1', 0)).toBeNull()
  })

  it('同じ相手への同時の取得は 1 回にまとめる', async () => {
    const fetcher = vi.fn(async () => detail('u1'))
    const [x, y] = await Promise.all([
      fetchUserDetail('a1', 'u1', fetcher, 0),
      fetchUserDetail('a1', 'u1', fetcher, 0),
    ])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(x).toBe(y)
  })

  it('キャッシュがあっても fetchUserDetail は取り直して差し替える', async () => {
    await fetchUserDetail('a1', 'u1', async () => detail('u1'), 0)
    const fresh = detail('u1')
    await fetchUserDetail('a1', 'u1', async () => fresh, 10)
    expect(getCachedUserDetail('a1', 'u1', 10)).toBe(fresh)
  })

  it('失敗した取得は残さず、次は取り直す', async () => {
    await expect(
      fetchUserDetail('a1', 'u1', async () => {
        throw new Error('x')
      }),
    ).rejects.toThrow('x')
    const fetcher = vi.fn(async () => detail('u1'))
    await fetchUserDetail('a1', 'u1', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
