/**
 * HEARTBEAT の「最後の巡回」(#1321)。notemaid の観測値 (`heartbeat_status`) をモジュール単位で
 * 共有し、初回に読み、tick の開始 / 終了 (`nd:ai-heartbeat-event`) で読み直す。event は全窓に
 * 届くので代表窓に限らない。代表窓の副作用 (通知 / ペット / OS 通知) は `useHeartbeatDaemon`
 * で、ここは表示の写しだけ。AI 設定 / About / DevDashboard が読む
 */

import type { UnlistenFn } from '@tauri-apps/api/event'
import { type Ref, ref } from 'vue'
import type { HeartbeatProbeResult, HeartbeatStatus } from '@/bindings'
import { isTauri } from '@/utils/settingsFs'
import { listenTauri } from '@/utils/tauriEvents'
import { commands, unwrap } from '@/utils/tauriInvoke'

const _status: Ref<HeartbeatStatus | null> = ref(null)
const _loading = ref(false)
let _started = false
let _unlisten: UnlistenFn | null = null
/** 最後に出した読取の番号。古い読取が後から返っても捨てる (開始と終了の読取が入れ替わらない) */
let _seq = 0

async function refresh(): Promise<void> {
  if (!isTauri) return
  const seq = ++_seq
  _loading.value = true
  try {
    const next = unwrap(await commands.heartbeatStatus())
    if (seq === _seq) _status.value = next
  } catch (e) {
    console.warn('[heartbeat] status read failed:', e)
  } finally {
    if (seq === _seq) _loading.value = false
  }
}

/**
 * 「今すぐ巡回する」(#1321): 無効でも走り、cheap check を飛ばし、連続失敗と日次に数えない。
 * notemaid は実行中の印を取って即返す (結果は event と状態で見る)。実行中なら Err
 */
async function triggerNow(): Promise<void> {
  unwrap(await commands.heartbeatTriggerNow())
  await refresh()
}

/**
 * 「この接続を試す」(#1321): 通常の tick と同じ組み立ての prompt で 1 巡だけ回し、報告の tool を
 * 呼べるかだけを見る。報告先への書込 / 通知は起きない。予算は消費する。結果を待って返す
 */
async function probe(): Promise<HeartbeatProbeResult> {
  try {
    return unwrap(await commands.heartbeatProbe())
  } finally {
    void refresh()
  }
}

export function useHeartbeatStatus() {
  if (!_started) {
    _started = true
    void refresh()
    if (isTauri) {
      void listenTauri('nd:ai-heartbeat-event', (ev) => {
        // 試走も started / finished を流す。scheduled は timer の組み直し (次回の予定時刻)
        if (
          ev.kind === 'started' ||
          ev.kind === 'finished' ||
          ev.kind === 'scheduled'
        )
          void refresh()
      }).then((un) => {
        _unlisten = un
      })
    }
  }
  return { status: _status, loading: _loading, refresh, triggerNow, probe }
}

/** @internal テスト用 */
export function _resetHeartbeatStatusForTest(): void {
  _status.value = null
  _loading.value = false
  _started = false
  _unlisten?.()
  _unlisten = null
}
