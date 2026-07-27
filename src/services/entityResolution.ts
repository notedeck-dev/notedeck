/**
 * エンティティ解決サービス (#777)。
 *
 * リモートノートの URI を「指定アカウントのサーバー上のローカル noteId」に
 * 解決する。同一ホストの URL は ap/show を呼ばずにパースで短絡し、
 * それ以外は ap/show の結果をアカウントスコープ別にキャッシュする。
 */

import type { NormalizedNote } from '@/adapters/types'
import { evictByLiveness } from '@/services/mapEviction'
import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import { AppError } from '@/utils/errors'
import { getNoteUri, parseNoteUrl } from '@/utils/noteUrl'
import { commands, unwrap } from '@/utils/tauriInvoke'

export type ResolveNoteError = {
  code: 'not_found' | 'retryable' | 'no_token'
  message: string
}

export type ResolveNoteResult =
  | { ok: true; noteId: string }
  | ({ ok: false } & ResolveNoteError)

// キーは `${accountScopeKey}|${uri}`。Account.id はログインごとに
// 再生成されるためキャッシュキーには使えない (#771)。
type CacheEntry = { key: string; noteId: string; cachedAt: string }

const MAX_CACHE_ENTRIES = 200
const NO_LIVE_KEYS: ReadonlySet<string> = new Set()
const resolutionCache = new Map<string, CacheEntry>()

export function _clearResolutionCacheForTest(): void {
  resolutionCache.clear()
}

/** アカウント削除時にそのスコープのキャッシュを無効化する */
export function invalidateResolutionCache(scopeKeyPrefix: string): void {
  const prefix = `${scopeKeyPrefix}|`
  for (const key of resolutionCache.keys()) {
    if (key.startsWith(prefix)) resolutionCache.delete(key)
  }
}

function toResolveError(e: unknown): ResolveNoteError {
  const err = AppError.from(e)
  if (err.displayCode.startsWith('NO_SUCH') || err.message.includes('404')) {
    return { code: 'not_found', message: err.message }
  }
  return { code: 'retryable', message: err.message }
}

/** uri を指定アカウントのサーバー上のノート ID に解決する */
export async function resolveNoteUriFor(
  accountId: string,
  uri: string,
): Promise<ResolveNoteResult> {
  const account = useAccountsStore().accountMap.get(accountId)
  if (!account) {
    throw new Error(`resolveNoteUriFor: unknown account ${accountId}`)
  }

  // 同一ホスト高速パス: 自サーバーの URL は ap/show 不要
  const parsed = parseNoteUrl(uri)
  if (parsed && parsed.host === account.host) {
    return { ok: true, noteId: parsed.noteId }
  }

  if (!account.hasToken) {
    return {
      ok: false,
      code: 'no_token',
      message: `account ${accountId} has no token`,
    }
  }

  const cacheKey = `${accountScopeKey(account)}|${uri}`
  const cached = resolutionCache.get(cacheKey)
  if (cached) return { ok: true, noteId: cached.noteId }

  try {
    const res = unwrap(await commands.apiApShow(accountId, uri)) as unknown as {
      type?: string
      object?: { id?: unknown }
    }
    const noteId = res?.type === 'Note' ? res.object?.id : undefined
    if (typeof noteId !== 'string') {
      return {
        ok: false,
        code: 'not_found',
        message: `ap/show returned ${res?.type ?? 'nothing'} for ${uri}`,
      }
    }
    resolutionCache.set(cacheKey, {
      key: cacheKey,
      noteId,
      cachedAt: new Date().toISOString(),
    })
    evictByLiveness(
      resolutionCache,
      MAX_CACHE_ENTRIES,
      NO_LIVE_KEYS,
      (entry) => entry.cachedAt,
      (entry) => entry.key,
    )
    return { ok: true, noteId }
  } catch (e) {
    return { ok: false, ...toResolveError(e) }
  }
}

/** NormalizedNote を指定アカウント上の ID に解決する（同一アカウントは短絡） */
export async function resolveNoteFor(
  accountId: string,
  note: NormalizedNote,
): Promise<ResolveNoteResult> {
  if (note._accountId === accountId) return { ok: true, noteId: note.id }
  return resolveNoteUriFor(accountId, getNoteUri(note))
}
