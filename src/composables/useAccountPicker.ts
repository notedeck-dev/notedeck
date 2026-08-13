/**
 * 「全アカウント」カラムからアカウント必須の操作を起こすときのアカウント選択
 * (#1018)。
 *
 * 全アカウントのカラムは accountId を持たないので、そこから認証必須の操作を
 * 始めるとアクティブアカウントへ暗黙にフォールバックするか、単に呼べなくなる
 * かのどちらかだった。どちらのサーバーに対する操作かをその場で決めさせる。
 */

import { computed } from 'vue'
import { getAccountLabel, useAccountsStore } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'

const CANCEL = '__cancel'

export function useAccountPicker() {
  const { confirmWithAction } = useConfirm()

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
   * 候補が 1 つだけなら選ぶ余地がないのでそのまま返す (ダイアログを出さない)。
   *
   * @param purpose 何のために選ぶのか (ダイアログ本文に出す)
   */
  async function pickAccount(purpose: string): Promise<string | null> {
    const accounts = pickableAccounts.value
    const only = accounts[0]
    if (!only) return null
    if (accounts.length === 1) return only.id

    const action = await confirmWithAction({
      title: 'アカウントを選択',
      message: purpose,
      icon: 'question',
      actions: [
        ...accounts.map((a) => ({ value: a.id, label: getAccountLabel(a) })),
        { value: CANCEL, label: 'キャンセル', cancel: true },
      ],
    })
    return action && action !== CANCEL ? action : null
  }

  return { pickAccount, pickableAccounts, hasPickableAccount }
}
