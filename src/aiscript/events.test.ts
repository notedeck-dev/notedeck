import { describe, expect, it } from 'vitest'
import { diffColumns, diffStreamingStates } from './events'

// Note: subscribeNoteDeckEvent 本体は Pinia store の watch に依存するため、
// ロジックの単体テストは差分計算ヘルパに切り出して検証する。実 watch の挙動は
// 実機で確認する。

describe('diffColumns', () => {
  it('returns empty added/removedIds when nothing changed', () => {
    const prev = new Set(['a', 'b'])
    const result = diffColumns(prev, [
      { id: 'a', type: 'timeline', name: null, accountId: null },
      { id: 'b', type: 'search', name: null, accountId: null },
    ])
    expect(result.added).toEqual([])
    expect(result.removedIds).toEqual([])
    expect(result.next).toEqual(new Set(['a', 'b']))
  })

  it('detects newly added columns', () => {
    const prev = new Set(['a'])
    const result = diffColumns(prev, [
      { id: 'a', type: 'timeline', name: null, accountId: null },
      { id: 'b', type: 'search', name: 'My search', accountId: 'acc-1' },
    ])
    expect(result.added).toEqual([
      { id: 'b', type: 'search', name: 'My search', accountId: 'acc-1' },
    ])
    expect(result.removedIds).toEqual([])
  })

  it('detects removed columns', () => {
    const prev = new Set(['a', 'b', 'c'])
    const result = diffColumns(prev, [
      { id: 'a', type: 'timeline', name: null, accountId: null },
    ])
    expect(result.added).toEqual([])
    expect(result.removedIds.sort()).toEqual(['b', 'c'])
  })

  it('detects added and removed in the same diff', () => {
    const prev = new Set(['a', 'b'])
    const result = diffColumns(prev, [
      { id: 'a', type: 'timeline', name: null, accountId: null },
      { id: 'c', type: 'notifications', name: null, accountId: null },
    ])
    expect(result.added.map((c) => c.id)).toEqual(['c'])
    expect(result.removedIds).toEqual(['b'])
  })
})

describe('diffStreamingStates', () => {
  it('returns no changes when states are identical', () => {
    expect(
      diffStreamingStates(
        { 'acc-1': 'online', 'acc-2': 'offline' },
        { 'acc-1': 'online', 'acc-2': 'offline' },
      ),
    ).toEqual([])
  })

  it('detects status transitions', () => {
    expect(
      diffStreamingStates(
        { 'acc-1': 'online' },
        { 'acc-1': 'offline', 'acc-2': 'online' },
      ),
    ).toEqual([
      { accountId: 'acc-1', status: 'offline' },
      { accountId: 'acc-2', status: 'online' },
    ])
  })

  it('returns the change row for an account newly seen in current', () => {
    expect(diffStreamingStates({}, { 'acc-1': 'unknown' })).toEqual([
      { accountId: 'acc-1', status: 'unknown' },
    ])
  })
})
