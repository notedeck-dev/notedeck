import { createAdapter } from './registry'
import type { ServerAdapter, ServerInfo } from './types'

/**
 * factory が外側 (store) に頼む仕事。adapters 層は stores を import しないので
 * (#1098)、アプリの起動時に `configureAdapterFactory` で渡す
 */
export interface AdapterFactoryDeps {
  /** ホストのサーバー情報 (キャッシュ済みならそれ) */
  getServerInfo(host: string): Promise<ServerInfo>
  /**
   * adapter を返すたびに呼ぶ (作った直後もキャッシュ済みも)。絵文字辞書や
   * ピン留めリアクションの温めなど、冪等な副作用の置き場
   */
  onAdapterReady?(
    adapter: ServerAdapter,
    ctx: { host: string; accountId: string; hasToken: boolean },
    options?: { pinnedReactions?: boolean },
  ): void
}

let deps: AdapterFactoryDeps | null = null

export function configureAdapterFactory(next: AdapterFactoryDeps): void {
  deps = next
}

function requireDeps(): AdapterFactoryDeps {
  if (!deps) {
    throw new Error(
      'adapter factory is not configured: call configureAdapterFactory() at startup',
    )
  }
  return deps
}

export interface InitAdapterResult {
  adapter: ServerAdapter
  serverInfo: ServerInfo
}

// Global adapter cache: accountId -> ServerAdapter
const adapterCache = new Map<string, ServerAdapter>()
const adapterPending = new Map<string, Promise<InitAdapterResult>>()

/**
 * Common adapter initialization with accountId-based caching.
 *
 * The same accountId always returns the same adapter instance.
 * This eliminates duplicate MisskeyApi / MisskeyStream instances
 * when multiple columns share the same account.
 */
export async function initAdapterFor(
  host: string,
  accountId: string,
  options?: { pinnedReactions?: boolean; hasToken?: boolean },
): Promise<InitAdapterResult> {
  const hasToken = options?.hasToken !== false

  // Return cached adapter if available
  const cached = adapterCache.get(accountId)
  if (cached) {
    const serverInfo = cached.serverInfo
    requireDeps().onAdapterReady?.(
      cached,
      { host, accountId, hasToken },
      options,
    )
    return { adapter: cached, serverInfo }
  }

  // In-flight dedup: if another caller is already initializing this accountId, wait for it
  const inflight = adapterPending.get(accountId)
  if (inflight) return inflight

  const promise = (async (): Promise<InitAdapterResult> => {
    const d = requireDeps()
    const serverInfo = await d.getServerInfo(host)
    const adapter = createAdapter(serverInfo, accountId, hasToken)

    adapterCache.set(accountId, adapter)
    d.onAdapterReady?.(adapter, { host, accountId, hasToken }, options)

    return { adapter, serverInfo }
  })()

  adapterPending.set(accountId, promise)
  try {
    return await promise
  } finally {
    adapterPending.delete(accountId)
  }
}

/**
 * Destroy the cached adapter for an account.
 * Call on logout or account removal.
 *
 * cleanup() (JS リスナー掃除) ではなく disconnect() を呼ぶ: backend の
 * WS 接続・subscriptions・captured_notes はアカウントのライフサイクルに
 * 従うべきで、cleanup だけだと削除済みアカウントの接続がアプリ終了まで
 * 残存し再接続 replay され続ける。
 */
export function destroyAdapter(accountId: string): void {
  const adapter = adapterCache.get(accountId)
  if (!adapter) return
  adapter.stream.disconnect()
  adapterCache.delete(accountId)
}

/** Check if an adapter is cached for the given accountId (for testing/debug) */
export function hasAdapterCache(accountId: string): boolean {
  return adapterCache.has(accountId)
}
