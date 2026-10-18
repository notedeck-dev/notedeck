import { onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/ui'
import { startSleepDetector } from '@/utils/sleepDetector'

/**
 * デッキ復帰シグナル (deckResumeSignal) の発生源を一元管理する。
 *
 * 「復帰」は物理的に異なる 4 事象から起きるため検知は 4 系統あるが、
 * すべて同一の emitDeckResume() に合流し、下流 (ストリーム再接続 /
 * catch-up / タイマー掃除 / 失敗した同期の取り直し) は冪等なので多重発火は無害。
 *
 * 1. visibilitychange — ウィンドウの不可視 → 可視 (最小化・タブ切替からの復帰)
 * 2. 時刻ジャンプ (sleepDetector) — OS スリープ復帰 (#791)。ウィンドウが
 *    可視のまま復帰すると visibilitychange は発火しないため、これが唯一の
 *    検知手段。純 JS なので全プラットフォーム共通
 * 3. nd-app-resumed — Android ネイティブ (MainActivity.onResume) (#506)。
 *    pin 済み tauri-runtime-wry 2.10 が Event::Resumed を握り潰す間の
 *    暫定経路で、windowing 層の pin (#678) 解除後に削除できる
 * 4. online — OS の回線復帰 (#1260)。窓を前面に置いたまま Wi-Fi が戻った
 *    ときはこれが唯一の経路。隠れている間は可視化時の visibilitychange に任せる
 *
 * アプリ自身のオフラインモードの解除 (offlineMode store) も同じ信号を出す。
 */
export function useDeckResume() {
  const uiStore = useUiStore()
  let stopSleepDetector: (() => void) | null = null

  function onVisibilityChange() {
    if (!document.hidden) uiStore.emitDeckResume()
  }

  function onNativeResume() {
    uiStore.emitDeckResume()
  }

  function onOnline() {
    if (!document.hidden) uiStore.emitDeckResume()
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('nd-app-resumed', onNativeResume)
    window.addEventListener('online', onOnline)
    stopSleepDetector = startSleepDetector(() => {
      // hidden 中のジャンプ (背景タイマー間引き含む) は可視化時の
      // visibilitychange に任せる
      if (!document.hidden) uiStore.emitDeckResume()
    })
  })

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('nd-app-resumed', onNativeResume)
    window.removeEventListener('online', onOnline)
    stopSleepDetector?.()
  })
}
