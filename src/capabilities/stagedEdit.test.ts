import { describe, expect, it } from 'vitest'
import { stageEdit, takeStagedEdit } from './stagedEdit'
import type { CapabilityContext } from './types'

describe('stageEdit', () => {
  it('確認で見せた適用後全文を ctx に載せて返す', () => {
    const ctx: CapabilityContext = {}
    expect(stageEdit(ctx, 'old', 'new')).toBe('new')
    expect(ctx.stagedEdit).toEqual({ baseline: 'old', next: 'new' })
  })

  it('ctx が無い経路 (直接 execute) でも値を返すだけで落ちない', () => {
    expect(stageEdit(undefined, 'old', 'new')).toBe('new')
  })
})

describe('takeStagedEdit', () => {
  it('確認で見せた全文をそのまま返す (再計算しない)', () => {
    const ctx: CapabilityContext = { stagedEdit: { baseline: 'a', next: 'b' } }
    expect(takeStagedEdit(ctx, 'x.write', 'a', () => 'recomputed')).toBe('b')
  })

  it('一度使ったら消費する (同じ ctx の再利用で二重適用しない)', () => {
    const ctx: CapabilityContext = { stagedEdit: { baseline: 'a', next: 'b' } }
    takeStagedEdit(ctx, 'x.write', 'a', () => 'recomputed')
    expect(ctx.stagedEdit).toBeUndefined()
    expect(takeStagedEdit(ctx, 'x.write', 'a', () => 'recomputed')).toBe(
      'recomputed',
    )
  })

  it('確認を経ていなければ fallback を計算する', () => {
    expect(takeStagedEdit({}, 'x.write', 'a', () => 'recomputed')).toBe(
      'recomputed',
    )
    expect(takeStagedEdit(undefined, 'x.write', 'a', () => 'recomputed')).toBe(
      'recomputed',
    )
  })

  it('確認後に元が変わっていたら書かずに投げる', () => {
    const ctx: CapabilityContext = { stagedEdit: { baseline: 'a', next: 'b' } }
    expect(() =>
      takeStagedEdit(ctx, 'x.write', 'changed', () => 'recomputed'),
    ).toThrow(/x\.write/)
    expect(() =>
      takeStagedEdit(
        { stagedEdit: { baseline: 'a', next: 'b' } },
        'x.write',
        'changed',
        () => 'recomputed',
      ),
    ).toThrow(/確認後/)
  })
})
