import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { events, type SystemState } from '@/bindings'
import {
  deriveAdaptation,
  describeAdaptationEntry,
  NO_ADAPTATION,
} from '@/services/systemAdaptation'
import { useSettingsStore } from '@/stores/settings'
import { useToast } from '@/stores/toast'
import { useUiStore } from '@/stores/ui'
import { setEmojiStaticMode } from '@/utils/mediaProxy'
import { commands, unwrap } from '@/utils/tauriInvoke'

const UNKNOWN: SystemState = {
  onBattery: null,
  lowPowerMode: null,
  metered: null,
  doNotDisturb: null,
}

/**
 * OS の電源・回線・集中モード状態 (#931 / #935 / #928)。
 * Rust の `system_state.rs` が観測して変化時に `SystemState` event で配る。
 * ここは購読 + 現在値 + 「何を落とすか」(`services/systemAdaptation.ts`) の
 * 導出だけ。各消費側 (先読み / 絵文字 URL / メディアグリッド / 通知音) は
 * `adaptation` を読む。
 */
export const useSystemStateStore = defineStore('systemState', () => {
  const state = ref<SystemState>(UNKNOWN)
  const settingsStore = useSettingsStore()

  /** 電源・回線の状態に合わせて自動調整する (既定 ON)。`settings.json5` `system.autoAdapt` */
  const autoAdapt = computed<boolean>({
    get: () => settingsStore.get('system.autoAdapt') !== false,
    set: (v) => {
      settingsStore.set('system.autoAdapt', v)
    },
  })

  // ウィンドウが隠れている (#986) は Rust ではなく `useAppBackground` が観測し、
  // ui store に置く。同じ思想の別トリガーなので判断はここに合流させる
  const uiStore = useUiStore()
  const adaptation = computed(() =>
    deriveAdaptation(state.value, autoAdapt.value, uiStore.isBackground),
  )

  // 絵文字 URL の組み立ては util (mediaProxy.ts) にあり store を見ないので、
  // こちらから押し込む
  watch(
    () => adaptation.value.staticEmoji,
    (v) => setEmojiStaticMode(v),
    { immediate: true },
  )

  // 自動で落ちたことに気付けないと不具合に見える (#931) ので、入るときだけ知らせる
  watch(adaptation, (next, prev) => {
    const text = describeAdaptationEntry(
      prev ?? NO_ADAPTATION,
      next,
      state.value,
    )
    if (text) useToast().show(text, 'info')
  })

  let unlisten: (() => void) | null = null

  /** main window で 1 回だけ呼ぶ。listen を先に張ってから初期値を取る (取りこぼし防止) */
  async function start(): Promise<void> {
    if (unlisten) return
    unlisten = await events.systemState.listen(({ payload }) => {
      state.value = payload
    })
    try {
      state.value = unwrap(await commands.systemStateGet())
    } catch {
      // backend 未起動 (ブラウザ開発時) は全項目 null のまま = 通常どおり
    }
  }

  function stop(): void {
    unlisten?.()
    unlisten = null
  }

  return { state, autoAdapt, adaptation, start, stop }
})
