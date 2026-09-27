import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type {
  ClientLayerState,
  CoreStatus,
  MigrationSummary,
  SwitchBack,
} from '@/bindings'
import { isTauri } from '@/utils/settingsFs'
import { listenTauri } from '@/utils/tauriEvents'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * クライアント層の状態の写し (#1106 段階 3a)。
 *
 * `state` は今このプロセスがどちらのコア (埋め込み / 常駐の notecored) と話して
 * いるかと接続の様子 (`nd:client-layer-state` で更新)。`core` は切替導線の
 * 状態面 (望む構成 / notecored の所在 / unit / secret / 前回の失敗) で、
 * 「コア」ウィンドウが開いたときとアクションの後に読み直す。
 */
export const useClientLayerStore = defineStore('clientLayer', () => {
  const state = ref<ClientLayerState | null>(null)
  // daemon の生 JSON (再帰型) を deep に unwrap させない (型の展開が深くなりすぎる)。丸ごと差し替えるだけなので shallow で足りる
  const core = shallowRef<CoreStatus | null>(null)
  let started = false

  async function refreshState(): Promise<void> {
    if (!isTauri) return
    try {
      state.value = await commands.clientLayerState()
    } catch (e) {
      console.warn('[client-layer] state fetch failed:', e)
    }
  }

  async function refreshCore(): Promise<void> {
    if (!isTauri) return
    try {
      core.value = unwrap(await commands.coreStatus())
    } catch (e) {
      console.warn('[client-layer] core status failed:', e)
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

  /** 今のプロセスが常駐の notecored に中継しているか */
  const isResident = computed(() => state.value?.backend === 'resident')
  /** ナビバーに出す必要があるか (常駐か、前回の切替が完了していない) */
  const needsAttention = computed(
    () => isResident.value || !!state.value?.switchError,
  )

  /** 常駐へ (unit の用意 + 移行パッケージ + pending)。完了は再起動 */
  async function switchToResident(): Promise<MigrationSummary> {
    return unwrap(await commands.coreSwitchToResident())
  }

  /** 埋め込みへ戻す (常駐を止めて secret を取り戻す)。完了は再起動 */
  async function switchToEmbedded(): Promise<SwitchBack> {
    return unwrap(await commands.coreSwitchToEmbedded())
  }

  /** 切り替えの途中をやめる */
  async function cancelPending(): Promise<void> {
    unwrap(await commands.coreCancelPending())
  }

  return {
    state,
    core,
    isResident,
    needsAttention,
    refreshState,
    refreshCore,
    start,
    switchToResident,
    switchToEmbedded,
    cancelPending,
  }
})
