import {
  type Account,
  accountScopeKey,
  getAccountLabel,
  isGuestAccount,
  useAccountsStore,
} from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import { useDeckStore } from '@/stores/deck'
import { useStreamingStore } from '@/stores/streaming'
import { useWindowsStore } from '@/stores/windows'
import { AppError } from '@/utils/errors'
import { purgeNotificationCacheForAccount } from '@/utils/notificationCache'
import { openSafeUrl, webUiUrl } from '@/utils/url'

export function useAccountActions() {
  const accountsStore = useAccountsStore()
  const streamingStore = useStreamingStore()
  const deckStore = useDeckStore()
  const windowsStore = useWindowsStore()
  const { confirm } = useConfirm()

  function openProfile(acc: Account) {
    windowsStore.open('user-profile', { accountId: acc.id, userId: acc.userId })
  }

  function openSettings(acc: Account) {
    // Misskey Web UI の設定ページを外部ブラウザで開くだけなので、
    // ログアウト中でもリンクとして機能させる。
    openSafeUrl(webUiUrl(acc.host, '/settings'))
  }

  function openAdmin(acc: Account) {
    openSafeUrl(webUiUrl(acc.host, '/admin'))
  }

  /** トークンを無効化し、ローカルデータは保持する */
  function logoutKeepData(acc: Account) {
    streamingStore.disconnect(acc.id)
    accountsStore.logoutAccount(acc.id)
  }

  /** アカウントとカラムをすべて削除する */
  async function deleteAccountData(acc: Account) {
    try {
      await accountsStore.removeAccount(acc.id)
    } catch (e) {
      // backend 削除に失敗したときは何も消さない。カラムだけ先に閉じていると
      // アカウントは残るのにカラムが消えた中途半端な状態になる (#1091)
      const { useToast } = await import('@/stores/toast')
      useToast().show(
        `アカウント削除に失敗しました: ${AppError.from(e).message}`,
        'error',
      )
      return
    }
    // カラムは backend 削除の成功後に閉じる (#1091、ウィジェットの #1061 と同じ)。
    // アカウントが消えてから閉じるまでの一瞬は DeckColumn の
    // 「アカウントが見つかりません」表示が受けるので、参照が残っても壊れない
    for (const col of [...deckStore.columns]) {
      if (col.accountId === acc.id) {
        deckStore.removeColumn(col.id)
      }
    }
    // 通知キャッシュは notecli DB ではなく localStorage なので個別に消す。
    // cross-account 通知カラムの分は該当アカウント entry のみ除去する
    purgeNotificationCacheForAccount(acc.id)
    // このアカウントに固定されたウィジェット個体はアカウントと運命を共にする
    // (#1061)。全アカウントカラムに置かれているので、参照を剥がしてから消す。
    // backend 削除の成功後に回す — ソースと Mk:save 領域の削除は不可逆で、
    // アカウントが残ったまま消えると復元できない
    deckStore.purgeAccountWidgets(accountScopeKey(acc))
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
