import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MEMOS_READ_BUILTIN_CAPABILITIES,
  memosBacklinksCapability,
  memosListCapability,
  memosSearchCapability,
} from './memos-read'

vi.mock('@/utils/settingsFs', async () => {
  const actual =
    await vi.importActual<typeof import('@/utils/settingsFs')>(
      '@/utils/settingsFs',
    )
  return { ...actual, isTauri: false }
})
vi.mock('@/aiscript/events', () => ({ emitNoteDeckEvent: vi.fn() }))

describe('memos-read capability shape', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('memos.list declares memos.read permission and is cheap', () => {
    expect(memosListCapability.id).toBe('memos.list')
    expect(memosListCapability.permissions).toEqual(['memos.read'])
    expect(memosListCapability.aiTool).toBe(true)
    expect(memosListCapability.signature?.cheap).toBe(true)
    expect(memosListCapability.requiresConfirmation).toBeFalsy()
  })

  it('memos.list params (tag / olderThanDays / query / limit) are optional', () => {
    const params = memosListCapability.signature?.params
    expect(params?.tag?.optional).toBe(true)
    expect(params?.olderThanDays?.optional).toBe(true)
    expect(params?.query?.optional).toBe(true)
    expect(params?.limit?.optional).toBe(true)
  })

  it('memos.search declares memos.read permission and requires query', () => {
    expect(memosSearchCapability.id).toBe('memos.search')
    expect(memosSearchCapability.permissions).toEqual(['memos.read'])
    expect(memosSearchCapability.aiTool).toBe(true)
    expect(memosSearchCapability.signature?.cheap).toBe(true)
    const params = memosSearchCapability.signature?.params
    expect(params?.query?.optional).toBeFalsy() // required
    expect(params?.limit?.optional).toBe(true)
  })

  it('memos.search rejects empty / missing query', async () => {
    await expect(memosSearchCapability.execute()).rejects.toThrow(
      /query is required/,
    )
    await expect(
      memosSearchCapability.execute({ query: '   ' }),
    ).rejects.toThrow(/query is required/)
  })

  it('memos.backlinks declares memos.read permission, is cheap, requires id (#494)', () => {
    expect(memosBacklinksCapability.id).toBe('memos.backlinks')
    expect(memosBacklinksCapability.permissions).toEqual(['memos.read'])
    expect(memosBacklinksCapability.aiTool).toBe(true)
    expect(memosBacklinksCapability.signature?.cheap).toBe(true)
    expect(memosBacklinksCapability.requiresConfirmation).toBeFalsy()
    const params = memosBacklinksCapability.signature?.params
    expect(params?.id?.optional).toBeFalsy() // required
  })

  it('memos.backlinks rejects missing / malformed id', async () => {
    await expect(memosBacklinksCapability.execute()).rejects.toThrow(
      /id is required/,
    )
    await expect(
      memosBacklinksCapability.execute({ id: 'not-a-zk-id' }),
    ).rejects.toThrow(/Zettelkasten key/)
  })

  it('MEMOS_READ_BUILTIN_CAPABILITIES exposes list / search / backlinks', () => {
    const ids = MEMOS_READ_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual(['memos.backlinks', 'memos.list', 'memos.search'])
  })

  it('ラベル付き (tainted) メモを返すときだけ markTainted を呼ぶ (#1103)', async () => {
    const { saveMemo, deleteMemo } = await import('@/composables/useMemos')
    const base = {
      cw: '',
      showCw: false,
      visibility: 'public' as const,
      localOnly: false,
      fileIds: [],
      pollChoices: [],
      pollMultiple: false,
      showPoll: false,
      scheduledAt: null,
      tags: [],
    }
    saveMemo('20260101000001', { ...base, text: 'clean note' })
    saveMemo('20260101000002', { ...base, text: 'dirty note', tainted: true })
    const mark = vi.fn()
    const clean = await memosSearchCapability.execute(
      { query: 'clean' },
      { markTainted: mark },
    )
    expect(clean).toHaveLength(1)
    expect(mark).not.toHaveBeenCalled()
    const dirty = (await memosListCapability.execute(
      {},
      { markTainted: mark },
    )) as Array<{ tainted?: boolean }>
    expect(dirty.some((r) => r.tainted)).toBe(true)
    expect(mark).toHaveBeenCalledOnce()
    deleteMemo('20260101000001')
    deleteMemo('20260101000002')
  })
})
