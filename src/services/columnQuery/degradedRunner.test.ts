import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ColumnQueryWorkerRequest,
  ColumnQueryWorkerResponse,
} from '@/workers/columnQueryWorker'
import { createDegradedRunner } from './degradedRunner'

/**
 * Worker の代役。postMessage された内容を記録し、テストから応答を差し込む。
 * `hang` を立てたフィルタは begin だけ出して done を返さない (暴走の再現)。
 */
class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((e: MessageEvent<ColumnQueryWorkerResponse>) => void) | null =
    null
  onerror: ((e: unknown) => void) | null = null
  requests: ColumnQueryWorkerRequest[] = []
  terminated = false
  /** このキーのフィルタに当たったら応答を止める */
  static hangOn: string | null = null

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(req: ColumnQueryWorkerRequest): void {
    this.requests.push(req)
    queueMicrotask(() => {
      if (this.terminated) return
      for (const f of req.filters) {
        this.emit({ type: 'begin', id: req.id, key: f.key })
        if (FakeWorker.hangOn === f.key) return // done を返さない
      }
      this.emit({
        type: 'done',
        id: req.id,
        verdicts: req.notes.map(() => 'match' as const),
        invalidFilters: [],
      })
    })
  }

  terminate(): void {
    this.terminated = true
  }

  private emit(data: ColumnQueryWorkerResponse): void {
    this.onmessage?.({ data } as MessageEvent<ColumnQueryWorkerResponse>)
  }
}

const makeRunner = (timeoutMs = 1000) =>
  createDegradedRunner({
    workerFactory: () => new FakeWorker() as unknown as Worker,
    timeoutMs,
  })

const notes = [{ id: 'a' }, { id: 'b' }]

beforeEach(() => {
  FakeWorker.instances = []
  FakeWorker.hangOn = null
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createDegradedRunner: 正常系', () => {
  it('Worker の判定をそのまま返す', async () => {
    const runner = makeRunner()
    const p = runner.run([{ key: 'f1', source: 'true' }], notes)
    await vi.runAllTimersAsync()
    const out = await p
    expect(out.verdicts).toEqual(['match', 'match'])
    expect(out.suspended).toEqual([])
    runner.dispose()
  })

  it('Worker は使い回す (バッチごとに作り直さない)', async () => {
    const runner = makeRunner()
    const spec = [{ key: 'f1', source: 'true' }]
    await vi.runAllTimersAsync()
    const p1 = runner.run(spec, notes)
    await vi.runAllTimersAsync()
    await p1
    const p2 = runner.run(spec, notes)
    await vi.runAllTimersAsync()
    await p2
    expect(FakeWorker.instances).toHaveLength(1)
    runner.dispose()
  })
})

describe('createDegradedRunner: 暴走の打ち切り (V15/V23)', () => {
  it('タイムアウトで Worker を terminate する', async () => {
    FakeWorker.hangOn = 'runaway'
    const runner = makeRunner()
    const p = runner.run([{ key: 'runaway', source: 'loop {}' }], notes)
    await vi.runAllTimersAsync()
    await p
    expect(FakeWorker.instances[0]?.terminated).toBe(true)
    runner.dispose()
  })

  it('最後に開始したフィルタを犯人としてサスペンドする', async () => {
    FakeWorker.hangOn = 'runaway'
    const runner = makeRunner()
    const p = runner.run(
      [
        { key: 'ok', source: 'true' },
        { key: 'runaway', source: 'loop {}' },
      ],
      notes,
    )
    await vi.runAllTimersAsync()
    const out = await p
    expect(out.suspended).toEqual(['runaway'])
    expect(runner.isSuspended('runaway')).toBe(true)
    expect(runner.isSuspended('ok')).toBe(false)
    runner.dispose()
  })

  it('Worker を再起動して残りのフィルタを再評価する', async () => {
    FakeWorker.hangOn = 'runaway'
    const runner = makeRunner()
    const p = runner.run(
      [
        { key: 'runaway', source: 'loop {}' },
        { key: 'ok', source: 'true' },
      ],
      notes,
    )
    await vi.runAllTimersAsync()
    await p
    // 1 台目は terminate、2 台目で残りを評価
    expect(FakeWorker.instances).toHaveLength(2)
    expect(
      FakeWorker.instances[1]?.requests[0]?.filters.map((f) => f.key),
    ).toEqual(['ok'])
    runner.dispose()
  })

  it('サスペンドしたフィルタを含むバッチは fail-closed (全件除外)', async () => {
    FakeWorker.hangOn = 'runaway'
    const runner = makeRunner()
    const first = runner.run([{ key: 'runaway', source: 'loop {}' }], notes)
    await vi.runAllTimersAsync()
    await first

    FakeWorker.hangOn = null
    const second = runner.run([{ key: 'runaway', source: 'loop {}' }], notes)
    await vi.runAllTimersAsync()
    const out = await second
    expect(out.verdicts).toEqual(['error', 'error'])
    // サスペンド中は Worker を起こしもしない (1 台目は terminate 済み)
    expect(FakeWorker.instances).toHaveLength(1)
    runner.dispose()
  })

  it('明示再開でサスペンドを解除する', async () => {
    FakeWorker.hangOn = 'runaway'
    const runner = makeRunner()
    const first = runner.run([{ key: 'runaway', source: 'loop {}' }], notes)
    await vi.runAllTimersAsync()
    await first
    expect(runner.suspendedKeys()).toEqual(['runaway'])

    FakeWorker.hangOn = null
    runner.resume('runaway')
    expect(runner.isSuspended('runaway')).toBe(false)
    const second = runner.run([{ key: 'runaway', source: 'note.text' }], notes)
    await vi.runAllTimersAsync()
    const out = await second
    expect(out.verdicts).toEqual(['match', 'match'])
    runner.dispose()
  })
})

describe('createDegradedRunner: 巻き添えの防止', () => {
  it('他バッチの terminate に巻き込まれても犯人扱いしない', async () => {
    FakeWorker.hangOn = 'runaway'
    const runner = makeRunner()
    // 先に暴走バッチ、後から無関係なバッチ (同じ Worker を共有する)
    const runaway = runner.run([{ key: 'runaway', source: 'loop {}' }], notes)
    const bystander = runner.run([{ key: 'innocent', source: 'true' }], notes)
    await vi.runAllTimersAsync()
    await runaway
    const out = await bystander

    // 巻き添え側は fail-closed で返るが、フィルタはサスペンドしない
    expect(out.suspended).toEqual([])
    expect(runner.isSuspended('innocent')).toBe(false)
    expect(runner.isSuspended('runaway')).toBe(true)
    runner.dispose()
  })
})

describe('createDegradedRunner: 空入力', () => {
  it('フィルタが無ければ Worker を起こさず全件 match', async () => {
    const runner = makeRunner()
    const out = await runner.run([], notes)
    expect(out.verdicts).toEqual(['match', 'match'])
    expect(FakeWorker.instances).toHaveLength(0)
    runner.dispose()
  })

  it('ノートが無ければ Worker を起こさない', async () => {
    const runner = makeRunner()
    const out = await runner.run([{ key: 'f1', source: 'true' }], [])
    expect(out.verdicts).toEqual([])
    expect(FakeWorker.instances).toHaveLength(0)
    runner.dispose()
  })
})
