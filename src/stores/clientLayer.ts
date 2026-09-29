import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ClientLayerState, ResidentStatus } from '@/bindings'
import { isTauri } from '@/utils/settingsFs'
import { listenTauri } from '@/utils/tauriEvents'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * クライアント層の状態の写し (#1106 案 B)。
 *
 * `state` は今このプロセスが AI 系のコマンドをどこに送っているか (in-process /
 * 別プロセスの notemaid に中継) と接続の様子 (`nd:client-layer-state` で更新)。
 * `resident` は「アプリを閉じても AI を動かす」(ログイン時タスク) の状態で、「コア」
 * ウィンドウが開いたときとトグルの後に読み直す。データ面は常にこの端末で動く。
 */
export const useClientLayerStore = defineStore('clientLayer', () => {
  const state = ref<ClientLayerState | null>(null)
  const resident = ref<ResidentStatus | null>(null)
  let started = false

  async function refreshState(): Promise<void> {
    if (!isTauri) return
    try {
      state.value = await commands.clientLayerState()
    } catch (e) {
      console.warn('[client-layer] state fetch failed:', e)
    }
  }

  async function refreshResident(): Promise<void> {
    if (!isTauri) return
    try {
      resident.value = await commands.coreResidentStatus()
    } catch (e) {
      console.warn('[client-layer] resident status failed:', e)
    }
  }

  /** 常設のコンポーネント (ナビバー) から 1 回だけ */
  function start(): void {
    if (started || !isTauri) return
    started = true
    void refreshState()
    void listenTauri('nd:client-layer-state', (s) => {
      state.value = s
    })
  }

  /** 今のプロセスが AI 系を別プロセスの notemaid に中継しているか */
  const isResident = computed(() => state.value?.backend === 'resident')

  /** 「アプリを閉じても AI を動かす」を切り替える (再起動不要) */
  async function setResident(enabled: boolean): Promise<void> {
    state.value = unwrap(await commands.coreSetResident(enabled))
    await refreshResident()
  }

  /** 口座が変わったとき、別プロセスの notemaid に一覧を写し直す */
  async function syncAccounts(): Promise<void> {
    if (!isTauri) return
    try {
      await commands.coreSyncAccounts()
    } catch (e) {
      console.warn('[client-layer] account sync failed:', e)
    }
  }

  return {
    state,
    resident,
    isResident,
    refreshState,
    refreshResident,
    start,
    setResident,
    syncAccounts,
  }
})
