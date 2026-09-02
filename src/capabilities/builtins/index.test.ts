import { describe, expect, it } from 'vitest'
import { sanitizeToolName } from '@/capabilities/identifier'
import { toAnthropicTool, toOpenAiTool } from '@/capabilities/toolSchema'
import { HIGH_RISK_PERMISSION_KEYS } from '@/permissions/schema'
import { ALL_BUILTIN_CAPABILITIES } from './index'

describe('ALL_BUILTIN_CAPABILITIES', () => {
  it('exposes the expected built-in capability ids', () => {
    const ids = ALL_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual(
      [
        'account.current',
        'account.list',
        'account.switch',
        'ai.chat',
        'ai.listPersonas',
        'ai.sessions.list',
        'ai.sessions.read',
        'ai.sessions.search',
        'ai.setPersona',
        'aiscript.logs',
        'aiscript.validate',
        'announcements.list',
        'antenna.list',
        'antenna.notes',
        'channel.list',
        'channel.notes',
        'chat.react',
        'chat.unreact',
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
        'column.move',
        'column.remove',
        'column.updateSettings',
        'sidebar.toggle',
        'drafts.create',
        'drafts.delete',
        'drafts.list',
        'drafts.update',
        'drive.list',
        'backup.create',
        'favorites.add',
        'favorites.remove',
        'federation.chart',
        'federation.instance',
        'federation.instances',
        'files.export',
        'flash.list',
        'flash.show',
        'gallery.list',
        'http.fetch',
        'keybinds.list',
        'keybinds.reset',
        'keybinds.resetAll',
        'keybinds.set',
        'list.addUser',
        'list.list',
        'list.removeUser',
        'logs.recent',
        'memos.backlinks',
        'memos.create',
        'memos.delete',
        'memos.revert',
        'memos.list',
        'memos.search',
        'memos.update',
        'meta.activeSkills',
        'meta.config',
        'meta.heartbeat',
        'meta.permissions',
        'meta.persona',
        'metrics.read',
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
        'pages.list',
        'pages.show',
        'performance.applySlider',
        'performance.list',
        'performance.reset',
        'performance.resetAll',
        'performance.set',
        'plugins.create',
        'plugins.delete',
        'plugins.history',
        'plugins.install',
        'plugins.list',
        'plugins.read',
        'plugins.revert',
        'plugins.setActive',
        'plugins.uninstall',
        'plugins.update',
        'registry.delete',
        'registry.get',
        'registry.listKeys',
        'registry.set',
        'role.notes',
        'skills.append',
        'skills.create',
        'skills.history',
        'skills.install',
        'skills.list',
        'skills.read',
        'skills.replaceSection',
        'skills.revert',
        'skills.toggle',
        'skills.uninstall',
        'styles.append',
        'styles.history',
        'styles.read',
        'styles.revert',
        'styles.write',
        'tasks.run',
        'theme.apply',
        'theme.create',
        'theme.history',
        'theme.install',
        'theme.list',
        'theme.read',
        'theme.revert',
        'theme.uninstall',
        'theme.update',
        'time.now',
        'ui.notify',
        'user.follow',
        'user.followers',
        'user.following',
        'user.lookup',
        'user.mute',
        'user.renoteMute',
        'user.search',
        'user.unfollow',
        'user.unmute',
        'user.unrenoteMute',
        'vault.fetch',
        'widgets.create',
        'widgets.delete',
        'widgets.history',
        'widgets.install',
        'widgets.list',
        'widgets.read',
        'widgets.revert',
        'widgets.setAutoRun',
        'widgets.uninstall',
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

// capability の AI 露出面と権限宣言を機械的に固定する (#876)。
//
// 権限まわりの構造は #711 / #712 / #718 で固めたが、個々の capability が
// 「AI に見せてよいか」「どの権限を要求するか」「実行前に確認を出すか」は
// 定義に書かれた宣言だけが根拠で、書き忘れても CI では落ちなかった。
//
// ここでは現状の宣言をそのまま固定する。新しい capability が宣言なしで
// 増えたときにこのテストが落ち、意図的なら一覧に足す (= レビューを強制する)
// のが目的で、リストの中身自体は過去の設計判断の写しでしかない。

/**
 * AI tool schema に載せない capability。
 * `ai.chat` は AI 本体からの自己再帰を防ぐため (registry.ts)。
 */
const NOT_EXPOSED_TO_AI = ['ai.chat']

/**
 * 権限を要求しない capability。いずれもローカル UI state の操作で、
 * 実際の副作用は開いた先の capability 側で guard される
 * (例: cssEditor を開くのは自由だが CSS 書込には styles.write が要る)。
 */
const WITHOUT_PERMISSIONS = [
  'aiscript.validate',
  'column.add',
  'column.move',
  'column.remove',
  'column.updateSettings',
  'keybinds.list',
  'meta.activeSkills',
  'meta.config',
  'meta.heartbeat',
  'meta.permissions',
  'meta.persona',
  'metrics.read',
  'navbar.list',
  'performance.list',
  'sidebar.toggle',
  'styles.history',
  'styles.read',
  'theme.apply',
  'theme.history',
  'theme.list',
  'theme.read',
  'time.now',
  'windows.close',
  'windows.closeAll',
  'windows.focus',
  'windows.list',
  'windows.open',
]

/**
 * 高リスク権限 (HIGH_RISK_PERMISSION_KEYS) を要求するが確認ダイアログを
 * 出さない capability。権限そのものが gate になっている面。
 */
const HIGH_RISK_WITHOUT_CONFIRMATION = [
  // アクティブアカウントの切替。もう一度呼べば戻せる
  'account.switch',
  // 検索のみ (外部ネットワークへの read)
  'misstore.search',
  // skill の有効 / 無効の切替。本文は書き換えない
  'skills.toggle',
  // tasks.run 権限自体が高リスク扱いで、plugin / external には恒久 deny
  'tasks.run',
]

describe('capability の AI 露出と権限宣言 (#876)', () => {
  it('AI tool schema に載らない capability は固定の一覧だけ', () => {
    const notExposed = ALL_BUILTIN_CAPABILITIES.filter((c) => !c.aiTool)
      .map((c) => c.id)
      .sort()
    expect(notExposed).toEqual([...NOT_EXPOSED_TO_AI].sort())
  })

  it('AI に露出する capability は 2 形式の tool schema へ変換できる', () => {
    for (const cap of ALL_BUILTIN_CAPABILITIES.filter((c) => c.aiTool)) {
      expect(() => toAnthropicTool(cap), cap.id).not.toThrow()
      expect(() => toOpenAiTool(cap), cap.id).not.toThrow()
    }
  })

  it('tool 名が衝突しない', () => {
    // 区切りを '_' に潰すので、id が違っても tool 名が重なることがありうる
    const names = ALL_BUILTIN_CAPABILITIES.map((c) => sanitizeToolName(c.id))
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([])
  })

  it('権限を要求しない capability は固定の一覧だけ', () => {
    const ungated = ALL_BUILTIN_CAPABILITIES.filter(
      (c) => !c.permissions?.length,
    )
      .map((c) => c.id)
      .sort()
    expect(ungated).toEqual([...WITHOUT_PERMISSIONS].sort())
  })

  it('高リスク権限を要求する capability は確認を出す (例外は固定の一覧だけ)', () => {
    const unconfirmed = ALL_BUILTIN_CAPABILITIES.filter(
      (c) =>
        c.permissions?.some((p) => HIGH_RISK_PERMISSION_KEYS.includes(p)) &&
        !c.requiresConfirmation,
    )
      .map((c) => c.id)
      .sort()
    expect(unconfirmed).toEqual([...HIGH_RISK_WITHOUT_CONFIRMATION].sort())
  })

  it('actsAsAccount 宣言のある capability は必ず確認を出す', () => {
    // 呼び出し文脈と違うアカウントとして実行する面 (#777)。確認を挟まないと
    // 「どのアカウントとして実行されたか」をユーザーが知る機会がなくなる
    const missing = ALL_BUILTIN_CAPABILITIES.filter(
      (c) => c.actsAsAccount && !c.requiresConfirmation,
    ).map((c) => c.id)
    expect(missing).toEqual([])
  })
})
