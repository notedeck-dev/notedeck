import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import { noteIdentityOf, variantKey, variantKeyOf } from '@/services/noteKey'
import { useNoteStore } from '@/stores/notes'

function makeNote(
  overrides: Partial<NormalizedNote> & { id: string; _accountId: string },
): NormalizedNote {
  const host = overrides._serverHost ?? 'a.example'
  return {
    _serverHost: host,
    _identity: overrides.uri ?? `https://${host}/notes/${overrides.id}`,
    _isOrigin: overrides.uri == null,
    _identityTrusted: true,
    contentHidden: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    text: null,
    cw: null,
    user: { id: 'u1', username: 'u', host: null, name: null, avatarUrl: null },
    visibility: 'public',
    emojis: {},
    reactionEmojis: {},
    reactions: {},
    renoteCount: 0,
    repliesCount: 0,
    files: [],
    localOnly: false,
    ...overrides,
  }
}

describe('noteStore (variant key, #1010)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('別アカウント由来の同じノート ID を別エントリとして保持する', () => {
    const store = useNoteStore()
    const a = makeNote({ id: 'n1', _accountId: 'acc-a', text: 'from a' })
    const b = makeNote({ id: 'n1', _accountId: 'acc-b', text: 'from b' })
    store.put([a, b])
    expect(store.get(variantKey('acc-a', 'n1'))?.text).toBe('from a')
    expect(store.get(variantKey('acc-b', 'n1'))?.text).toBe('from b')
  })

  it('削除 tombstone はアカウント単位で、他アカウントの同 ID は隠れない', () => {
    const store = useNoteStore()
    store.put([
      makeNote({ id: 'n1', _accountId: 'acc-a' }),
      makeNote({ id: 'n1', _accountId: 'acc-b' }),
    ])
    store.remove(variantKey('acc-a', 'n1'))
    expect(store.isDeleted(variantKey('acc-a', 'n1'))).toBe(true)
    expect(store.isDeleted(variantKey('acc-b', 'n1'))).toBe(false)
    expect(store.get(variantKey('acc-b', 'n1'))).toBeDefined()
  })

  it('origin の variant の削除だけを identity 単位で記録する (#1058 §5.5)', () => {
    const store = useNoteStore()
    const origin = makeNote({
      id: 'o1',
      _accountId: 'acc-o',
      _serverHost: 'origin.example',
    })
    const remote = makeNote({
      id: 'r1',
      _accountId: 'acc-r',
      _serverHost: 'b.example',
      uri: 'https://origin.example/notes/o1',
    })
    store.put([origin, remote])
    const identity = noteIdentityOf(origin)
    expect(noteIdentityOf(remote)).toBe(identity)

    store.remove(variantKeyOf(remote))
    expect(store.isDeletedAtOrigin(identity)).toBe(false)

    store.remove(variantKeyOf(origin))
    expect(store.isDeletedAtOrigin(identity)).toBe(true)
  })

  it('applyUpdate はイベントのアカウントで行を引き、echo 抑止もそのアカウントの userId で判定する', () => {
    const store = useNoteStore()
    store.put([
      makeNote({ id: 'n1', _accountId: 'acc-a', reactions: {} }),
      makeNote({ id: 'n1', _accountId: 'acc-b', reactions: {} }),
    ])
    store.applyUpdate(
      {
        accountId: 'acc-b',
        noteId: 'n1',
        type: 'reacted',
        body: { reaction: '👍', userId: 'me-on-b' },
      },
      (accountId) => (accountId === 'acc-b' ? 'me-on-b' : undefined),
    )
    expect(store.get(variantKey('acc-a', 'n1'))?.reactions).toEqual({})
    const b = store.get(variantKey('acc-b', 'n1'))
    expect(b?.reactions).toEqual({ '👍': 1 })
    expect(b?.myReaction).toBe('👍')
  })

  it('renote の入れ子は親の取得元アカウントに属するキーで同期される', () => {
    const store = useNoteStore()
    const inner = makeNote({ id: 'inner', _accountId: 'acc-a', text: 'v1' })
    const outer = makeNote({
      id: 'outer',
      _accountId: 'acc-a',
      renoteId: 'inner',
      renote: inner,
    })
    store.put([outer])
    const innerV2 = makeNote({ id: 'inner', _accountId: 'acc-a', text: 'v2' })
    store.put([innerV2])
    const [resolved] = store.resolve([variantKeyOf(outer)])
    expect(resolved?.renote?.text).toBe('v2')
  })
})
