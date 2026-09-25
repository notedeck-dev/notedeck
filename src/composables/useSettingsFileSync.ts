/**
 * notecore の `nd:settings-file-changed` を購読し、`services/settingsFileSync` の
 * 配線表に配る (#1133)。全ウィンドウに届くので、PiP など別ウィンドウの store も
 * 追従する。購読は 1 ウィンドウ 1 回 (App.vue)。
 */

import { dispatchSettingsChange } from '@/services/settingsFileSync'
import { isTauri } from '@/utils/settingsFs'
import { listenTauri } from '@/utils/tauriEvents'

export {
  registerSettingsFileHandler,
  type SettingsFileHandler,
} from '@/services/settingsFileSync'

let started = false

/** notecore の変更通知の購読を始める (1 ウィンドウ 1 回) */
export function startSettingsFileSync(): void {
  if (started || !isTauri) return
  started = true
  listenTauri('nd:settings-file-changed', (change) => {
    void dispatchSettingsChange(change)
  }).catch((e) => console.warn('[settings-sync] listen failed:', e))
}
