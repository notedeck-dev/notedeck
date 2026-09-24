import { describe, expect, it } from 'vitest'
import {
  FAVORITES_BUILTIN_CAPABILITIES,
  favoritesAddCapability,
  favoritesRemoveCapability,
} from './favorites'

describe('favorites capabilities — declaration', () => {
  it.each([
    ['favorites.add', favoritesAddCapability] as const,
    ['favorites.remove', favoritesRemoveCapability] as const,
  ])('%s declares notes.react permission, confirmation, aiTool', (id, cap) => {
    expect(cap.id).toBe(id)
    expect(cap.permissions).toEqual(['notes.react'])
    expect(cap.requiresConfirmation).toBeTruthy()
    expect(cap.aiTool).toBe(true)
    expect(cap.signature?.params?.noteId?.optional).not.toBe(true)
  })
})

describe('FAVORITES_BUILTIN_CAPABILITIES', () => {
  it('contains add / remove', () => {
    const ids = FAVORITES_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual(['favorites.add', 'favorites.remove'])
  })
})
