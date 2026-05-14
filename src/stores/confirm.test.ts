import { describe, expect, it } from 'vitest'
import { useConfirm } from './confirm'

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

  it('opening a new dialog rejects the previous one as not-accepted', async () => {
    const { confirmWithDecision, resolve } = useConfirm()
    const first = confirmWithDecision({ title: '1', message: '' })
    const second = confirmWithDecision({ title: '2', message: '' })
    await expect(first).resolves.toEqual({ accepted: false, remember: false })
    resolve({ accepted: true, remember: false })
    await expect(second).resolves.toEqual({ accepted: true, remember: false })
  })
})
