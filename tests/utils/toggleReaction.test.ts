import { describe, expect, it, vi } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import { toggleReaction } from '@/utils/toggleReaction'

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

// 差分計算とロールバックは src/services/reactionToggle.test.ts。ここは utils 側の連打抑止だけ
describe('toggleReaction in-flight guard (#1058)', () => {
  it('同じ variant への連打は最初の 1 回だけ API に届く', async () => {
    const api = makeApi()
    let resolveCreate: (() => void) | null = null
    api.createReaction = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCreate = resolve
        }),
    )
    const note = makeNote({ myReaction: null })
    const apply = vi.fn()
    const p1 = toggleReaction(api, note, '👍', apply)
    const p2 = toggleReaction(api, note, '👍', apply)
    resolveCreate?.()
    await Promise.all([p1, p2])
    expect(api.createReaction).toHaveBeenCalledTimes(1)
  })
})
