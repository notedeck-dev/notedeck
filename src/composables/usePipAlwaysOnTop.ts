import { ref } from 'vue'

/**
 * PiP ウィンドウの「最前面に固定」状態。
 *
 * PiP は 1 枚ごとに別 WebView = 別 JS realm なので、module 変数がそのまま
 * このウィンドウ 1 枚分の状態になる（＝ PiP ごとに独立して切り替えられる）。
 * 生成時は最前面固定で開くため初期値は true（usePipWindow の alwaysOnTop と対）。
 */
const alwaysOnTop = ref(true)

export function usePipAlwaysOnTop() {
  async function toggle(): Promise<void> {
    const next = !alwaysOnTop.value
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().setAlwaysOnTop(next)
      alwaysOnTop.value = next
    } catch {
      // 適用できなかったときは表示も変えない（実際のウィンドウとずらさない）
    }
  }

  return { alwaysOnTop, toggle }
}
