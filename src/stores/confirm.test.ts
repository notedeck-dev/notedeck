import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetConfirmForTest, useConfirm } from './confirm'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  _resetConfirmForTest()
})

describe('useConfirm', () => {
  it('confirm() resolves to true when accepted', async () => {
    const { confirm, resolve } = useConfirm()
    const p = confirm({ title: 't', message: 'm' })
    resolve({ accepted: true, remember: false })
    await expect(p).resolves.toBe(true)
  })

  it('confirm() resolves to false when cancelled', async () => {
    const { confirm, resolve } = useConfirm()
    const p = confirm({ title: 't', message: 'm' })
    resolve({ accepted: false, remember: false })
    await expect(p).resolves.toBe(false)
  })

  it('confirm() ignores remember (= boolean 互換を保つ)', async () => {
    const { confirm, resolve } = useConfirm()
    const p = confirm({ title: 't', message: 'm' })
    resolve({ accepted: true, remember: true })
    await expect(p).resolves.toBe(true)
  })

  it('confirmWithDecision() resolves to the full decision', async () => {
    const { confirmWithDecision, resolve } = useConfirm()
    const p = confirmWithDecision({ title: 't', message: 'm' })
    resolve({ accepted: true, remember: true })
    await expect(p).resolves.toEqual({ accepted: true, remember: true })
  })

  // #716: 起動時に複数ウィジェットが一斉に確認要求すると、旧実装は先行の
  // ダイアログを user_cancelled で横取りして最後の 1 件しか確認できなかった。
  // 同時要求はキューに積み、順番に全件表示する。
  it('同時要求は先行ダイアログを横取りせずキューされる (#716)', async () => {
    const { confirmWithDecision, resolve, options, visible } = useConfirm()
    const first = confirmWithDecision({ title: '1', message: '' })
    const second = confirmWithDecision({ title: '2', message: '' })

    // 表示中は最初の要求のまま (横取りされない)
    expect(visible.value).toBe(true)
    expect(options.value.title).toBe('1')

    resolve({ accepted: true, remember: true })
    await expect(first).resolves.toEqual({ accepted: true, remember: true })

    // leave transition 待ちの後、次のダイアログが表示される
    expect(visible.value).toBe(false)
    vi.runAllTimers()
    expect(visible.value).toBe(true)
    expect(options.value.title).toBe('2')

    resolve({ accepted: false, remember: false })
    await expect(second).resolves.toEqual({ accepted: false, remember: false })
    vi.runAllTimers()
    expect(visible.value).toBe(false)
  })

  it('3 件同時要求は FIFO 順に全件表示・解決される (#716)', async () => {
    const { confirmWithDecision, resolve, options } = useConfirm()
    const decisions = [
      { accepted: true, remember: true },
      { accepted: false, remember: false },
      { accepted: true, remember: false },
    ] as const
    const promises = [1, 2, 3].map((n) =>
      confirmWithDecision({ title: String(n), message: '' }),
    )
    for (const [i, decision] of decisions.entries()) {
      expect(options.value.title).toBe(String(i + 1))
      resolve({ ...decision })
      await expect(promises[i]).resolves.toEqual(decision)
      vi.runAllTimers()
    }
  })

  it('キュー待機中に来た新規要求も末尾に並ぶ (#716)', async () => {
    const { confirmWithDecision, resolve, options } = useConfirm()
    const first = confirmWithDecision({ title: '1', message: '' })
    const second = confirmWithDecision({ title: '2', message: '' })
    resolve({ accepted: true, remember: false })
    await first
    // leave transition 待ちの間 (ダイアログ非表示) に来た要求
    const third = confirmWithDecision({ title: '3', message: '' })
    vi.runAllTimers()
    expect(options.value.title).toBe('2')
    resolve({ accepted: true, remember: false })
    await second
    vi.runAllTimers()
    expect(options.value.title).toBe('3')
    resolve({ accepted: false, remember: false })
    await expect(third).resolves.toEqual({ accepted: false, remember: false })
  })

  // #720: 単一 principal がキューを埋め尽くす DoS を防ぐ。上限超過分は
  // 自動キャンセルで即解決し、既にキューにある正当な確認は保持する。
  it('キューが上限に達したら超過分は自動キャンセルされる (#720)', async () => {
    const { confirmWithDecision, resolve } = useConfirm()
    // 1 件目を表示中にし、残り MAX_QUEUE(32) 件でキューを満たす
    const displayed = confirmWithDecision({ title: 'shown', message: '' })
    const queued: Array<Promise<{ accepted: boolean }>> = []
    for (let i = 0; i < 32; i++) {
      queued.push(confirmWithDecision({ title: `q${i}`, message: '' }))
    }
    // 33 件目 (キュー 33 個目) は上限超過で即キャンセル解決される
    const overflow = confirmWithDecision({ title: 'overflow', message: '' })
    await expect(overflow).resolves.toEqual({
      accepted: false,
      remember: false,
    })

    // 表示中とキュー済みは影響を受けない (overflow だけが落ちる)
    resolve({ accepted: true, remember: false })
    await expect(displayed).resolves.toEqual({
      accepted: true,
      remember: false,
    })
    vi.runAllTimers()
    resolve({ accepted: true, remember: false })
    await expect(queued[0]).resolves.toEqual({
      accepted: true,
      remember: false,
    })
  })

  // #720/#716: 「今後確認しない」で許可したら、キューで待つ同一操作
  // (同じ dedupKey) は再度聞かず同じ許可で自動解決する。
  it('remember 許可はキュー内の同一操作を自動承認する (#720)', async () => {
    const { confirmWithDecision, resolve } = useConfirm()
    const KEY = 'plugin:widget:w1:http.fetch'
    const first = confirmWithDecision({
      title: 'http',
      message: '',
      dedupKey: KEY,
    })
    const sameA = confirmWithDecision({
      title: 'http',
      message: '',
      dedupKey: KEY,
    })
    const sameB = confirmWithDecision({
      title: 'http',
      message: '',
      dedupKey: KEY,
    })
    // 別操作 (異なる dedupKey) は波及しない
    const other = confirmWithDecision({
      title: 'other',
      message: '',
      dedupKey: 'plugin:widget:w1:notes.write',
    })

    // 1 件目を「今後確認しない」で許可
    resolve({ accepted: true, remember: true })
    await expect(first).resolves.toEqual({ accepted: true, remember: true })
    // 同一 dedupKey の待機分は自動承認 (remember は記録済みなので false で返す)
    await expect(sameA).resolves.toEqual({ accepted: true, remember: false })
    await expect(sameB).resolves.toEqual({ accepted: true, remember: false })

    // 別操作は自動承認されず、通常どおり次に表示される
    vi.runAllTimers()
    resolve({ accepted: false, remember: false })
    await expect(other).resolves.toEqual({ accepted: false, remember: false })
  })

  it('remember なし許可では同一操作を自動承認しない (#720)', async () => {
    const { confirmWithDecision, resolve } = useConfirm()
    const KEY = 'plugin:widget:w1:http.fetch'
    const first = confirmWithDecision({
      title: 'http',
      message: '',
      dedupKey: KEY,
    })
    const same = confirmWithDecision({
      title: 'http',
      message: '',
      dedupKey: KEY,
    })

    // remember なしで許可 → 波及しない (待機分は個別に確認される)
    resolve({ accepted: true, remember: false })
    await expect(first).resolves.toEqual({ accepted: true, remember: false })
    vi.runAllTimers()
    resolve({ accepted: false, remember: false })
    await expect(same).resolves.toEqual({ accepted: false, remember: false })
  })
})
