import { describe, expect, it, vi } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import {
  type ReactionPatch,
  type ReactionPatchFn,
  toggleReaction,
} from '@/utils/toggleReaction'

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
  // 呼び出し元が持つ「最新のノート」。差分はここから計算される
  const state = { ...note, myReaction: note.myReaction ?? null }
  const patches: ReactionPatch[] = []
  const apply = (compute: ReactionPatchFn) => {
    const p = compute(state)
    patches.push(p)
    Object.assign(state, p)
  }
  /** API を待つ間にストリーミングで他人のリアクションが届いた状況 */
  const streamReaction = (reaction: string) => {
    state.reactions = {
      ...state.reactions,
      [reaction]: (state.reactions[reaction] ?? 0) + 1,
    }
  }
  return { state, patches, apply, streamReaction }
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

  it('切替の取消 (delete) 自体が失敗したら丸ごと元に巻き戻す', async () => {
    const api = makeApi()
    api.deleteReaction.mockRejectedValue(new Error('fail'))
    const note = makeNote({
      reactions: { '👍': 1 },
      myReaction: '👍',
    })
    const { state, apply } = track(note)

    await expect(toggleReaction(api, note, '❤️', apply)).rejects.toThrow('fail')

    expect(state.myReaction).toBe('👍')
    expect(state.reactions['👍']).toBe(1)
    expect(state.reactions['❤️']).toBeUndefined()
    expect(api.createReaction).not.toHaveBeenCalled()
  })

  it('切替の取消成功後に付与が失敗したら「リアクション無し」へ倒す (#891)', async () => {
    // サーバー上は取消だけが成立している。元のリアクションに巻き戻すと
    // 旧絵文字のカウントが 1 多いまま残り、次の取得まで直らない
    const api = makeApi()
    api.createReaction.mockRejectedValue(new Error('fail'))
    const note = makeNote({
      reactions: { '👍': 2 },
      myReaction: '👍',
    })
    const { state, apply } = track(note)

    await expect(toggleReaction(api, note, '❤️', apply)).rejects.toThrow('fail')

    expect(state.myReaction).toBeNull()
    expect(state.reactions['👍']).toBe(1)
    expect(state.reactions['❤️']).toBeUndefined()
  })

  it('付与の巻き戻しは待つ間に届いた他人のリアクションを残す (#904)', async () => {
    const api = makeApi()
    const note = makeNote({ reactions: { '👍': 1 } })
    const t = track(note)
    api.createReaction.mockImplementation(async () => {
      t.streamReaction('👍')
      throw new Error('fail')
    })

    await expect(toggleReaction(api, note, '❤️', t.apply)).rejects.toThrow(
      'fail',
    )

    expect(t.state.reactions).toEqual({ '👍': 2 })
    expect(t.state.myReaction).toBeNull()
  })

  it('取消の巻き戻しは待つ間に届いた他人のリアクションを残す (#904)', async () => {
    const api = makeApi()
    const note = makeNote({ reactions: { '👍': 2 }, myReaction: '👍' })
    const t = track(note)
    api.deleteReaction.mockImplementation(async () => {
      t.streamReaction('❤️')
      throw new Error('fail')
    })

    await expect(toggleReaction(api, note, '👍', t.apply)).rejects.toThrow(
      'fail',
    )

    expect(t.state.reactions).toEqual({ '👍': 2, '❤️': 1 })
    expect(t.state.myReaction).toBe('👍')
  })

  it('切替の巻き戻しは同じ絵文字への他人のリアクションを残す (#904)', async () => {
    const api = makeApi()
    const note = makeNote({ reactions: { '👍': 1 }, myReaction: '👍' })
    const t = track(note)
    api.createReaction.mockImplementation(async () => {
      t.streamReaction('❤️')
      throw new Error('fail')
    })

    await expect(toggleReaction(api, note, '❤️', t.apply)).rejects.toThrow(
      'fail',
    )

    // 自分が足した ❤️ (+1) だけ取り消し、他人の ❤️ は残る
    expect(t.state.reactions).toEqual({ '❤️': 1 })
    expect(t.state.myReaction).toBeNull()
  })
})
