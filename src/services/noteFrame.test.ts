import { describe, expect, it } from 'vitest'
import type { ServerInfo } from '@/adapters/types'
import { displayAcct, tickerInfo } from './noteFrame'

const remote = {
  username: 'bob',
  host: 'b.example',
  instance: {
    name: 'B',
    faviconUrl: 'https://b.example/fav.png',
    iconUrl: null,
    themeColor: '#123',
  },
}
const local = { username: 'alice', host: null, instance: undefined }
const servers = new Map<string, ServerInfo>([
  [
    'a.example',
    { iconUrl: 'https://a.example/icon.png', themeColor: '#abc' } as ServerInfo,
  ],
])
const lookup = (host: string) => servers.get(host)

describe('displayAcct', () => {
  it('相対表示ではローカルユーザーの host を出さない', () => {
    expect(displayAcct(local, 'a.example', false)).toBe('@alice')
    expect(displayAcct(remote, 'a.example', false)).toBe('@bob@b.example')
  })

  it('絶対表示ではローカルユーザーにも取得元サーバーを補う', () => {
    expect(displayAcct(local, 'a.example', true)).toBe('@alice@a.example')
    expect(displayAcct(remote, 'a.example', true)).toBe('@bob@b.example')
  })
})

describe('tickerInfo', () => {
  it('リモートユーザーは同梱の instance をそのまま使う', () => {
    expect(tickerInfo(remote, 'a.example', false, lookup)).toEqual({
      name: 'B',
      iconUrl: 'https://b.example/fav.png',
      themeColor: '#123',
    })
  })

  it('相対表示ではローカルユーザーにティッカーを出さない', () => {
    expect(tickerInfo(local, 'a.example', false, lookup)).toBeNull()
  })

  it('絶対表示ではローカルユーザーも取得元サーバーの検出情報で出す', () => {
    expect(tickerInfo(local, 'a.example', true, lookup)).toEqual({
      name: 'a.example',
      iconUrl: 'https://a.example/icon.png',
      themeColor: '#abc',
    })
  })

  it('検出情報が無いサーバーは host だけで出す', () => {
    expect(tickerInfo(local, 'x.example', true, lookup)).toEqual({
      name: 'x.example',
      iconUrl: null,
      themeColor: null,
    })
  })
})
