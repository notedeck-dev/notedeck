import { describe, expect, it, vi } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import { type ReactionPatch, toggleReaction } from '@/utils/toggleReaction'

function makeNote(overrides: Partial<NormalizedNote> = {}): NormalizedNote {
  return {
    id: 'note1',
    text: 'hello',
    createdAt: '2025-01-01T00:00:00Z',
    user: {
      id: 'u1',
      username: 'test',
      host: null,
      name: null,
      avatarUrl: null,
    },
    visibility: 'public',
    reactions: {},
    myReaction: null,
    emojis: {},
    reactionEmojis: {},
    files: [],
    renoteCount: 0,
    repliesCount: 0,
    renote: null,
    reply: null,
    cw: null,
    _accountId: 'a1',
    _serverHost: 'example.com',
    ...overrides,
  }
}

function makeApi() {
  return {
    createReaction: vi.fn().mockResolvedValue(undefined),
    deleteReaction: vi.fn().mockResolvedValue(undefined),
  }
}

/** apply された差分を状態として追跡する (呼び出し元の反映を模す) */
function track(note: NormalizedNote) {
  const state: ReactionPatch = {
    reactions: note.reactions,
    myReaction: note.myReaction ?? null,
  }
  const patches: ReactionPatch[] = []
  const apply = (p: ReactionPatch) => {
    patches.push(p)
    state.reactions = p.reactions
    state.myReaction = p.myReaction
  }
  return { state, patches, apply }
}

describe('toggleReaction', () => {
  it('adds a new reaction optimistically', async () => {
    const api = makeApi()
    const note = makeNote()
    const { state, apply } = track(note)

    await toggleReaction(api, note, '👍', apply)

    expect(state.myReaction).toBe('👍')
    expect(state.reactions['👍']).toBe(1)
    expect(api.createReaction).toHaveBeenCalledWith('note1', '👍')
    expect(api.deleteReaction).not.toHaveBeenCalled()
  })

  it('note は mutate せず、新しい reactions オブジェクトで apply する', async () => {
    // shallowRef 保持の面 (プロフィール・通知カラム等) が差し替えを検知
    // できるよう、mutate ではなく新オブジェクトの差分として渡す
    const api = makeApi()
    const note = makeNote({ reactions: { '🎉': 1 } })
    const { state, apply } = track(note)

    await toggleReaction(api, note, '👍', apply)

    expect(note.reactions).toEqual({ '🎉': 1 })
    expect(note.myReaction).toBeNull()
    expect(state.reactions).not.toBe(note.reactions)
    expect(state.reactions).toEqual({ '🎉': 1, '👍': 1 })
  })

  it('removes an existing reaction optimistically', async () => {
    const api = makeApi()
    const note = makeNote({
      reactions: { '👍': 1 },
      myReaction: '👍',
    })
    const { state, apply } = track(note)

    await toggleReaction(api, note, '👍', apply)

    expect(state.myReaction).toBeNull()
    expect(state.reactions['👍']).toBeUndefined()
    expect(api.deleteReaction).toHaveBeenCalledWith('note1')
  })

  it('switches reaction (removes old, adds new; delete → create の順)', async () => {
    const api = makeApi()
    const calls: string[] = []
    api.deleteReaction.mockImplementation(async () => {
      calls.push('delete')
    })
    api.createReaction.mockImplementation(async () => {
      calls.push('create')
    })
    const note = makeNote({
      reactions: { '👍': 1 },
      myReaction: '👍',
    })
    const { state, apply } = track(note)

    await toggleReaction(api, note, '❤️', apply)

    expect(state.myReaction).toBe('❤️')
    expect(state.reactions['👍']).toBeUndefined()
    expect(state.reactions['❤️']).toBe(1)
    expect(api.deleteReaction).toHaveBeenCalledWith('note1')
    expect(api.createReaction).toHaveBeenCalledWith('note1', '❤️')
    expect(calls).toEqual(['delete', 'create'])
  })

  it('decrements count instead of deleting when count > 1', async () => {
    const api = makeApi()
    const note = makeNote({
      reactions: { '👍': 3 },
      myReaction: '👍',
    })
    const { state, apply } = track(note)

    await toggleReaction(api, note, '👍', apply)

    expect(state.myReaction).toBeNull()
    expect(state.reactions['👍']).toBe(2)
  })

  it('rolls back on API failure', async () => {
    const api = makeApi()
    api.createReaction.mockRejectedValue(new Error('fail'))
    const note = makeNote()
    const { state, apply } = track(note)

    await expect(toggleReaction(api, note, '👍', apply)).rejects.toThrow('fail')

    expect(state.myReaction).toBeNull()
    expect(state.reactions['👍']).toBeUndefined()
  })

  it('rolls back switch on API failure', async () => {
    const api = makeApi()
    api.createReaction.mockRejectedValue(new Error('fail'))
    const note = makeNote({
      reactions: { '👍': 1 },
      myReaction: '👍',
    })
    const { state, apply } = track(note)

    await expect(toggleReaction(api, note, '❤️', apply)).rejects.toThrow('fail')

    expect(state.myReaction).toBe('👍')
    expect(state.reactions['👍']).toBe(1)
    expect(state.reactions['❤️']).toBeUndefined()
  })
})
