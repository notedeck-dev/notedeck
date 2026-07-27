import type { Command } from '@/commands/registry'
import { projectVisibleItems } from '@/composables/useAiSystemContext'
import { ACCOUNT_ID_PARAM_DESC, getApiAdapter } from '../accountContext'

/**
 * Antenna (Misskey antennas) 系 capability。自分が定義したアンテナの
 * 一覧取得とアンテナにマッチした note の読み出しを提供する。read-only。
 *
 * permission: `account.read` (list) / `notes.read` (notes)。
 * antenna の create / update / delete は対応する adapter メソッドが現状
 * なく、UI 側でも編集できないため本 PR では追加しない。
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

export const antennaListCapability: Command = {
  id: 'antenna.list',
  label: '自分のアンテナ一覧',
  icon: 'ti-antenna',
  category: 'account',
  shortcuts: [],
  aiTool: true,
  permissions: ['account.read'],
  signature: {
    description:
      '自分が定義した Misskey アンテナの一覧を返す。各要素は ' +
      '{ id, name, keywords, users, ... }。antenna.notes で notes を取るときの起点。',
    params: {
      accountId: {
        type: 'string',
        description: ACCOUNT_ID_PARAM_DESC,
        optional: true,
      },
    },
    returns: { type: 'array', description: 'Antenna の配列' },
    cheap: true,
  },
  visible: false,
  execute: async (params, ctx) => {
    const api = await getApiAdapter(params?.accountId, ctx)
    return await api.getAntennas()
  },
}

export const antennaNotesCapability: Command = {
  id: 'antenna.notes',
  label: 'アンテナの note',
  icon: 'ti-antenna-bars-5',
  category: 'note',
  shortcuts: [],
  aiTool: true,
  permissions: ['notes.read'],
  signature: {
    description:
      '指定アンテナにマッチした note を返す。antennaId は antenna.list で取得。' +
      ' projection された note (id / userId / username / text / createdAt) を最大 limit 件返す。',
    params: {
      antennaId: { type: 'string', description: '対象 antennaId' },
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
    const antennaId = pickString(params?.antennaId)
    if (!antennaId) throw new Error('antenna.notes: antennaId is required')
    const limit = pickNumber(params?.limit) ?? 20
    const untilId = pickString(params?.untilId)
    const api = await getApiAdapter(params?.accountId, ctx)
    const notes = await api.getAntennaNotes(antennaId, { limit, untilId })
    return projectVisibleItems(notes, 'antenna', limit)
  },
}

export const ANTENNA_BUILTIN_CAPABILITIES: readonly Command[] = [
  antennaListCapability,
  antennaNotesCapability,
]
