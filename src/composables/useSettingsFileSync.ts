/**
 * 設定ファイルの変更通知を購読し、`services/settingsFileSync` の配線表に配る。
 * 書き手は 2 つあり、どちらも同じ配線表に落とす:
 *
 * - notecore (`nd:settings-file-changed`, #1133): Rust が全ウィンドウへ流す
 * - 他のウィンドウ (`nd:settings-file-written`, #1042): 書いたウィンドウが
 *   JS → JS で流す。自分の書込は自分の写しを自分で更新しているので捨てる
 *
 * 購読は 1 ウィンドウ 1 回 (App.vue)。
 */

import { dispatchSettingsChange } from '@/services/settingsFileSync'
import { isTauri, SETTINGS_FS_SOURCE_ID } from '@/utils/settingsFs'
import { listenTauri } from '@/utils/tauriEvents'

export {
  registerSettingsFileHandler,
  type SettingsFileHandler,
} from '@/services/settingsFileSync'

let started = false

/** 変更通知の購読を始める (1 ウィンドウ 1 回) */
export function startSettingsFileSync(): void {
  if (started || !isTauri) return
  started = true
  listenTauri('nd:settings-file-changed', (change) => {
    void dispatchSettingsChange(change)
  }).catch((e) => console.warn('[settings-sync] listen failed:', e))
  listenTauri('nd:settings-file-written', ({ sourceId, change }) => {
    if (sourceId === SETTINGS_FS_SOURCE_ID) return
    void dispatchSettingsChange(change)
  }).catch((e) => console.warn('[settings-sync] listen failed:', e))
}
