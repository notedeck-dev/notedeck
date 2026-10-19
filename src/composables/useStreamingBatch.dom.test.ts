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

  it('新着の flush で上限を切るとき、数えないノート (水平線の下) は落とさず数えない (#1184)', () => {
    const floor = '2026-01-02T00:00:00.000Z'
    const list = useNoteList({
      bundle: true,
      getAdapter: () => null,
      deleteHandler: async () => false,
      closePostForm: () => undefined,
      displayFloor: () => floor,
    })
    const batch = useStreamingBatch({
      notes: list.rawNotes,
      noteKeys: list.noteKeys,
      scroller: ref<HTMLElement | null>(null),
      maxNotes: 1,
      hasGroup: list.hasGroupFor,
      insertSilently: list.insertSilently,
      identityOf: (n) => n._identity,
      countsNote: (n) => n.createdAt >= floor,
    })
    list.setNotes([
      variant('n3', 'a', 'https://o/notes/n3', '2026-01-03T00:00:00.000Z'),
      variant('h', 'b', 'https://o/notes/h', '2026-01-01T00:00:00.000Z'),
    ])
    batch.addQueued([
      variant('n4', 'a', 'https://o/notes/n4', '2026-01-04T00:00:00.000Z'),
    ])
    batch.flushToTop()
    // 見えている 2 件のうち上限 1 を超えた n3 だけ落ち、隠れた h は残る
    expect(list.rawNotes.value.map((n) => n.id)).toEqual(['n4', 'h'])
  })
})
