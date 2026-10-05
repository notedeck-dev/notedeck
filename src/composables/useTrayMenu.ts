import { getCurrentWindow } from '@tauri-apps/api/window'
import { computed, watch } from 'vue'
import { useAiConfig } from '@/composables/useAiConfig'
import { i18n } from '@/i18n'
import { trayMenuState } from '@/services/trayMenu'
import { useClientLayerStore } from '@/stores/clientLayer'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { useRealtimeModeStore } from '@/stores/realtimeMode'
import { useToast } from '@/stores/toast'
import { listenTauri } from '@/utils/tauriEvents'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * システムトレイのメニューを設定に追従させる (#1174)。
 *
 * 文言 (表示言語) とチェック状態 (オフライン / リアルタイム / HEARTBEAT / 常駐) の
 * 正本はフロントの store にあるので、変わるたびに Rust へ押し込む。トレイからの
 * 切り替えはイベントで届き、設定画面と同じ store を動かす (2 つ目の設定を作らない)。
 * トレイは OS 全体で 1 つなので main ウィンドウだけが持つ。
 */
export function useTrayMenu() {
  if (getCurrentWindow().label !== 'main') return

  const offline = useOfflineModeStore()
  const realtime = useRealtimeModeStore()
  const clientLayer = useClientLayerStore()
  const { config, save, initialized } = useAiConfig()
  const toast = useToast()

  clientLayer.start()
  void clientLayer.refreshResident()

  const state = computed(() =>
    trayMenuState({
      labels: {
        show: i18n.ts._tray.show,
        offline: i18n.ts._tray.offline,
        realtime: i18n.ts._tray.realtime,
        heartbeat: i18n.ts._tray.heartbeat,
        resident: i18n.ts._tray.resident,
        quit: i18n.ts._tray.quit,
      },
      offline: offline.isOfflineMode,
      realtime: realtime.enabled,
      heartbeatEnabled: config.value.heartbeat.enabled,
      residentInstalled: clientLayer.resident?.installed ?? false,
      relayed: clientLayer.isResident,
      residentAvailable: clientLayer.resident?.available ?? false,
    }),
  )

  watch(
    state,
    async (next) => {
      try {
        unwrap(await commands.traySync(next))
      } catch (e) {
        console.warn('[tray] sync failed:', e)
      }
    },
    { immediate: true },
  )

  /**
   * OS はクリックした時点でチェックを反転させるので、状態を変えずに終わる経路
   * (無視 / 失敗) では今の状態を押し戻す (computed が変わらず watch が走らないため)
   */
  function resync(): void {
    commands.traySync(state.value).catch((e) => {
      console.warn('[tray] sync failed:', e)
    })
  }

  void listenTauri('nd:toggle-heartbeat', () => {
    // ai.json5 を読み終える前に押されたら、既定値で上書きしないよう無視する
    if (!initialized.value) {
      resync()
      return
    }
    config.value.heartbeat.enabled = !config.value.heartbeat.enabled
    // 設定画面が開いていないと deep watch の保存が無いので、ここで書く
    save()
  })

  void listenTauri('nd:toggle-ai-resident', async () => {
    if (!state.value.residentEnabled) {
      resync()
      return
    }
    try {
      await clientLayer.setResident(!(clientLayer.resident?.installed ?? false))
    } catch (e) {
      toast.show(
        typeof e === 'object' && e !== null && 'message' in e
          ? String((e as { message: unknown }).message)
          : String(e),
        'error',
      )
      await clientLayer.refreshResident()
      resync()
    }
  })
}
