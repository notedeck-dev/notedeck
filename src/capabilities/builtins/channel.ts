import type { Command } from '@/commands/registry'
import { projectVisibleItems } from '@/composables/useAiSystemContext'
import { getApiAdapter } from '../accountContext'
import { implement } from '../declare'

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

export const channelListCapability = implement('channel.list', {
  execute: async (params, ctx) => {
    const api = await getApiAdapter(params?.accountId, ctx)
    return await api.getChannels()
  },
})

export const channelNotesCapability = implement('channel.notes', {
  execute: async (params, ctx) => {
    const channelId = pickString(params?.channelId)
    if (!channelId) throw new Error('channel.notes: channelId is required')
    const limit = pickNumber(params?.limit) ?? 20
    const untilId = pickString(params?.untilId)
    const api = await getApiAdapter(params?.accountId, ctx)
    const notes = await api.getChannelNotes(channelId, { limit, untilId })
    return projectVisibleItems(notes, 'channel', limit)
  },
})

export const CHANNEL_BUILTIN_CAPABILITIES: readonly Command[] = [
  channelListCapability,
  channelNotesCapability,
]
