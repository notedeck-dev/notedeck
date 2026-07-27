import { describe, expect, it } from 'vitest'
import {
  getNoteShareUrl,
  getNoteUri,
  parseNoteUrl,
  parseUserQuery,
} from './noteUrl'

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

describe('parseUserQuery', () => {
  describe('@user 形式', () => {
    it('@付きユーザー名をパースできる', () => {
      expect(parseUserQuery('@alice')).toEqual({
        username: 'alice',
        host: null,
      })
    })

    it('アンダースコア含みのユーザー名をパースできる', () => {
      expect(parseUserQuery('@alice_bob')).toEqual({
        username: 'alice_bob',
        host: null,
      })
    })

    it('数字含みのユーザー名をパースできる', () => {
      expect(parseUserQuery('@user123')).toEqual({
        username: 'user123',
        host: null,
      })
    })
  })

  describe('@user@host 形式', () => {
    it('完全修飾ユーザー名をパースできる', () => {
      expect(parseUserQuery('@alice@misskey.io')).toEqual({
        username: 'alice',
        host: 'misskey.io',
      })
    })

    it('@なしでもhost付きならパースできる', () => {
      expect(parseUserQuery('alice@misskey.io')).toEqual({
        username: 'alice',
        host: 'misskey.io',
      })
    })
  })

  describe('無効な入力', () => {
    it('空文字列はパースできない', () => {
      expect(parseUserQuery('')).toBeNull()
    })

    it('@なし・host なしの単語はパースできない', () => {
      expect(parseUserQuery('alice')).toBeNull()
    })

    it('URLはパースできない', () => {
      expect(parseUserQuery('https://misskey.io/notes/abc')).toBeNull()
    })

    it('ユーザー名に無効な文字があるとパースできない', () => {
      expect(parseUserQuery('@alice-bob')).toBeNull()
    })

    it('@のみはパースできない', () => {
      expect(parseUserQuery('@')).toBeNull()
    })
  })
})

describe('getNoteUri', () => {
  it('uri があればそれを返す（AP id 優先）', () => {
    expect(
      getNoteUri({
        id: 'local1',
        uri: 'https://remote.example/notes/remote1',
        _serverHost: 'a.example',
      }),
    ).toBe('https://remote.example/notes/remote1')
  })

  it('uri がなければサーバーホストから推定する', () => {
    expect(getNoteUri({ id: 'n1', _serverHost: 'a.example' })).toBe(
      'https://a.example/notes/n1',
    )
  })

  it('uri が null でも推定にフォールバックする', () => {
    expect(getNoteUri({ id: 'n1', uri: null, _serverHost: 'a.example' })).toBe(
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
