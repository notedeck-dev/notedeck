import { describe, expect, it } from 'vitest'
import {
  NOTES_WRITE_BUILTIN_CAPABILITIES,
  notesCreateCapability,
  notesReactCapability,
  notesUnreactCapability,
} from './notes-write'

describe('notes.unreact capability', () => {
  it('declares notes.react permission, confirmation, aiTool', () => {
    expect(notesUnreactCapability.id).toBe('notes.unreact')
    expect(notesUnreactCapability.permissions).toEqual(['notes.react'])
    expect(notesUnreactCapability.requiresConfirmation).toBe(true)
    expect(notesUnreactCapability.aiTool).toBe(true)
  })

  it('requires noteId', async () => {
    expect(notesUnreactCapability.signature?.params?.noteId?.optional).not.toBe(
      true,
    )
    await expect(notesUnreactCapability.execute({})).rejects.toThrow(
      /noteId is required/,
    )
  })
})

describe('notes.create capability', () => {
  it('declares notes.write permission and aiTool: true', () => {
    expect(notesCreateCapability.permissions).toEqual(['notes.write'])
    expect(notesCreateCapability.aiTool).toBe(true)
    expect(notesCreateCapability.id).toBe('notes.create')
  })

  it('requires confirmation', () => {
    expect(notesCreateCapability.requiresConfirmation).toBe(true)
  })

  it('marks text as required and others as optional', () => {
    const params = notesCreateCapability.signature?.params
    expect(params?.text?.optional).not.toBe(true)
    expect(params?.cw?.optional).toBe(true)
    expect(params?.visibility?.optional).toBe(true)
    expect(params?.replyId?.optional).toBe(true)
    expect(params?.renoteId?.optional).toBe(true)
    expect(params?.accountId?.optional).toBe(true)
  })

  it('declares the visibility enum', () => {
    expect(notesCreateCapability.signature?.params?.visibility?.enum).toEqual([
      'public',
      'home',
      'followers',
      'specified',
    ])
  })

  it('throws when text and renoteId are both missing', async () => {
    await expect(notesCreateCapability.execute({})).rejects.toThrow(
      /text is required/,
    )
    await expect(
      notesCreateCapability.execute({ text: '   ' }),
    ).rejects.toThrow(/text is required/)
  })

  it('throws on invalid visibility', async () => {
    await expect(
      notesCreateCapability.execute({ text: 'hi', visibility: 'secret' }),
    ).rejects.toThrow(/invalid visibility/)
  })
})

describe('notes.react capability', () => {
  it('declares notes.react permission and aiTool: true', () => {
    expect(notesReactCapability.permissions).toEqual(['notes.react'])
    expect(notesReactCapability.aiTool).toBe(true)
    expect(notesReactCapability.id).toBe('notes.react')
  })

  it('requires confirmation', () => {
    expect(notesReactCapability.requiresConfirmation).toBe(true)
  })

  it('marks noteId and reaction as required, accountId as optional', () => {
    const params = notesReactCapability.signature?.params
    expect(params?.noteId?.optional).not.toBe(true)
    expect(params?.reaction?.optional).not.toBe(true)
    expect(params?.accountId?.optional).toBe(true)
  })

  it('throws when noteId is missing', async () => {
    await expect(
      notesReactCapability.execute({ reaction: '👍' }),
    ).rejects.toThrow(/noteId is required/)
  })

  it('throws when reaction is missing', async () => {
    await expect(
      notesReactCapability.execute({ noteId: 'n1' }),
    ).rejects.toThrow(/reaction is required/)
  })
})

describe('NOTES_WRITE_BUILTIN_CAPABILITIES', () => {
  it('contains create / react / unreact', () => {
    const ids = NOTES_WRITE_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual(['notes.create', 'notes.react', 'notes.unreact'])
  })
})
