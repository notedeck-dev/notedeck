import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createWorkerClient,
  WorkerAbortedError,
  WorkerTimeoutError,
} from './workerClient'

/** 応答を手で返す偽 Worker。terminate の回数も数える */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  posted: Array<Record<string, unknown>> = []
  terminated = 0
  postMessage(data: Record<string, unknown>) {
    this.posted.push(data)
  }
  terminate() {
    this.terminated++
  }
  reply(id: number, extra: Record<string, unknown> = {}) {
    this.onmessage?.({ data: { id, ...extra } } as MessageEvent)
  }
}

describe('createWorkerClient の時間上限', () => {
  const workers: FakeWorker[] = []
  const factory = () => {
    const w = new FakeWorker()
    workers.push(w)
    return w as unknown as Worker
  }

  beforeEach(() => {
    vi.useFakeTimers()
    workers.length = 0
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('期限内に返れば解決し、タイマーは残らない', async () => {
    const client = createWorkerClient<{ id: number; v: number }>(factory, {
      timeoutMs: 1000,
    })
    const p = client.post({ type: 'x' })
    workers[0]?.reply(0, { v: 42 })
    await expect(p).resolves.toMatchObject({ v: 42 })
    vi.advanceTimersByTime(5000)
    expect(workers[0]?.terminated).toBe(0)
  })

  it('期限を超えたら Worker を止め、その要求は時間切れ、他の待ちは巻き添えとして即座に失敗する', async () => {
    const client = createWorkerClient<{ id: number }>(factory, {
      timeoutMs: 1000,
    })
    const slow = client.post({ type: 'slow' })
    vi.advanceTimersByTime(500)
    const bystander = client.post({ type: 'other' })
    vi.advanceTimersByTime(600)
    await expect(slow).rejects.toBeInstanceOf(WorkerTimeoutError)
    await expect(bystander).rejects.toBeInstanceOf(WorkerAbortedError)
    expect(workers[0]?.terminated).toBe(1)
  })

  it('止めた後の次の要求は新しい Worker で普通に動く', async () => {
    const client = createWorkerClient<{ id: number }>(factory, {
      timeoutMs: 1000,
    })
    const first = client.post({ type: 'slow' })
    vi.advanceTimersByTime(1000)
    await expect(first).rejects.toBeInstanceOf(WorkerTimeoutError)
    const next = client.post({ type: 'ok' })
    expect(workers).toHaveLength(2)
    const id = workers[1]?.posted[0]?.id as number
    workers[1]?.reply(id)
    await expect(next).resolves.toMatchObject({ id })
  })

  it('時間上限なし (既定) では待ち続ける', async () => {
    const client = createWorkerClient<{ id: number }>(factory)
    const p = client.post({ type: 'x' })
    vi.advanceTimersByTime(60_000)
    expect(workers[0]?.terminated).toBe(0)
    workers[0]?.reply(0)
    await expect(p).resolves.toMatchObject({ id: 0 })
  })
})
