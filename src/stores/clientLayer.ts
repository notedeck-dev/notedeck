import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ClientLayerState } from '@/bindings'
import { isTauri } from '@/utils/settingsFs'
import { listenTauri } from '@/utils/tauriEvents'
import { commands } from '@/utils/tauriInvoke'

/**
 * クライアント層の状態の写し (#1106 案 B)。
 *
 * `state` は今このプロセスが AI 系のコマンドをどこに送っているか (この端末で回す /
 * 別プロセスの notemaid に中継) と接続の様子 (`nd:client-layer-state` で更新)。
 * データ面は常にこの端末で動くので、切替導線はここには無い (構成は client.json5)。
 */
export const useClientLayerStore = defineStore('clientLayer', () => {
  const state = ref<ClientLayerState | null>(null)
  let started = false

  async function refreshState(): Promise<void> {
    if (!isTauri) return
    try {
      state.value = await commands.clientLayerState()
    } catch (e) {
      console.warn('[client-layer] state fetch failed:', e)
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

  return { state, isResident, refreshState, start }
})
