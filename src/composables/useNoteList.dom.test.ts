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

describe('useNoteList: noteCapture 同期の通知経路 (#939)', () => {
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

  // ストリーミングの新着 flush (useStreamingBatch) は setNotes を通らず
  // rawNotes setter へ直接書く。通知が setNotes だけにあると、WS で流れ込んだ
  // ノートが一度も subNote されず、他者リアクションの noteUpdated が届かない
  it('setter 直書き (ストリーミング flush 相当) でも onNotesChanged が呼ばれる', () => {
    const list = setup(10)
    const seen: string[][] = []
    list.setOnNotesChanged((notes) => seen.push(notes.map((n) => n.id)))
    list.setNotes(descNotes(2))
    expect(seen.at(-1)).toEqual(['n0', 'n1'])

    const fresh = makeNote('fresh', new Date(2026, 0, 2).toISOString())
    list.rawNotes.value = [fresh, ...list.rawNotes.value]
    expect(seen.at(-1)).toEqual(['fresh', 'n0', 'n1'])
  })

  it('setNotes の通知は 1 回だけ (setter 経由と二重にならない)', () => {
    const list = setup(10)
    let calls = 0
    list.setOnNotesChanged(() => {
      calls++
    })
    list.setNotes(descNotes(2))
    expect(calls).toBe(1)
  })

  // 削除に失敗したら楽観削除を巻き戻すが、そこで購読同期を呼ばないと
  // 「表示は戻っているのに subNote は外れたまま」になり、そのノートへの
  // 他者リアクションが以後届かなくなる
  it('削除失敗で巻き戻したとき、購読同期にノートが戻って通知される', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const list = useNoteList({
      getMyUserId: () => 'me',
      getAdapter: () => null,
      deleteHandler: async () => false, // 削除失敗
      closePostForm: () => {},
      maxNotes: 10,
    })
    const seen: string[][] = []
    list.setNotes(descNotes(3))
    list.setOnNotesChanged((notes) => seen.push(notes.map((n) => n.id)))

    const target = list.rawNotes.value[1]
    if (!target) throw new Error('fixture broken')
    await list.removeNote(target)

    // 楽観削除の通知 → 巻き戻しの通知の 2 回ちょうど。全体を突き合わせる
    // ことで、余分な通知 (購読の無駄な張り直し) の再発も検出する
    expect(seen).toEqual([
      ['n0', 'n2'],
      ['n0', 'n1', 'n2'],
    ])
    expect(list.rawNotes.value.map((n) => n.id)).toEqual(['n0', 'n1', 'n2'])
  })
})
