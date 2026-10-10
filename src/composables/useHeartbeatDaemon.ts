/**
 * HEARTBEAT (#411) のデバイス側 (#1133 縦切り 5)。
 *
 * daemon の本体 (skill 選択 / cheap check / 日次上限 / AI 呼び出し / 応答契約 /
 * 報告先への書込 / 失敗の数え方) は notecore (`crates/notecore/src/heartbeat.rs`)。
 * ここに残るのは
 *
 * - 設定 (enabled / intervalMinutes) を Rust の timer に伝える
 * - notecore の出来事 (`nd:ai-heartbeat-event`) をデバイスに反映する:
 *   報告先セッションの写しの読み直し、アプリの通知 (受信トレイに残し、押せば
 *   該当の AI セッション / AI 設定の HEARTBEAT を開く, #1165)、OS 通知、ペットの活動表示
 * - アプリを閉じている間に届いた報告を、次に開いたときにアプリの通知へ 1 件にまとめて出す
 *
 * App.vue で 1 回だけ mount する (PiP では mount しない = main window だけ)。
 */

import type { UnlistenFn } from '@tauri-apps/api/event'
import { onScopeDispose, watch } from 'vue'
import { i18n } from '@/i18n'
import { localizeNative } from '@/i18n/native'
import { summarizeHeartbeatAway } from '@/services/heartbeatAway'
import { useAiActivity } from '@/stores/aiActivity'
import { useAiSessionsStore } from '@/stores/aiSessions'
import { useDeckStore } from '@/stores/deck'
import { useToast } from '@/stores/toast'
import { useWindowsStore } from '@/stores/windows'
import { sendDesktopNotification } from '@/utils/desktopNotification'
import { readSafeMode } from '@/utils/safeMode'
import { isTauri } from '@/utils/settingsFs'
import {
  getStorageString,
  removeStorage,
  STORAGE_KEYS,
  setStorageString,
} from '@/utils/storage'
import { listenTauri } from '@/utils/tauriEvents'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { useAiConfig } from './useAiConfig'

export function useHeartbeatDaemon() {
  // セーフモード (#794) — 常駐して AI 推論を回す daemon なので、第三者コードと
  // 同格に止める。Rust の timer への configure も listen も行わない
  if (readSafeMode()) return

  const { config, initialized } = useAiConfig()
  const sessions = useAiSessionsStore()
  const toast = useToast()
  const activity = useAiActivity()
  let endRunning: (() => void) | null = null
  let unlisten: UnlistenFn | null = null

  /** 該当の AI セッションを AI カラムで開く。消えていればそう知らせる */
  async function openSession(sessionId: string): Promise<void> {
    await sessions.loadAllMeta()
    if (!sessions.get(sessionId)) {
      toast.show(i18n.ts._useHeartbeatDaemon.sessionMissing, 'warning', {
        source: 'HEARTBEAT',
      })
      return
    }
    useDeckStore().openAiSession(sessionId)
  }

  function openHeartbeatSettings(): void {
    useWindowsStore().open('aiSettings', {
      section: 'heartbeat',
      revealAt: Date.now(),
    })
  }

  /** アプリの通知に出す。押せば開く先があるので、情報でも受信トレイに残る */
  function notice(
    text: string,
    type: 'info' | 'warning',
    onClick: () => void,
  ): void {
    toast.show(text, type, { source: 'HEARTBEAT', onClick })
  }

  // --- 閉じている間の報告 (#1165) ---
  // 「最後に見た時刻」を端末に持ち、次に開いたときにそれより後の報告を数える。
  // HEARTBEAT が有効な間だけ持つ (無効なら閉じている間に報告は来ないので、起動時に
  // 全セッションを読む手間も掛けない)
  function markSeen(): void {
    setStorageString(STORAGE_KEYS.heartbeatLastSeenAt, String(Date.now()))
  }

  async function announceAway(): Promise<void> {
    const raw = getStorageString(STORAGE_KEYS.heartbeatLastSeenAt)
    const since = raw == null ? Number.NaN : Number(raw)
    if (Number.isFinite(since)) {
      await sessions.loadAllMeta()
      const away = summarizeHeartbeatAway(
        [...sessions.sessions.values()],
        since,
      )
      if (away) {
        const text =
          away.reports > 0 && away.pending > 0
            ? i18n.tsx._useHeartbeatDaemon.awayReportsAndPending({
                count: away.reports,
                pending: away.pending,
              })
            : away.reports > 0
              ? i18n.tsx._useHeartbeatDaemon.awayReports_plural({
                  count: away.reports,
                })
              : i18n.tsx._useHeartbeatDaemon.awayPending_plural({
                  count: away.pending,
                })
        notice(text, 'info', () => void openSession(away.sessionId))
      }
    }
    if (config.value.heartbeat.enabled) markSeen()
    else removeStorage(STORAGE_KEYS.heartbeatLastSeenAt)
  }

  if (isTauri) {
    watch(
      initialized,
      (ready, _prev, onCleanup) => {
        if (!ready) return
        void announceAway()
        // 以後の有効 / 無効の切り替えに追従する
        const stop = watch(
          () => config.value.heartbeat.enabled,
          (enabled) => {
            if (enabled) markSeen()
            else removeStorage(STORAGE_KEYS.heartbeatLastSeenAt)
          },
        )
        onCleanup(stop)
      },
      { immediate: true },
    )
  }

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
        case 'report': {
          // notecore が報告先セッションを書いた → そのセッションだけ読み直す
          const sessionId = ev.sessionId
          if (!sessionId) return
          void sessions.reload(sessionId)
          // 開いている間に届いたものは、次に開いたときのまとめに数えない
          if (config.value.heartbeat.enabled) markSeen()
          const pending = ev.pending ?? 0
          if (pending > 0) {
            notice(
              i18n.tsx._useHeartbeatDaemon.pending_plural({ count: pending }),
              'info',
              () => void openSession(sessionId),
            )
          }
          return
        }
        case 'titled':
          if (ev.sessionId) void sessions.reload(ev.sessionId)
          return
        case 'notify': {
          // AI が「通知して」とした報告。受信トレイには必ず残し、OS 通知は
          // 「デスクトップ通知」が on のときだけ (フォーカス中は送り先で抑制される)
          const sessionId = ev.sessionId
          notice(ev.body ?? '', 'info', () => {
            if (sessionId) void openSession(sessionId)
          })
          if (ev.desktop) {
            sendDesktopNotification(ev.title ?? 'HEARTBEAT', ev.body ?? '')
          }
          return
        }
        case 'toast':
          // 自動停止・失敗・上限の知らせ。押せば AI 設定の HEARTBEAT を開く。
          // notecore の文言は英語の正本文 + 辞書の手がかり。表示言語で描き直す
          notice(
            localizeNative(ev).text ?? '',
            ev.level === 'warning' ? 'warning' : 'info',
            openHeartbeatSettings,
          )
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
