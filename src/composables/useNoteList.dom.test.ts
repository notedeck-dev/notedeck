import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import { useNoteList } from './useNoteList'

function makeNote(id: string, createdAt: string): NormalizedNote {
  return {
    id,
    createdAt,
    text: id,
    user: { id: `u-${id}`, username: id, host: null, name: id },
    files: [],
    reactions: {},
  } as unknown as NormalizedNote
}

/** 新しい順 (降順) に n 件。id は new-0 が最新 */
function descNotes(n: number, prefix = 'n'): NormalizedNote[] {
  return Array.from({ length: n }, (_, i) =>
    makeNote(`${prefix}${i}`, new Date(2026, 0, 1, 0, 0, n - i).toISOString()),
  )
}

describe('useNoteList: 保持上限の切り捨て方向 (#834)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function setup(maxNotes: number) {
    return useNoteList({
      getMyUserId: () => 'me',
      getAdapter: () => null,
      deleteHandler: async () => false,
      closePostForm: () => {},
      maxNotes,
    })
  }

  it('既定では古い側を捨てる (ストリーミングで新着が入る経路)', () => {
    const list = setup(3)
    list.setNotes(descNotes(5))
    expect(list.rawNotes.value.map((n) => n.id)).toEqual(['n0', 'n1', 'n2'])
  })

  it("trim='newest' では新しい側を捨てて古い側を残す (下方向ページング)", () => {
    const list = setup(3)
    list.setNotes(descNotes(5), 'newest')
    expect(list.rawNotes.value.map((n) => n.id)).toEqual(['n2', 'n3', 'n4'])
  })

  it('上限に達した後も、取得した古いノートが列に残る', () => {
    const list = setup(3)
    list.setNotes(descNotes(3))
    expect(list.rawNotes.value.map((n) => n.id)).toEqual(['n0', 'n1', 'n2'])

    // loadMore 相当: 末尾に古いノートを 2 件足す
    const older = [
      makeNote('old0', new Date(2025, 0, 1, 0, 0, 2).toISOString()),
      makeNote('old1', new Date(2025, 0, 1, 0, 0, 1).toISOString()),
    ]
    list.setNotes([...list.rawNotes.value, ...older], 'newest')

    // 従来はここで older が丸ごと捨てられ、列が変わらなかった
    expect(list.rawNotes.value.map((n) => n.id)).toEqual(['n2', 'old0', 'old1'])
  })

  it('上限以下なら trim 指定に関係なく全件残る', () => {
    const list = setup(10)
    list.setNotes(descNotes(4), 'newest')
    expect(list.rawNotes.value).toHaveLength(4)
  })
})
