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

/**
 * 権限不足 (PERMISSION_DENIED) の案内。要求する権限を後から増やしたとき、以前の
 * トークンのままの口座には再ログインしてもらう (例: `write:notifications` の
 * 「全部既読」)。失効ではないので、同じ口座への表示は失効の案内と同じく抑止する
 */
export function showPermissionReloginPrompt(accountId: string): void {
  const now = Date.now()
  const last = reloginPromptShownAt.get(accountId)
  if (last !== undefined && now - last < RELOGIN_PROMPT_DEDUPE_MS) return
  reloginPromptShownAt.set(accountId, now)
  const toast = useToast()
  const account = useAccountsStore().accounts.find((a) => a.id === accountId)
  if (!account) return
  const { relogin } = useAccountActions()
  toast.show(i18n.ts._useLoginPrompt.permissionMissing, 'warning', {
    action: {
      label: i18n.ts._common.relogin,
      onClick: () => relogin(account),
    },
  })
}
