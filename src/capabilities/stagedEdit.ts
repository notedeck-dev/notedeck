import type { CapabilityContext } from './types'

/**
 * 「確認で見せた適用後全文をそのまま書き込む」ための受け渡し (#981)。
 *
 * dispatcher は `requiresConfirmation` と `execute` に同一の
 * CapabilityContext を渡す。確認オプションを組み立てる側が
 * `stageEdit` で適用後全文を載せ、`execute` は `takeStagedEdit` で
 * それを受け取って書き込む。承認後に再計算しないのが要点で、
 * 「見せたものと書くものの一致」が承認 UI の意味そのものになる。
 *
 * 確認を経ない経路 (requiresConfirmation が null を返す / capability を
 * 直接 execute する) では fallback で従来どおり計算する。
 */

export interface StagedEdit {
  /** 確認時点で読んだ編集前の全文 */
  baseline: string
  /** 確認ダイアログで見せた適用後の全文 */
  next: string
}

/** 適用後全文を ctx に載せ、そのまま返す (確認オプションの diff.new に使う)。 */
export function stageEdit(
  ctx: CapabilityContext | undefined,
  baseline: string,
  next: string,
): string {
  if (ctx) ctx.stagedEdit = { baseline, next }
  return next
}

/**
 * 確認で見せた適用後全文を取り出す。確認時点の全文と現在が食い違っていれば
 * 書き込まずに投げる (= 見せていない変更を承認済みとして書かない)。
 */
export function takeStagedEdit(
  ctx: CapabilityContext | undefined,
  capabilityId: string,
  current: string,
  fallback: () => string,
): string {
  const staged = ctx?.stagedEdit
  if (!staged || !ctx) return fallback()
  ctx.stagedEdit = undefined
  if (staged.baseline !== current) {
    throw new Error(
      `${capabilityId}: 確認後に対象が変更されたため書き込みを中止しました ` +
        '(最新の内容を読み直してからやり直すこと)',
    )
  }
  return staged.next
}
