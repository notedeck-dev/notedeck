import type { Capability } from '@/capabilities/types'
import { implementCore } from '../declare'

/**
 * `drive.list` — 現在 active なアカウントのドライブファイル一覧を取得する。
 * folderId 省略時はルート、fileType 指定で MIME prefix 絞り込み。
 */
export const driveListCapability = implementCore('drive.list')

export const DRIVE_BUILTIN_CAPABILITIES: readonly Capability[] = [
  driveListCapability,
]
