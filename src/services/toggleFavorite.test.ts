import { describe, expect, it, vi } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import { toggleFavorite } from './toggleFavorite'

function makeApi() {
  return {
    createFavorite: vi.fn(async (_id: string) => undefined),
    deleteFavorite: vi.fn(async (_id: string) => undefined),
  }
}

function makeNote(isFavorited: boolean | undefined): NormalizedNote {
  return { id: 'n1', isFavorited } as unknown as NormalizedNote
}

describe('toggleFavorite', () => {
  it('未お気に入りなら先に true へ書き換えてから createFavorite を呼ぶ', async () => {
    const api = makeApi()
    const note = makeNote(false)
    const seen: Array<boolean | undefined> = []
    api.createFavorite.mockImplementation(async () => {
      seen.push(note.isFavorited)
    })
    await toggleFavorite(api, note)
    expect(seen).toEqual([true])
    expect(note.isFavorited).toBe(true)
    expect(api.createFavorite).toHaveBeenCalledWith('n1')
    expect(api.deleteFavorite).not.toHaveBeenCalled()
  })

  it('お気に入り済みなら false にして deleteFavorite を呼ぶ', async () => {
    const api = makeApi()
    const note = makeNote(true)
    await toggleFavorite(api, note)
    expect(note.isFavorited).toBe(false)
    expect(api.deleteFavorite).toHaveBeenCalledWith('n1')
    expect(api.createFavorite).not.toHaveBeenCalled()
  })

  it('isFavorited が未定義なら未お気に入り扱いで create し true になる', async () => {
    const api = makeApi()
    const note = makeNote(undefined)
    await toggleFavorite(api, note)
    expect(note.isFavorited).toBe(true)
    expect(api.createFavorite).toHaveBeenCalledOnce()
  })

  it('成功時は onMutated を 1 回だけ呼ぶ', async () => {
    const onMutated = vi.fn()
    await toggleFavorite(makeApi(), makeNote(false), onMutated)
    expect(onMutated).toHaveBeenCalledOnce()
  })

  it('API が失敗したら元の値へ戻し、onMutated をもう一度呼んでエラーを投げ直す', async () => {
    const api = makeApi()
    const err = new Error('boom')
    api.createFavorite.mockRejectedValue(err)
    const note = makeNote(false)
    const states: Array<boolean | undefined> = []
    const onMutated = vi.fn(() => {
      states.push(note.isFavorited)
    })
    await expect(toggleFavorite(api, note, onMutated)).rejects.toBe(err)
    expect(note.isFavorited).toBe(false)
    expect(states).toEqual([true, false])
  })

  it('未定義から失敗したら undefined へ戻す', async () => {
    const api = makeApi()
    api.createFavorite.mockRejectedValue(new Error('x'))
    const note = makeNote(undefined)
    await expect(toggleFavorite(api, note)).rejects.toThrow('x')
    expect(note.isFavorited).toBeUndefined()
  })
})
