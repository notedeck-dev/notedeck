/**
 * 開発者モードの読み書きと、初回の初期値解決 (#1034)。
 *
 * 露出の判定そのものは `@/settings/exposure` にある。ここはトグル操作と、
 * 「既存インストールは on / 新規は off」を一度だけ確定させる配線。
 */

import { computed, watch } from 'vue'
import { useAiConfig } from '@/composables/useAiConfig'
import { resolveDeveloperMode } from '@/services/developerMode'
import { useAccountsStore } from '@/stores/accounts'
import { useSettingsStore } from '@/stores/settings'
import { useToast } from '@/stores/toast'
import { readAiSettings } from '@/utils/settingsFs'

export function useDeveloperMode() {
  const settings = useSettingsStore()
  const enabled = computed(() => settings.get('ui.developerMode') === true)

  function setEnabled(value: boolean): void {
    settings.set('ui.developerMode', value)
    // HEARTBEAT は開発者モードと無関係に走り続ける。off にすると制御面 (エージェント
    // 設定) の入口が消えるので、動いていることを黙らせない (#1034)。停止は
    // 「NoteDeck について」の稼働バッジから行える
    if (!value && useAiConfig().config.value.heartbeat.enabled) {
      useToast().show(
        'HEARTBEAT は動作したままです。停止は「NoteDeck について」から',
        'info',
      )
    }
  }

  return { enabled, setEnabled, toggle: () => setEnabled(!enabled.value) }
}

/**
 * 未決定なら初期値を決めて保存する。決定済みなら何もしない。
 *
 * アカウントのロードを待つのは、既存インストールの判定に使う信号だから。
 * 待っている間は off として扱われるが、隠れるのは入口だけなので既存ユーザーの
 * デッキは変わらない。
 */
export async function initDeveloperMode(): Promise<void> {
  const settings = useSettingsStore()
  if (settings.get('ui.developerMode') !== undefined) return

  const accounts = useAccountsStore()
  if (!accounts.isLoaded) {
    await new Promise<void>((resolve) => {
      const stop = watch(
        () => accounts.isLoaded,
        (loaded) => {
          if (!loaded) return
          stop()
          resolve()
        },
      )
    })
  }

  let hasDeveloperArtifacts = false
  try {
    hasDeveloperArtifacts = (await readAiSettings()).trim().length > 0
  } catch {
    // ai.json5 が読めない = 使った痕跡なしとして扱う
  }

  settings.set(
    'ui.developerMode',
    resolveDeveloperMode(undefined, {
      hasAccounts: accounts.accounts.length > 0,
      hasDeveloperArtifacts,
    }),
  )
}
