import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { ServerEmoji } from '@/adapters/types'
import { usePerformanceStore } from '@/stores/performance'
import { createDebouncedPersist } from '@/utils/debouncedPersist'
import { getStorageJson, STORAGE_KEYS, setStorageJson } from '@/utils/storage'

export const useEmojisStore = defineStore('emojis', () => {
  const perfStore = usePerformanceStore()

  // host → (shortcode → url) — for fast emoji resolution in notes
  const cache = shallowRef(new Map<string, Record<string, string>>())

  // host → ServerEmoji[] — for the reaction picker (with category/aliases)
  const emojiList = shallowRef(new Map<string, ServerEmoji[]>())

  // In-flight dedup: avoid parallel fetches for the same host
  const pending = new Map<string, Promise<void>>()
  // Backoff: track failed hosts to avoid immediate retry
  const failedHosts = new Map<string, number>()

  // Load shortcode→url cache from localStorage (for offline emoji resolution)
  function loadFromStorage() {
    const obj = getStorageJson<Record<string, Record<string, string>> | null>(
      STORAGE_KEYS.emojisCache,
      null,
    )
    if (!obj) return
    const map = new Map<string, Record<string, string>>()
    for (const [host, lookup] of Object.entries(obj)) {
      map.set(host, lookup)
    }
    cache.value = map
  }

  function persistToStorage() {
    try {
      const obj: Record<string, Record<string, string>> = {}
      for (const [host, lookup] of cache.value) {
        obj[host] = lookup
      }
      setStorageJson(STORAGE_KEYS.emojisCache, obj)
    } catch {
      // storage full, ignore
    }
  }

  const { schedule: schedulePersist } = createDebouncedPersist(persistToStorage)

  // Initialize from localStorage
  loadFromStorage()

  function set(host: string, emojis: ServerEmoji[]) {
    // Build shortcode→url lookup for resolution (no cap — lightweight Record<string, string>)
    const lookup: Record<string, string> = {}
    for (const e of emojis) {
      lookup[e.name] = e.url
    }

    const nextCache = new Map(cache.value)
    nextCache.set(host, lookup)
    cache.value = nextCache

    // emojiList: only keep the most recent hosts to bound memory
    const nextList = new Map(emojiList.value)
    nextList.set(host, emojis)
    if (nextList.size > perfStore.get('emojiListHosts')) {
      const oldest = nextList.keys().next().value
      if (oldest !== undefined) nextList.delete(oldest)
    }
    emojiList.value = nextList

    pending.delete(host)

    // Persist shortcode→url cache for offline use (debounced)
    schedulePersist()
  }

  const RETRY_BACKOFF_MS = 30_000

  function ensureLoaded(
    host: string,
    fetcher: () => Promise<ServerEmoji[]>,
  ): void {
    if (
      (cache.value.has(host) && emojiList.value.has(host)) ||
      pending.has(host)
    )
      return
    const failedAt = failedHosts.get(host)
    if (failedAt && Date.now() - failedAt < RETRY_BACKOFF_MS) return
    const p = fetcher()
      .then((emojis) => {
        failedHosts.delete(host)
        set(host, emojis)
      })
      .catch((e) => {
        console.warn('[emojis] failed to fetch:', host, e)
        failedHosts.set(host, Date.now())
        pending.delete(host)
      })
    pending.set(host, p)
  }

  function resolve(host: string, shortcode: string): string | null {
    const map = cache.value.get(host)
    if (!map) return null
    const base = shortcode.replace(/@\.$/, '')
    return map[shortcode] || map[base] || map[`${base}@.`] || null
  }

  function getEmojiList(host: string): ServerEmoji[] {
    return emojiList.value.get(host) ?? []
  }

  function has(host: string): boolean {
    return cache.value.has(host)
  }

  return { cache, emojiList, set, ensureLoaded, resolve, getEmojiList, has }
})
