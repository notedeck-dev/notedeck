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
        'ai.listPersonas',
        'ai.sessions.list',
        'ai.sessions.read',
        'ai.sessions.search',
        'ai.setPersona',
        'clipboard.read',
        'clipboard.write',
        'clips.addNote',
        'clips.create',
        'clips.list',
        'clips.notes',
        'clips.removeNote',
        'column.active',
        'column.add',
        'column.focusedNote',
        'column.list',
        'column.remove',
        'drafts.create',
        'drafts.delete',
        'drafts.list',
        'drafts.update',
        'drive.list',
        'http.fetch',
        'keybinds.list',
        'keybinds.reset',
        'keybinds.resetAll',
        'keybinds.set',
        'logs.recent',
        'memos.backlinks',
        'memos.create',
        'memos.delete',
        'memos.list',
        'memos.search',
        'memos.update',
        'meta.activeSkills',
        'meta.config',
        'meta.permissions',
        'meta.persona',
        'misstore.search',
        'navbar.list',
        'navbar.reset',
        'navbar.set',
        'notes.children',
        'notes.create',
        'notes.delete',
        'notes.pin',
        'notes.react',
        'notes.search',
        'notes.show',
        'notes.timeline',
        'notes.unpin',
        'notes.unreact',
        'notes.user',
        'notifications.list',
        'notifications.markRead',
        'performance.applySlider',
        'performance.list',
        'performance.reset',
        'performance.resetAll',
        'performance.set',
        'plugins.create',
        'plugins.delete',
        'plugins.history',
        'plugins.list',
        'plugins.read',
        'plugins.revert',
        'plugins.setActive',
        'plugins.update',
        'skills.append',
        'skills.history',
        'skills.list',
        'skills.read',
        'skills.replaceSection',
        'skills.revert',
        'skills.toggle',
        'styles.append',
        'styles.history',
        'styles.read',
        'styles.revert',
        'styles.write',
        'tasks.run',
        'theme.apply',
        'theme.create',
        'theme.history',
        'theme.list',
        'theme.read',
        'theme.revert',
        'theme.update',
        'time.now',
        'ui.notify',
        'user.follow',
        'user.lookup',
        'user.mute',
        'user.renoteMute',
        'user.search',
        'user.unfollow',
        'user.unmute',
        'user.unrenoteMute',
        'widgets.create',
        'widgets.delete',
        'widgets.history',
        'widgets.list',
        'widgets.read',
        'widgets.revert',
        'widgets.setAutoRun',
        'widgets.update',
        'windows.close',
        'windows.closeAll',
        'windows.focus',
        'windows.list',
        'windows.open',
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
      // 推奨だが skills.replaceSection のように camelCase 複合語も許可。
      // 多段ネスト (例: ai.sessions.list) も許可。
      expect(cap.id, `${cap.id} should be dotted`).toMatch(
        /^[a-z]+(?:\.[a-zA-Z]+){1,2}$/,
      )
    }
  })
})
