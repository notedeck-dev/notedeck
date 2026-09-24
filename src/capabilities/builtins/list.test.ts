import { describe, expect, it } from 'vitest'
import {
  LIST_BUILTIN_CAPABILITIES,
  listAddUserCapability,
  listListCapability,
  listRemoveUserCapability,
} from './list'

describe('list capabilities — declaration', () => {
  it('list.list: account.read, cheap, aiTool', () => {
    expect(listListCapability.id).toBe('list.list')
    expect(listListCapability.permissions).toEqual(['account.read'])
    expect(listListCapability.signature?.cheap).toBe(true)
    expect(listListCapability.signature?.returns?.type).toBe('array')
  })

  it.each([
    ['list.addUser', listAddUserCapability] as const,
    ['list.removeUser', listRemoveUserCapability] as const,
  ])('%s declares account.write + confirmation', (id, cap) => {
    expect(cap.id).toBe(id)
    expect(cap.permissions).toEqual(['account.write'])
    expect(cap.requiresConfirmation).toBeTruthy()
    expect(cap.aiTool).toBe(true)
    expect(cap.signature?.params?.listId?.optional).not.toBe(true)
    expect(cap.signature?.params?.userId?.optional).not.toBe(true)
  })
})

describe('LIST_BUILTIN_CAPABILITIES', () => {
  it('contains list / addUser / removeUser', () => {
    const ids = LIST_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual(['list.addUser', 'list.list', 'list.removeUser'])
  })
})
