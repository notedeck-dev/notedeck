import { useVault } from '@/composables/useVault'
import { i18n } from '@/i18n'
import {
  type Account,
  accountScopeKey,
  getAccountLabel,
  isGuestAccount,
  useAccountsStore,
} from '@/stores/accounts'
import { useColumnQueriesStore } from '@/stores/columnQueries'
import { useConfirm } from '@/stores/confirm'
import { useDeckStore } from '@/stores/deck'
import { usePluginsStore } from '@/stores/plugins'
import { useStreamingStore } from '@/stores/streaming'
import { useThemeStore } from '@/stores/theme'
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
        i18n.tsx._useAccountActions.deleteAccountFailed({
          error: AppError.from(e).message,
        }),
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
    // プラグイン・クエリ・テーマのスコープ参加も同じ場所で外す (#1114)。
    // 「データを削除」は明示的な破棄で、ログアウト (残す) とは別の操作。
    // プラグイン・クエリの本体はライブラリに残り、テーマは紐付けが無くなる
    // ものだけ本体ごと消える (手動の「外す」と同じ)
    const key = accountScopeKey(acc)
    usePluginsStore().purgeAccount(key)
    useColumnQueriesStore().purgeAccount(key)
    // テーマは紐付け (安定キー) と per-account 適用キャッシュ (内部 ID) の両方を捨てる
    useThemeStore().purgeAccount(key, acc.id)
    // Secret Vault のアカウント専用接続 (内部 ID で紐付け) も slot の secret
    // ごと消す (#1121)。OS キーチェーン操作なので失敗しうるが、アカウント本体は
    // もう消えているので警告だけ出して終える
    try {
      await useVault().purgeAccount(acc.id)
    } catch (e) {
      const { useToast } = await import('@/stores/toast')
      useToast().show(
        i18n.tsx._useAccountActions.deleteVaultFailed({
          error: AppError.from(e).message,
        }),
        'warning',
      )
    }
  }

  /** ログアウト確認ダイアログを表示し実行する */
  async function logout(acc: Account) {
    if (isGuestAccount(acc)) {
      const ok = await confirm({
        title: i18n.ts._useAccountActions.deleteGuestTitle,
        message: i18n.ts._useAccountActions.confirmDeleteGuest,
        okLabel: i18n.ts._common.delete,
        type: 'danger',
      })
      if (ok) deleteAccountData(acc)
      return
    }
    const ok = await confirm({
      title: i18n.ts._common.logout,
      message: i18n.tsx._useAccountActions.confirmLogout({
        account: getAccountLabel(acc),
      }),
      okLabel: i18n.ts._common.logout,
      type: 'danger',
    })
    if (ok) logoutKeepData(acc)
  }

  /** データ全削除確認ダイアログを表示し実行する */
  async function deleteAccount(acc: Account) {
    const ok = await confirm({
      title: i18n.ts._common.deleteData,
      message: i18n.tsx._useAccountActions.confirmDeleteData({
        account: getAccountLabel(acc),
      }),
      okLabel: i18n.ts._common.delete,
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
