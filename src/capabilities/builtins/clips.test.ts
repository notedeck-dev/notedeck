import { describe, expect, it } from 'vitest'
import {
  CLIPS_BUILTIN_CAPABILITIES,
  clipsAddNoteCapability,
  clipsCreateCapability,
  clipsListCapability,
  clipsNotesCapability,
  clipsRemoveNoteCapability,
} from './clips'

// Note: execute は adapter / Tauri command を経由するので unit 環境では走らない。
// capability 定義と引数バリデーションのみ検証する。

describe('clips capabilities — declaration', () => {
  it('clips.list: read permission, aiTool true, cheap', () => {
    expect(clipsListCapability.id).toBe('clips.list')
    expect(clipsListCapability.permissions).toEqual(['clips.read'])
    expect(clipsListCapability.signature?.cheap).toBe(true)
    expect(clipsListCapability.signature?.returns?.type).toBe('array')
  })

  it('clips.notes: read + notes.read permission, requires clipId', async () => {
    expect(clipsNotesCapability.id).toBe('clips.notes')
    expect(clipsNotesCapability.permissions).toEqual([
      'clips.read',
      'notes.read',
    ])
    expect(clipsNotesCapability.signature?.params?.clipId?.optional).not.toBe(
      true,
    )
    expect(clipsNotesCapability.signature?.params?.limit?.optional).toBe(true)
    await expect(clipsNotesCapability.execute({})).rejects.toThrow(
      /clipId is required/,
    )
  })

  it('clips.create: write permission, confirmation, requires name', async () => {
    expect(clipsCreateCapability.id).toBe('clips.create')
    expect(clipsCreateCapability.permissions).toEqual(['clips.write'])
    expect(clipsCreateCapability.requiresConfirmation).toBe(true)
    await expect(clipsCreateCapability.execute({})).rejects.toThrow(
      /name is required/,
    )
  })

  it('clips.addNote: write permission, confirmation, requires clipId+noteId', async () => {
    expect(clipsAddNoteCapability.id).toBe('clips.addNote')
    expect(clipsAddNoteCapability.permissions).toEqual(['clips.write'])
    expect(clipsAddNoteCapability.requiresConfirmation).toBe(true)
    await expect(clipsAddNoteCapability.execute({})).rejects.toThrow(
      /clipId is required/,
    )
    await expect(
      clipsAddNoteCapability.execute({ clipId: 'c1' }),
    ).rejects.toThrow(/noteId is required/)
  })

  it('clips.removeNote: write permission, confirmation, requires clipId+noteId', async () => {
    expect(clipsRemoveNoteCapability.id).toBe('clips.removeNote')
    expect(clipsRemoveNoteCapability.permissions).toEqual(['clips.write'])
    expect(clipsRemoveNoteCapability.requiresConfirmation).toBe(true)
    await expect(clipsRemoveNoteCapability.execute({})).rejects.toThrow(
      /clipId is required/,
    )
    await expect(
      clipsRemoveNoteCapability.execute({ clipId: 'c1' }),
    ).rejects.toThrow(/noteId is required/)
  })
})

describe('CLIPS_BUILTIN_CAPABILITIES', () => {
  it('contains all 5 capabilities', () => {
    const ids = CLIPS_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual([
      'clips.addNote',
      'clips.create',
      'clips.list',
      'clips.notes',
      'clips.removeNote',
    ])
  })

  it('all capabilities are exposed to AI (aiTool: true)', () => {
    for (const cap of CLIPS_BUILTIN_CAPABILITIES) {
      expect(cap.aiTool, `${cap.id} should be aiTool`).toBe(true)
    }
  })
})
