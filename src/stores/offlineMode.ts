import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useAccountsStore } from '@/stores/accounts'
import { useSettingsStore } from '@/stores/settings'
import { useStreamingStore } from '@/stores/streaming'
import { useSystemStateStore } from '@/stores/systemState'
import { useUiStore } from '@/stores/ui'
import { useRepresentative } from '@/windows/roles'

/**
 * アプリ全体のオフラインモード。
 *
 * - 手動: `settings.json5` の `modes.offline`。利用者が切り替え、回線が戻っても
 *   勝手には抜けない
 * - 自動 (#461): 回線が無いと `systemState` が判断したら入り、戻ったら抜ける。
 *   設定ファイルには書かない一時状態。自動で入っている間に利用者が解除したら、
 *   次に回線が切れるまで自動を抑止する (回線検知の誤りで閉じ込めない)
 *
 * 入る / 抜けるときの副作用 (ストリーム切断、輸送路の再適用、復帰信号) は
 * どちらの経路でも同じなので、実効値の watcher 1 箇所でやる。
 */
export const useOfflineModeStore = defineStore('offlineMode', () => {
  const settingsStore = useSettingsStore()
  const systemState = useSystemStateStore()

  const isManualOffline = computed<boolean>({
    get: () => settingsStore.get('modes.offline') ?? false,
    set: (v) => {
      settingsStore.set('modes.offline', v)
    },
  })

  /** 自動オフライン中に利用者が解除した。次の回線断で解ける */
  const autoSuppressed = ref(false)
  watch(
    () => systemState.adaptation.goOffline,
    (v) => {
      if (!v) autoSuppressed.value = false
    },
  )

  /** 回線が無いことによる自動のオフライン */
  const isAutoOffline = computed(
    () => systemState.adaptation.goOffline && !autoSuppressed.value,
  )

  /** 実効値: 手動 or 自動 */
  const isOfflineMode = computed(
    () => isManualOffline.value || isAutoOffline.value,
  )

  watch(
    isOfflineMode,
    (now) => {
      if (now) {
        void useStreamingStore().disconnectAll(useAccountsStore().accounts)
        return
      }
      // polling モードなら輸送路を再開する (#1004)。disconnectAll が polling
      // タスクも止めるため、再適用しないと復帰時の connect で実動作が
      // realtime に化ける。realtimeMode store を経由しないのは、そちらが
      // こちらの isOfflineMode を見る (向きを一方向に保つ、#1098)
      // 輸送路への適用はプロセスに 1 回でよいので代表窓だけが送る (#1131)
      if (useRepresentative().isRepresentative.value) {
        useStreamingStore().applyPersistedMode(useAccountsStore().accounts)
      }
      // 再接続と catch-up は復帰信号に乗せる
      useUiStore().emitDeckResume()
    },
    { flush: 'sync' },
  )

  async function enable(): Promise<void> {
    isManualOffline.value = true
  }

  async function disable(): Promise<void> {
    isManualOffline.value = false
    if (systemState.adaptation.goOffline) autoSuppressed.value = true
  }

  async function toggle(): Promise<void> {
    if (isOfflineMode.value) {
      await disable()
    } else {
      await enable()
    }
  }

  return {
    isOfflineMode,
    isManualOffline,
    isAutoOffline,
    enable,
    disable,
    toggle,
  }
})
