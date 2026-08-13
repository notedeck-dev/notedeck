/**
 * 「全アカウント」カラムからアカウント必須の操作を起こすときのアカウント選択
 * (#1018)。
 *
 * 全アカウントのカラムは accountId を持たないので、そこから認証必須の操作を
 * 始めるとアクティブアカウントへ暗黙にフォールバックするか、単に呼べなくなる
 * かのどちらかだった。どちらのサーバーに対する操作かをその場で決めさせる。
 *
 * 選ばせ方はレイアウトで変える。デスクトップは既に「候補を絞って選ぶ」場所が
 * コマンドパレットにあるのでそれに乗せ、コンパクト表示ではパレットが画面を
 * 占有してしまうためボトムシート (AccountPickerSheet) を使う。どちらもアバターに
 * サーバーバッジを出す。
 *
 * シートは呼び出し側のテンプレートに置く — `sheetPurpose` が非 null の間だけ
 * 開き、選択 / キャンセルを `resolveSheet` に渡すと pickAccount が解決する。
 */

import { computed, ref, watch } from 'vue'
import { useCommandStore } from '@/commands/registry'
import {
  getAccountAvatarUrl,
  getAccountLabel,
  useAccountsStore,
} from '@/stores/accounts'
import { useIsCompactLayout } from '@/stores/ui'

export function useAccountPicker() {
  const commandStore = useCommandStore()
  const isCompact = useIsCompactLayout()

  /**
   * 認証必須の操作に使えるアカウント。
   * (ゲストはトークンを持たないのでここに入らない)
   */
  const pickableAccounts = computed(() =>
    useAccountsStore().accounts.filter((a) => a.hasToken),
  )

  /** 選べる相手が 1 つでもあるか。install 可否の判定などに使う */
  const hasPickableAccount = computed(() => pickableAccounts.value.length > 0)

  /**
   * 操作に使うアカウントを選ばせる。キャンセル・候補なしは null。
   * 候補が 1 つだけなら選ぶ余地がないのでそのまま返す (何も出さない)。
   *
   * @param purpose 何のために選ぶのか (選択 UI に出す)
   */
  async function pickAccount(purpose: string): Promise<string | null> {
    const accounts = pickableAccounts.value
    const only = accounts[0]
    if (!only) return null
    if (accounts.length === 1) return only.id

    if (isCompact.value) return pickViaSheet(purpose)
    return pickViaPalette(purpose)
  }

  /** シートを開いている間の目的文 (= 開いているかどうか) */
  const sheetPurpose = ref<string | null>(null)
  let sheetResolve: ((accountId: string | null) => void) | null = null

  function pickViaSheet(purpose: string): Promise<string | null> {
    return new Promise((resolve) => {
      sheetResolve = resolve
      sheetPurpose.value = purpose
    })
  }

  /** シートの選択 / キャンセルを pickAccount 側へ返す */
  function resolveSheet(accountId: string | null) {
    sheetPurpose.value = null
    sheetResolve?.(accountId)
    sheetResolve = null
  }

  function pickViaPalette(purpose: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      let settled = false
      const finish = (id: string | null) => {
        if (settled) return
        settled = true
        stopWatch()
        resolve(id)
      }

      commandStore.open()
      commandStore.pushQuickPick({
        title: 'アカウントを選択',
        placeholder: purpose,
        items: pickableAccounts.value.map((a) => ({
          id: `pick-account-${a.id}`,
          label: getAccountLabel(a),
          icon: 'user',
          avatarUrl: getAccountAvatarUrl(a),
          serverHost: a.host,
          action: () => finish(a.id),
        })),
      })

      // パレットが閉じられた = 選ばずにやめた。選択時は CommandPalette が
      // close してから action を呼ぶが、watch は後から流れるので取りこぼさない
      // (settled で二重解決を防ぐ)
      const stopWatch = watch(
        () => commandStore.isOpen,
        (open) => {
          if (!open) finish(null)
        },
      )
    })
  }

  return {
    pickAccount,
    pickableAccounts,
    hasPickableAccount,
    sheetPurpose,
    resolveSheet,
  }
}
