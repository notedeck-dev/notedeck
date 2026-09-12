import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { NormalizedNote } from '@/adapters/types'
import { variantKey } from '@/services/noteKey'
import { useNoteList } from './useNoteList'
import { useStreamingBatch } from './useStreamingBatch'

function variant(
  id: string,
  accountId: string,
  identity: string,
  createdAt = '2026-01-01T00:00:00.000Z',
): NormalizedNote {
  return {
    id,
    createdAt,
    text: id,
    user: { id: `u-${id}`, username: id, host: null, name: id },
    files: [],
    reactions: {},
    _accountId: accountId,
    _serverHost: `${accountId}.example`,
    _identity: identity,
    _isOrigin: false,
    _identityTrusted: true,
  } as unknown as NormalizedNote
}

describe('useStreamingBatch: 束ねる面のサイレント挿入 (#1058 §6)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function setup() {
    const list = useNoteList({
      bundle: true,
      getAdapter: () => null,
      deleteHandler: async () => false,
      closePostForm: () => undefined,
    })
    const batch = useStreamingBatch({
      notes: list.rawNotes,
      noteKeys: list.noteKeys,
      scroller: ref<HTMLElement | null>(null),
      hasGroup: list.hasGroupFor,
      insertSilently: list.insertSilently,
      identityOf: (n) => n._identity,
    })
    return { list, batch }
  }

  it('既存 group の variant は行を増やさず即座に差し込み、新着数には数えない', () => {
    const { list, batch } = setup()
    list.setNotes([variant('x', 'a', 'https://o/notes/x')])

    batch.addQueued([
      variant('x', 'b', 'https://o/notes/x'),
      variant('y', 'b', 'https://o/notes/y', '2026-01-02T00:00:00.000Z'),
    ])

    // x の variant b は queued を通らず列に入っている
    expect(list.rawNotes.value.map((n) => `${n._accountId}:${n.id}`)).toEqual([
      'a:x',
      'b:x',
    ])
    expect(list.groups.value).toHaveLength(1)
    // 増える行は y の 1 つだけ
    expect(batch.pendingCount.value).toBe(1)
  })

  it('新着数は variant 数でなく identity の distinct 数', () => {
    const { list, batch } = setup()
    list.setNotes([variant('x', 'a', 'https://o/notes/x')])
    batch.addQueued([
      variant('y', 'a', 'https://o/notes/y'),
      variant('y', 'b', 'https://o/notes/y'),
    ])
    expect(batch.pendingCount.value).toBe(1)
  })

  it('flush では新しい行だけがアニメーション対象になる', () => {
    const { list, batch } = setup()
    list.setNotes([variant('x', 'a', 'https://o/notes/x')])
    batch.addQueued([
      variant('x', 'b', 'https://o/notes/x'),
      variant('y', 'b', 'https://o/notes/y', '2026-01-02T00:00:00.000Z'),
    ])
    batch.flushToTop()
    expect(list.groups.value).toHaveLength(2)
    expect([...batch.animatingIds.value]).toEqual([variantKey('b', 'y')])
    expect(batch.pendingCount.value).toBe(0)
  })
})
