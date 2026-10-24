import { watch } from 'vue'
import { i18n } from '@/i18n'
import { getAccountLabel, useAccountsStore } from '@/stores/accounts'
import { useToast } from '@/stores/toast'
import { useUiStore } from '@/stores/ui'
import { useWindowsStore } from '@/stores/windows'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * push の登録し直しの知らせ (#330、Android)。起動時と復帰時に Rust 側の突き合わせ
 * (以前の版からの移行・後始末の再試行・送り先とサーバーの変化の検出) を走らせ、
 * 登録し直しが要る口座をアプリの通知 (受信トレイ) に出す。押すとそのサーバーの登録の
 * 窓を開く。同じ口座はアプリを開いている間に 1 回だけ知らせ、直ったら忘れる。
 */
export function usePushAttention() {
  const uiStore = useUiStore()
  if (!uiStore.isMobilePlatform) return
  const accountsStore = useAccountsStore()
  const toast = useToast()
  const notified = new Set<string>()

  async function check() {
    let ids: string[]
    try {
      ids = unwrap(await commands.pushAttention())
    } catch {
      // 次の復帰でもう一度試す
      return
    }
    for (const id of [...notified]) {
      if (!ids.includes(id)) notified.delete(id)
    }
    for (const id of ids) {
      if (notified.has(id)) continue
      const account = accountsStore.accounts.find((a) => a.id === id)
      if (!account) continue
      notified.add(id)
      toast.show(
        i18n.tsx._pushRegister.attention({ user: getAccountLabel(account) }),
        'warning',
        {
          onClick: () =>
            useWindowsStore().open('push-register', { host: account.host }),
        },
      )
    }
  }

  // 口座の一覧が読めてから 1 回目を走らせる (起動直後はまだ空のことがある)
  watch(
    () => accountsStore.accounts.length > 0,
    (loaded) => {
      if (loaded) void check()
    },
    { immediate: true },
  )
  watch(
    () => uiStore.deckResumeSignal,
    () => void check(),
  )
}
