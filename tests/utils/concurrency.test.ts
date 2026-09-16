import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from '@/utils/concurrency'

const defer = <T>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('mapWithConcurrency', () => {
  it('結果は入力順、rejected は包んで返す', async () => {
    const results = await mapWithConcurrency(
      [1, 2, 3],
      async (n) => {
        if (n === 2) throw new Error('boom')
        return n * 10
      },
      2,
    )
    expect(results).toEqual([
      { status: 'fulfilled', value: 10 },
      { status: 'rejected', reason: new Error('boom') },
      { status: 'fulfilled', value: 30 },
    ])
  })

  it('onSettled は完了順に呼ばれ、進捗 (done / total) を伴う (#1095)', async () => {
    const slow = defer<string>()
    const fast = defer<string>()
    const seen: Array<{ item: string; done: number; total: number }> = []

    const run = mapWithConcurrency(
      ['slow', 'fast'],
      (item) => (item === 'slow' ? slow.promise : fast.promise),
      2,
      (r, item, progress) => {
        expect(r.status).toBe('fulfilled')
        seen.push({ item, ...progress })
      },
    )
    fast.resolve('b')
    await Promise.resolve()
    slow.resolve('a')
    const results = await run

    expect(seen).toEqual([
      { item: 'fast', done: 1, total: 2 },
      { item: 'slow', done: 2, total: 2 },
    ])
    // 戻り値は入力順のまま
    expect(
      results.map((r) => (r.status === 'fulfilled' ? r.value : null)),
    ).toEqual(['a', 'b'])
  })

  it('onSettled は直列に実行され、全部終わってから resolve する', async () => {
    const gate = defer<void>()
    const log: string[] = []
    let resolved = false

    const run = mapWithConcurrency(
      [1, 2],
      async (n) => n,
      2,
      async (r) => {
        const v = r.status === 'fulfilled' ? r.value : 0
        log.push(`start ${v}`)
        if (v === 1) await gate.promise
        log.push(`end ${v}`)
      },
    ).then(() => {
      resolved = true
    })

    await new Promise((r) => setTimeout(r, 0))
    // 1 件目のコールバックが終わるまで 2 件目は始まらない
    expect(log).toEqual(['start 1'])
    expect(resolved).toBe(false)

    gate.resolve()
    await run
    expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2'])
  })
})
