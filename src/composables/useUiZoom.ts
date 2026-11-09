import { getCurrentWebview } from '@tauri-apps/api/webview'
import { computed, watch } from 'vue'
import { clampUiZoom, stepUiZoom } from '@/services/uiZoom'
import { useUiStateStore } from '@/stores/uiState'
import { isTauri } from '@/utils/settingsFs'

/**
 * UI ズーム (#704)。値はこの機械の状態 `state/ui.json5` の `ui.zoom` が正本で
 * (#1333 §3)、拡大・縮小・等倍はそこへ書くだけ。webview への適用は `applyUiZoom`
 * が状態を見て行うので、他のウィンドウの操作も状態の同期で追従する。
 */
export function useUiZoom() {
  const settings = useUiStateStore()
  const zoom = computed(() => clampUiZoom(settings.get('ui.zoom')))

  function set(value: number) {
    settings.set('ui.zoom', clampUiZoom(value))
  }

  return {
    zoom,
    zoomIn: () => set(stepUiZoom(zoom.value, 1)),
    zoomOut: () => set(stepUiZoom(zoom.value, -1)),
    reset: () => set(1),
  }
}

/** 自分の webview に保存された拡大率を当て続ける。各ウィンドウで 1 回呼ぶ */
export function applyUiZoom(): void {
  if (!isTauri) return
  const { zoom } = useUiZoom()
  watch(
    zoom,
    (z) => {
      getCurrentWebview()
        .setZoom(z)
        .catch((e) => console.warn('[ui-zoom] setZoom failed:', e))
    },
    { immediate: true },
  )
}
