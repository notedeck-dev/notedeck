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
    expect(notesUnreactCapability.requiresConfirmation).toBeTruthy()
    expect(notesUnreactCapability.aiTool).toBe(true)
  })
})

describe('notes.create capability', () => {
  it('declares notes.write permission and aiTool: true', () => {
    expect(notesCreateCapability.permissions).toEqual(['notes.write'])
    expect(notesCreateCapability.aiTool).toBe(true)
    expect(notesCreateCapability.id).toBe('notes.create')
  })

  it('requires confirmation', () => {
    expect(notesCreateCapability.requiresConfirmation).toBeTruthy()
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
})

describe('notes.react capability', () => {
  it('declares notes.react permission and aiTool: true', () => {
    expect(notesReactCapability.permissions).toEqual(['notes.react'])
    expect(notesReactCapability.aiTool).toBe(true)
    expect(notesReactCapability.id).toBe('notes.react')
  })

  it('requires confirmation', () => {
    expect(notesReactCapability.requiresConfirmation).toBeTruthy()
  })

  it('marks noteId and reaction as required, accountId as optional', () => {
    const params = notesReactCapability.signature?.params
    expect(params?.noteId?.optional).not.toBe(true)
    expect(params?.reaction?.optional).not.toBe(true)
    expect(params?.accountId?.optional).toBe(true)
  })
})

describe('notes.pin / unpin', () => {
  it.each([
    'notes.pin',
    'notes.unpin',
  ] as const)('%s declares notes.write + confirmation', (id) => {
    const cap = NOTES_WRITE_BUILTIN_CAPABILITIES.find((c) => c.id === id)
    if (!cap) throw new Error(`${id} not found`)
    expect(cap.permissions).toEqual(['notes.write'])
    expect(cap.requiresConfirmation).toBeTruthy()
    expect(cap.aiTool).toBe(true)
    expect(cap.signature?.params?.noteId?.optional).not.toBe(true)
  })
})

describe('NOTES_WRITE_BUILTIN_CAPABILITIES', () => {
  it('contains create / react / unreact / delete / pin / unpin', () => {
    const ids = NOTES_WRITE_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual([
      'notes.create',
      'notes.delete',
      'notes.pin',
      'notes.react',
      'notes.unpin',
      'notes.unreact',
    ])
  })
})
