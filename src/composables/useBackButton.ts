import { onUnmounted, type Ref, watch } from 'vue'
import { pushOverlay } from '@/utils/overlayBackStack'

export { pushOverlay }

/**
 * Composable: ref を監視して overlay を自動登録/解除する。
 * Android back button / gesture でオーバーレイ UI を閉じる。
 */
export function useBackButton(overlayRef: Ref<boolean>, close: () => void) {
  let unregister: (() => void) | null = null

  watch(overlayRef, (open) => {
    if (open) {
      unregister = pushOverlay(close)
    } else {
      unregister?.()
      unregister = null
    }
  })

  onUnmounted(() => {
    unregister?.()
    unregister = null
  })
}
