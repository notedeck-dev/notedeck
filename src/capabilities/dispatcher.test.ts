// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Command } from '@/commands/registry'
import {
  type AiConfig,
  defaultConfig,
  setPermissionPreset,
} from '@/composables/useAiConfig'
import { useSpotlightStore } from '@/composables/useSpotlight'
import { dispatchCapability } from './dispatcher'
import { _clearCapabilitiesForTest, registerCapability } from './registry'

function makeCapability(overrides: Partial<Command> = {}): Command {
  return {
    id: 'test.cap',
    label: 'test',
    icon: 'ti-flask',
    category: 'general',
    shortcuts: [],
    aiTool: true,
    permissions: [],
    signature: { description: 'test capability' },
    execute: () => 'ok',
    ...overrides,
  }
}

function configWithPreset(preset: 'readonly' | 'safe' | 'full'): AiConfig {
  const cfg = defaultConfig()
  cfg.permissions = setPermissionPreset(cfg.permissions, preset)
  return cfg
}

afterEach(() => {
  _clearCapabilitiesForTest()
})

// nextTick の microtask を flush するためのヘルパー (dispatcher は void nextTick で
// spotlight を emit するので、await で済む)
async function flushNextTick() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('dispatchCapability', () => {
  it('returns ok + result for a registered no-permission capability', async () => {
    registerCapability(makeCapability({ id: 'a', execute: () => 'hello' }))
    const r = await dispatchCapability(
      'a',
      undefined,
      configWithPreset('readonly'),
    )
    expect(r).toEqual({ ok: true, result: 'hello' })
  })

  it('returns unknown_capability for an unregistered id', async () => {
    const r = await dispatchCapability('not-here', {}, configWithPreset('full'))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('unknown_capability')
      expect(r.error).toContain('not-here')
    }
  })

  it('returns permission_denied when required permissions are not allowed', async () => {
    registerCapability(
      makeCapability({ id: 'notes.post', permissions: ['notes.write'] }),
    )
    const r = await dispatchCapability(
      'notes.post',
      { text: 'hi' },
      configWithPreset('readonly'), // notes.write は false
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('permission_denied')
      expect(r.error).toContain('notes.write')
    }
  })

  it('passes when all required permissions are allowed', async () => {
    registerCapability(
      makeCapability({
        id: 'notes.react',
        permissions: ['notes.react'],
        execute: () => 'reacted',
      }),
    )
    const r = await dispatchCapability(
      'notes.react',
      undefined,
      configWithPreset('safe'), // notes.react は true
    )
    expect(r).toEqual({ ok: true, result: 'reacted' })
  })

  it('returns execute_failed when the capability throws', async () => {
    registerCapability(
      makeCapability({
        id: 'broken',
        execute: () => {
          throw new Error('boom')
        },
      }),
    )
    const r = await dispatchCapability(
      'broken',
      undefined,
      configWithPreset('full'),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('execute_failed')
      expect(r.error).toContain('boom')
    }
  })

  it('forwards params to execute and supports async execute', async () => {
    let received: unknown = null
    registerCapability(
      makeCapability({
        id: 'echo',
        execute: async (params) => {
          received = params
          return params
        },
      }),
    )
    const r = await dispatchCapability(
      'echo',
      { greeting: 'hello' },
      configWithPreset('full'),
    )
    expect(r).toEqual({ ok: true, result: { greeting: 'hello' } })
    expect(received).toEqual({ greeting: 'hello' })
  })

  it('resolves a sanitized tool name back to its dotted capability id', async () => {
    // AI は Anthropic / OpenAI 制約に従って sanitized name (`time_now`)
    // を返す。dispatcher はそれを dotted id (`time.now`) に逆引きできる。
    registerCapability(
      makeCapability({
        id: 'time.now',
        execute: () => 'iso-string',
      }),
    )
    const r = await dispatchCapability(
      'time_now',
      undefined,
      configWithPreset('readonly'),
    )
    expect(r).toEqual({ ok: true, result: 'iso-string' })
  })

  it('still works for capabilities whose id has no dot (no sanitization needed)', async () => {
    registerCapability(makeCapability({ id: 'simple', execute: () => 42 }))
    const r = await dispatchCapability(
      'simple',
      undefined,
      configWithPreset('readonly'),
    )
    expect(r).toEqual({ ok: true, result: 42 })
  })

  it('reports ALL missing permissions when more than one is denied', async () => {
    registerCapability(
      makeCapability({
        id: 'multi',
        permissions: ['notes.write', 'network.external'],
      }),
    )
    const r = await dispatchCapability(
      'multi',
      undefined,
      configWithPreset('readonly'),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('notes.write')
      expect(r.error).toContain('network.external')
    }
  })
})

describe('dispatchCapability — confirmation flow', () => {
  it('does NOT invoke confirmFn when capability does not require confirmation', async () => {
    let confirmCalls = 0
    registerCapability(
      makeCapability({ id: 'a', execute: () => 'ok' }), // no requiresConfirmation
    )
    const r = await dispatchCapability(
      'a',
      undefined,
      configWithPreset('readonly'),
      {
        confirmFn: async () => {
          confirmCalls++
          return { accepted: true, remember: false }
        },
      },
    )
    expect(r).toEqual({ ok: true, result: 'ok' })
    expect(confirmCalls).toBe(0)
  })

  it('invokes confirmFn before execute when requiresConfirmation: true', async () => {
    const calls: string[] = []
    registerCapability(
      makeCapability({
        id: 'notes.create',
        permissions: ['notes.write'],
        requiresConfirmation: true,
        execute: () => {
          calls.push('execute')
          return 'posted'
        },
      }),
    )
    const r = await dispatchCapability(
      'notes.create',
      { text: 'hello' },
      configWithPreset('full'),
      {
        confirmFn: async (opts) => {
          calls.push(`confirm:${opts.title}`)
          return { accepted: true, remember: false }
        },
      },
    )
    expect(r).toEqual({ ok: true, result: 'posted' })
    // confirm が execute より先に呼ばれている
    expect(calls).toEqual(['confirm:test を実行しますか?', 'execute'])
  })

  it('returns user_cancelled and SKIPS execute when user cancels', async () => {
    let executed = false
    registerCapability(
      makeCapability({
        id: 'notes.create',
        permissions: ['notes.write'],
        requiresConfirmation: true,
        execute: () => {
          executed = true
          return 'posted'
        },
      }),
    )
    const r = await dispatchCapability(
      'notes.create',
      { text: 'hello' },
      configWithPreset('full'),
      // user clicked cancel
      { confirmFn: async () => ({ accepted: false, remember: false }) },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('user_cancelled')
      expect(r.error).toContain('notes.create')
    }
    expect(executed).toBe(false)
  })

  it('uses function-form requiresConfirmation to compose the ConfirmOptions', async () => {
    const seenOpts: { title: string; message: string }[] = []
    registerCapability(
      makeCapability({
        id: 'notes.react',
        permissions: ['notes.react'],
        requiresConfirmation: (params) => ({
          title: 'リアクションする?',
          message: `note=${(params as { noteId?: string })?.noteId} reaction=${(params as { reaction?: string })?.reaction}`,
          type: 'normal',
        }),
        execute: () => 'reacted',
      }),
    )
    const r = await dispatchCapability(
      'notes.react',
      { noteId: 'n1', reaction: '👍' },
      configWithPreset('safe'),
      {
        confirmFn: async (opts) => {
          seenOpts.push({ title: opts.title, message: opts.message })
          return { accepted: true, remember: false }
        },
      },
    )
    expect(r).toEqual({ ok: true, result: 'reacted' })
    expect(seenOpts).toEqual([
      { title: 'リアクションする?', message: 'note=n1 reaction=👍' },
    ])
  })

  it('runs preflight BEFORE confirm and returns preflight_failed (skipping confirm)', async () => {
    let confirmCalls = 0
    registerCapability(
      makeCapability({
        id: 'plugins.create',
        permissions: ['plugins.write'],
        preflight: () => ({ error: 'bad src: diagnostics: [...]' }),
        requiresConfirmation: true,
        execute: () => 'should not run',
      }),
    )
    const r = await dispatchCapability(
      'plugins.create',
      { src: 'broken' },
      configWithPreset('full'),
      {
        confirmFn: async () => {
          confirmCalls++
          return { accepted: true, remember: false }
        },
      },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('preflight_failed')
      expect(r.error).toContain('diagnostics:')
    }
    expect(confirmCalls).toBe(0)
  })

  it('continues to confirm + execute when preflight returns null', async () => {
    let executed = false
    registerCapability(
      makeCapability({
        id: 'plugins.create',
        permissions: ['plugins.write'],
        preflight: () => null,
        requiresConfirmation: true,
        execute: () => {
          executed = true
          return 'created'
        },
      }),
    )
    const r = await dispatchCapability(
      'plugins.create',
      { src: 'let x = 1' },
      configWithPreset('full'),
      { confirmFn: async () => ({ accepted: true, remember: false }) },
    )
    expect(r).toEqual({ ok: true, result: 'created' })
    expect(executed).toBe(true)
  })

  it('supports async preflight', async () => {
    registerCapability(
      makeCapability({
        id: 'plugins.create',
        permissions: ['plugins.write'],
        preflight: async () => ({ error: 'async fail' }),
      }),
    )
    const r = await dispatchCapability(
      'plugins.create',
      undefined,
      configWithPreset('full'),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('preflight_failed')
      expect(r.error).toBe('async fail')
    }
  })

  it('SKIPS confirm + executes when function-form requiresConfirmation returns null', async () => {
    let confirmCalls = 0
    let executed = false
    registerCapability(
      makeCapability({
        id: 'vault.fetch',
        permissions: ['vault.use'],
        // null = この回は確認不要 (信頼済み接続など)
        requiresConfirmation: () => null,
        execute: () => {
          executed = true
          return 'fetched'
        },
      }),
    )
    const r = await dispatchCapability(
      'vault.fetch',
      { connectionRef: 'Habitica' },
      configWithPreset('full'),
      {
        confirmFn: async () => {
          confirmCalls++
          return { accepted: true, remember: false }
        },
      },
    )
    expect(r).toEqual({ ok: true, result: 'fetched' })
    expect(confirmCalls).toBe(0)
    expect(executed).toBe(true)
  })

  it('calls onConfirmRemember when decision.remember is true', async () => {
    const rememberCalls: (Record<string, unknown> | undefined)[] = []
    registerCapability(
      makeCapability({
        id: 'vault.fetch',
        permissions: ['vault.use'],
        requiresConfirmation: () => ({
          title: '確認',
          message: '',
          rememberLabel: '今後この接続を確認なしで使う',
        }),
        onConfirmRemember: (params) => {
          rememberCalls.push(params)
        },
        execute: () => 'fetched',
      }),
    )
    const r = await dispatchCapability(
      'vault.fetch',
      { connectionRef: 'Habitica' },
      configWithPreset('full'),
      {
        confirmFn: async () => ({ accepted: true, remember: true }),
      },
    )
    expect(r).toEqual({ ok: true, result: 'fetched' })
    expect(rememberCalls).toEqual([{ connectionRef: 'Habitica' }])
  })

  it('does NOT call onConfirmRemember when decision.remember is false', async () => {
    let rememberCalls = 0
    registerCapability(
      makeCapability({
        id: 'vault.fetch',
        permissions: ['vault.use'],
        requiresConfirmation: true,
        onConfirmRemember: () => {
          rememberCalls++
        },
        execute: () => 'fetched',
      }),
    )
    const r = await dispatchCapability(
      'vault.fetch',
      { connectionRef: 'Habitica' },
      configWithPreset('full'),
      {
        confirmFn: async () => ({ accepted: true, remember: false }),
      },
    )
    expect(r).toEqual({ ok: true, result: 'fetched' })
    expect(rememberCalls).toBe(0)
  })

  it('checks permissions BEFORE confirm (no confirm if denied)', async () => {
    let confirmCalls = 0
    registerCapability(
      makeCapability({
        id: 'notes.create',
        permissions: ['notes.write'],
        requiresConfirmation: true,
      }),
    )
    const r = await dispatchCapability(
      'notes.create',
      { text: 'x' },
      configWithPreset('readonly'), // notes.write not allowed
      {
        confirmFn: async () => {
          confirmCalls++
          return { accepted: true, remember: false }
        },
      },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('permission_denied')
    expect(confirmCalls).toBe(0)
  })
})

describe('dispatchCapability spotlight emission', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('column.add 成功時に新規カラム本体 (column:<id>) を spotlight する', async () => {
    registerCapability(
      makeCapability({
        id: 'column.add',
        execute: (params) => ({
          id: 'col-1',
          type: (params as { type?: string } | undefined)?.type,
        }),
      }),
    )

    const store = useSpotlightStore()
    const r = await dispatchCapability(
      'column.add',
      { type: 'notifications' },
      configWithPreset('full'),
    )

    expect(r.ok).toBe(true)
    await flushNextTick()
    // bottombar / mobile-nav タブが反応する target
    expect(store.isActive('column:col-1')).toBe(true)
    expect(store.lastAnnouncement).toContain('通知')
    // ナビバー (サイドバースロット) は対象外
    expect(store.isActive('navbar:notifications:null')).toBe(false)
  })

  it('column.add に accountId が指定されていても target は column id ベース', async () => {
    registerCapability(
      makeCapability({
        id: 'column.add',
        execute: (params) => ({
          id: 'col-2',
          type: (params as { type?: string } | undefined)?.type,
        }),
      }),
    )

    const store = useSpotlightStore()
    await dispatchCapability(
      'column.add',
      { type: 'chat', accountId: 'abc' },
      configWithPreset('full'),
    )

    await flushNextTick()
    expect(store.isActive('column:col-2')).toBe(true)
  })

  it('column.add 以外の capability では spotlight を emit しない', async () => {
    registerCapability(makeCapability({ id: 'time.now', execute: () => 'now' }))

    const store = useSpotlightStore()
    await dispatchCapability('time.now', undefined, configWithPreset('full'))

    await flushNextTick()
    expect(store.spotlights.size).toBe(0)
  })

  it('permission_denied のときは spotlight を emit しない', async () => {
    registerCapability(
      makeCapability({
        id: 'column.add',
        permissions: ['notes.write'],
        execute: () => ({ id: 'col-3', type: 'notifications' }),
      }),
    )

    const store = useSpotlightStore()
    const r = await dispatchCapability(
      'column.add',
      { type: 'notifications' },
      configWithPreset('readonly'),
    )

    expect(r.ok).toBe(false)
    await flushNextTick()
    expect(store.spotlights.size).toBe(0)
  })

  it('execute_failed のときは spotlight を emit しない', async () => {
    registerCapability(
      makeCapability({
        id: 'column.add',
        execute: () => {
          throw new Error('boom')
        },
      }),
    )

    const store = useSpotlightStore()
    const r = await dispatchCapability(
      'column.add',
      { type: 'notifications' },
      configWithPreset('full'),
    )

    expect(r.ok).toBe(false)
    await flushNextTick()
    expect(store.spotlights.size).toBe(0)
  })

  it('vi.useFakeTimers と無関係に highlight が同期反映される (Map にエントリが入る)', () => {
    // 防御テスト: vi.useFakeTimers を使わなくても store API は同期で動く
    vi.useFakeTimers()
    setActivePinia(createPinia())
    const store = useSpotlightStore()
    store.highlight('navbar:notifications:null')
    expect(store.isActive('navbar:notifications:null')).toBe(true)
    vi.useRealTimers()
  })

  it('column.remove は視覚 spotlight なし、announce のみ', async () => {
    registerCapability(
      makeCapability({
        id: 'column.remove',
        execute: () => undefined,
      }),
    )

    const store = useSpotlightStore()
    const r = await dispatchCapability(
      'column.remove',
      { id: 'col-xxx' },
      configWithPreset('full'),
    )

    expect(r.ok).toBe(true)
    await flushNextTick()
    expect(store.spotlights.size).toBe(0)
    expect(store.lastAnnouncement).toContain('削除')
  })

  it('column.move 成功時に column:<id> を spotlight する', async () => {
    registerCapability(
      makeCapability({
        id: 'column.move',
        execute: (params) => ({
          moved: true,
          columnId: (params as { columnId?: string } | undefined)?.columnId,
          targetIndex: 0,
        }),
      }),
    )

    const store = useSpotlightStore()
    await dispatchCapability(
      'column.move',
      { columnId: 'col-move-1', targetIndex: 2 },
      configWithPreset('full'),
    )

    await flushNextTick()
    expect(store.isActive('column:col-move-1')).toBe(true)
    expect(store.lastAnnouncement).toContain('移動')
  })

  it('column.updateSettings 成功時に column:<id> を spotlight する', async () => {
    registerCapability(
      makeCapability({
        id: 'column.updateSettings',
        execute: (params) => ({
          updated: true,
          columnId: (params as { columnId?: string } | undefined)?.columnId,
          applied: ['name'],
        }),
      }),
    )

    const store = useSpotlightStore()
    await dispatchCapability(
      'column.updateSettings',
      { columnId: 'col-set-1', name: 'New name' },
      configWithPreset('full'),
    )

    await flushNextTick()
    expect(store.isActive('column:col-set-1')).toBe(true)
    expect(store.lastAnnouncement).toContain('更新')
  })

  it('notifications.markRead 成功時に navbar:notifications:<accountId> を spotlight', async () => {
    registerCapability(
      makeCapability({
        id: 'notifications.markRead',
        execute: () => ({ markedAccounts: 1 }),
      }),
    )

    const store = useSpotlightStore()
    await dispatchCapability(
      'notifications.markRead',
      { accountId: 'acc-1' },
      configWithPreset('full'),
    )

    await flushNextTick()
    expect(store.isActive('navbar:notifications:acc-1')).toBe(true)
    expect(store.lastAnnouncement).toContain('既読')
  })

  it('notifications.markRead accountId 省略時は navbar:notifications:null を spotlight', async () => {
    registerCapability(
      makeCapability({
        id: 'notifications.markRead',
        execute: () => ({ markedAccounts: 3 }),
      }),
    )

    const store = useSpotlightStore()
    await dispatchCapability(
      'notifications.markRead',
      undefined,
      configWithPreset('full'),
    )

    await flushNextTick()
    expect(store.isActive('navbar:notifications:null')).toBe(true)
  })

  it('windows.open 成功時に window:<id> を spotlight する', async () => {
    registerCapability(
      makeCapability({
        id: 'windows.open',
        execute: () => ({ id: 'win-1' }),
      }),
    )

    const store = useSpotlightStore()
    await dispatchCapability(
      'windows.open',
      { type: 'note-detail' },
      configWithPreset('full'),
    )

    await flushNextTick()
    expect(store.isActive('window:win-1')).toBe(true)
    expect(store.lastAnnouncement).toContain('ノート')
  })

  it('windows.focus 成功時に window:<id> を spotlight する', async () => {
    registerCapability(
      makeCapability({
        id: 'windows.focus',
        execute: () => ({ focused: true, id: 'win-2' }),
      }),
    )

    const store = useSpotlightStore()
    await dispatchCapability(
      'windows.focus',
      { id: 'win-2' },
      configWithPreset('full'),
    )

    await flushNextTick()
    expect(store.isActive('window:win-2')).toBe(true)
    expect(store.lastAnnouncement).toContain('前面')
  })

  it('windows.close 成功時は announce のみ (視覚 spotlight なし)', async () => {
    registerCapability(
      makeCapability({
        id: 'windows.close',
        execute: () => ({ closed: true, id: 'win-3' }),
      }),
    )

    const store = useSpotlightStore()
    await dispatchCapability(
      'windows.close',
      { id: 'win-3' },
      configWithPreset('full'),
    )

    await flushNextTick()
    expect(store.spotlights.size).toBe(0)
    expect(store.lastAnnouncement).toContain('閉じ')
  })

  it('windows.closeAll 成功時も announce のみ', async () => {
    registerCapability(
      makeCapability({
        id: 'windows.closeAll',
        execute: () => ({ closedAll: true }),
      }),
    )

    const store = useSpotlightStore()
    await dispatchCapability(
      'windows.closeAll',
      undefined,
      configWithPreset('full'),
    )

    await flushNextTick()
    expect(store.spotlights.size).toBe(0)
    expect(store.lastAnnouncement).toContain('全ウィンドウ')
  })

  it('notes.react 成功時に note:<id> を spotlight + reaction 名を含む announcement', async () => {
    registerCapability(
      makeCapability({
        id: 'notes.react',
        execute: () => ({ noteId: 'note-1', ok: true, reaction: ':smile:' }),
      }),
    )

    const store = useSpotlightStore()
    await dispatchCapability(
      'notes.react',
      { noteId: 'note-1', reaction: ':smile:' },
      configWithPreset('full'),
    )

    await flushNextTick()
    expect(store.isActive('note:note-1')).toBe(true)
    expect(store.lastAnnouncement).toContain(':smile:')
  })

  it('notes.unreact 成功時に note:<id> を spotlight する', async () => {
    registerCapability(
      makeCapability({
        id: 'notes.unreact',
        execute: () => ({ noteId: 'note-2', ok: true }),
      }),
    )

    const store = useSpotlightStore()
    await dispatchCapability(
      'notes.unreact',
      { noteId: 'note-2' },
      configWithPreset('full'),
    )

    await flushNextTick()
    expect(store.isActive('note:note-2')).toBe(true)
    expect(store.lastAnnouncement).toContain('取り消し')
  })

  it('notes.pin 成功時に note:<id> を spotlight する', async () => {
    registerCapability(
      makeCapability({
        id: 'notes.pin',
        execute: () => ({ noteId: 'note-3', pinned: true }),
      }),
    )

    const store = useSpotlightStore()
    await dispatchCapability(
      'notes.pin',
      { noteId: 'note-3' },
      configWithPreset('full'),
    )

    await flushNextTick()
    expect(store.isActive('note:note-3')).toBe(true)
    expect(store.lastAnnouncement).toContain('ピン留め')
  })

  it('notes.unpin 成功時に note:<id> を spotlight する', async () => {
    registerCapability(
      makeCapability({
        id: 'notes.unpin',
        execute: () => ({ noteId: 'note-4', unpinned: true }),
      }),
    )

    const store = useSpotlightStore()
    await dispatchCapability(
      'notes.unpin',
      { noteId: 'note-4' },
      configWithPreset('full'),
    )

    await flushNextTick()
    expect(store.isActive('note:note-4')).toBe(true)
    expect(store.lastAnnouncement).toContain('外し')
  })

  it('notes.create 成功時に result.id を note:<id> として spotlight する', async () => {
    registerCapability(
      makeCapability({
        id: 'notes.create',
        execute: () => ({
          createdAt: '2026-05-15T00:00:00Z',
          id: 'note-new',
          text: 'hello',
        }),
      }),
    )

    const store = useSpotlightStore()
    await dispatchCapability(
      'notes.create',
      { text: 'hello' },
      configWithPreset('full'),
    )

    await flushNextTick()
    expect(store.isActive('note:note-new')).toBe(true)
    expect(store.lastAnnouncement).toContain('投稿')
  })

  it('notes.delete 成功時は announce のみ (視覚 spotlight なし)', async () => {
    registerCapability(
      makeCapability({
        id: 'notes.delete',
        execute: () => ({ deleted: true, noteId: 'note-5' }),
      }),
    )

    const store = useSpotlightStore()
    await dispatchCapability(
      'notes.delete',
      { noteId: 'note-5' },
      configWithPreset('full'),
    )

    await flushNextTick()
    expect(store.spotlights.size).toBe(0)
    expect(store.lastAnnouncement).toContain('削除')
  })

  it('account.switch 成功時に account:<id> を spotlight する', async () => {
    registerCapability(
      makeCapability({
        id: 'account.switch',
        execute: () => ({ id: 'acc-2', ok: true }),
      }),
    )

    const store = useSpotlightStore()
    await dispatchCapability(
      'account.switch',
      { id: 'acc-2' },
      configWithPreset('full'),
    )

    await flushNextTick()
    expect(store.isActive('account:acc-2')).toBe(true)
    expect(store.lastAnnouncement).toContain('切り替え')
  })
})
