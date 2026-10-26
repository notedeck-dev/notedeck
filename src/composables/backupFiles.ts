import type { ImportSettingsResult } from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * バックアップ (settings の JSON / notecli.db) の出し入れと置き場 (#1258)。
 * 書き出し / 取り込みは Rust 側がファイルダイアログを出し、キャンセルは false
 */
export function exportSettingsFile(): Promise<boolean> {
  return commands.exportSettingsJson().then(unwrap)
}

export function importSettingsFile(): Promise<ImportSettingsResult> {
  return commands.importSettingsJson().then(unwrap)
}

export function exportDatabaseFile(): Promise<boolean> {
  return commands.exportDb().then(unwrap)
}

export function importDatabaseFile(): Promise<boolean> {
  return commands.importDb().then(unwrap)
}

export function backupDirPath(): Promise<string> {
  return commands.getBackupDir().then(unwrap)
}

/** 一括ダウンロード (#92) の保存先 */
export function exportDirPath(): Promise<string> {
  return commands.getExportDir().then(unwrap)
}
