import type { Command } from '@/commands/registry'
import { projectVisibleItems } from '@/composables/useAiSystemContext'
import { ACCOUNT_ID_PARAM_DESC, getApiAdapter } from '../accountContext'

/**
 * Role (Misskey roles) 系 capability。指定 roleId の所属ユーザーが投稿した
 * note 一覧を返す。read-only。
 *
 * 一覧 (= 公開 role 一覧) を取る API は Misskey の admin/roles/list 配下で
 * 通常ユーザーからは引けないため、`role.notes` のみ提供する。roleId は
 * 既存のロールカラム / 設定から取得する想定。
 *
 * permission: `notes.read`。
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

export const roleNotesCapability: Command = {
  id: 'role.notes',
  label: 'ロールの note',
  icon: 'ti-badges',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.read'],
  signature: {
    description:
      '指定 role の所属ユーザーが投稿した note を返す。roleId はサーバーの role 設定で確認。' +
      ' projection された note (id / userId / username / text / createdAt) を最大 limit 件返す。',
    params: {
      roleId: { type: 'string', description: '対象 roleId' },
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
    const roleId = pickString(params?.roleId)
    if (!roleId) throw new Error('role.notes: roleId is required')
    const limit = pickNumber(params?.limit) ?? 20
    const untilId = pickString(params?.untilId)
    const api = await getApiAdapter(params?.accountId, ctx)
    const notes = await api.getRoleNotes(roleId, { limit, untilId })
    return projectVisibleItems(notes, 'role', limit)
  },
}

export const ROLE_BUILTIN_CAPABILITIES: readonly Command[] = [
  roleNotesCapability,
]
