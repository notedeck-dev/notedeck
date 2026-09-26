import { useAccountActions } from '@/composables/useAccountActions'
import { i18n } from '@/i18n'
import { useAccountsStore } from '@/stores/accounts'
import { useToast } from '@/stores/toast'

export function showLoginPrompt(): void {
  const toast = useToast()
  toast.show(i18n.ts._useLoginPrompt.reloginToContinue, 'info')
}

// 短時間に複数カラムが同時に失効エラーを出すため、
// 同一アカウントへの表示をモジュールスコープでデデュープする
const reloginPromptShownAt = new Map<string, number>()
const RELOGIN_PROMPT_DEDUPE_MS = 60_000

/**
 * トークン失効時の再ログイン導線トースト (全カラム共通ハンドラ用)。
 * accountId から Account を解決できれば「再ログイン」action で
 * ログインウィンドウを開く。解決できなければ action 無しで案内のみ。
 */
export function showReloginPrompt(accountId?: string): void {
  const key = accountId ?? ''
  const now = Date.now()
  const last = reloginPromptShownAt.get(key)
  if (last !== undefined && now - last < RELOGIN_PROMPT_DEDUPE_MS) return
  reloginPromptShownAt.set(key, now)

  const toast = useToast()
  const account = accountId
    ? useAccountsStore().accounts.find((a) => a.id === accountId)
    : undefined
  if (account) {
    const { relogin } = useAccountActions()
    toast.show(i18n.ts._useLoginPrompt.sessionExpired, 'warning', {
      action: {
        label: i18n.ts._common.relogin,
        onClick: () => relogin(account),
      },
    })
  } else {
    toast.show(i18n.ts._useLoginPrompt.sessionExpiredUseMenu, 'warning')
  }
}
