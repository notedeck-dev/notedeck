import type { Command } from '@/commands/registry'
import { projectVisibleItems } from '@/composables/useAiSystemContext'
import { ACCOUNT_ID_PARAM_DESC, getApiAdapter } from '../accountContext'

/**
 * Channel (Misskey channels) 系 capability。チャネル一覧の取得と
 * 各チャネルに投稿された note の読み出しを提供する。read-only。
 *
 * permission: `account.read` (list) / `notes.read` (notes)。
 * チャネルへの note 投稿は `notes.create` で channelId を渡せば既に可能。
 * follow / unfollow は adapter 未実装で本 PR では追加しない。
 */

function pickString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

function pickNumber(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return v
}

export const channelListCapability: Command = {
  id: 'channel.list',
  label: '自分のフォロー中チャネル',
  icon: 'ti-device-tv',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.read'],
  signature: {
    description:
      '自分がフォロー中の Misskey チャネル一覧を返す。各要素は ' +
      '{ id, name, description, ... }。channel.notes で channelId を渡すときの起点。',
    params: {
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: { type: 'array', description: 'Channel の配列' },
    cheap: true,
  },
  visible: false,
  execute: async (params, ctx) => {
    const api = await getApiAdapter(params?.accountId, ctx)
    return await api.getChannels()
  },
}

export const channelNotesCapability: Command = {
  id: 'channel.notes',
  label: 'チャネルの note',
  icon: 'ti-message-circle',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.read'],
  signature: {
    description:
      '指定チャネルの note を返す。channelId は channel.list で取得。' +
      ' projection された note (id / userId / username / text / createdAt) を最大 limit 件返す。',
    params: {
      channelId: { type: 'string', description: '対象 channelId' },
      limit: {
        type: 'number',
        description: '取得件数 (default 20)',
        optional: true,
      },
      untilId: {
        type: 'string',
        description: 'untilId (古い方向のページング)',
        optional: true,
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: { type: 'array', description: 'projected note の配列' },
  },
  visible: false,
  execute: async (params, ctx) => {
    const channelId = pickString(params?.channelId)
    if (!channelId) throw new Error('channel.notes: channelId is required')
    const limit = pickNumber(params?.limit) ?? 20
    const untilId = pickString(params?.untilId)
    const api = await getApiAdapter(params?.accountId, ctx)
    const notes = await api.getChannelNotes(channelId, { limit, untilId })
    return projectVisibleItems(notes, 'channel', limit)
  },
}

export const CHANNEL_BUILTIN_CAPABILITIES: readonly Command[] = [
  channelListCapability,
  channelNotesCapability,
]
