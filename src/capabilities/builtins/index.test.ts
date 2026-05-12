import { describe, expect, it } from 'vitest'
import { ALL_BUILTIN_CAPABILITIES } from './index'

describe('ALL_BUILTIN_CAPABILITIES', () => {
  it('exposes the expected built-in capability ids', () => {
    const ids = ALL_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual(
      [
        'account.current',
        'account.list',
        'ai.chat',
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
        'plugins.create',
        'plugins.delete',
        'plugins.list',
        'plugins.read',
        'plugins.setActive',
        'plugins.update',
        'skills.append',
        'skills.list',
        'skills.read',
        'skills.replaceSection',
        'skills.toggle',
        'tasks.run',
        'theme.apply',
        'theme.create',
        'theme.list',
        'theme.read',
        'theme.update',
        'time.now',
        'ui.notify',
        'user.lookup',
        'widgets.create',
        'widgets.delete',
        'widgets.list',
        'widgets.read',
        'widgets.setAutoRun',
        'widgets.update',
      ].sort(),
    )
  })

  it('every entry has a signature with a description', () => {
    // aiTool は capability ごとに true/false が選択される (例: ai.chat は false
    // で AI 本体からの自己再帰を防ぐ)。registry 登録の必須項目は signature。
    for (const cap of ALL_BUILTIN_CAPABILITIES) {
      expect(cap.signature, `${cap.id} signature`).toBeDefined()
      expect(typeof cap.signature?.description, `${cap.id} description`).toBe(
        'string',
      )
    }
  })

  it('every id uses dot-notation (Phase 1 命名規約)', () => {
    for (const cap of ALL_BUILTIN_CAPABILITIES) {
      // capability id は <subject>.<verb> ドット区切り。verb は単一語が
      // 推奨だが skills.replaceSection のように camelCase 複合語も許可する。
      expect(cap.id, `${cap.id} should be dotted`).toMatch(
        /^[a-z]+\.[a-zA-Z]+$/,
      )
    }
  })
})
