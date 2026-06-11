import type { UnlistenFn } from '@tauri-apps/api/event'
import { computed, onUnmounted, type Ref, ref, watch } from 'vue'
import { useAccountsStore } from '@/stores/accounts'
import { useOfflineModeStore } from '@/stores/offlineMode'
import type { PerformanceKey } from '@/stores/performance'
import { usePerformanceStore } from '@/stores/performance'
import { listenTauri, type StreamEventEnvelope } from '@/utils/tauriEvents'

export interface UnreadCounterConfig {
  /** Performance store key for polling interval (seconds) */
  pollIntervalKey: PerformanceKey
  /** Fetch the unread count for a single account */
  fetchCount: (accountId: string) => Promise<number>
  /** Handle a stream event — return updated count delta or null to skip */
  onStreamEvent: (
    kind: string,
    payload: StreamEventEnvelope['payload'],
    currentCount: number,
  ) => number | null
}

interface SharedState {
  counts: Ref<Record<string, number>>
  listenerSetUp: boolean
  unlistenFn: UnlistenFn | null
  refCount: number
  pollingInterval: ReturnType<typeof setInterval> | null
  isPollingActive: boolean
}

const sharedStates = new Map<string, SharedState>()

function getSharedState(key: string): SharedState {
  let state = sharedStates.get(key)
  if (!state) {
    state = {
      counts: ref<Record<string, number>>({}),
      listenerSetUp: false,
      unlistenFn: null,
      refCount: 0,
      pollingInterval: null,
      isPollingActive: false,
    }
    sharedStates.set(key, state)
  }
  return state
}

export function useUnreadCounter(key: string, config: UnreadCounterConfig) {
  const state = getSharedState(key)
  const accountsStore = useAccountsStore()

  const totalUnread = computed(() =>
    Object.values(state.counts.value).reduce((sum, c) => sum + c, 0),
  )

  async function setupListener() {
    if (state.listenerSetUp) return
    state.listenerSetUp = true
    state.unlistenFn = await listenTauri(
      'stream-event',
      ({ kind, payload }) => {
        const { accountId } = payload
        const current = state.counts.value[accountId] ?? 0
        const result = config.onStreamEvent(kind, payload, current)
        if (result !== null) {
          state.counts.value = {
            ...state.counts.value,
            [accountId]: result,
          }
        }
      },
    )
  }

  function teardownListener() {
    if (state.unlistenFn) {
      state.unlistenFn()
      state.unlistenFn = null
    }
    state.listenerSetUp = false
  }

  async function fetchAll() {
    if (useOfflineModeStore().isOfflineMode) return
    const authed = accountsStore.accounts.filter((acc) => acc.hasToken)
    const results = await Promise.all(
      authed.map(async (acc) => ({
        id: acc.id,
        count: await config.fetchCount(acc.id),
      })),
    )
    const updated: Record<string, number> = {}
    for (const r of results) updated[r.id] = r.count
    state.counts.value = updated
  }

  function resetAll() {
    const reset: Record<string, number> = {}
    for (const acc of accountsStore.accounts) {
      reset[acc.id] = 0
    }
    state.counts.value = reset
  }

  function startPolling() {
    if (state.isPollingActive) return
    state.isPollingActive = true
    const perfStore = usePerformanceStore()
    state.pollingInterval = setInterval(
      fetchAll,
      perfStore.get(config.pollIntervalKey) * 1000,
    )
  }

  function stopPolling() {
    if (!state.isPollingActive) return
    state.isPollingActive = false
    if (state.pollingInterval) {
      clearInterval(state.pollingInterval)
      state.pollingInterval = null
    }
  }

  function onVisibilityChange() {
    if (document.hidden) {
      stopPolling()
    } else {
      fetchAll()
      startPolling()
    }
  }

  state.refCount++
  setupListener()

  watch(
    () => accountsStore.accounts.length,
    () => fetchAll(),
  )

  const perfStore = usePerformanceStore()
  watch(
    () => perfStore.get(config.pollIntervalKey),
    () => {
      if (state.isPollingActive) {
        stopPolling()
        startPolling()
      }
    },
  )

  fetchAll()
  if (!document.hidden) startPolling()
  document.addEventListener('visibilitychange', onVisibilityChange)

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    state.refCount--
    if (state.refCount <= 0) {
      stopPolling()
      teardownListener()
      state.refCount = 0
    }
  })

  return {
    totalUnread,
    counts: state.counts,
    fetchAll,
    resetAll,
  }
}
