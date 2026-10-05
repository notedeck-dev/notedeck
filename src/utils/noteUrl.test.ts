import { describe, expect, it } from 'vitest'
import { getNoteShareUrl, localNoteIdentity, parseNoteUrl } from './noteUrl'

describe('parseNoteUrl', () => {
  describe('Misskey形式のURL', () => {
    it('標準的なノートURLをパースできる', () => {
      const result = parseNoteUrl('https://misskey.io/notes/abc123')
      expect(result).toEqual({ host: 'misskey.io', noteId: 'abc123' })
    })

    it('httpスキームでもパースできる', () => {
      const result = parseNoteUrl('http://localhost/notes/xyz789')
      expect(result).toEqual({ host: 'localhost', noteId: 'xyz789' })
    })

    it('英数字混合のnoteIdをパースできる', () => {
      const result = parseNoteUrl('https://example.com/notes/9xAbCdEf01')
      expect(result).toEqual({ host: 'example.com', noteId: '9xAbCdEf01' })
    })

    it('末尾スラッシュがあるとパースできない', () => {
      expect(parseNoteUrl('https://misskey.io/notes/abc123/')).toBeNull()
    })

    it('noteIdが空だとパースできない', () => {
      expect(parseNoteUrl('https://misskey.io/notes/')).toBeNull()
    })
  })

  describe('Mastodon形式のURL', () => {
    it('標準的なステータスURLをパースできる', () => {
      const result = parseNoteUrl('https://mastodon.social/@user/123456')
      expect(result).toEqual({ host: 'mastodon.social', noteId: '123456' })
    })

    it('数字以外のIDはパースできない', () => {
      expect(parseNoteUrl('https://mastodon.social/@user/abc')).toBeNull()
    })
  })

  describe('無効な入力', () => {
    it('ユーザー名形式はパースできない', () => {
      expect(parseNoteUrl('@user@host.example')).toBeNull()
    })

    it('空文字列はパースできない', () => {
      expect(parseNoteUrl('')).toBeNull()
    })

    it('関係ないURLはパースできない', () => {
      expect(parseNoteUrl('https://example.com/timeline')).toBeNull()
    })

    it('ActivityPub URIはパースできない', () => {
      expect(parseNoteUrl('https://misskey.io/users/abc123')).toBeNull()
    })
  })
})

describe('localNoteIdentity', () => {
  it('合成ノートの identity を自アカウントのサーバーで組む (host は小文字)', () => {
    expect(localNoteIdentity('A.Example', 'n1')).toBe(
      'https://a.example/notes/n1',
    )
  })
})

describe('getNoteShareUrl', () => {
  it('url があればそれを返す（表示 URL 優先）', () => {
    expect(
      getNoteShareUrl({
        id: 'local1',
        url: 'https://remote.example/@alice/1',
        uri: 'https://remote.example/notes/remote1',
        _serverHost: 'a.example',
      }),
    ).toBe('https://remote.example/@alice/1')
  })

  it('url がなければ uri を返す', () => {
    expect(
      getNoteShareUrl({
        id: 'local1',
        uri: 'https://remote.example/notes/remote1',
        _serverHost: 'a.example',
      }),
    ).toBe('https://remote.example/notes/remote1')
  })

  it('url も uri もなければサーバーホストから推定する', () => {
    expect(getNoteShareUrl({ id: 'n1', _serverHost: 'a.example' })).toBe(
      'https://a.example/notes/n1',
    )
  })
})
