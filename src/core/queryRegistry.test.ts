import { afterEach, describe, expect, it } from 'vitest'
import type { QueryKey } from '@/bindings'
import {
  _resetQueryRegistryForTest,
  getQueryInfo,
  registerQuery,
  unregisterQuery,
} from './queryRegistry'

const timelineKey = (accountId: string): QueryKey => ({
  kind: 'timeline',
  account_id: accountId,
  key: 'home',
})

describe('queryRegistry', () => {
  afterEach(() => {
    _resetQueryRegistryForTest()
  })

  it('登録した query の info が引ける', () => {
    registerQuery('q-1', timelineKey('acc-1'))
    expect(getQueryInfo('q-1')).toEqual({
      flavor: 'note',
      accountId: 'acc-1',
    })
    unregisterQuery('q-1')
    expect(getQueryInfo('q-1')).toBeUndefined()
  })

  it('共有 query は refcount され、片方の解除では消えない', () => {
    // Rust QueryRuntime は同一 key の query を dedup するため、同じ queryId を
    // 複数購読 (per-account 通知カラム + cross-account 通知カラム等) が共有する
    registerQuery('q-shared', timelineKey('acc-1'))
    registerQuery('q-shared', timelineKey('acc-1'))

    unregisterQuery('q-shared')
    expect(getQueryInfo('q-shared')).toBeDefined()

    unregisterQuery('q-shared')
    expect(getQueryInfo('q-shared')).toBeUndefined()
  })

  it('未登録 queryId の解除は無害', () => {
    unregisterQuery('q-unknown')
    expect(getQueryInfo('q-unknown')).toBeUndefined()
  })
})
