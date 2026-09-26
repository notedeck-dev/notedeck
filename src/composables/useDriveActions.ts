import type { DriveFolder, NormalizedDriveFile } from '@/adapters/types'
import { i18n } from '@/i18n'
import { useConfirm } from '@/stores/confirm'
import { usePrompt } from '@/stores/prompt'
import { useToast } from '@/stores/toast'
import { useUiStore } from '@/stores/ui'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'

/** move-bulk の maxItems（上流 2026.6.0 で確認済み） */
const MOVE_BULK_CHUNK_SIZE = 100

/** 既知の Misskey エラーコードの意訳（それ以外は AppError.message をそのまま出す） */
const ERROR_TRANSLATIONS: Record<string, string> = {
  get RATE_LIMIT_EXCEEDED() {
    return i18n.ts._useDriveActions.rateLimitExceeded
  },
  get HAS_CHILD_FILES_OR_FOLDERS() {
    return i18n.ts._useDriveActions.folderNotEmpty
  },
  get INVALID_FILE_NAME() {
    return i18n.ts._useDriveActions.invalidFileName
  },
}

function errorMessage(e: unknown): string {
  const appErr = AppError.from(e)
  return ERROR_TRANSLATIONS[appErr.displayCode] ?? appErr.message
}

/**
 * ドライブ整理操作の共通ロジック (#792)。
 * prompt / confirm → Tauri command → emitDriveFilesChanged まで各関数で完結する。
 * カラム・コンテキストメニュー・詳細ウィンドウ・移動ダイアログ・#793 から共用。
 */
export function useDriveActions() {
  const { prompt } = usePrompt()
  const { confirm } = useConfirm()
  const toast = useToast()
  const uiStore = useUiStore()

  /** 成功時は作成されたフォルダを返す（移動ダイアログの auto-descend 用）。キャンセル・失敗は null */
  async function createFolder(
    accountId: string | null | undefined,
    parentId: string | null,
  ): Promise<DriveFolder | null> {
    if (!accountId) return null
    const name = (
      await prompt({
        title: i18n.ts._common.newFolder,
        placeholder: i18n.ts._useDriveActions.folderNamePlaceholder,
      })
    )?.trim()
    if (!name) return null
    try {
      const created = unwrap(
        await commands.apiCreateDriveFolder(accountId, name, parentId),
      )
      uiStore.emitDriveFilesChanged(accountId)
      return {
        id: created.id,
        name: created.name,
        parentId: created.parentId ?? null,
      }
    } catch (e) {
      toast.show(errorMessage(e), 'error')
      return null
    }
  }

  async function renameFolder(
    accountId: string | null | undefined,
    folder: DriveFolder,
  ): Promise<void> {
    if (!accountId) return
    const name = (
      await prompt({
        title: i18n.ts._useDriveActions.renameFolder,
        defaultValue: folder.name,
      })
    )?.trim()
    if (!name || name === folder.name) return
    try {
      unwrap(await commands.apiUpdateDriveFolder(accountId, folder.id, name))
      uiStore.emitDriveFilesChanged(accountId)
    } catch (e) {
      toast.show(errorMessage(e), 'error')
    }
  }

  async function deleteFolder(
    accountId: string | null | undefined,
    folder: DriveFolder,
  ): Promise<void> {
    if (!accountId) return
    const ok = await confirm({
      title: i18n.ts._useDriveActions.deleteFolderTitle,
      message: i18n.tsx._useDriveActions.confirmDeleteFolder({
        name: folder.name,
      }),
      okLabel: i18n.ts._common.delete,
      type: 'danger',
    })
    if (!ok) return
    try {
      unwrap(await commands.apiDeleteDriveFolder(accountId, folder.id))
      uiStore.emitDriveFilesChanged(accountId)
    } catch (e) {
      toast.show(errorMessage(e), 'error')
    }
  }

  async function renameFile(
    accountId: string | null | undefined,
    file: NormalizedDriveFile,
  ): Promise<void> {
    if (!accountId) return
    const name = (
      await prompt({
        title: i18n.ts._useDriveActions.renameFile,
        defaultValue: file.name,
      })
    )?.trim()
    if (!name || name === file.name) return
    try {
      unwrap(
        await commands.apiUpdateDriveFile(accountId, file.id, name, null, null),
      )
      uiStore.emitDriveFilesChanged(accountId)
    } catch (e) {
      toast.show(errorMessage(e), 'error')
    }
  }

  /**
   * move-bulk（100 件ずつチャンク）。1 チャンク内は上流実装が単一 UPDATE のため
   * 部分成功は存在しない。途中チャンク失敗は中断 + エラー表示、成功可否にかかわらず
   * bump して先行チャンクの成功分を refetch で実状態に同期する。
   */
  async function moveFiles(
    accountId: string | null | undefined,
    fileIds: string[],
    folderId: string | null,
  ): Promise<boolean> {
    if (!accountId || fileIds.length === 0) return false
    try {
      for (let i = 0; i < fileIds.length; i += MOVE_BULK_CHUNK_SIZE) {
        const chunk = fileIds.slice(i, i + MOVE_BULK_CHUNK_SIZE)
        unwrap(await commands.apiMoveDriveFiles(accountId, chunk, folderId))
      }
      return true
    } catch (e) {
      toast.show(errorMessage(e), 'error')
      return false
    } finally {
      uiStore.emitDriveFilesChanged(accountId)
    }
  }

  /** 削除成功時 true（詳細ウィンドウの self-close 判定用） */
  async function deleteFile(
    accountId: string | null | undefined,
    file: NormalizedDriveFile,
  ): Promise<boolean> {
    if (!accountId) return false
    const ok = await confirm({
      title: i18n.ts._useDriveActions.deleteFileTitle,
      message: i18n.tsx._useDriveActions.confirmDeleteFile({ name: file.name }),
      okLabel: i18n.ts._common.delete,
      type: 'danger',
    })
    if (!ok) return false
    try {
      unwrap(await commands.apiDeleteDriveFile(accountId, file.id))
      uiStore.emitDriveFilesChanged(accountId)
      return true
    } catch (e) {
      toast.show(errorMessage(e), 'error')
      return false
    }
  }

  return {
    createFolder,
    renameFolder,
    deleteFolder,
    renameFile,
    moveFiles,
    deleteFile,
  }
}
