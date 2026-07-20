import { computed, ref, shallowRef } from 'vue'
import type { DriveFolder, NormalizedDriveFile } from '@/adapters/types'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { isSafeUrl } from '@/utils/url'

export interface UseDriveFolderOptions {
  accountId: () => string | undefined
  initialFolderId?: string | null
  /** folderStack の初期値（移動ダイアログ・詳細ウィンドウの origin 引き継ぎ用） */
  initialStack?: DriveFolder[]
}

export function useDriveFolder(options: UseDriveFolderOptions) {
  const currentFolderId = ref<string | null>(options.initialFolderId ?? null)
  const folderStack = ref<DriveFolder[]>([...(options.initialStack ?? [])])
  const folders = shallowRef<DriveFolder[]>([])
  const files = shallowRef<NormalizedDriveFile[]>([])
  const loading = ref(false)
  const error = ref<AppError | null>(null)

  async function fetchDrive(folderId?: string | null) {
    const accountId = options.accountId()
    if (!accountId) return
    const targetFolderId = folderId ?? currentFolderId.value
    loading.value = true
    error.value = null

    try {
      const [folderResult, fileResult] = await Promise.all([
        commands
          .apiGetDriveFolders(accountId, targetFolderId, 50)
          .then((r) => unwrap(r) as unknown as DriveFolder[]),
        commands
          .apiGetDriveFiles(accountId, targetFolderId, 50, null)
          .then((r) => unwrap(r) as unknown as NormalizedDriveFile[]),
      ])
      folders.value = folderResult
      files.value = fileResult
    } catch (e) {
      error.value = AppError.from(e)
    } finally {
      loading.value = false
    }
  }

  function openFolder(folder: DriveFolder) {
    folderStack.value.push(folder)
    currentFolderId.value = folder.id
    fetchDrive(folder.id)
  }

  function goUp() {
    folderStack.value.pop()
    const parent = folderStack.value[folderStack.value.length - 1]
    currentFolderId.value = parent?.id ?? null
    fetchDrive(currentFolderId.value)
  }

  function goRoot() {
    folderStack.value = []
    currentFolderId.value = null
    fetchDrive(null)
  }

  // --- File selection ---
  const selectedIds = ref(new Set<string>())

  function toggleFile(fileId: string) {
    const next = new Set(selectedIds.value)
    if (next.has(fileId)) {
      next.delete(fileId)
    } else {
      next.add(fileId)
    }
    selectedIds.value = next
  }

  // union（加算）: 他階層で選択済みの ID は捨てない
  function selectAll() {
    const next = new Set(selectedIds.value)
    for (const f of files.value) next.add(f.id)
    selectedIds.value = next
  }

  /** 現フォルダの files に含まれる ID のみ解除（他階層の選択は保持） */
  function deselectCurrent() {
    const next = new Set(selectedIds.value)
    for (const f of files.value) next.delete(f.id)
    selectedIds.value = next
  }

  function deselectAll() {
    selectedIds.value = new Set()
  }

  const selectedCount = computed(() => selectedIds.value.size)

  /** 選択中のうち現フォルダの files に無い件数（他階層で選択された分） */
  const selectedOutsideCount = computed(() => {
    const currentIds = new Set(files.value.map((f) => f.id))
    let count = 0
    for (const id of selectedIds.value) {
      if (!currentIds.has(id)) count++
    }
    return count
  })

  return {
    currentFolderId,
    folderStack,
    folders,
    files,
    loading,
    error,
    fetchDrive,
    openFolder,
    goUp,
    goRoot,
    selectedIds,
    toggleFile,
    selectAll,
    deselectCurrent,
    deselectAll,
    selectedCount,
    selectedOutsideCount,
  }
}

// --- Shared utility functions ---

export function safeUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  return isSafeUrl(url) ? url : undefined
}

export function isImage(file: NormalizedDriveFile): boolean {
  return file.type.startsWith('image/')
}

export function isVideo(file: NormalizedDriveFile): boolean {
  return file.type.startsWith('video/')
}

export function isAudio(file: NormalizedDriveFile): boolean {
  return file.type.startsWith('audio/')
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
