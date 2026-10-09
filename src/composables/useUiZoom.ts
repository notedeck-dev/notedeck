import { getCurrentWebview } from '@tauri-apps/api/webview'
import { computed, watch } from 'vue'
import { clampUiZoom, stepUiZoom } from '@/services/uiZoom'
import { useSettingsStore } from '@/stores/settings'
import { isTauri } from '@/utils/settingsFs'

/**
 * UI ズーム (#704)。値は settings.json5 の `ui.zoom` が正本で、拡大・縮小・
 * 等倍はそこへ書くだけ。webview への適用は `applyUiZoom` が設定を見て行うので、
 * 他のウィンドウの操作も設定の同期で追従する。
 */
export function useUiZoom() {
  const settings = useSettingsStore()
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

/** 自分の webview に設定の拡大率を当て続ける。各ウィンドウで 1 回呼ぶ */
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
