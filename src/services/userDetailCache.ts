/**
 * ユーザー詳細 (users/show) の共有キャッシュ (#1212)。
 *
 * ホバーのユーザーポップアップとプロフィールのウィンドウで使い回す。
 * ポップアップで見た相手のプロフィールを開いたとき、手元の詳細で先に
 * ヒーローを描き、取り直したもので差し替える (スピナーを挟まない)。
 *
 * 同じオブジェクトを両方の面が持つので、フォロー等の楽観的な書き換えは
 * 次に開いたときにも効く。上限は boundedCache で守る (#987)。
 */
import type { NormalizedUserDetail } from '@/adapters/types'
import { createBoundedCache } from '@/services/boundedCache'

export const USER_DETAIL_CACHE_TTL = 5 * 60 * 1000
const USER_DETAIL_CACHE_MAX = 32

const cache = createBoundedCache<
  string,
  { data: NormalizedUserDetail; at: number }
>(USER_DETAIL_CACHE_MAX, 'userDetail')
const pending = new Map<string, Promise<NormalizedUserDetail>>()

function keyOf(accountId: string, userId: string): string {
  return `${accountId}:${userId}`
}

/** TTL 内に取得した詳細。無ければ null */
export function getCachedUserDetail(
  accountId: string,
  userId: string,
  now = Date.now(),
): NormalizedUserDetail | null {
  const entry = cache.get(keyOf(accountId, userId))
  if (!entry || now - entry.at > USER_DETAIL_CACHE_TTL) return null
  return entry.data
}

/** 取り直してキャッシュを差し替える。同じ相手への同時の取得は 1 回にまとめる */
export function fetchUserDetail(
  accountId: string,
  userId: string,
  fetcher: () => Promise<NormalizedUserDetail>,
  now = Date.now(),
): Promise<NormalizedUserDetail> {
  const key = keyOf(accountId, userId)
  const inflight = pending.get(key)
  if (inflight) return inflight
  const promise = fetcher()
    .then((data) => {
      cache.set(key, { data, at: now })
      return data
    })
    .finally(() => {
      pending.delete(key)
    })
  pending.set(key, promise)
  return promise
}

export function clearUserDetailCache(): void {
  cache.clear()
  pending.clear()
}
