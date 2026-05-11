import { describe, expect, it } from 'vitest'
import { ALL_BUILTIN_CAPABILITIES } from './index'

describe('ALL_BUILTIN_CAPABILITIES', () => {
  it('exposes the expected built-in capability ids', () => {
    const ids = ALL_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual(
      [
        'account.current',
        'account.list',
        'column.add',
        'column.list',
        'column.remove',
        'drive.list',
        'http.fetch',
        'memos.backlinks',
        'memos.create',
        'memos.delete',
        'memos.list',
        'memos.search',
        'memos.update',
        'notes.children',
        'notes.create',
        'notes.react',
        'notes.search',
        'notes.show',
        'notes.timeline',
        'notes.user',
        'notifications.list',
        'tasks.run',
        'theme.apply',
        'theme.list',
        'time.now',
        'ui.notify',
        'user.lookup',
      ].sort(),
    )
  })

  it('every entry is properly tagged for AI tool calling', () => {
    for (const cap of ALL_BUILTIN_CAPABILITIES) {
      expect(cap.aiTool, `${cap.id} aiTool`).toBe(true)
      expect(cap.signature, `${cap.id} signature`).toBeDefined()
      expect(typeof cap.signature?.description, `${cap.id} description`).toBe(
        'string',
      )
    }
  })

  it('every id uses dot-notation (Phase 1 命名規約)', () => {
    for (const cap of ALL_BUILTIN_CAPABILITIES) {
      // capability id は <subject>.<verb> ドット区切り。Phase 1 の
      // permissions key と統一されている。
      expect(cap.id, `${cap.id} should be dotted`).toMatch(/^[a-z]+\.[a-z]+$/)
    }
  })
})
