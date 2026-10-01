/**
 * AI の人格と記憶 (#1162) のうち、カラム / ウィンドウが notemaid に聞く読取だけ。
 * ファイルの書き手は notemaid で、ここは RPC の写しを返すだけ (components は
 * IPC を直接叩かない — tests/lint/layerImports)。
 */

import { onMounted, onUnmounted, ref } from 'vue'
import { registerSettingsFileHandler } from '@/services/settingsFileSync'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * 新品のワークスペースに notemaid が置く BOOTSTRAP.md (first-run ritual) が
 * まだあるか。人格か記憶が変わるか「あなたのことを覚える」が OFF になると
 * notemaid が消すので、`notemaid` 配下の変更通知で読み直す。
 * notemaid に届かない (起動直後 / sidecar 停止中) ときは false。
 */
export function useBootstrapPending() {
  const pending = ref(false)

  async function refresh(): Promise<void> {
    try {
      const files = unwrap(await commands.maidWorkspaceList())
      pending.value = files.some((f) => f.kind === 'bootstrap' && f.exists)
    } catch {
      pending.value = false
    }
  }

  let unregister: (() => void) | null = null
  onMounted(() => {
    void refresh()
    unregister = registerSettingsFileHandler('notemaid', () => refresh())
  })
  onUnmounted(() => {
    unregister?.()
    unregister = null
  })

  return { pending, refresh }
}

/**
 * そのターンで notemaid が送った system prompt。notemaid は直近の数ターン分しか
 * メモリに残さないので、消えていれば null。ここでも保存しない。
 */
export async function fetchTurnSystem(turnId: string): Promise<string | null> {
  const v = unwrap(await commands.maidTurnSystem(turnId))
  return typeof v === 'string' ? v : null
}
