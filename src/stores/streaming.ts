import { defineStore } from 'pinia'
import { shallowRef, triggerRef } from 'vue'
import { usePerformanceStore } from '@/stores/performance'
import { useSettingsStore } from '@/stores/settings'
import { commands, unwrap } from '@/utils/tauriInvoke'

export type OnlineStatus = 'online' | 'active' | 'offline' | 'unknown'

export const useStreamingStore = defineStore('streaming', () => {
  /** accountId → OnlineStatus */
  const states = shallowRef<Record<string, OnlineStatus>>({})

  /** Fetch onlineStatus from users/show API for a given account */
  async function fetchOnlineStatus(
    accountId: string,
    userId: string,
  ): Promise<void> {
    try {
      const detail = unwrap(await commands.apiGetUserDetail(accountId, userId))
      const status = detail.onlineStatus as OnlineStatus | null
      // API success = server reachable.
      // 'unknown' means hidden status — for own account, treat as 'online'
      states.value[accountId] =
        status && status !== 'unknown' ? status : 'online'
      triggerRef(states)
    } catch {
      states.value[accountId] = 'unknown'
      triggerRef(states)
    }
  }

  function getState(accountId: string): OnlineStatus {
    return states.value[accountId] ?? 'unknown'
  }

  /** Mark an account as disconnected (e.g. on logout) */
  function disconnect(accountId: string): void {
    states.value[accountId] = 'offline'
    triggerRef(states)
  }

  /** Disconnect all accounts' streams (e.g. entering offline mode) */
  async function disconnectAll(
    accounts: { id: string; hasToken: boolean }[],
  ): Promise<void> {
    for (const acc of accounts) {
      if (acc.hasToken) {
        commands.streamDisconnect(acc.id).catch(() => undefined)
      }
    }
  }

  /** Set streaming mode for all accounts (realtime or polling) */
  async function setModeAll(
    accounts: { id: string; hasToken: boolean }[],
    mode: 'realtime' | 'polling',
    intervalMs?: number,
  ): Promise<void> {
    for (const acc of accounts) {
      if (acc.hasToken) {
        commands
          .streamSetMode(acc.id, mode, intervalMs ?? null)
          .catch(() => undefined)
      }
    }
  }

  /**
   * 永続化された輸送路 (`settings.json5` の `modes.realtime`) をバックエンドの
   * 実動作へ適用する (#1004)。realtime はバックエンドの既定 (connect = WS) なので
   * polling のときだけ明示的に送る。起動時とオフラインモード解除時に呼ぶ
   * (オフライン中に呼ばないのは呼ぶ側の責任。offlineMode と realtimeMode の
   * 両方から使うのでここに置き、store どうしの輪を作らない、#1098)
   */
  function applyPersistedMode(
    accounts: { id: string; hasToken: boolean }[],
  ): void {
    if (useSettingsStore().get('modes.realtime') ?? true) return
    const intervalMs = usePerformanceStore().get('streamPollingInterval') * 1000
    void setModeAll(accounts, 'polling', intervalMs)
  }

  return {
    states,
    fetchOnlineStatus,
    getState,
    disconnect,
    disconnectAll,
    setModeAll,
    applyPersistedMode,
  }
})
