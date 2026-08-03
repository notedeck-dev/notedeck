import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedNote, ServerAdapter } from '@/adapters/types'
import { useNoteStore } from '@/stores/notes'
import { purgeStaleCachedNotes } from './useNoteColumnCache'

const bindings = vi.hoisted(() => ({
  verifyResult: null as unknown,
  verifyCalls: [] as unknown[][],
  deleteCalls: [] as unknown[][],
}))

vi.mock('@/bindings', () => ({
  commands: {
    apiVerifyNotes: (...args: unknown[]) => {
      bindings.verifyCalls.push(args)
      return Promise.resolve(bindings.verifyResult)
    },
    apiDeleteCachedNote: (...args: unknown[]) => {
      bindings.deleteCalls.push(args)
      return Promise.resolve({ status: 'ok', data: null })
    },
  },
}))

function note(id: string): NormalizedNote {
  return {
    id,
    createdAt: '2026-08-01T00:00:00.000Z',
    text: `note ${id}`,
    user: { id: `user-${id}` },
    _accountId: 'acc-1',
  } as unknown as NormalizedNote
}

const adapter = {} as ServerAdapter

describe('purgeStaleCachedNotes: verify-purge (notecli#30 v5 §6-8 / §9-23)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    bindings.verifyResult = null
    bindings.verifyCalls.length = 0
    bindings.deleteCalls.length = 0
  })

  it('missing (NO_SUCH_NOTE 確認済み) のみ削除する', async () => {
    const noteStore = useNoteStore()
    noteStore.put([note('a'), note('b'), note('c')])
    bindings.verifyResult = {
      status: 'ok',
      data: {
        verified: { a: { ...note('a'), text: 'fresh a' } },
        missing: ['b'],
      },
    }

    await purgeStaleCachedNotes(adapter, ['a', 'b', 'c'], () => true, 'acc-1')

    // 削除は missing の b のみ (accountId スコープ付き)
    expect(bindings.deleteCalls).toEqual([['acc-1', 'b']])
    expect(noteStore.get('b')).toBeUndefined()
    // verified の a は fresh データで更新される
    expect(noteStore.get('a')?.text).toBe('fresh a')
    // verified にも missing にも無い c は「生存扱い」— 削除しない
    expect(noteStore.get('c')).toBeDefined()
  })

  it('通信エラー相当 (verified にも missing にも無い) は一切削除しない', async () => {
    const noteStore = useNoteStore()
    noteStore.put([note('a'), note('b')])
    // 全 id が検証不能だった応答 (レート制限・タイムアウト等)
    bindings.verifyResult = {
      status: 'ok',
      data: { verified: {}, missing: [] },
    }

    await purgeStaleCachedNotes(adapter, ['a', 'b'], () => true, 'acc-1')

    expect(bindings.deleteCalls).toEqual([])
    expect(noteStore.get('a')).toBeDefined()
    expect(noteStore.get('b')).toBeDefined()
  })

  it('bulk verify 自体の失敗ではキャッシュを触らない', async () => {
    const noteStore = useNoteStore()
    noteStore.put([note('a')])
    bindings.verifyResult = {
      status: 'error',
      error: { code: 'NETWORK', message: 'offline', apiCode: null },
    }

    await purgeStaleCachedNotes(adapter, ['a'], () => true, 'acc-1')

    expect(bindings.deleteCalls).toEqual([])
    expect(noteStore.get('a')).toBeDefined()
  })
})
