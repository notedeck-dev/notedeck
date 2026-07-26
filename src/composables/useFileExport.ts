import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import type { ExportFileItem } from '@/bindings'
import { events } from '@/bindings'
import { commands } from '@/utils/tauriInvoke'

export type ExportItemStatus =
  | 'pending'
  | 'saving'
  | 'done'
  | 'skipped'
  | 'failed'

export interface ExportItemState {
  fileId: string
  name: string
  status: ExportItemStatus
  error?: string
}

/**
 * ファイル一括エクスポート (#92) のフロント側進捗管理。
 * Rust 側 export_files_start が emit する ExportProgress を購読して
 * ファイル単位のステータスを保持する。保存済み fileId は Rust 側が
 * 冪等スキップするため、リトライは失敗分の再投入だけでよい。
 */
export function useFileExport() {
  const itemStates = ref<ExportItemState[]>([])
  const running = ref(false)
  const finished = ref(false)
  const cancelled = ref(false)
  const taskError = ref<string | null>(null)
  const doneCount = ref(0)
  const skippedCount = ref(0)
  const failedCount = ref(0)
  /** 直近の start が解決した保存先ディレクトリ (「フォルダを開く」用) */
  const savedDir = ref<string | null>(null)

  const total = computed(() => itemStates.value.length)
  const completedCount = computed(
    () => doneCount.value + skippedCount.value + failedCount.value,
  )

  let taskId: string | null = null
  let unlisten: (() => void) | null = null
  let byId = new Map<string, ExportItemState>()
  let lastSegments: string[] = []
  let sourceItems = new Map<string, ExportFileItem>()

  function onEvent(p: {
    taskId: string
    fileId: string
    status: string
    error: string | null
  }) {
    if (p.taskId !== taskId) return
    if (p.fileId === '') {
      // タスク全体イベント
      if (p.status === 'finished' || p.status === 'cancelled') {
        running.value = false
        finished.value = true
        cancelled.value = p.status === 'cancelled'
        unlisten?.()
        unlisten = null
      } else if (p.status === 'failed') {
        taskError.value = p.error ?? 'export failed'
      }
      return
    }
    const s = byId.get(p.fileId)
    if (!s) return
    if (p.status === 'saving') {
      s.status = 'saving'
    } else if (
      p.status === 'done' ||
      p.status === 'skipped' ||
      p.status === 'failed'
    ) {
      s.status = p.status
      s.error = p.error ?? undefined
      if (p.status === 'done') doneCount.value++
      else if (p.status === 'skipped') skippedCount.value++
      else failedCount.value++
    }
  }

  async function start(
    segments: string[],
    files: ExportFileItem[],
  ): Promise<boolean> {
    if (running.value || files.length === 0) return false
    running.value = true
    finished.value = false
    cancelled.value = false
    taskError.value = null
    doneCount.value = 0
    skippedCount.value = 0
    failedCount.value = 0
    taskId = crypto.randomUUID()
    lastSegments = segments
    sourceItems = new Map(files.map((f) => [f.fileId, f]))
    itemStates.value = files.map((f) => ({
      fileId: f.fileId,
      name: f.name,
      status: 'pending' as const,
    }))
    byId = new Map(itemStates.value.map((s) => [s.fileId, s]))

    unlisten?.()
    unlisten = await events.exportProgress.listen(({ payload }) =>
      onEvent(payload),
    )
    const result = await commands.exportFilesStart(taskId, segments, files)
    if (result.status === 'error') {
      running.value = false
      taskError.value = String(result.error)
      unlisten?.()
      unlisten = null
      return false
    }
    savedDir.value = result.data
    return true
  }

  async function retryFailed(): Promise<boolean> {
    if (running.value) return false
    const files = itemStates.value
      .filter((s) => s.status === 'failed')
      .map((s) => sourceItems.get(s.fileId))
      .filter((f): f is ExportFileItem => f !== undefined)
    if (files.length === 0) return false
    return start(lastSegments, files)
  }

  function cancel() {
    if (taskId && running.value) {
      commands.exportFilesCancel(taskId)
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      unlisten?.()
      unlisten = null
    })
  }

  return {
    itemStates,
    running,
    finished,
    cancelled,
    taskError,
    savedDir,
    total,
    doneCount,
    skippedCount,
    failedCount,
    completedCount,
    start,
    retryFailed,
    cancel,
  }
}
