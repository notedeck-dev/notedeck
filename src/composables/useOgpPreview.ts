import { ref } from 'vue'
import { usePerformanceStore } from '@/stores/performance'
import type { OgpData } from '@/utils/ogp'
import { listenTauri } from '@/utils/tauriEvents'
import { commands, unwrap } from '@/utils/tauriInvoke'

const ogpCache = new Map<string, OgpData | null>()

function getOgpCacheMax(): number {
  try {
    return usePerformanceStore().get('ogpCacheMax')
  } catch {
    return 128
  }
}
const pendingRequests = new Map<string, Promise<OgpData | null>>()

function setOgpCache(url: string, value: OgpData | null) {
  if (ogpCache.has(url)) {
    // LRU: delete and re-insert to move to end (most recently used)
    ogpCache.delete(url)
  } else if (ogpCache.size >= getOgpCacheMax()) {
    // Evict least recently used (first entry in Map iteration order)
    const lru = ogpCache.keys().next().value
    if (lru !== undefined) ogpCache.delete(lru)
  }
  ogpCache.set(url, value)
}

function getOgpCache(url: string): OgpData | null | undefined {
  if (!ogpCache.has(url)) return undefined
  const value = ogpCache.get(url) ?? null
  // LRU: move to end by re-inserting
  ogpCache.delete(url)
  ogpCache.set(url, value)
  return value
}

/** Pre-populate the OGP cache from batch IPC results (e.g. timeline enriched) */
export function populateOgpCache(hints: Record<string, OgpData>) {
  for (const [url, data] of Object.entries(hints)) {
    setOgpCache(url, data)
  }
}

/** Listen for background OGP prefetch results from Rust side. Call once at app init. */
let ogpUnlisten: (() => void) | null = null
export async function initOgpListener(): Promise<void> {
  ogpUnlisten?.()
  ogpUnlisten = await listenTauri('nd:ogp-hints', (hints) => {
    populateOgpCache(hints)
  })
}

export function useOgpPreview(initialUrl: string, accountId?: string) {
  const data = ref<OgpData | null>(null)
  const loading = ref(true)
  let currentUrl = initialUrl

  async function fetchUrl(targetUrl: string) {
    currentUrl = targetUrl
    loading.value = true
    data.value = null

    const cached = getOgpCache(targetUrl)
    if (cached !== undefined) {
      data.value = cached
      loading.value = false
      return
    }

    let promise = pendingRequests.get(targetUrl)
    if (!promise) {
      promise = commands
        .fetchOgp(targetUrl, accountId ?? null)
        .then((result) => {
          const data = unwrap(result) as OgpData
          setOgpCache(targetUrl, data)
          pendingRequests.delete(targetUrl)
          return data
        })
        .catch(() => {
          setOgpCache(targetUrl, null)
          pendingRequests.delete(targetUrl)
          return null
        })
      pendingRequests.set(targetUrl, promise)
    }

    const result = await promise
    // Only update if still the current URL (guard against race conditions)
    if (currentUrl === targetUrl) {
      data.value = result
      loading.value = false
    }
  }

  async function fetch() {
    await fetchUrl(currentUrl)
  }

  return { data, loading, fetch, fetchUrl }
}
