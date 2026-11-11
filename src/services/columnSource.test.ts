import { describe, expect, it } from 'vitest'
import {
  accountSource,
  missingSourceAccounts,
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

describe('missingSourceAccounts (#1354)', () => {
  const has = (id: string) => id === 'here'

  it('手元に無いアカウントの組を user@host で返す (重複は 1 つ)', () => {
    expect(
      missingSourceAccounts(
        [
          { accountId: 'here', account: 'a@x.example', id: '1' },
          { accountId: 'unbound:b@y.example', account: 'b@y.example', id: '2' },
          { accountId: 'unbound:b@y.example', account: 'b@y.example', id: '3' },
        ],
        has,
      ),
    ).toEqual(['b@y.example'])
  })

  it('account を持たない古い組は null (名前が分からない) で返す', () => {
    expect(
      missingSourceAccounts([{ accountId: 'other-machine', id: '1' }], has),
    ).toEqual([null])
  })

  it('全部手元にあれば空', () => {
    expect(
      missingSourceAccounts([{ accountId: 'here', id: '1' }], has),
    ).toEqual([])
  })
})
