import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  MEMOS_READ_BUILTIN_CAPABILITIES,
  memosBacklinksCapability,
  memosListCapability,
  memosSearchCapability,
} from './memos-read'

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
})
