/**
 * カスタムタイムライン / モード / フィルターの検出 (Tauri 経由の取得 +
 * localStorage の SWR キャッシュ + accounts store) と i18n ラベル。
 * policy → 可用性、モード → アイコン、フィルターの共通集合といった純規則は
 * services/timelinePolicy。
 */
import type { TimelineFilter, TimelineType } from '@/adapters/types'
import { i18n } from '@/i18n'
import {
  applyPoliciesToAvailability,
  FILTER_PARAM_ALIASES,
  KNOWN_FILTER_KEYS,
  MODE_RE,
} from '@/services/timelinePolicy'
import { useAccountsStore } from '@/stores/accounts'
import {
  getStorageJson,
  removeStorage,
  STORAGE_KEYS,
  setStorageJson,
} from './storage'
import { commands, unwrap } from './tauriInvoke'

export interface CustomTimelineInfo {
  type: string
  label: string
  icon: string // SVG path
}

// Standard timeline endpoints — excluded from custom detection
const STANDARD_TL_ENDPOINTS = new Set([
  'notes/timeline',
  'notes/local-timeline',
  'notes/hybrid-timeline',
  'notes/global-timeline',
  'notes/user-list-timeline',
])

// Known icons for specific custom timeline types (optional overrides)
export const CUSTOM_TL_ICONS: Record<string, string> = {
  bubble:
    'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12c0 2.1.644 4.052 1.745 5.665L2 22l4.335-1.745A9.956 9.956 0 0012 22z',
  recommended:
    'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  yami: 'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z',
  hanami:
    'M12 3c-1.5 2-4 4-4 7a4 4 0 008 0c0-3-2.5-5-4-7zm-5 9c-1.2 1.5-3 3-3 5.5a3 3 0 006 0c0-2.5-1.8-4-3-5.5zm10 0c-1.2 1.5-3 3-3 5.5a3 3 0 006 0c0-2.5-1.8-4-3-5.5z',
}

// Generic icon for unknown custom timelines
const GENERIC_TL_ICON =
  'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z'

// --- localStorage SWR cache ---

const POLICY_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h

interface CacheEntry<T> {
  data: T
  updatedAt: number
}

function readCache<T>(key: string): CacheEntry<T> | null {
  return getStorageJson<CacheEntry<T> | null>(key, null)
}

function writeCache<T>(key: string, data: T): void {
  setStorageJson(key, { data, updatedAt: Date.now() } satisfies CacheEntry<T>)
}

// --- Custom timeline detection (per host) ---

// Memory cache: host → custom timelines
const customTlMemCache = new Map<string, CustomTimelineInfo[]>()

async function fetchCustomTimelinesFromNetwork(
  host: string,
): Promise<CustomTimelineInfo[]> {
  const endpoints = unwrap(await commands.apiGetEndpoints(host))
  const customs: CustomTimelineInfo[] = []
  for (const ep of endpoints) {
    const match = ep.match(/^notes\/(.+)-timeline$/)
    if (!match || STANDARD_TL_ENDPOINTS.has(ep)) continue
    const type = match[1] as string
    customs.push({
      type,
      label: type.charAt(0).toUpperCase() + type.slice(1),
      icon: CUSTOM_TL_ICONS[type] ?? GENERIC_TL_ICON,
    })
  }
  customTlMemCache.set(host, customs)
  writeCache(STORAGE_KEYS.customTimeline(host), customs)
  return customs
}

/**
 * Auto-detect custom timelines by scanning /api/endpoints
 * for notes/*-timeline patterns not in the standard set.
 * Uses SWR: returns localStorage cache immediately, revalidates in background if stale.
 */
export async function detectCustomTimelines(
  host: string,
): Promise<CustomTimelineInfo[]> {
  // 1. Memory cache
  const memCached = customTlMemCache.get(host)
  if (memCached) return memCached

  // 2. localStorage cache (SWR)
  const stored = readCache<CustomTimelineInfo[]>(
    STORAGE_KEYS.customTimeline(host),
  )
  if (stored) {
    customTlMemCache.set(host, stored.data)
    if (Date.now() - stored.updatedAt >= POLICY_CACHE_TTL_MS) {
      fetchCustomTimelinesFromNetwork(host).catch(() => {
        /* stale cache is fine — revalidation is best-effort */
      })
    }
    return stored.data
  }

  // 3. No cache — network required
  try {
    return await fetchCustomTimelinesFromNetwork(host)
  } catch (e) {
    console.warn('[customTimelines] failed to detect:', e)
    return []
  }
}

// --- Timeline availability detection via user policies ---

export interface TimelineAvailability {
  available: TimelineType[]
  denied: Set<string>
  modes: Record<string, boolean> // e.g., { isInYamiMode: true }
}

// Serialized form for localStorage (Set → Array)
interface SerializedAvailability {
  available: TimelineType[]
  denied: string[]
  modes: Record<string, boolean>
}

function serializeAvailability(
  a: TimelineAvailability,
): SerializedAvailability {
  return { available: a.available, denied: [...a.denied], modes: a.modes }
}

function deserializeAvailability(
  s: SerializedAvailability,
): TimelineAvailability {
  return { available: s.available, denied: new Set(s.denied), modes: s.modes }
}

// Cache: accountId → availability
const availableTlCache = new Map<string, TimelineAvailability>()

// Runtime-denied: TL types that returned "disabled" errors at runtime.
// Persists across policy refreshes until explicitly cleared (e.g., mode toggle).
const runtimeDenied = new Map<string, Set<string>>()

export function markTimelineDenied(accountId: string, tlType: string): void {
  let set = runtimeDenied.get(accountId)
  if (!set) {
    set = new Set()
    runtimeDenied.set(accountId, set)
  }
  set.add(tlType)
  // Drop memory cache so the next detect() rebuilds with the new denied applied.
  // Without this, a stale memory hit would re-expose a tab we just learned is dead.
  availableTlCache.delete(accountId)
}

/** Apply runtime-denied set to a result in-place. */
function applyRuntimeDenied(
  accountId: string,
  result: TimelineAvailability,
): void {
  const rtDenied = getRuntimeDenied(accountId)
  for (const d of rtDenied) {
    result.denied.add(d)
    const idx = result.available.indexOf(d as TimelineType)
    if (idx >= 0) result.available.splice(idx, 1)
  }
}

/**
 * Strip TL types unreachable for the account in-place.
 * Currently only guests, who lack auth for `home` and `social` (= hybrid).
 * Applied even on cache hits so stale entries from older builds get cleaned up.
 */
function applyAccountExclusions(
  accountId: string,
  result: TimelineAvailability,
): void {
  const account = useAccountsStore().accountMap.get(accountId)
  if (account?.hasToken !== false) return
  for (const t of ['home', 'social'] as const) {
    const idx = result.available.indexOf(t)
    if (idx >= 0) result.available.splice(idx, 1)
    result.denied.add(t)
  }
}

export function getRuntimeDenied(accountId: string): Set<string> {
  return runtimeDenied.get(accountId) ?? new Set()
}

export function clearRuntimeDenied(accountId: string): void {
  runtimeDenied.delete(accountId)
}

/** Core network fetch logic for authenticated policies. */
async function fetchPoliciesFromNetwork(
  accountId: string,
): Promise<TimelineAvailability> {
  const denied = new Set<string>()
  const modes: Record<string, boolean> = {}
  const available: TimelineType[] = ['home']

  const data = unwrap(await commands.apiGetUserPolicies(accountId)) as Record<
    string,
    boolean
  >

  const policies: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('isIn') && key.endsWith('Mode')) {
      modes[key] = value
    } else {
      policies[key] = value
    }
  }

  applyPoliciesToAvailability(policies, available, denied)

  const result: TimelineAvailability = { available, denied, modes }
  applyAccountExclusions(accountId, result)
  applyRuntimeDenied(accountId, result)
  availableTlCache.set(accountId, result)
  writeCache(STORAGE_KEYS.policies(accountId), serializeAvailability(result))
  return result
}

/**
 * Public fallback for unauthenticated accounts: read default policies from
 * the server's `meta` endpoint (no auth required). Tabs that the server has
 * disabled at policy level (e.g. ltlAvailable=false) are filtered out before
 * any TL fetch is attempted.
 */
async function fetchPoliciesFromMeta(
  accountId: string,
): Promise<TimelineAvailability> {
  const denied = new Set<string>()
  const available: TimelineType[] = []

  const meta = (unwrap(await commands.apiGetMetaDetail(accountId)) ??
    {}) as Record<string, unknown>
  const rawPolicies = (meta.policies ?? {}) as Record<string, unknown>
  const policies: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(rawPolicies)) {
    if (typeof v === 'boolean') policies[k] = v
  }

  applyPoliciesToAvailability(policies, available, denied)

  const result: TimelineAvailability = { available, denied, modes: {} }
  applyAccountExclusions(accountId, result)
  applyRuntimeDenied(accountId, result)
  availableTlCache.set(accountId, result)
  writeCache(STORAGE_KEYS.policies(accountId), serializeAvailability(result))
  return result
}

/**
 * Detect timeline availability and mode flags from user policies.
 * Scans both known standard policies and fork-specific *TlAvailable patterns.
 * Also extracts isIn*Mode flags for mode toggle detection.
 * Uses SWR: returns localStorage cache immediately, revalidates in background if stale.
 */
export async function detectAvailableTimelines(
  accountId: string,
): Promise<TimelineAvailability> {
  // 1. Memory cache (markTimelineDenied invalidates this so fresh denials surface)
  const cached = availableTlCache.get(accountId)
  if (cached) return cached

  // 2. localStorage cache (SWR) — shared by both authenticated and logged-out.
  //    applyAccountExclusions cleans up entries from older builds that may
  //    have stored guest-unreachable types like 'home' or 'social'.
  const stored = readCache<SerializedAvailability>(
    STORAGE_KEYS.policies(accountId),
  )
  if (stored) {
    const result = deserializeAvailability(stored.data)
    applyAccountExclusions(accountId, result)
    applyRuntimeDenied(accountId, result)
    availableTlCache.set(accountId, result)
    if (Date.now() - stored.updatedAt >= POLICY_CACHE_TTL_MS) {
      fetchPoliciesFromNetwork(accountId).catch(() => {
        /* stale cache is fine — revalidation is best-effort */
      })
    }
    return result
  }

  // 3. No cache — try network.
  //    - Authenticated: i/get-policies (per-user role-aggregated).
  //    - Guest: meta.policies (server defaults, no auth).
  const account = useAccountsStore().accountMap.get(accountId)
  if (account?.hasToken) {
    try {
      return await fetchPoliciesFromNetwork(accountId)
    } catch (e) {
      console.warn('[availableTimelines] failed to detect policies (auth):', e)
    }
  } else if (account) {
    try {
      return await fetchPoliciesFromMeta(accountId)
    } catch (e) {
      console.warn('[availableTimelines] failed to detect policies (meta):', e)
    }
  }

  // 4. Final fallback: token state determines safe defaults; runtime-denied
  //    applied so tabs we already learned are dead stay hidden.
  const fallbackAvailable: TimelineType[] = account?.hasToken
    ? ['home']
    : ['local', 'global']
  const result: TimelineAvailability = {
    available: fallbackAvailable,
    denied: new Set(),
    modes: {},
  }
  applyAccountExclusions(accountId, result)
  applyRuntimeDenied(accountId, result)
  availableTlCache.set(accountId, result)
  return result
}

/** Invalidate the cached availability for an account (e.g., after mode toggle). */
export function clearAvailableTlCache(accountId: string) {
  availableTlCache.delete(accountId)
  try {
    removeStorage(STORAGE_KEYS.policies(accountId))
  } catch {
    // localStorage unavailable — ignore
  }
}

/** モードキー (e.g. 'isInYamiMode') を表示ラベル (e.g. 'Yamiモード') に変換 */
export function modeLabel(key: string): string {
  const match = key.match(MODE_RE)
  if (!match?.[1]) return key
  return i18n.tsx._customTimelines.modeLabel({ name: match[1] })
}

// --- Filter detection via /api/endpoint ---

// Cache: "host:endpoint" → filter keys
const filterKeyCache = new Map<string, (keyof TimelineFilter)[]>()

function getTimelineEndpoint(type: TimelineType): string {
  switch (type) {
    case 'home':
      return 'notes/timeline'
    case 'local':
      return 'notes/local-timeline'
    case 'social':
      return 'notes/hybrid-timeline'
    case 'global':
      return 'notes/global-timeline'
    default:
      return `notes/${type}-timeline`
  }
}

/**
 * Detect which filter params a timeline endpoint actually supports
 * by probing the /api/endpoint schema.
 */
export async function detectFilterKeys(
  host: string,
  timelineType: TimelineType,
): Promise<(keyof TimelineFilter)[]> {
  const endpoint = getTimelineEndpoint(timelineType)
  const cacheKey = `${host}:${endpoint}`
  const cached = filterKeyCache.get(cacheKey)
  if (cached) return cached

  try {
    const params = unwrap(await commands.apiGetEndpointParams(host, endpoint))
    const keys = KNOWN_FILTER_KEYS.filter((k) =>
      FILTER_PARAM_ALIASES[k].some((alias) => params.includes(alias)),
    )
    filterKeyCache.set(cacheKey, keys)
    return keys
  } catch (e) {
    console.warn('[filterDetection] failed to detect filters:', e)
    return []
  }
}
