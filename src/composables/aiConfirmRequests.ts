import { rememberConfirmation } from '@/capabilities/dispatcher'
import type { AiConfirmItem } from '@/composables/useAiTurn'
import { i18n } from '@/i18n'
import { useAiActivity } from '@/stores/aiActivity'
import { type ConfirmOptions, useConfirm } from '@/stores/confirm'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * notecore 発の確認要求のデバイス側 (#1133 縦切り 2)。
 *
 * - 要求は「今回だけ許可 / 今回だけ拒否」の 2 択。表示内容は capability の
 *   実装が組んだプレビュー (`ai/confirm-preview`) をそのまま出す
 * - 1 要求に複数の項目 (同じラウンドの複数の tool 呼び出し) が束ねられていれば
 *   1 枚のダイアログにまとめ、決定は全項目に効く
 * - 「次から確認しない」は現状どおりデバイス側が権限ファイルに減算する
 *   (capability 固有の remember があればそれへ)。notecore は次の判定で読む
 * - 表示した時点を notecore に伝える (表示 TTL の起点)。期限切れ / 中断 /
 *   別デバイスの応答で notecore が閉じたら、表示中のダイアログを畳む
 * - 応答は最初の 1 つだけが効く。遅れた応答のエラーは握りつぶさず warn に残す
 */

export interface AiConfirmRequestPayload {
  requestId: string
  turnId: string
  principal: 'ai.chat' | 'ai.heartbeat'
  accountId?: string
  items: AiConfirmItem[]
}

interface OpenRequest {
  turnId: string
  controller: AbortController
}

const open = new Map<string, OpenRequest>()

/** 束ねた項目を 1 枚のダイアログにする */
export function bundleConfirmOptions(
  items: AiConfirmItem[],
  onShow: () => void,
): ConfirmOptions {
  const allowRemember = items.some((it) => it.allowRemember)
  if (items.length === 1 && items[0]) {
    const single = { ...items[0].preview, onShow }
    if (!allowRemember) delete single.rememberLabel
    return single
  }
  const withDiff = items.filter((it) => it.preview.diff)
  const withCode = items.filter((it) => it.preview.code)
  const first = items[0]?.preview
  return {
    title: i18n.tsx._aiConfirmRequests.bundleTitle_plural({
      count: items.length,
    }),
    message: items
      .map((it, i) => {
        const head = `${i + 1}. ${it.preview.title}`
        return it.preview.message ? `${head}\n${it.preview.message}` : head
      })
      .join('\n\n'),
    okLabel: i18n.ts._aiConfirmRequests.runAll,
    cancelLabel: i18n.ts._aiConfirmRequests.stop,
    type: 'danger',
    trusted: true,
    ...(first?.attribution ? { attribution: first.attribution } : {}),
    // プレビュー (diff / 引数) は 1 件分しか出せないので、1 件だけのときに限る
    ...(withDiff.length === 1 && withDiff[0]
      ? { diff: withDiff[0].preview.diff }
      : {}),
    ...(withDiff.length === 0 && withCode.length === 1 && withCode[0]
      ? {
          code: withCode[0].preview.code,
          codeLanguage: withCode[0].preview.codeLanguage,
        }
      : {}),
    ...(allowRemember
      ? { rememberLabel: i18n.ts._aiConfirmRequests.rememberAll }
      : {}),
    onShow,
  }
}

/** 要求を表示し、決定を notecore に返す */
export async function presentConfirmRequest(
  p: AiConfirmRequestPayload,
): Promise<void> {
  if (p.items.length === 0) return
  const controller = new AbortController()
  open.set(p.requestId, { turnId: p.turnId, controller })
  const endWaiting = useAiActivity().begin('waiting')
  let decision: { accepted: boolean; remember: boolean }
  try {
    const options = bundleConfirmOptions(p.items, () => {
      void commands.aiConfirmShown(p.requestId).catch((e) => {
        console.warn('[ai-confirm] shown report failed:', e)
      })
    })
    decision = await useConfirm().confirmWithDecision(
      options,
      controller.signal,
    )
  } finally {
    endWaiting()
    open.delete(p.requestId)
  }
  // notecore 側で閉じられた (期限切れ / 中断) なら応答しない
  if (controller.signal.aborted) return

  if (decision.accepted && decision.remember) {
    for (const it of p.items) {
      if (!it.allowRemember) continue
      try {
        await rememberConfirmation(it.capabilityId, it.params, {
          principal: { kind: p.principal },
          accountId: p.accountId,
        })
      } catch (e) {
        console.warn('[ai-confirm] remember failed:', it.capabilityId, e)
      }
    }
  }
  try {
    unwrap(await commands.aiConfirmRespond(p.requestId, decision.accepted))
  } catch (e) {
    // 期限切れ直後の応答など。決定は効かない (notecore が拒否として進めている)
    console.warn('[ai-confirm] response rejected:', e)
  }
}

/** notecore が閉じた要求 (期限切れ / 中断 / 別デバイスの応答) の表示を畳む */
export function closeConfirmRequest(requestId: string): void {
  open.get(requestId)?.controller.abort()
}

/** turn の中断で、その turn の表示中の要求を畳む */
export function closeConfirmRequestsForTurn(turnId: string): void {
  for (const [, r] of open) {
    if (r.turnId === turnId) r.controller.abort()
  }
}

/** test 用 */
export function _resetConfirmRequestsForTest(): void {
  open.clear()
}
