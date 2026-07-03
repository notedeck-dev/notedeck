import {
  type Account,
  getAccountLabel,
  isGuestAccount,
  useAccountsStore,
} from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import { useDeckStore } from '@/stores/deck'
import { useStreamingStore } from '@/stores/streaming'
import { useWindowsStore } from '@/stores/windows'
import { AppError } from '@/utils/errors'
import { removeStorage, STORAGE_KEYS } from '@/utils/storage'

export function useAccountActions() {
  const accountsStore = useAccountsStore()
  const streamingStore = useStreamingStore()
  const deckStore = useDeckStore()
  const windowsStore = useWindowsStore()
  const { confirm } = useConfirm()

  function openProfile(acc: Account) {
    windowsStore.open('user-profile', { accountId: acc.id, userId: acc.userId })
  }

  async function openSettings(acc: Account) {
    // Misskey Web UI の設定ページを外部ブラウザで開くだけなので、
    // ログアウト中でもリンクとして機能させる。
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    openUrl(`https://${acc.host}/settings`)
  }

  async function openAdmin(acc: Account) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    openUrl(`https://${acc.host}/admin`)
  }

  /** トークンを無効化し、ローカルデータは保持する */
  function logoutKeepData(acc: Account) {
    streamingStore.disconnect(acc.id)
    accountsStore.logoutAccount(acc.id)
    removeStorage(STORAGE_KEYS.shellCache)
    removeStorage(STORAGE_KEYS.shellCacheVersion)
  }

  /** アカウントとカラムをすべて削除する */
  async function deleteAccountData(acc: Account) {
    for (const col of deckStore.columns) {
      if (col.accountId === acc.id) {
        deckStore.removeColumn(col.id)
      }
    }
    try {
      await accountsStore.removeAccount(acc.id)
    } catch (e) {
      // backend 削除に失敗したのに「カラムだけ消えて無言」にならないよう通知する
      const { useToast } = await import('@/stores/toast')
      useToast().show(
        `アカウント削除に失敗しました: ${AppError.from(e).message}`,
        'error',
      )
      return
    }
    removeStorage(STORAGE_KEYS.shellCache)
    removeStorage(STORAGE_KEYS.shellCacheVersion)
  }

  /** ログアウト確認ダイアログを表示し実行する */
  async function logout(acc: Account) {
    if (isGuestAccount(acc)) {
      const ok = await confirm({
        title: 'ゲストを削除',
        message: 'このゲストアカウントを削除しますか？',
        okLabel: '削除',
        type: 'danger',
      })
      if (ok) deleteAccountData(acc)
      return
    }
    const ok = await confirm({
      title: 'ログアウト',
      message: `${getAccountLabel(acc)} からログアウトしますか？\nローカルデータはこのデバイスに残ります。`,
      okLabel: 'ログアウト',
      type: 'danger',
    })
    if (ok) logoutKeepData(acc)
  }

  /** データ全削除確認ダイアログを表示し実行する */
  async function deleteAccount(acc: Account) {
    const ok = await confirm({
      title: 'データを削除',
      message: `${getAccountLabel(acc)} のローカルデータをすべて削除しますか？`,
      okLabel: '削除',
      type: 'danger',
    })
    if (ok) deleteAccountData(acc)
  }

  function relogin(acc: Account) {
    windowsStore.open('login', { initialHost: acc.host })
  }

  function addAccount() {
    windowsStore.open('login')
  }

  return {
    openProfile,
    openSettings,
    openAdmin,
    logoutKeepData,
    deleteAccountData,
    logout,
    deleteAccount,
    relogin,
    addAccount,
    isGuestAccount,
    getAccountLabel,
  }
}
