// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/settingsFs', async () => {
  const actual =
    await vi.importActual<typeof import('@/utils/settingsFs')>(
      '@/utils/settingsFs',
    )
  return { ...actual, isTauri: false }
})

vi.mock('@/aiscript/events', () => ({ emitNoteDeckEvent: vi.fn() }))

import {
  deleteMemo,
  loadAllMemos,
  loadMemo,
  type MemoData,
  saveMemo,
} from '@/composables/useMemos'

function memo(text: string): MemoData {
  return {
    text,
    cw: '',
    showCw: false,
    visibility: 'public',
    localOnly: false,
    fileIds: [],
    pollChoices: [],
    pollMultiple: false,
    showPoll: false,
    scheduledAt: null,
    tags: [],
  }
}

describe('useMemos — メモはアカウントに紐づかない (#1018)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    for (const key of Object.keys(loadAllMemos())) deleteMemo(key)
  })

  it('アカウントを渡さずに保存・読み出しできる', () => {
    saveMemo('20260813120000', memo('ローカルのメモ'))

    expect(loadMemo('20260813120000')?.data.text).toBe('ローカルのメモ')
  })

  it('すべてのメモが 1 つのプールに並ぶ', () => {
    saveMemo('20260813120000', memo('a'))
    saveMemo('20260813120001', memo('b'))

    expect(Object.keys(loadAllMemos()).sort()).toEqual([
      '20260813120000',
      '20260813120001',
    ])
  })

  it('誰が書いたかは author (principal 種別) が持つ', () => {
    saveMemo('20260813120000', {
      ...memo('a'),
      author: { id: 'ai.heartbeat', displayName: 'HEARTBEAT' },
    })

    expect(loadMemo('20260813120000')?.data.author?.id).toBe('ai.heartbeat')
    // 人間が書いたメモは author を持たない
    saveMemo('20260813120001', memo('b'))
    expect(loadMemo('20260813120001')?.data.author).toBeUndefined()
  })

  it('削除はキーだけで行える', () => {
    saveMemo('20260813120000', memo('a'))

    deleteMemo('20260813120000')

    expect(loadMemo('20260813120000')).toBeNull()
  })
})
