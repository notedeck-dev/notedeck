import { describe, expect, it } from 'vitest'
import {
  acctKeyOf,
  acctOf,
  hostParamFor,
  normalizeAcctHost,
  parseUserRef,
} from './userRef'

describe('parseUserRef (#1185)', () => {
  it('@ 表記を分解する', () => {
    expect(parseUserRef('@alice')).toEqual({ username: 'alice', host: null })
    expect(parseUserRef('@alice@Misskey.IO')).toEqual({
      username: 'alice',
      host: 'misskey.io',
    })
    expect(parseUserRef('alice@misskey.io')).toEqual({
      username: 'alice',
      host: 'misskey.io',
    })
    expect(parseUserRef('  @alice_01@a.example  ')).toEqual({
      username: 'alice_01',
      host: 'a.example',
    })
  })

  it('裸の語と不正な username は null (照会ではノート ID として扱う)', () => {
    expect(parseUserRef('alice')).toBeNull()
    expect(parseUserRef('9abcdef0123')).toBeNull()
    expect(parseUserRef('@ali ce')).toBeNull()
    expect(parseUserRef('@alice@')).toBeNull()
    expect(parseUserRef('@a@b@c')).toBeNull()
    expect(parseUserRef('')).toBeNull()
  })

  it('プロフィール URL を acct に変換する (host は URL の host、@user@host2 なら後者)', () => {
    expect(parseUserRef('https://misskey.io/@alice')).toEqual({
      username: 'alice',
      host: 'misskey.io',
    })
    expect(parseUserRef('https://a.example/@alice@b.example/')).toEqual({
      username: 'alice',
      host: 'b.example',
    })
    expect(parseUserRef('https://a.example/@ali%20ce')).toBeNull()
    expect(parseUserRef('https://a.example/notes/abc')).toBeNull()
  })

  it('host は IDNA の ASCII 化 + 小文字', () => {
    expect(parseUserRef('@alice@日本語.Example')).toEqual({
      username: 'alice',
      host: 'xn--wgv71a119e.example',
    })
  })
})

describe('normalizeAcctHost / acctOf / acctKeyOf', () => {
  it('束ねキーは username 小文字 + 正規化 host、表示用は素のまま', () => {
    expect(normalizeAcctHost('Misskey.IO')).toBe('misskey.io')
    expect(normalizeAcctHost('日本語.example')).toBe('xn--wgv71a119e.example')
    const user = { username: 'Alice', host: null }
    expect(acctOf(user, 'misskey.io')).toBe('Alice@misskey.io')
    expect(acctKeyOf(user, 'Misskey.IO')).toBe('alice@misskey.io')
    expect(
      acctKeyOf({ username: 'alice', host: 'xn--wgv71a119e.example' }, 'x'),
    ).toBe(acctKeyOf({ username: 'ALICE', host: '日本語.example' }, 'y'))
  })
})

describe('hostParamFor', () => {
  it('自サーバーの acct には null を渡し、他は host をそのまま', () => {
    expect(hostParamFor({ username: 'a', host: null }, 'misskey.io')).toBeNull()
    expect(
      hostParamFor({ username: 'a', host: 'misskey.io' }, 'Misskey.IO'),
    ).toBeNull()
    expect(
      hostParamFor({ username: 'a', host: 'b.example' }, 'misskey.io'),
    ).toBe('b.example')
  })
})
