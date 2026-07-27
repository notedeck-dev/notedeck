import type { NormalizedNote } from '@/adapters/types'
import { useMultiAccountAdapters } from '@/composables/useMultiAccountAdapters'
import { resolveNoteFor } from '@/services/entityResolution'
import { getAccountLabel, useAccountsStore } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import { useToast } from '@/stores/toast'
import { AppError } from '@/utils/errors'

/** quoteAs の解決結果。呼び出し側が投稿フォームを開くのに使う */
export type QuoteAsTarget = { accountId: string; renoteId: string }

/**
 * 別アカウントからのノート操作 (#627): リアクション / リノート / 引用。
 *
 * 楽観更新は一切しない — `note.myReaction` / `note.reactions` /
 * `note.renoteCount` には触れず、反映は連合ストリーミングに任せる。
 */
export function useCrossAccountNoteActions() {
  const toast = useToast()
  const { confirm } = useConfirm()
  const { getOrCreate } = useMultiAccountAdapters()
  const accountsStore = useAccountsStore()

  function labelFor(accountId: string): string {
    const account = accountsStore.accountMap.get(accountId)
    return account ? getAccountLabel(account) : accountId
  }

  /** 共通骨格: 指定アカウント上の noteId へ解決。失敗時は code 別 toast を出して null */
  async function resolveTarget(
    accountId: string,
    note: NormalizedNote,
  ): Promise<string | null> {
    const resolved = await resolveNoteFor(accountId, note)
    if (resolved.ok) return resolved.noteId
    if (resolved.code === 'no_token') {
      toast.show('このアカウントでは操作できません（未ログイン）', 'error')
    } else if (resolved.code === 'not_found') {
      toast.show(
        `${labelFor(accountId)} のサーバーからこのノートを見つけられませんでした`,
        'error',
      )
    } else {
      toast.show(
        'ノートの解決に失敗しました。あとで再試行してください',
        'error',
      )
    }
    return null
  }

  /** note に対し accountId のアカウントとして reaction を送る */
  async function reactAs(
    accountId: string,
    note: NormalizedNote,
    reaction: string,
  ): Promise<void> {
    const noteId = await resolveTarget(accountId, note)
    if (noteId == null) return
    const adapter = await getOrCreate(accountId)
    if (!adapter) return

    const label = labelFor(accountId)
    try {
      await adapter.api.createReaction(noteId, reaction)
      toast.show(`${label} でリアクションしました`, 'success')
    } catch (e) {
      const err = AppError.from(e)
      if (err.displayCode === 'ALREADY_REACTED') {
        const ok = await confirm({
          title: 'リアクション解除',
          message: `${label} は既にこのノートにリアクションしています。リアクションを解除しますか？`,
          type: 'danger',
          okLabel: '解除',
        })
        if (!ok) return
        try {
          await adapter.api.deleteReaction(noteId)
          toast.show(`${label} のリアクションを解除しました`, 'success')
        } catch (e2) {
          const err2 = AppError.from(e2)
          console.error('[crossAction:unreact]', err2.code, err2.message)
          toast.show(
            `リアクションの解除に失敗しました（${err2.displayCode}）`,
            'error',
          )
        }
        return
      }
      console.error('[crossAction:react]', err.code, err.message)
      toast.show(`リアクションに失敗しました（${err.displayCode}）`, 'error')
    }
  }

  /** note を accountId のアカウントとしてリノートする（公開範囲はサーバーデフォルト） */
  async function renoteAs(
    accountId: string,
    note: NormalizedNote,
  ): Promise<void> {
    const noteId = await resolveTarget(accountId, note)
    if (noteId == null) return
    const adapter = await getOrCreate(accountId)
    if (!adapter) return

    try {
      await adapter.api.createNote({ renoteId: noteId })
      toast.show(`${labelFor(accountId)} でリノートしました`, 'success')
    } catch (e) {
      const err = AppError.from(e)
      console.error('[crossAction:renote]', err.code, err.message)
      toast.show(`リノートに失敗しました（${err.displayCode}）`, 'error')
    }
  }

  /**
   * 引用のためのエンティティ解決。成功時は投稿フォーム起動用のターゲットを
   * 返す（フォームを開くのは呼び出し側 = MkNote）。失敗時は toast を出して null。
   */
  async function quoteAs(
    accountId: string,
    note: NormalizedNote,
  ): Promise<QuoteAsTarget | null> {
    const noteId = await resolveTarget(accountId, note)
    if (noteId == null) return null
    return { accountId, renoteId: noteId }
  }

  return { reactAs, renoteAs, quoteAs }
}
