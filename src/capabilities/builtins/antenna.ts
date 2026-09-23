import type { Command } from '@/commands/registry'
import { projectVisibleItems } from '@/composables/useAiSystemContext'
import { getApiAdapter } from '../accountContext'
import { implement } from '../declare'

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

export const antennaListCapability = implement('antenna.list', {
  execute: async (params, ctx) => {
    const api = await getApiAdapter(params?.accountId, ctx)
    return await api.getAntennas()
  },
})

export const antennaNotesCapability = implement('antenna.notes', {
  execute: async (params, ctx) => {
    const antennaId = pickString(params?.antennaId)
    if (!antennaId) throw new Error('antenna.notes: antennaId is required')
    const limit = pickNumber(params?.limit) ?? 20
    const untilId = pickString(params?.untilId)
    const api = await getApiAdapter(params?.accountId, ctx)
    const notes = await api.getAntennaNotes(antennaId, { limit, untilId })
    return projectVisibleItems(notes, 'antenna', limit)
  },
})

export const ANTENNA_BUILTIN_CAPABILITIES: readonly Command[] = [
  antennaListCapability,
  antennaNotesCapability,
]
