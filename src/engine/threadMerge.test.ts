import { describe, expect, it } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import type { MergedThread } from './threadMerge'
import { mergeThreadFragments, type ThreadFragment } from './threadMerge'

/** テスト用の最小限 NormalizedNote を生成 */
function makeNote(
  overrides: Partial<NormalizedNote> & {
    id: string
    _accountId: string
    _serverHost: string
  },
): NormalizedNote {
  return {
    createdAt: '2025-01-01T00:00:00.000Z',
    text: null,
    cw: null,
    user: {
      id: 'u1',
      username: 'test',
      host: null,
      name: 'Test',
      avatarUrl: null,
    },
    visibility: 'public',
    emojis: {},
    reactionEmojis: {},
    reactions: {},
    renoteCount: 0,
    repliesCount: 0,
    files: [],
    ...overrides,
  }
}

function frag(note: NormalizedNote, sourceAccountId?: string): ThreadFragment {
  return { note, sourceAccountId: sourceAccountId ?? note._accountId }
}

/** null でないことをアサートして返す */
function ensureNotNull(result: MergedThread | null): MergedThread {
  expect(result).not.toBeNull()
  return result as MergedThread
}

describe('mergeThreadFragments', () => {
  it('空のフラグメントで null を返す', () => {
    expect(mergeThreadFragments([], 'https://example/notes/1')).toBeNull()
  })

  it('単一フラグメントでそのまま返す', () => {
    const note = makeNote({
      id: 'n1',
      _accountId: 'a1',
      _serverHost: 'a.example',
      uri: 'https://origin.example/notes/orig1',
    })
    const result = ensureNotNull(
      mergeThreadFragments([frag(note)], 'https://origin.example/notes/orig1'),
    )
    expect(result.focal.note.id).toBe('n1')
    expect(result.focal.variants).toHaveLength(1)
    expect(result.ancestors).toHaveLength(0)
    expect(result.children).toHaveLength(0)
    expect(result.stats.totalNotes).toBe(1)
    expect(result.stats.serversContributed).toBe(1)
  })

  it('2 サーバーの同一 URI ノートが 1 つにマージされる', () => {
    const uri = 'https://origin.example/notes/orig1'
    const noteA = makeNote({
      id: 'localA',
      _accountId: 'accA',
      _serverHost: 'a.example',
      uri,
      reactions: { '👍': 3, '❤️': 2 },
      renoteCount: 5,
      repliesCount: 2,
    })
    const noteB = makeNote({
      id: 'localB',
      _accountId: 'accB',
      _serverHost: 'b.example',
      uri,
      reactions: { '👍': 1, '🎉': 4 },
      renoteCount: 3,
      repliesCount: 7,
    })

    const result = ensureNotNull(
      mergeThreadFragments([frag(noteA), frag(noteB)], uri),
    )

    expect(result.stats.totalNotes).toBe(1)
    expect(result.stats.serversContributed).toBe(2)
    expect(result.focal.variants).toHaveLength(2)

    // リアクション合算
    expect(result.focal.note.reactions).toEqual({
      '👍': 4,
      '❤️': 2,
      '🎉': 4,
    })
    // renoteCount / repliesCount は max
    expect(result.focal.note.renoteCount).toBe(5)
    expect(result.focal.note.repliesCount).toBe(7)
  })

  it('片方のサーバーにしかない子ノートが統合ツリーに含まれる', () => {
    const parentUri = 'https://origin.example/notes/parent'
    const childUri = 'https://origin.example/notes/child'

    const parentA = makeNote({
      id: 'parentA',
      _accountId: 'accA',
      _serverHost: 'a.example',
      uri: parentUri,
      repliesCount: 1,
    })
    const childB = makeNote({
      id: 'childB',
      _accountId: 'accB',
      _serverHost: 'b.example',
      uri: childUri,
      replyId: 'parentB',
      createdAt: '2025-01-01T00:01:00.000Z',
    })
    const parentB = makeNote({
      id: 'parentB',
      _accountId: 'accB',
      _serverHost: 'b.example',
      uri: parentUri,
    })

    const result = ensureNotNull(
      mergeThreadFragments(
        [frag(parentA), frag(parentB), frag(childB)],
        parentUri,
      ),
    )

    expect(result.focal.note.uri).toBe(parentUri)
    expect(result.children).toHaveLength(1)
    expect(result.children[0]?.note.uri).toBe(childUri)
    expect(result.stats.totalNotes).toBe(2)
    expect(result.stats.serversContributed).toBe(2)
  })

  it('ancestors / children の分離が正しい', () => {
    const grandparentUri = 'https://origin.example/notes/gp'
    const parentUri = 'https://origin.example/notes/p'
    const focalUri = 'https://origin.example/notes/f'
    const childUri = 'https://origin.example/notes/c'

    const gp = makeNote({
      id: 'gp',
      _accountId: 'a1',
      _serverHost: 'a.example',
      uri: grandparentUri,
      createdAt: '2025-01-01T00:00:00.000Z',
    })
    const parent = makeNote({
      id: 'p',
      _accountId: 'a1',
      _serverHost: 'a.example',
      uri: parentUri,
      replyId: 'gp',
      createdAt: '2025-01-01T00:01:00.000Z',
    })
    const focal = makeNote({
      id: 'f',
      _accountId: 'a1',
      _serverHost: 'a.example',
      uri: focalUri,
      replyId: 'p',
      createdAt: '2025-01-01T00:02:00.000Z',
    })
    const child = makeNote({
      id: 'c',
      _accountId: 'a1',
      _serverHost: 'a.example',
      uri: childUri,
      replyId: 'f',
      createdAt: '2025-01-01T00:03:00.000Z',
    })

    const result = ensureNotNull(
      mergeThreadFragments(
        [frag(gp), frag(parent), frag(focal), frag(child)],
        focalUri,
      ),
    )

    expect(result.ancestors).toHaveLength(2)
    expect(result.ancestors[0]?.note.uri).toBe(grandparentUri)
    expect(result.ancestors[1]?.note.uri).toBe(parentUri)
    expect(result.focal.note.uri).toBe(focalUri)
    expect(result.children).toHaveLength(1)
    expect(result.children[0]?.note.uri).toBe(childUri)
  })

  it('フォーカルノートが見つからない場合、ルートノートで代替する', () => {
    const uri = 'https://origin.example/notes/n1'
    const note = makeNote({
      id: 'n1',
      _accountId: 'a1',
      _serverHost: 'a.example',
      uri,
    })

    const result = ensureNotNull(
      mergeThreadFragments(
        [frag(note)],
        'https://origin.example/notes/nonexistent',
      ),
    )

    expect(result.focal.note.uri).toBe(uri)
  })

  it('reply フィールドから親 URI を解決できる', () => {
    const parentUri = 'https://origin.example/notes/parent'
    const childUri = 'https://origin.example/notes/child'

    const parent = makeNote({
      id: 'p1',
      _accountId: 'a1',
      _serverHost: 'a.example',
      uri: parentUri,
    })
    const child = makeNote({
      id: 'c1',
      _accountId: 'a2',
      _serverHost: 'b.example',
      uri: childUri,
      replyId: 'unknownLocalId',
      reply: makeNote({
        id: 'parentOnB',
        _accountId: 'a2',
        _serverHost: 'b.example',
        uri: parentUri,
      }),
    })

    const result = ensureNotNull(
      mergeThreadFragments([frag(parent), frag(child)], parentUri),
    )

    expect(result.children).toHaveLength(1)
    expect(result.children[0]?.note.uri).toBe(childUri)
  })

  it('循環参照があっても無限ループしない', () => {
    const uriA = 'https://example/notes/a'
    const uriB = 'https://example/notes/b'

    const noteA = makeNote({
      id: 'a',
      _accountId: 'a1',
      _serverHost: 'example',
      uri: uriA,
      replyId: 'b',
    })
    const noteB = makeNote({
      id: 'b',
      _accountId: 'a1',
      _serverHost: 'example',
      uri: uriB,
      replyId: 'a',
    })

    const result = mergeThreadFragments([frag(noteA), frag(noteB)], uriA)

    expect(result).not.toBeNull()
  })
})
