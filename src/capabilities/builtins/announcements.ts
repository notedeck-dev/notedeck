import type { Command } from '@/commands/registry'
import { ACCOUNT_ID_PARAM_DESC, getApiAdapter } from '../accountContext'

/**
 * Announcements (Misskey サーバーアナウンス) 系 capability。
 *
 * サーバー管理者がサーバー全体に流すお知らせ。read-only で AI に開放する。
 *
 * permission: `account.read`。サーバー側情報、認証不要でも引けるが
 * NoteDeck の adapter は account_id 経由なのでログイン前提。
 *
 * announcements.read (既読化) は `account.write` 相当の副作用があり
 * AI が勝手に既読にして読み逃しを引き起こすリスクがあるので本 PR では
 * 提供しない (= read-only のみ)。
 */

function pickNumber(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return v
}

function pickBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

export const announcementsListCapability: Command = {
  id: 'announcements.list',
  label: 'サーバーアナウンス一覧',
  icon: 'ti-megaphone',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.read'],
  signature: {
    description:
      'Misskey サーバーのアナウンス一覧を返す (read-only)。isActive=true (default)' +
      ' で現在有効なアナウンスのみ、false で過去含む。既読化は副作用ありのため' +
      ' 本 capability では提供しない (取得のみ)。',
    params: {
      limit: {
        type: 'number',
        description: '取得件数 (default 30, 1-100)',
        optional: true,
      },
      isActive: {
        type: 'boolean',
        description: '現在有効なアナウンスのみ (default: true)',
        optional: true,
      },
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: { type: 'array', description: 'Announcement の配列' },
    cheap: true,
  },
  visible: false,
  execute: async (params, ctx) => {
    const limit = pickNumber(params?.limit)
    const isActive = pickBoolean(params?.isActive)
    const api = await getApiAdapter(params?.accountId, ctx)
    return await api.getAnnouncements({ limit, isActive })
  },
}

export const ANNOUNCEMENTS_BUILTIN_CAPABILITIES: readonly Command[] = [
  announcementsListCapability,
]
