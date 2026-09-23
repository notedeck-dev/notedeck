import type { Command } from '@/commands/registry'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { resolveAccountId } from '../accountContext'
import { implement } from '../declare'

/**
 * Drive ファイルは ApiAdapter を介さず Rust 側の `api_get_drive_files` を直接
 * 呼ぶ (DeckDriveColumn と同じ経路)。adapter には drive.* が無いので、
 * AI tool としてもこのバイパス経路を使う。
 */

const MAX_DRIVE_LIMIT = 100
const DEFAULT_LIMIT = 30

function clampLimit(input: unknown, fallback = DEFAULT_LIMIT): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback
  return Math.max(1, Math.min(MAX_DRIVE_LIMIT, Math.floor(input)))
}

function pickStringOrNull(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * `drive.list` — 現在 active なアカウントのドライブファイル一覧を取得する。
 * folderId 省略時はルート、fileType 指定で MIME prefix 絞り込み。
 */
export const driveListCapability = implement('drive.list', {
  execute: async (params, ctx) => {
    const accountId = resolveAccountId(params?.accountId, ctx)
    const folderId = pickStringOrNull(params?.folderId)
    const fileType = pickStringOrNull(params?.fileType)
    const limit = clampLimit(params?.limit)
    const result = await commands.apiGetDriveFiles(
      accountId,
      folderId,
      limit,
      fileType,
    )
    return unwrap(result)
  },
})

export const DRIVE_BUILTIN_CAPABILITIES: readonly Command[] = [
  driveListCapability,
]
