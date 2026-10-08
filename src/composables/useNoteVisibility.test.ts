// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import { variantKey } from '@/services/noteKey'
import { useNoteStore } from '@/stores/notes'
import { useNoteVisibility } from './useNoteVisibility'

vi.mock('@/bindings', () => ({
  commands: new Proxy(
    {},
    { get: () => () => Promise.resolve({ status: 'ok', data: [] }) },
  ),
}))

function note(id: string, extra: Partial<NormalizedNote> = {}): NormalizedNote {
  return {
    id,
    _accountId: 'acc-a',
    _serverHost: 'example.com',
    createdAt: '2026-07-01T00:00:00.000Z',
    text: id,
    cw: null,
    visibility: 'public',
    user: { id: `user-${id}`, username: id, host: null },
    files: [],
    reactions: {},
    ...extra,
  } as unknown as NormalizedNote
}

/** 純 Renote (本文なし) */
function pureRenoteOf(original: NormalizedNote, accountId = 'acc-a') {
  return note(`rn-${original.id}`, {
    _accountId: accountId,
    text: null,
    renoteId: original.id,
    renote: original,
  })
}

describe('useNoteVisibility: 元ノートが削除された Renote 行', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('元ノートが tombstone なら純 Renote は隠す', () => {
    const original = note('orig')
    const renote = pureRenoteOf(original)
    const { isHidden } = useNoteVisibility()
    expect(isHidden(renote)).toBe(false)
    useNoteStore().remove(variantKey('acc-a', 'orig'))
    expect(isHidden(renote)).toBe(true)
  })

  it('添付だけの引用 (本文なし) も元ノートが消えても隠さない', () => {
    const original = note('orig')
    const quote = note('q', {
      text: null,
      files: [{ id: 'f1' }] as never,
      renoteId: 'orig',
      renote: original,
    })
    useNoteStore().remove(variantKey('acc-a', 'orig'))
    expect(useNoteVisibility().isHidden(quote)).toBe(false)
  })

  it('引用 (本文あり) は元ノートが消えても隠さない', () => {
    const original = note('orig')
    const quote = note('q', { renoteId: 'orig', renote: original })
    useNoteStore().remove(variantKey('acc-a', 'orig'))
    expect(useNoteVisibility().isHidden(quote)).toBe(false)
  })

  it('別アカウント経由の Renote は、そのアカウントの variant が消えていなければ隠さない', () => {
    const original = note('orig')
    const renote = pureRenoteOf(original, 'acc-b')
    useNoteStore().remove(variantKey('acc-a', 'orig'))
    expect(useNoteVisibility().isHidden(renote)).toBe(false)
  })

  it('renote 本体が無い純 Renote (元ノートがサーバーで消えた形) は tombstone が無くても隠す', () => {
    // 再起動後は tombstone が消えるが、本家 2025.10 以降は renote: null の
    // Renote 行を返し続ける。キャッシュから戻った行もこの形になる
    const renote = note('rn-orig', {
      text: null,
      renoteId: 'orig',
      renote: undefined,
    })
    expect(useNoteVisibility().isHidden(renote)).toBe(true)
  })

  it('renote 本体が無くても本文や添付が残る引用は隠さない', () => {
    const quote = note('q', { renoteId: 'orig', renote: undefined })
    expect(useNoteVisibility().isHidden(quote)).toBe(false)
    const withFile = note('q2', {
      text: null,
      files: [{ id: 'f1' }] as never,
      renoteId: 'orig',
      renote: undefined,
    })
    expect(useNoteVisibility().isHidden(withFile)).toBe(false)
  })

  it('tombstone なしの除去 (verify miss) では隠さない', () => {
    const original = note('orig')
    const renote = pureRenoteOf(original)
    useNoteStore().remove(variantKey('acc-a', 'orig'), false)
    expect(useNoteVisibility().isHidden(renote)).toBe(false)
  })
})
