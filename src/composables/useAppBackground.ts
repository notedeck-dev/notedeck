import { onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/ui'

/**
 * ウィンドウが隠れ続けてから background とみなすまでの猶予。
 * 一瞬の最小化 ⇄ 復帰で購読の解除 / 再購読をフラップさせない。
 */
export const BACKGROUND_GRACE_MS = 60_000

/**
 * アプリ単位の background 判定 (#986)。`useDeckResume` (復帰) の対になる
 * 「離脱」の発生源で、`uiStore.isBackground` に書く。
 *
 * ウィンドウの非表示・最小化・トレイ格納はいずれも WebView を不可視にするので
 * `document.hidden` で一様に検知できる (既存の復帰検知・未読ポーリング停止と
 * 同じシグナル)。OS ウィンドウイベントを OS ごとに配線するより単純。
 *
 * 何を落とすかは `services/systemAdaptation.ts` が決め、購読側はそちらを見る。
 * モバイルは OS がプロセスごと凍結するため対象外 (既存の復帰検知が担当)。
 */
export function useAppBackground() {
  const uiStore = useUiStore()
  let timer: ReturnType<typeof setTimeout> | null = null

  function clearTimer() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function onVisibilityChange() {
    if (uiStore.isMobilePlatform) return
    if (document.hidden) {
      if (timer || uiStore.isBackground) return
      timer = setTimeout(() => {
        timer = null
        // 猶予中に戻っていれば visibilitychange 側で clear 済み
        if (document.hidden) uiStore.isBackground = true
      }, BACKGROUND_GRACE_MS)
      return
    }
    clearTimer()
    uiStore.isBackground = false
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange)
    onVisibilityChange()
  })

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    clearTimer()
    uiStore.isBackground = false
  })
}
