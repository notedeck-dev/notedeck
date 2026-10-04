import { describe, expect, it } from 'vitest'
import {
  allowsAutoContinue,
  decideContinue,
  queryCountsAsCondition,
  shouldStartSearch,
} from './searchRun'

describe('queryCountsAsCondition', () => {
  it('評価されるクエリと fail-closed は条件に数え、fail-open と未設定は数えない', () => {
    expect(queryCountsAsCondition('active')).toBe(true)
    expect(queryCountsAsCondition('degraded')).toBe(true)
    expect(queryCountsAsCondition('invalid')).toBe(true)
    expect(queryCountsAsCondition('none')).toBe(false)
    expect(queryCountsAsCondition('safeMode')).toBe(false)
    expect(queryCountsAsCondition('disabled')).toBe(false)
  })
})

describe('shouldStartSearch (規則は 1 つ)', () => {
  it('検索語 / フィルターの行 / 本文の条件 / 条件に数えるクエリ のいずれかで始める', () => {
    expect(
      shouldStartSearch({ term: 'x', filter: {}, queryStatus: 'none' }),
    ).toBe(true)
    expect(
      shouldStartSearch({
        term: '',
        filter: { since: '2026-01-01' },
        queryStatus: 'none',
      }),
    ).toBe(true)
    expect(
      shouldStartSearch({
        term: '',
        filter: { conditions: [{ type: 'excludes', words: ['bot'] }] },
        queryStatus: 'none',
      }),
    ).toBe(true)
    expect(
      shouldStartSearch({ term: '', filter: {}, queryStatus: 'active' }),
    ).toBe(true)
  })

  it('条件が 1 つも無ければ始めない。止まっている本文の条件も数えない', () => {
    expect(
      shouldStartSearch({ term: '  ', filter: {}, queryStatus: 'none' }),
    ).toBe(false)
    expect(
      shouldStartSearch({
        term: '',
        filter: {
          conditions: [{ type: 'excludes', words: ['bot'] }],
          conditionsPaused: true,
        },
        queryStatus: 'none',
      }),
    ).toBe(false)
  })

  it('セーフモードや全無効のクエリだけでは始めない (索引全件を出さない)', () => {
    expect(
      shouldStartSearch({ term: '', filter: {}, queryStatus: 'safeMode' }),
    ).toBe(false)
    expect(
      shouldStartSearch({ term: '', filter: {}, queryStatus: 'disabled' }),
    ).toBe(false)
    expect(
      shouldStartSearch({ term: '', filter: {}, queryStatus: 'invalid' }),
    ).toBe(true)
  })
})

describe('自動続行', () => {
  it('明示の操作だけが続行を許す', () => {
    expect(allowsAutoContinue('explicit')).toBe(true)
    expect(allowsAutoContinue('typed')).toBe(false)
    expect(allowsAutoContinue('restore')).toBe(false)
  })

  const base = {
    hasMore: true,
    queryBlocked: false,
    scanned: 0,
    limit: 100,
    viewportFilled: false,
    lastAdded: 5,
  }

  it('一画面に満たない間、または直前のページで 1 件も足せなかった間は続ける', () => {
    expect(decideContinue(base)).toBe('continue')
    expect(
      decideContinue({ ...base, viewportFilled: true, lastAdded: 0 }),
    ).toBe('continue')
    expect(
      decideContinue({ ...base, viewportFilled: true, lastAdded: 3 }),
    ).toBe('stop:filled')
  })

  it('索引が尽きた / クエリが止まっている / 上限 で止まり、理由が分かる', () => {
    expect(decideContinue({ ...base, hasMore: false })).toBe('stop:exhausted')
    expect(decideContinue({ ...base, queryBlocked: true })).toBe('stop:blocked')
    expect(decideContinue({ ...base, scanned: 100 })).toBe('stop:limit')
    // 尽きたことが止まっているより優先 (続きが無いなら理由は要らない)
    expect(
      decideContinue({ ...base, hasMore: false, queryBlocked: true }),
    ).toBe('stop:exhausted')
  })
})
