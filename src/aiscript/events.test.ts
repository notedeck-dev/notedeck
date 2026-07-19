import { afterEach, describe, expect, it } from 'vitest'
import type { QueryItem, QueryKey } from '@/bindings'
import { registerQuery, unregisterQuery } from '@/core/queryRegistry'
import {
  _resetEventStateForTest,
  diffColumns,
  diffStreamingStates,
  extractInsertIds,
  SUPPORTED_EVENT_NAMES,
  subscribeNoteDeckEvent,
} from './events'

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

const noop = (): void => {
  /* test handler placeholder */
}

describe('SUPPORTED_EVENT_NAMES', () => {
  it('includes the Phase 1 + Phase 2 + v0.24 events', () => {
    expect(SUPPORTED_EVENT_NAMES).toEqual([
      'account:switch',
      'column:added',
      'column:removed',
      'streaming:status',
      'note:new',
      'notification:new',
      'memo:created',
      'memo:updated',
      'memo:deleted',
      'skill:edited',
      'theme:applied',
    ])
  })
})

describe('extractInsertIds', () => {
  it('returns the id field from each item', () => {
    // #781: inserts は typed QueryItem[]。id の存在は型契約が保証するので
    // テストは形の最小表現で足りる。
    const items = [
      { kind: 'note', id: 'a', text: 'hello' },
      { kind: 'notification', id: 'b' },
    ] as unknown as QueryItem[]
    expect(extractInsertIds(items)).toEqual(['a', 'b'])
  })

  it('returns empty for an empty array', () => {
    expect(extractInsertIds([])).toEqual([])
  })
})

describe('subscribeNoteDeckEvent (Phase 2: note:new / notification:new)', () => {
  afterEach(() => {
    _resetEventStateForTest()
  })

  function timelineKey(accountId: string): QueryKey {
    return {
      kind: 'timeline',
      account_id: accountId,
      timeline_type: 'home',
      list_id: null,
    }
  }

  function notificationsKey(accountId: string): QueryKey {
    return { kind: 'notifications', account_id: accountId }
  }

  function chatUserKey(accountId: string, otherId: string): QueryKey {
    return { kind: 'chatUser', account_id: accountId, other_id: otherId }
  }

  it('rejects unsupported event names with a helpful error', () => {
    expect(() =>
      subscribeNoteDeckEvent(
        // biome-ignore lint/suspicious/noExplicitAny: テストで未知 event を渡す
        'something:weird' as any,
        noop,
      ),
    ).toThrow()
  })

  it('returns an unsubscribe function for note:new and removes the handler', () => {
    const unsub = subscribeNoteDeckEvent('note:new', noop)
    expect(typeof unsub).toBe('function')
    unsub()
  })

  it('registerQuery + unregisterQuery do not throw', () => {
    expect(() => {
      registerQuery('q-1', timelineKey('acc-1'))
      registerQuery('q-2', notificationsKey('acc-1'))
      registerQuery('q-3', chatUserKey('acc-1', 'user-x'))
      unregisterQuery('q-1')
      unregisterQuery('q-2')
      unregisterQuery('q-3')
    }).not.toThrow()
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
