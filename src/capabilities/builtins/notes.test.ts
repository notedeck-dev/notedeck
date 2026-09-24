import { describe, expect, it } from 'vitest'
import {
  NOTES_BUILTIN_CAPABILITIES,
  notesChildrenCapability,
  notesSearchArchiveCapability,
  notesSearchCapability,
  notesShowCapability,
  notesTimelineCapability,
  notesUserCapability,
} from './notes'

// Note: 実 adapter / Misskey API 呼び出しは ユニットテストでは
// 検証しない (Tauri / fetch の depends あり)。本テストは capability
// 定義の正しさ + 入力検証 (params validation) のみ。
// 実挙動は dom テストか実機 / E2E で確認。

describe('notes.search capability', () => {
  it('declares notes.read permission and aiTool: true', () => {
    expect(notesSearchCapability.permissions).toEqual(['notes.read'])
    expect(notesSearchCapability.aiTool).toBe(true)
    expect(notesSearchCapability.id).toBe('notes.search')
    expect(notesSearchCapability.signature?.returns?.type).toBe('array')
  })

  it('marks query as required and limit as optional', () => {
    const params = notesSearchCapability.signature?.params
    expect(params?.query?.optional).not.toBe(true)
    expect(params?.limit?.optional).toBe(true)
  })
})

describe('notes.searchArchive capability (#947)', () => {
  it('declares notes.readArchive (not notes.read) and aiTool: true', () => {
    expect(notesSearchArchiveCapability.permissions).toEqual([
      'notes.readArchive',
    ])
    expect(notesSearchArchiveCapability.aiTool).toBe(true)
    expect(notesSearchArchiveCapability.id).toBe('notes.searchArchive')
  })

  it('every param is optional and includePrivate defaults to public only', () => {
    const params = notesSearchArchiveCapability.signature?.params ?? {}
    for (const key of Object.keys(params)) {
      expect(params[key]?.optional, key).toBe(true)
    }
    expect(params.includePrivate?.description).toContain('既定 false')
  })

  it('is registered', () => {
    expect(NOTES_BUILTIN_CAPABILITIES).toContain(notesSearchArchiveCapability)
  })
})

describe('notes.timeline capability', () => {
  it('declares notes.read permission and aiTool: true', () => {
    expect(notesTimelineCapability.permissions).toEqual(['notes.read'])
    expect(notesTimelineCapability.aiTool).toBe(true)
    expect(notesTimelineCapability.id).toBe('notes.timeline')
  })

  it('declares the timeline type enum', () => {
    const enums = notesTimelineCapability.signature?.params?.type?.enum
    expect(enums).toEqual(['home', 'local', 'social', 'global'])
  })
})

describe('notes.user capability', () => {
  it('declares notes.read permission and aiTool: true', () => {
    expect(notesUserCapability.permissions).toEqual(['notes.read'])
    expect(notesUserCapability.aiTool).toBe(true)
    expect(notesUserCapability.id).toBe('notes.user')
  })

  it('marks userId as required', () => {
    const params = notesUserCapability.signature?.params
    expect(params?.userId?.optional).not.toBe(true)
  })
})

describe('notes.show capability', () => {
  it('declares notes.read permission and aiTool: true', () => {
    expect(notesShowCapability.permissions).toEqual(['notes.read'])
    expect(notesShowCapability.aiTool).toBe(true)
    expect(notesShowCapability.id).toBe('notes.show')
    expect(notesShowCapability.signature?.returns?.type).toBe('object')
  })

  it('marks noteId as required', () => {
    const params = notesShowCapability.signature?.params
    expect(params?.noteId?.optional).not.toBe(true)
  })
})

describe('notes.children capability', () => {
  it('declares notes.read permission and aiTool: true', () => {
    expect(notesChildrenCapability.permissions).toEqual(['notes.read'])
    expect(notesChildrenCapability.aiTool).toBe(true)
    expect(notesChildrenCapability.id).toBe('notes.children')
    expect(notesChildrenCapability.signature?.returns?.type).toBe('array')
  })

  it('marks noteId required, limit/untilId optional', () => {
    const params = notesChildrenCapability.signature?.params
    expect(params?.noteId?.optional).not.toBe(true)
    expect(params?.limit?.optional).toBe(true)
    expect(params?.untilId?.optional).toBe(true)
  })
})

describe('NOTES_BUILTIN_CAPABILITIES', () => {
  it('contains all six notes capabilities', () => {
    expect(NOTES_BUILTIN_CAPABILITIES).toHaveLength(6)
    expect(NOTES_BUILTIN_CAPABILITIES).toContain(notesSearchArchiveCapability)
    expect(NOTES_BUILTIN_CAPABILITIES).toContain(notesSearchCapability)
    expect(NOTES_BUILTIN_CAPABILITIES).toContain(notesTimelineCapability)
    expect(NOTES_BUILTIN_CAPABILITIES).toContain(notesUserCapability)
    expect(NOTES_BUILTIN_CAPABILITIES).toContain(notesShowCapability)
    expect(NOTES_BUILTIN_CAPABILITIES).toContain(notesChildrenCapability)
  })
})
