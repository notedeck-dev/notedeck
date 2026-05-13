import type { Command } from '@/commands/registry'
import { useAccountsStore } from '@/stores/accounts'
import { commands, unwrap } from '@/utils/tauriInvoke'

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

function resolveAccountId(input: unknown): string {
  const explicit = typeof input === 'string' ? input.trim() : ''
  if (explicit) return explicit
  const store = useAccountsStore()
  const id = store.activeAccountId
  if (!id) throw new Error('chat: no active account')
  return id
}

const ACCOUNT_ID_PARAM_DESC =
  'どのアカウントで実行するか。未指定なら active アカウント。' +
  ' 別サーバーのカラムから操作するときは `<currentColumn>.accountId` を渡す。'

export const chatReactCapability: Command = {
  id: 'chat.react',
  label: 'チャットメッセージにリアクション',
  icon: 'ti-mood-smile',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.react'],
  requiresConfirmation: true,
  signature: {
    description:
      'Misskey 新 Chat (v2025) のメッセージにリアクションを付ける。reaction は ' +
      '`:name:` 形式または Unicode 絵文字。messageId は chat カラム表示中の' +
      'メッセージから取得する想定。',
    params: {
      messageId: { type: 'string', description: '対象メッセージ id' },
      reaction: {
        type: 'string',
        description: 'リアクション (`:thinking_face:` / `👍` 等)',
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ ok: true, messageId, reaction }',
    },
  },
  visible: false,
  execute: async (params) => {
    const messageId = pickString(params?.messageId)
    const reaction = pickString(params?.reaction)
    if (!messageId) throw new Error('chat.react: messageId is required')
    if (!reaction) throw new Error('chat.react: reaction is required')
    const accountId = resolveAccountId(params?.accountId)
    unwrap(await commands.apiReactChatMessage(accountId, messageId, reaction))
    return { ok: true, messageId, reaction }
  },
}

export const chatUnreactCapability: Command = {
  id: 'chat.unreact',
  label: 'チャットメッセージのリアクションを解除',
  icon: 'ti-mood-x',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.react'],
  requiresConfirmation: true,
  signature: {
    description:
      'Misskey Chat メッセージから自分のリアクションを解除する。reaction は' +
      ' 付けたときと同じ値 (チャットでは複数 reaction を 1 ユーザーが付けられるため、' +
      ' note のリアクションと違って種別指定が必要)。',
    params: {
      messageId: { type: 'string', description: '対象メッセージ id' },
      reaction: { type: 'string', description: '解除する reaction 種別' },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ ok: true, messageId, reaction }',
    },
  },
  visible: false,
  execute: async (params) => {
    const messageId = pickString(params?.messageId)
    const reaction = pickString(params?.reaction)
    if (!messageId) throw new Error('chat.unreact: messageId is required')
    if (!reaction) throw new Error('chat.unreact: reaction is required')
    const accountId = resolveAccountId(params?.accountId)
    unwrap(await commands.apiUnreactChatMessage(accountId, messageId, reaction))
    return { ok: true, messageId, reaction }
  },
}

export const CHAT_BUILTIN_CAPABILITIES: readonly Command[] = [
  chatReactCapability,
  chatUnreactCapability,
]
