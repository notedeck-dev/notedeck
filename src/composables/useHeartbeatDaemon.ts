/**
 * HEARTBEAT (#411) のデバイス側 (#1133 縦切り 5)。
 *
 * daemon の本体 (skill 選択 / cheap check / 日次上限 / AI 呼び出し / 応答契約 /
 * 報告先への書込 / 失敗の数え方) は notecore (`crates/notecore/src/heartbeat.rs`)。
 * ここに残るのは
 *
 * - 設定 (enabled / intervalMinutes) を Rust の timer に伝える
 * - notecore の出来事 (`nd:ai-heartbeat-event`) をデバイスに反映する:
 *   報告先セッションの写しの読み直し、OS 通知、toast、ペットの活動表示
 *
 * App.vue で 1 回だけ mount する (PiP では mount しない = main window だけ)。
 */

import type { UnlistenFn } from '@tauri-apps/api/event'
import { onScopeDispose, watch } from 'vue'
import { useAiActivity } from '@/stores/aiActivity'
import { useAiSessionsStore } from '@/stores/aiSessions'
import { useToast } from '@/stores/toast'
import { sendDesktopNotification } from '@/utils/desktopNotification'
import { readSafeMode } from '@/utils/safeMode'
import { isTauri } from '@/utils/settingsFs'
import { listenTauri } from '@/utils/tauriEvents'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { useAiConfig } from './useAiConfig'

export function useHeartbeatDaemon() {
  // セーフモード (#794) — 常駐して AI 推論を回す daemon なので、第三者コードと
  // 同格に止める。Rust の timer への configure も listen も行わない
  if (readSafeMode()) return

  const { config } = useAiConfig()
  const sessions = useAiSessionsStore()
  const toast = useToast()
  const activity = useAiActivity()
  let endRunning: (() => void) | null = null
  let unlisten: UnlistenFn | null = null

  async function configureScheduler(intervalMinutes: number): Promise<void> {
    if (!isTauri) return
    try {
      unwrap(await commands.heartbeatConfigure(intervalMinutes))
    } catch (e) {
      console.warn('[heartbeat] configure failed:', e)
    }
  }

  async function unconfigureScheduler(): Promise<void> {
    if (!isTauri) return
    try {
      unwrap(await commands.heartbeatUnconfigure())
    } catch (e) {
      console.warn('[heartbeat] unconfigure failed:', e)
    }
  }

  // 設定 → Rust の timer (変更のたびに replace。冪等)
  watch(
    () => ({
      enabled: config.value.heartbeat.enabled,
      interval: config.value.heartbeat.intervalMinutes,
    }),
    async (next) => {
      if (next.enabled) {
        await configureScheduler(next.interval)
      } else {
        await unconfigureScheduler()
      }
    },
    { immediate: true, deep: true },
  )

  // notecore の出来事 → デバイスの反映
  ;(async () => {
    if (!isTauri) return
    unlisten = await listenTauri('nd:ai-heartbeat-event', (ev) => {
      switch (ev.kind) {
        case 'started':
          endRunning?.()
          endRunning = activity.begin('running')
          activity.pulse('jumping')
          return
        case 'finished':
          endRunning?.()
          endRunning = null
          if (ev.outcome === 'reported') activity.pulse('waving')
          else if (ev.outcome === 'error') activity.pulse('failed')
          return
        case 'report':
        case 'titled':
          // notecore が報告先セッションを書いた → そのセッションだけ読み直す
          if (ev.sessionId) void sessions.reload(ev.sessionId)
          return
        case 'notify':
          // アプリにフォーカスがあるときは sendDesktopNotification 内で抑制される
          sendDesktopNotification(ev.title ?? 'HEARTBEAT', ev.body ?? '')
          return
        case 'toast':
          toast.show(ev.text ?? '', ev.level === 'warning' ? 'warning' : 'info')
          return
        default:
          return
      }
    })
  })()

  onScopeDispose(() => {
    if (unlisten) unlisten()
    endRunning?.()
    void unconfigureScheduler()
  })
}
