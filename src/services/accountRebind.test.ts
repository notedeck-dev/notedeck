import { describe, expect, it } from 'vitest'
import {
  isUnboundAccountId,
  placeholderAccountIds,
  portableAccountId,
  type RebindableAccount,
  type RebindableColumn,
  rebindColumns,
  stripMachineAccountIds,
} from './accountRebind'

const alice: RebindableAccount = {
  id: 'uuid-a',
  host: 'misskey.example',
  username: 'alice',
  userId: 'u1',
  hasToken: true,
}
const guest: RebindableAccount = {
  id: 'uuid-g',
  host: 'misskey.example',
  username: '',
  userId: '__guest__',
  hasToken: false,
}

describe('accountRebind (#1332)', () => {
  it('portable id は user@host、ゲストは無し', () => {
    expect(portableAccountId(alice)).toBe('alice@misskey.example')
    expect(portableAccountId(guest)).toBeNull()
  })

  it('この機械にある accountId には account を埋め、無ければ account で付け替える', () => {
    const cols: RebindableColumn[] = [
      { id: 'c1', accountId: 'uuid-a' },
      {
        id: 'c2',
        accountId: 'other-machine',
        account: 'alice@misskey.example',
      },
      { id: 'c3', accountId: 'other-machine', account: 'bob@misskey.example' },
      { id: 'c4', accountId: null },
    ]
    const r = rebindColumns(cols, [alice, guest])
    expect(r.changed).toBe(true)
    expect(r.columns[0]).toEqual({
      id: 'c1',
      accountId: 'uuid-a',
      account: 'alice@misskey.example',
    })
    expect(r.columns[1]).toEqual({
      id: 'c2',
      accountId: 'uuid-a',
      account: 'alice@misskey.example',
    })
    // 一致が無い列はそのまま残す (カラムは消さない)
    expect(r.columns[2]).toEqual(cols[2])
    expect(r.unbound).toEqual(['c3'])
    expect(r.columns[3]).toBe(cols[3])
  })

  it('ファイルには account だけを書き、読むときは unbound: の印を置く', () => {
    const cols: RebindableColumn[] = [
      { id: 'c1', accountId: 'uuid-a', account: 'alice@misskey.example' },
      { id: 'c2', accountId: null },
      { id: 'c3', accountId: 'uuid-g' },
    ]
    const written = stripMachineAccountIds(cols)
    expect(written[0]).toEqual({ id: 'c1', account: 'alice@misskey.example' })
    expect(written[1]).toEqual({ id: 'c2', accountId: null })
    expect(written[2]).toEqual({ id: 'c3', accountId: 'uuid-g' })
    const read = placeholderAccountIds(written)
    expect(read[0]?.accountId).toBe('unbound:alice@misskey.example')
    expect(isUnboundAccountId(read[0]?.accountId)).toBe(true)
    // 再結合でこの機械の UUID に置き換わる
    expect(rebindColumns(read, [alice]).columns[0]?.accountId).toBe('uuid-a')
  })

  it('何も変わらなければ changed は false で、入力は変えない', () => {
    const cols: RebindableColumn[] = [
      { id: 'c1', accountId: 'uuid-a', account: 'alice@misskey.example' },
    ]
    const r = rebindColumns(cols, [alice])
    expect(r.changed).toBe(false)
    expect(r.columns[0]).toBe(cols[0])
    expect(r.unbound).toEqual([])
  })
})
