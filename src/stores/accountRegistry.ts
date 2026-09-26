import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { JsonValue } from '@/bindings'
import { logIgnored } from '@/utils/logger'
import { getStorageJson, STORAGE_KEYS, setStorageJson } from '@/utils/storage'
import { commands, unwrap } from '@/utils/tauriInvoke'

// per-account の i/registry/* 値をキャッシュする store。
// 本家 Misskey Web UI と互換な scope/key を読み書きする薄い API 層で、
// per-account 設定 (テーマ #339 / プラグイン #340 / ウィジェット #387) の土台。
//
// - in-memory cache: shallowRef<Map<accountId, Map<cacheKey, value>>>
// - localStorage backing: 起動時の instant restore 用
// - write-through: set/remove は API + cache を同時に更新

type RegistryValue = JsonValue | null
type CacheKey = string // JSON.stringify([scope, key])
type AccountCache = Map<CacheKey, RegistryValue>
type SerializedAccount = [string, [CacheKey, RegistryValue][]]

const makeCacheKey = (scope: readonly string[], key: string): CacheKey =>
  JSON.stringify([scope, key])

export const useAccountRegistryStore = defineStore('accountRegistry', () => {
  const cache = shallowRef<Map<string, AccountCache>>(new Map())

  // FOUC 回避のため defer して localStorage から復元
  queueMicrotask(() => {
    const restored = getStorageJson<SerializedAccount[]>(
      STORAGE_KEYS.accountRegistry,
      [],
    )
    if (restored.length === 0) return
    try {
      cache.value = new Map(
        restored.map(([accountId, entries]) => [accountId, new Map(entries)]),
      )
    } catch {
      /* ignore corrupt data */
    }
  })

  // QuotaExceededError が一度出たら以降の persist は skip (ログ汚染回避)
  let persistDisabled = false

  function persist(): void {
    if (persistDisabled) return
    const serializable: SerializedAccount[] = Array.from(
      cache.value.entries(),
    ).map(([accountId, m]) => [accountId, Array.from(m.entries())])
    try {
      setStorageJson(STORAGE_KEYS.accountRegistry, serializable)
    } catch (e) {
      persistDisabled = true
      if (import.meta.env.DEV) {
        console.warn('[accountRegistry] persist disabled (likely quota):', e)
      }
    }
  }

  function setCacheEntry(
    accountId: string,
    scope: readonly string[],
    key: string,
    value: RegistryValue,
  ): void {
    const next = new Map(cache.value)
    const accountCache = new Map(next.get(accountId) ?? [])
    accountCache.set(makeCacheKey(scope, key), value)
    next.set(accountId, accountCache)
    cache.value = next
    persist()
  }

  function deleteCacheEntry(
    accountId: string,
    scope: readonly string[],
    key: string,
  ): void {
    const accountCache = cache.value.get(accountId)
    if (!accountCache) return
    const next = new Map(cache.value)
    const updated = new Map(accountCache)
    updated.delete(makeCacheKey(scope, key))
    next.set(accountId, updated)
    cache.value = next
    persist()
  }

  /**
   * cache から同期で取得。miss 時は undefined、registry 上に存在しない場合 (negative cache) は null。
   */
  function getCached(
    accountId: string,
    scope: readonly string[],
    key: string,
  ): RegistryValue | undefined {
    return cache.value.get(accountId)?.get(makeCacheKey(scope, key))
  }

  /**
   * cache hit なら即返り、miss なら API fetch + cache 更新。
   * API エラーは null として cache に記録 (negative cache)。
   */
  async function get(
    accountId: string,
    scope: string[],
    key: string,
  ): Promise<RegistryValue> {
    const cached = getCached(accountId, scope, key)
    if (cached !== undefined) return cached

    try {
      const value = unwrap(
        await commands.apiGetRegistryValue(accountId, scope, key),
      )
      setCacheEntry(accountId, scope, key, value)
      return value
    } catch (e) {
      logIgnored('accountRegistry.get', e)
      setCacheEntry(accountId, scope, key, null)
      return null
    }
  }

  /**
   * registry 値を書き込み + cache 更新。失敗時は throw (caller でハンドリング)。
   */
  async function set(
    accountId: string,
    scope: string[],
    key: string,
    value: JsonValue,
  ): Promise<void> {
    unwrap(await commands.apiSetRegistryValue(accountId, scope, key, value))
    setCacheEntry(accountId, scope, key, value)
  }

  /**
   * registry 値を削除 + cache から削除。idempotent。
   */
  async function remove(
    accountId: string,
    scope: string[],
    key: string,
  ): Promise<void> {
    unwrap(await commands.apiDeleteRegistryValue(accountId, scope, key))
    deleteCacheEntry(accountId, scope, key)
  }

  /**
   * scope 内の key 一覧を type 付きで取得 (毎回 API、cache しない)。
   */
  async function listKeys(
    accountId: string,
    scope: string[],
  ): Promise<Record<string, string>> {
    try {
      const result = unwrap(
        await commands.apiListRegistryKeys(accountId, scope),
      )
      // bindings の型は Partial<Record<string, string>> なので undefined を除去
      const filtered: Record<string, string> = {}
      for (const [k, v] of Object.entries(result)) {
        if (v !== undefined) filtered[k] = v
      }
      return filtered
    } catch (e) {
      logIgnored('accountRegistry.listKeys', e)
      return {}
    }
  }

  /**
   * アカウント削除時に呼ぶ。in-memory + localStorage cache から消す。
   */
  function invalidate(accountId: string): void {
    if (!cache.value.has(accountId)) return
    const next = new Map(cache.value)
    next.delete(accountId)
    cache.value = next
    persist()
  }

  return { cache, get, getCached, set, remove, listKeys, invalidate }
})
