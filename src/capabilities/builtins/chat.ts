import type { Command } from '@/commands/registry'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { resolveAccountId } from '../accountContext'
import { implement } from '../declare'

/**
 * Chat reaction 系 capability — Misskey 新 Chat API (v2025) のメッセージに
 * リアクションを付け外しする。chat 相手に見える絵文字なので、`notes.react`
 * permission を再利用 (= 同レベルの可逆操作)。
 *
 * メッセージ送信そのものは別 capability (chat.* の send 系) が将来必要だが、
 * 本 PR では reaction のみに絞る。
 */

function pickString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

export const chatReactCapability = implement('chat.react', {
  execute: async (params, ctx) => {
    const messageId = pickString(params?.messageId)
    const reaction = pickString(params?.reaction)
    if (!messageId) throw new Error('chat.react: messageId is required')
    if (!reaction) throw new Error('chat.react: reaction is required')
    const accountId = resolveAccountId(params?.accountId, ctx)
    unwrap(await commands.apiReactChatMessage(accountId, messageId, reaction))
    return { ok: true, messageId, reaction }
  },
})

export const chatUnreactCapability = implement('chat.unreact', {
  execute: async (params, ctx) => {
    const messageId = pickString(params?.messageId)
    const reaction = pickString(params?.reaction)
    if (!messageId) throw new Error('chat.unreact: messageId is required')
    if (!reaction) throw new Error('chat.unreact: reaction is required')
    const accountId = resolveAccountId(params?.accountId, ctx)
    unwrap(await commands.apiUnreactChatMessage(accountId, messageId, reaction))
    return { ok: true, messageId, reaction }
  },
})

export const CHAT_BUILTIN_CAPABILITIES: readonly Command[] = [
  chatReactCapability,
  chatUnreactCapability,
]
