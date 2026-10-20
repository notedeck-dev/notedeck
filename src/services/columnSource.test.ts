import { describe, expect, it } from 'vitest'
import {
  accountSource,
  normalizeSources,
  parseSourceKey,
  sameSource,
  sourceKey,
  withoutAccountSources,
} from './columnSource'

describe('columnSource (#1017 案 2)', () => {
  it('組のキーは往復でき、アカウント単位の組は空の ID になる', () => {
    const key = sourceKey({ accountId: 'acc-a', id: 'list-1' })
    expect(parseSourceKey(key)).toEqual({ accountId: 'acc-a', id: 'list-1' })
    expect(parseSourceKey(sourceKey(accountSource('acc-a')))).toEqual({
      accountId: 'acc-a',
      id: '',
    })
  })

  it('同じ ID でもアカウントが違えば別の組', () => {
    expect(
      sourceKey({ accountId: 'acc-a', id: 'x' }) ===
        sourceKey({ accountId: 'acc-b', id: 'x' }),
    ).toBe(false)
    expect(
      sameSource({ accountId: 'a', id: 'x' }, { accountId: 'a', id: 'x' }),
    ).toBe(true)
    expect(
      sameSource({ accountId: 'a', id: 'x' }, { accountId: 'b', id: 'x' }),
    ).toBe(false)
  })

  it('正規化は空の ID と重複を落とし、順序は保つ', () => {
    expect(
      normalizeSources([
        { accountId: 'a', id: '1', name: 'one' },
        { accountId: 'a', id: '' },
        { accountId: 'b', id: '1' },
        { accountId: 'a', id: '1' },
        { accountId: '', id: '2' },
      ]),
    ).toEqual([
      { accountId: 'a', id: '1', name: 'one' },
      { accountId: 'b', id: '1' },
    ])
    expect(normalizeSources(undefined)).toEqual([])
  })

  it('アカウント削除でそのアカウントの組だけ外す', () => {
    expect(
      withoutAccountSources(
        [
          { accountId: 'a', id: '1' },
          { accountId: 'b', id: '1' },
        ],
        'a',
      ),
    ).toEqual([{ accountId: 'b', id: '1' }])
  })
})
