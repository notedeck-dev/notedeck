import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExportProgress } from '@/bindings'
import { useFileExport } from '@/composables/useFileExport'

const listenMock = vi.fn()
const startMock = vi.fn()
const cancelMock = vi.fn()

vi.mock('@/bindings', () => ({
  events: {
    exportProgress: {
      listen: (...args: unknown[]) => listenMock(...args),
    },
  },
}))

vi.mock('@/utils/tauriInvoke', () => ({
  commands: {
    exportFilesStart: (...args: unknown[]) => startMock(...args),
    exportFilesCancel: (...args: unknown[]) => cancelMock(...args),
  },
}))

type Handler = (event: { payload: ExportProgress }) => void
let handler: Handler | null = null
const unlistenMock = vi.fn()

function makeFiles(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    fileId: `f${i + 1}`,
    url: `https://example.com/${i + 1}.jpg`,
    name: `photo${i + 1}.jpg`,
  }))
}

/** 直近の start 呼び出しで使われた taskId を返す */
function startedTaskId(): string {
  return startMock.mock.calls.at(-1)?.[0] as string
}

function emit(over: Partial<ExportProgress>) {
  handler?.({
    payload: {
      taskId: startedTaskId(),
      fileId: '',
      status: 'finished',
      error: null,
      done: 0,
      total: 0,
      ...over,
    },
  })
}

describe('useFileExport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handler = null
    listenMock.mockImplementation(async (cb: Handler) => {
      handler = cb
      return unlistenMock
    })
    startMock.mockResolvedValue({ status: 'ok', data: '/downloads/notedeck/x' })
  })

  it('start はファイルを pending で初期化し、コマンドを呼んで running になる', async () => {
    const ex = useFileExport()
    const ok = await ex.start(['example.com', 'alice'], makeFiles(2))
    expect(ok).toBe(true)
    expect(ex.running.value).toBe(true)
    expect(ex.itemStates.value.map((s) => s.status)).toEqual([
      'pending',
      'pending',
    ])
    expect(startMock).toHaveBeenCalledWith(
      expect.any(String),
      ['example.com', 'alice'],
      makeFiles(2),
    )
    expect(ex.savedDir.value).toBe('/downloads/notedeck/x')
  })

  it('進捗イベントで saving→done/skipped/failed が反映されカウントされる', async () => {
    const ex = useFileExport()
    await ex.start(['example.com'], makeFiles(3))

    emit({ fileId: 'f1', status: 'saving' })
    expect(ex.itemStates.value[0]?.status).toBe('saving')

    emit({ fileId: 'f1', status: 'done', done: 1, total: 3 })
    emit({ fileId: 'f2', status: 'skipped', done: 2, total: 3 })
    emit({
      fileId: 'f3',
      status: 'failed',
      error: 'HTTP 404',
      done: 3,
      total: 3,
    })

    expect(ex.doneCount.value).toBe(1)
    expect(ex.skippedCount.value).toBe(1)
    expect(ex.failedCount.value).toBe(1)
    expect(ex.completedCount.value).toBe(3)
    expect(ex.itemStates.value[2]?.error).toBe('HTTP 404')
    expect(ex.running.value).toBe(true)

    emit({ fileId: '', status: 'finished', done: 3, total: 3 })
    expect(ex.running.value).toBe(false)
    expect(ex.finished.value).toBe(true)
    expect(ex.cancelled.value).toBe(false)
    expect(unlistenMock).toHaveBeenCalled()
  })

  it('別タスクのイベントは無視する', async () => {
    const ex = useFileExport()
    await ex.start(['example.com'], makeFiles(1))
    emit({ taskId: 'other-task', fileId: 'f1', status: 'done' })
    expect(ex.doneCount.value).toBe(0)
    expect(ex.itemStates.value[0]?.status).toBe('pending')
  })

  it('cancel はコマンドを呼び、cancelled イベントで終了フラグが立つ', async () => {
    const ex = useFileExport()
    await ex.start(['example.com'], makeFiles(1))
    ex.cancel()
    expect(cancelMock).toHaveBeenCalledWith(startedTaskId())
    emit({ fileId: '', status: 'cancelled' })
    expect(ex.running.value).toBe(false)
    expect(ex.cancelled.value).toBe(true)
  })

  it('retryFailed は失敗分のみを同じ保存先で再投入する', async () => {
    const ex = useFileExport()
    await ex.start(['example.com', 'alice'], makeFiles(3))
    emit({ fileId: 'f1', status: 'done', done: 1, total: 3 })
    emit({ fileId: 'f2', status: 'failed', error: 'x', done: 2, total: 3 })
    emit({ fileId: 'f3', status: 'failed', error: 'x', done: 3, total: 3 })
    emit({ fileId: '', status: 'finished', done: 3, total: 3 })

    const ok = await ex.retryFailed()
    expect(ok).toBe(true)
    expect(startMock).toHaveBeenLastCalledWith(
      expect.any(String),
      ['example.com', 'alice'],
      [makeFiles(3)[1], makeFiles(3)[2]],
    )
    expect(ex.itemStates.value).toHaveLength(2)
  })

  it('実行中は start も retryFailed も受け付けない', async () => {
    const ex = useFileExport()
    await ex.start(['example.com'], makeFiles(1))
    expect(await ex.start(['example.com'], makeFiles(1))).toBe(false)
    expect(await ex.retryFailed()).toBe(false)
    expect(startMock).toHaveBeenCalledTimes(1)
  })

  it('コマンドがエラーを返したら running を戻して taskError を立てる', async () => {
    startMock.mockResolvedValue({ status: 'error', error: 'no items' })
    const ex = useFileExport()
    const ok = await ex.start(['example.com'], makeFiles(1))
    expect(ok).toBe(false)
    expect(ex.running.value).toBe(false)
    expect(ex.taskError.value).toBe('no items')
    expect(unlistenMock).toHaveBeenCalled()
  })
})
