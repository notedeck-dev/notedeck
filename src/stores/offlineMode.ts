import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useAccountsStore } from '@/stores/accounts'
import { useRealtimeModeStore } from '@/stores/realtimeMode'
import { useSettingsStore } from '@/stores/settings'
import { useStreamingStore } from '@/stores/streaming'
import { useUiStore } from '@/stores/ui'

export const useOfflineModeStore = defineStore('offlineMode', () => {
  const settingsStore = useSettingsStore()

  /** App-wide offline mode. Backed by settings.json5 `modes.offline`. */
  const isOfflineMode = computed<boolean>({
    get: () => settingsStore.get('modes.offline') ?? false,
    set: (v) => {
      settingsStore.set('modes.offline', v)
    },
  })

  async function enable(): Promise<void> {
    isOfflineMode.value = true
    // Disconnect all streaming connections
    await useStreamingStore().disconnectAll(useAccountsStore().accounts)
  }

  async function disable(): Promise<void> {
    isOfflineMode.value = false
    // polling モードなら輸送路を再開する (#1004)。enable() の disconnectAll
    // が polling タスクも止めるため、再適用しないと復帰時の connect で
    // 実動作が realtime に化ける
    useRealtimeModeStore().applyPersistedMode()
    // Trigger reconnection via reactive deck-resume signal
    useUiStore().emitDeckResume()
  }

  async function toggle(): Promise<void> {
    if (isOfflineMode.value) {
      await disable()
    } else {
      await enable()
    }
  }

  return { isOfflineMode, enable, disable, toggle }
})
