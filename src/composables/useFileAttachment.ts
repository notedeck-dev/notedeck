import { computed, ref } from 'vue'
import type { NormalizedDriveFile, ServerAdapter } from '@/adapters/types'
import { AppError } from '@/utils/errors'

/**
 * アップロード中・失敗ファイルの per-file 状態 (#753)。
 * 成功したエントリはここから消え attachedFiles へ移る。失敗エントリは
 * source を保持しているので retryUpload で再試行できる。
 */
export interface PendingUpload {
  key: string
  name: string
  status: 'uploading' | 'error'
  error?: string
  source: { kind: 'path'; path: string } | { kind: 'browser'; file: File }
}

let uploadKeyCounter = 0

export function useFileAttachment(
  getAdapter: () => ServerAdapter | null,
  error: { value: string | null },
) {
  const attachedFiles = ref<NormalizedDriveFile[]>([])
  const pendingUploads = ref<PendingUpload[]>([])
  const isUploading = computed(() =>
    pendingUploads.value.some((p) => p.status === 'uploading'),
  )

  async function runUpload(entry: PendingUpload) {
    const adapter = getAdapter()
    if (!adapter) {
      pendingUploads.value = pendingUploads.value.filter(
        (p) => p.key !== entry.key,
      )
      return
    }
    try {
      const uploaded =
        entry.source.kind === 'path'
          ? await adapter.api.uploadFileFromPath(entry.source.path)
          : await adapter.api.uploadFile(
              entry.source.file.name,
              [...new Uint8Array(await entry.source.file.arrayBuffer())],
              entry.source.file.type || 'application/octet-stream',
            )
      pendingUploads.value = pendingUploads.value.filter(
        (p) => p.key !== entry.key,
      )
      attachedFiles.value = [...attachedFiles.value, uploaded]
    } catch (e) {
      // 失敗はエントリ単位で保持 (全体エラーにしない)。成功分は残り、
      // 失敗分だけ retry / dismiss できる
      pendingUploads.value = pendingUploads.value.map((p) =>
        p.key === entry.key
          ? { ...p, status: 'error' as const, error: AppError.from(e).message }
          : p,
      )
    }
  }

  function enqueue(sources: PendingUpload['source'][]): Promise<void> {
    if (sources.length === 0) return Promise.resolve()
    error.value = null
    const entries = sources.map((source): PendingUpload => {
      const name =
        source.kind === 'path'
          ? (source.path.split(/[/\\]/).pop() ?? source.path)
          : source.file.name
      return {
        key: `upload-${++uploadKeyCounter}`,
        name,
        status: 'uploading',
        source,
      }
    })
    pendingUploads.value = [...pendingUploads.value, ...entries]
    return Promise.all(entries.map((e) => runUpload(e))).then(() => undefined)
  }

  async function uploadFilesFromPaths(paths: string[]) {
    await enqueue(paths.map((path) => ({ kind: 'path' as const, path })))
  }

  /**
   * ブラウザの File オブジェクトからのアップロード。
   * クリップボード画像ペーストなど、ファイルパスを持たない入力用。
   */
  async function uploadBrowserFiles(files: File[]) {
    await enqueue(files.map((file) => ({ kind: 'browser' as const, file })))
  }

  async function retryUpload(key: string) {
    const entry = pendingUploads.value.find((p) => p.key === key)
    if (entry?.status !== 'error') return
    pendingUploads.value = pendingUploads.value.map((p) =>
      p.key === key
        ? { ...p, status: 'uploading' as const, error: undefined }
        : p,
    )
    const retrying = pendingUploads.value.find((p) => p.key === key)
    if (retrying) await runUpload(retrying)
  }

  function dismissUpload(key: string) {
    pendingUploads.value = pendingUploads.value.filter((p) => p.key !== key)
  }

  function attachDriveFiles(driveFiles: NormalizedDriveFile[]) {
    attachedFiles.value = [...attachedFiles.value, ...driveFiles]
  }

  function removeFile(fileId: string) {
    attachedFiles.value = attachedFiles.value.filter((f) => f.id !== fileId)
  }

  /** ドラッグ並び替え。fileIds の順序がそのまま投稿の表示順になる */
  function reorderFiles(fromIndex: number, toIndex: number) {
    const files = [...attachedFiles.value]
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= files.length ||
      toIndex >= files.length
    )
      return
    const [moved] = files.splice(fromIndex, 1)
    if (!moved) return
    files.splice(toIndex, 0, moved)
    attachedFiles.value = files
  }

  /** alt / センシティブ / 名前のローカル反映 (サーバー更新は呼び出し側が行う) */
  function applyFileMeta(
    fileId: string,
    patch: { comment?: string | null; isSensitive?: boolean; name?: string },
  ) {
    attachedFiles.value = attachedFiles.value.map((f) =>
      f.id === fileId ? { ...f, ...patch } : f,
    )
  }

  return {
    attachedFiles,
    pendingUploads,
    isUploading,
    uploadFilesFromPaths,
    uploadBrowserFiles,
    retryUpload,
    dismissUpload,
    attachDriveFiles,
    removeFile,
    reorderFiles,
    applyFileMeta,
  }
}
