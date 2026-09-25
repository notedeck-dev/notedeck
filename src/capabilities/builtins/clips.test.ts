import { describe, expect, it } from 'vitest'
import { CLIPS_BUILTIN_CAPABILITIES, clipsListCapability } from './clips'

// Note: execute は adapter / Tauri command を経由するので unit 環境では走らない。
// capability 定義と引数バリデーションのみ検証する。

describe('clips capabilities — declaration', () => {
  it('clips.list: read permission, aiTool true, cheap', () => {
    expect(clipsListCapability.id).toBe('clips.list')
    expect(clipsListCapability.permissions).toEqual(['clips.read'])
    expect(clipsListCapability.signature?.cheap).toBe(true)
    expect(clipsListCapability.signature?.returns?.type).toBe('array')
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
