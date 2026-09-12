import { describe, expect, it } from 'vitest'
import {
  dateBounds,
  hasActiveFilter,
  resolveScopeAccounts,
} from './clientSearch'

const accounts = [
  { id: 'a1', host: 'a.example' },
  { id: 'a2', host: 'A.example' },
  { id: 'b1', host: 'b.example' },
]

describe('resolveScopeAccounts', () => {
  it('未指定は全アカウント', () => {
    expect(resolveScopeAccounts(undefined, accounts)).toEqual([
      'a1',
      'a2',
      'b1',
    ])
    expect(resolveScopeAccounts('', accounts)).toEqual(['a1', 'a2', 'b1'])
  })

  it('server: はそのサーバーの全アカウント (大文字小文字を区別しない)', () => {
    expect(resolveScopeAccounts('server:a.example', accounts)).toEqual([
      'a1',
      'a2',
    ])
  })

  it('account: はそのアカウントだけ。消えたアカウントは空', () => {
    expect(resolveScopeAccounts('account:b1', accounts)).toEqual(['b1'])
    expect(resolveScopeAccounts('account:gone', accounts)).toEqual([])
  })
})

describe('dateBounds', () => {
  it('開始日は 0 時、終了日はその日の終わりまで含む', () => {
    const { since, until } = dateBounds({
      since: '2026-01-02',
      until: '2026-01-03',
    })
    expect(new Date(since as string).getTime()).toBe(
      new Date('2026-01-02T00:00:00').getTime(),
    )
    expect(new Date(until as string).getTime()).toBe(
      new Date('2026-01-03T23:59:59.999').getTime(),
    )
    expect(dateBounds({})).toEqual({ since: null, until: null })
  })
})

describe('hasActiveFilter', () => {
  it('並び順だけでは絞り込み扱いにしない', () => {
    expect(hasActiveFilter({ ascending: true })).toBe(false)
    expect(hasActiveFilter({ author: '  ' })).toBe(false)
    expect(hasActiveFilter({ hasFiles: false })).toBe(true)
    expect(hasActiveFilter({ scope: 'server:a.example' })).toBe(true)
  })
})
