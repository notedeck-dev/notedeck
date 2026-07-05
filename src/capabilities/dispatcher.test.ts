// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Command } from '@/commands/registry'
import { useSpotlightStore } from '@/composables/useSpotlight'
import {
  _clearPluginDenialsForTest,
  getPluginDenial,
} from '@/permissions/pluginDenials'
import type { ProfiledPrincipalId } from '@/permissions/principal'
import { setPermissionPreset } from '@/permissions/schema'
import {
  _resetPermissionsForTest,
  removeConfirmSkip,
  usePermissionsConfig,
} from '@/permissions/store'
import { type DispatchContext, dispatchCapability } from './dispatcher'
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

/** permissions.json5 singleton の principal プロファイルを preset に設定する。 */
function setPrincipalPreset(
  id: ProfiledPrincipalId,
  preset: 'readonly' | 'safe' | 'full',
): void {
  const { file } = usePermissionsConfig()
  file.value.principals[id] = setPermissionPreset(
    file.value.principals[id] ?? { preset: 'readonly', custom: {} as never },
    preset,
  )
}

/**
 * dispatcher は usePermissionsConfig() singleton から principal の権限を
 * 解決するので、ai.chat プロファイルを preset に設定した上で ai.chat principal
 * の DispatchContext を返す。
 */
function ctxWithPreset(preset: 'readonly' | 'safe' | 'full'): DispatchContext {
  setPrincipalPreset('ai.chat', preset)
  return { principal: { kind: 'ai.chat' } }
}

afterEach(() => {
  _clearCapabilitiesForTest()
  _resetPermissionsForTest()
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
      ctxWithPreset('readonly'),
    )
    expect(r).toEqual({ ok: true, result: 'hello' })
  })

  it('returns unknown_capability for an unregistered id', async () => {
    const r = await dispatchCapability('not-here', {}, ctxWithPreset('full'))
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
      ctxWithPreset('readonly'), // notes.write は false
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
      ctxWithPreset('safe'), // notes.react は true
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('readonly'),
    )
    expect(r).toEqual({ ok: true, result: 'iso-string' })
  })

  it('still works for capabilities whose id has no dot (no sanitization needed)', async () => {
    registerCapability(makeCapability({ id: 'simple', execute: () => 42 }))
    const r = await dispatchCapability(
      'simple',
      undefined,
      ctxWithPreset('readonly'),
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
      ctxWithPreset('readonly'),
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
      ctxWithPreset('readonly'),
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
      ctxWithPreset('full'),
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

  it('injects trusted marker on the confirm options (#720)', async () => {
    let seenTrusted: boolean | undefined
    registerCapability(
      makeCapability({
        id: 'notes.create',
        permissions: ['notes.write'],
        requiresConfirmation: true,
        execute: () => 'posted',
      }),
    )
    await dispatchCapability(
      'notes.create',
      { text: 'hi' },
      ctxWithPreset('full'),
      {
        confirmFn: async (opts) => {
          seenTrusted = opts.trusted
          return { accepted: true, remember: false }
        },
      },
    )
    // dispatcher 経由の権限確認は本体の信頼マーカーが立つ (プラグインの
    // Mk:confirm は立てられない)
    expect(seenTrusted).toBe(true)
  })

  it('injects dedupKey (scope:capabilityId) for a skippable scope (#720)', async () => {
    let seenKey: string | undefined
    registerCapability(
      makeCapability({
        id: 'notes.create',
        permissions: ['notes.write'],
        requiresConfirmation: true,
        execute: () => 'posted',
      }),
    )
    await dispatchCapability(
      'notes.create',
      { text: 'hi' },
      ctxWithPreset('full'),
      {
        confirmFn: async (opts) => {
          seenKey = opts.dedupKey
          return { accepted: true, remember: false }
        },
      },
    )
    // ai.chat principal の skip scope は 'ai.chat' なので dedupKey は
    // `ai.chat:notes.create` (同一操作の待機分を自動承認するためのキー)
    expect(seenKey).toBe('ai.chat:notes.create')
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
      ctxWithPreset('full'),
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
      ctxWithPreset('safe'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
      {
        confirmFn: async () => ({ accepted: true, remember: false }),
      },
    )
    expect(r).toEqual({ ok: true, result: 'fetched' })
    expect(rememberCalls).toBe(0)
  })

  it('ai.chat: remember=true で許可すると次回から確認をスキップする (#714)', async () => {
    let confirmCalls = 0
    let executed = 0
    registerCapability(
      makeCapability({
        id: 'clips.create',
        requiresConfirmation: true,
        execute: () => {
          executed++
          return 'created'
        },
      }),
    )
    const opts = {
      confirmFn: async () => {
        confirmCalls++
        return { accepted: true, remember: true }
      },
    }
    const first = await dispatchCapability(
      'clips.create',
      undefined,
      { principal: { kind: 'ai.chat' } },
      opts,
    )
    expect(first.ok).toBe(true)
    expect(confirmCalls).toBe(1)

    const second = await dispatchCapability(
      'clips.create',
      undefined,
      { principal: { kind: 'ai.chat' } },
      opts,
    )
    expect(second).toEqual({ ok: true, result: 'created' })
    expect(confirmCalls).toBe(1) // 2 回目は確認なし
    expect(executed).toBe(2)
  })

  it('汎用 remember は capability 単位 — 別 capability は引き続き確認される (#714)', async () => {
    let confirmCalls = 0
    registerCapability(
      makeCapability({ id: 'clips.create', requiresConfirmation: true }),
    )
    registerCapability(
      makeCapability({ id: 'memos.write', requiresConfirmation: true }),
    )
    const opts = {
      confirmFn: async () => {
        confirmCalls++
        return { accepted: true, remember: true }
      },
    }
    const ctx = { principal: { kind: 'ai.chat' } as const }
    await dispatchCapability('clips.create', undefined, ctx, opts)
    await dispatchCapability('memos.write', undefined, ctx, opts)
    expect(confirmCalls).toBe(2)
  })

  it('ai.chat の remember は ai.heartbeat に波及しない — 無人実行は常に確認 (#714)', async () => {
    let confirmCalls = 0
    registerCapability(
      makeCapability({ id: 'clips.create', requiresConfirmation: true }),
    )
    const opts = {
      confirmFn: async (o: { rememberLabel?: string }) => {
        confirmCalls++
        // heartbeat のダイアログには remember チェックボックス自体を出さない
        if (confirmCalls > 1) expect(o.rememberLabel).toBeUndefined()
        return { accepted: true, remember: true }
      },
    }
    await dispatchCapability(
      'clips.create',
      undefined,
      { principal: { kind: 'ai.chat' } },
      opts,
    )
    // chat で remember 済みでも heartbeat は毎回確認。remember=true を返しても
    // 記憶されない
    for (let i = 0; i < 2; i++) {
      const r = await dispatchCapability(
        'clips.create',
        undefined,
        { principal: { kind: 'ai.heartbeat' } },
        opts,
      )
      expect(r.ok).toBe(true)
    }
    expect(confirmCalls).toBe(3)
  })

  it('plugin の remember は個体単位 — 別プラグインには波及しない (#714)', async () => {
    let confirmCalls = 0
    registerCapability(
      makeCapability({ id: 'clips.create', requiresConfirmation: true }),
    )
    const opts = {
      confirmFn: async () => {
        confirmCalls++
        return { accepted: true, remember: true }
      },
    }
    const pluginA = { principal: { kind: 'plugin', pluginId: 'a' } as const }
    await dispatchCapability('clips.create', undefined, pluginA, opts)
    expect(confirmCalls).toBe(1)
    // 同一プラグインはスキップ
    await dispatchCapability('clips.create', undefined, pluginA, opts)
    expect(confirmCalls).toBe(1)
    // 別プラグインは確認される
    await dispatchCapability(
      'clips.create',
      undefined,
      { principal: { kind: 'plugin', pluginId: 'b' } },
      opts,
    )
    expect(confirmCalls).toBe(2)
  })

  it('user principal には remember チェックボックスを出さず、remember=true でも記憶しない (#714)', async () => {
    let confirmCalls = 0
    registerCapability(
      makeCapability({ id: 'clips.create', requiresConfirmation: true }),
    )
    const opts = {
      confirmFn: async (o: { rememberLabel?: string }) => {
        confirmCalls++
        expect(o.rememberLabel).toBeUndefined()
        return { accepted: true, remember: true }
      },
    }
    const ctx = { principal: { kind: 'user' } as const }
    await dispatchCapability('clips.create', undefined, ctx, opts)
    await dispatchCapability('clips.create', undefined, ctx, opts)
    expect(confirmCalls).toBe(2)
  })

  it('ai.chat の汎用確認には rememberLabel が注入される (#714)', async () => {
    let seenLabel: string | undefined
    registerCapability(
      makeCapability({ id: 'clips.create', requiresConfirmation: true }),
    )
    await dispatchCapability(
      'clips.create',
      undefined,
      { principal: { kind: 'ai.chat' } },
      {
        confirmFn: async (o) => {
          seenLabel = o.rememberLabel
          return { accepted: true, remember: false }
        },
      },
    )
    expect(seenLabel).toBe('今後この操作を確認しない')
  })

  it('onConfirmRemember を持つ capability (vault) は汎用スキップの対象外 (#714)', async () => {
    let confirmCalls = 0
    registerCapability(
      makeCapability({
        id: 'vault.fetch',
        permissions: ['vault.use'],
        requiresConfirmation: true,
        onConfirmRemember: () => {
          // 接続単位の信頼永続化のスタブ (中身は本テストでは不問)
        },
        execute: () => 'fetched',
      }),
    )
    const opts = {
      confirmFn: async () => {
        confirmCalls++
        return { accepted: true, remember: true }
      },
    }
    const ctx = ctxWithPreset('full')
    await dispatchCapability('vault.fetch', undefined, ctx, opts)
    // remember は onConfirmRemember (接続単位の信頼) に委ねられ、
    // capability 単位の汎用スキップとしては記憶されない
    await dispatchCapability('vault.fetch', undefined, ctx, opts)
    expect(confirmCalls).toBe(2)
  })

  it('external principal には remember チェックボックスを出さず、remember=true でも記憶しない (#714)', async () => {
    let confirmCalls = 0
    setPrincipalPreset('external', 'full')
    registerCapability(
      makeCapability({ id: 'clips.create', requiresConfirmation: true }),
    )
    const opts = {
      confirmFn: async (o: { rememberLabel?: string }) => {
        confirmCalls++
        expect(o.rememberLabel).toBeUndefined()
        return { accepted: true, remember: true }
      },
    }
    const ctx = { principal: { kind: 'external' } as const }
    await dispatchCapability('clips.create', undefined, ctx, opts)
    await dispatchCapability('clips.create', undefined, ctx, opts)
    expect(confirmCalls).toBe(2)
  })

  it('remember チェック付きでもキャンセルしたら記憶しない (#714)', async () => {
    let confirmCalls = 0
    registerCapability(
      makeCapability({ id: 'clips.create', requiresConfirmation: true }),
    )
    const ctx = { principal: { kind: 'ai.chat' } as const }
    const r = await dispatchCapability('clips.create', undefined, ctx, {
      confirmFn: async () => {
        confirmCalls++
        return { accepted: false, remember: true }
      },
    })
    expect(r.ok).toBe(false)
    // キャンセル + remember は無効 — 次回も確認される
    await dispatchCapability('clips.create', undefined, ctx, {
      confirmFn: async () => {
        confirmCalls++
        return { accepted: true, remember: false }
      },
    })
    expect(confirmCalls).toBe(2)
  })

  it('remember なしで許可した場合は次回も確認される (#714)', async () => {
    let confirmCalls = 0
    registerCapability(
      makeCapability({ id: 'clips.create', requiresConfirmation: true }),
    )
    const opts = {
      confirmFn: async () => {
        confirmCalls++
        return { accepted: true, remember: false }
      },
    }
    const ctx = { principal: { kind: 'ai.chat' } as const }
    await dispatchCapability('clips.create', undefined, ctx, opts)
    await dispatchCapability('clips.create', undefined, ctx, opts)
    expect(confirmCalls).toBe(2)
  })

  it('removeConfirmSkip で取り消すと再び確認される — 権限ウィンドウの取り消し導線 (#714)', async () => {
    let confirmCalls = 0
    registerCapability(
      makeCapability({ id: 'clips.create', requiresConfirmation: true }),
    )
    const opts = {
      confirmFn: async () => {
        confirmCalls++
        return { accepted: true, remember: true }
      },
    }
    const ctx = { principal: { kind: 'ai.chat' } as const }
    await dispatchCapability('clips.create', undefined, ctx, opts)
    await dispatchCapability('clips.create', undefined, ctx, opts)
    expect(confirmCalls).toBe(1) // スキップ確立

    removeConfirmSkip('ai.chat', 'clips.create')
    await dispatchCapability('clips.create', undefined, ctx, opts)
    expect(confirmCalls).toBe(2) // 取り消し後は再確認
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
      ctxWithPreset('readonly'), // notes.write not allowed
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
    )

    await flushNextTick()
    expect(store.isActive('column:col-2')).toBe(true)
  })

  it('column.add 以外の capability では spotlight を emit しない', async () => {
    registerCapability(makeCapability({ id: 'time.now', execute: () => 'now' }))

    const store = useSpotlightStore()
    await dispatchCapability('time.now', undefined, ctxWithPreset('full'))

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
      ctxWithPreset('readonly'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
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
      ctxWithPreset('full'),
    )

    await flushNextTick()
    expect(store.isActive('account:acc-2')).toBe(true)
    expect(store.lastAnnouncement).toContain('切り替え')
  })
})

describe('dispatchCapability — principal 別 resolve (#712 PR 1a)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('external principal は external プロファイルで enforce される (chat=full でも拒否)', async () => {
    registerCapability(
      makeCapability({
        id: 'notes.create',
        permissions: ['notes.write'],
        execute: () => 'posted',
      }),
    )
    setPrincipalPreset('ai.chat', 'full')
    setPrincipalPreset('external', 'readonly')

    const external = await dispatchCapability('notes.create', undefined, {
      principal: { kind: 'external' },
    })
    expect(external.ok).toBe(false)
    if (!external.ok) expect(external.code).toBe('permission_denied')

    // 同じ設定で ai.chat は full なので通る (principal 分離の固定)
    const chat = await dispatchCapability('notes.create', undefined, {
      principal: { kind: 'ai.chat' },
    })
    expect(chat.ok).toBe(true)
  })

  it('ai.heartbeat / plugin は各自のプロファイルで enforce される (#712 PR 1b)', async () => {
    registerCapability(
      makeCapability({
        id: 'notes.create',
        permissions: ['notes.write'],
        execute: () => 'posted',
      }),
    )
    // chat を full にしても heartbeat / plugin は緩まない
    setPrincipalPreset('ai.chat', 'full')
    setPrincipalPreset('ai.heartbeat', 'readonly')
    setPrincipalPreset('plugin', 'readonly')

    const heartbeat = await dispatchCapability('notes.create', undefined, {
      principal: { kind: 'ai.heartbeat' },
    })
    expect(heartbeat.ok).toBe(false)

    const plugin = await dispatchCapability('notes.create', undefined, {
      principal: { kind: 'plugin', pluginId: 'demo-plugin' },
    })
    expect(plugin.ok).toBe(false)

    setPrincipalPreset('ai.heartbeat', 'full')
    const heartbeatFull = await dispatchCapability('notes.create', undefined, {
      principal: { kind: 'ai.heartbeat' },
    })
    expect(heartbeatFull.ok).toBe(true)
  })

  it('user principal は権限プロファイルに関係なく常時許可', async () => {
    registerCapability(
      makeCapability({
        id: 'notes.create',
        permissions: ['notes.write'],
        execute: () => 'posted',
      }),
    )
    setPrincipalPreset('ai.chat', 'readonly')
    const r = await dispatchCapability('notes.create', undefined, {
      principal: { kind: 'user' },
    })
    expect(r).toEqual({ ok: true, result: 'posted' })
  })
})

describe('dispatchCapability — 確認ダイアログの principal 帰属 (#712 §3.3)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  async function dispatchConfirmable(principal: DispatchContext['principal']) {
    registerCapability(
      makeCapability({
        id: 'notes.create',
        label: 'ノートを投稿',
        requiresConfirmation: true,
        execute: () => 'posted',
      }),
    )
    let attribution: string | undefined
    const r = await dispatchCapability(
      'notes.create',
      { text: 'hi' },
      { principal },
      {
        confirmFn: async (opts) => {
          attribution = opts.attribution
          return { accepted: true, remember: false }
        },
      },
    )
    expect(r.ok).toBe(true)
    return attribution
  }

  it('ai.chat 由来の確認は「AI」で帰属表示される', async () => {
    const attribution = await dispatchConfirmable({ kind: 'ai.chat' })
    expect(attribution).toBe('AI')
  })

  it('ai.heartbeat 由来の確認は「HEARTBEAT」の独立ラベルになる', async () => {
    const attribution = await dispatchConfirmable({ kind: 'ai.heartbeat' })
    expect(attribution).toBe('HEARTBEAT')
  })

  it('external 由来の確認は「外部アプリ」で帰属表示される', async () => {
    const attribution = await dispatchConfirmable({ kind: 'external' })
    expect(attribution).toBe('外部アプリ')
  })

  it('user 由来の確認には帰属ラベルを注入しない', async () => {
    const attribution = await dispatchConfirmable({ kind: 'user' })
    expect(attribution).toBeUndefined()
  })

  it('plugin 由来の確認は配布名があればそれを出す (installId を見せない)', async () => {
    const attribution = await dispatchConfirmable({
      kind: 'plugin',
      pluginId: 'widget:wgt-1783163206736-38k1km',
      name: 'AtCoder',
    })
    expect(attribution).toBe('ウィジェット「AtCoder」')
  })

  it('plugin 由来の確認で name 不明時は prefix を落とした id にフォールバック', async () => {
    const attribution = await dispatchConfirmable({
      kind: 'plugin',
      pluginId: 'play:abc123',
    })
    expect(attribution).toBe('Play「abc123」')
  })
})

describe('dispatchCapability — Spotlight の principal 帰属 (#712 §3.3)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('external principal の column.add は「外部アプリが」ラベルで光る', async () => {
    registerCapability(
      makeCapability({
        id: 'column.add',
        execute: () => ({ id: 'col-x', type: 'notifications' }),
      }),
    )
    const store = useSpotlightStore()
    setPrincipalPreset('external', 'full')
    await dispatchCapability(
      'column.add',
      { type: 'notifications' },
      { principal: { kind: 'external' } },
    )
    await flushNextTick()
    expect(store.isActive('column:col-x')).toBe(true)
    expect(store.lastAnnouncement).toContain('外部アプリが')
  })

  it('user principal では spotlight を発火しない (本人操作に帰属表示は不要)', async () => {
    registerCapability(
      makeCapability({
        id: 'column.add',
        execute: () => ({ id: 'col-y', type: 'notifications' }),
      }),
    )
    const store = useSpotlightStore()
    await dispatchCapability(
      'column.add',
      { type: 'notifications' },
      { principal: { kind: 'user' } },
    )
    await flushNextTick()
    expect(store.spotlights.size).toBe(0)
  })
})

describe('dispatchCapability — 第三者 deny floor と external read floor (#712 PR 1c)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('plugin=safe (保存値 skills.write=true / tasks.run=true) でも floor で拒否される', async () => {
    registerCapability(
      makeCapability({
        id: 'skills.append',
        permissions: ['skills.write'],
        execute: () => 'appended',
      }),
    )
    registerCapability(
      makeCapability({
        id: 'tasks.run',
        permissions: ['tasks.run'],
        execute: () => 'ran',
      }),
    )
    // safe preset は skills.write=true / tasks.run=true を保存する
    setPrincipalPreset('plugin', 'safe')

    const skills = await dispatchCapability('skills.append', undefined, {
      principal: { kind: 'plugin', pluginId: 'evil-plugin' },
    })
    expect(skills.ok).toBe(false)
    if (!skills.ok) expect(skills.code).toBe('permission_denied')

    const tasks = await dispatchCapability('tasks.run', undefined, {
      principal: { kind: 'plugin', pluginId: 'evil-plugin' },
    })
    expect(tasks.ok).toBe(false)
  })

  it('external=full でも ai.persona.write / tasks.run は floor で拒否される (同意しても成立させない)', async () => {
    registerCapability(
      makeCapability({
        id: 'ai.setPersona',
        permissions: ['ai.persona.write'],
        execute: () => 'set',
      }),
    )
    registerCapability(
      makeCapability({
        id: 'tasks.run',
        permissions: ['tasks.run'],
        execute: () => 'ran',
      }),
    )
    setPrincipalPreset('external', 'full')

    const persona = await dispatchCapability('ai.setPersona', undefined, {
      principal: { kind: 'external' },
    })
    expect(persona.ok).toBe(false)

    const tasks = await dispatchCapability('tasks.run', undefined, {
      principal: { kind: 'external' },
    })
    expect(tasks.ok).toBe(false)
  })

  it('ai.chat では skills.write / tasks.run が preset どおり通る (自己拡張 / task runner の非破壊)', async () => {
    registerCapability(
      makeCapability({
        id: 'skills.append',
        permissions: ['skills.write'],
        execute: () => 'appended',
      }),
    )
    registerCapability(
      makeCapability({
        id: 'tasks.run',
        permissions: ['tasks.run'],
        execute: () => 'ran',
      }),
    )
    setPrincipalPreset('ai.chat', 'safe')

    const skills = await dispatchCapability('skills.append', undefined, {
      principal: { kind: 'ai.chat' },
    })
    expect(skills).toEqual({ ok: true, result: 'appended' })

    const tasks = await dispatchCapability('tasks.run', undefined, {
      principal: { kind: 'ai.chat' },
    })
    expect(tasks).toEqual({ ok: true, result: 'ran' })
  })

  it('plugin は vault.use が floor で常時拒否される', async () => {
    registerCapability(
      makeCapability({
        id: 'vault.fetch',
        permissions: ['vault.use'],
        execute: () => 'secret-op',
      }),
    )
    setPrincipalPreset('plugin', 'full')
    const r = await dispatchCapability('vault.fetch', undefined, {
      principal: { kind: 'plugin', pluginId: 'p1' },
    })
    expect(r.ok).toBe(false)
  })

  it('external は custom で Misskey read 4 キーを全 OFF にしても read が通る (下限)', async () => {
    registerCapability(
      makeCapability({
        id: 'notes.timeline',
        permissions: ['notes.read'],
        execute: () => 'notes',
      }),
    )
    registerCapability(
      makeCapability({
        id: 'memos.list',
        permissions: ['memos.read'],
        execute: () => 'memos',
      }),
    )
    // custom で全キー false に (readonly から custom 化して read も落とす)
    const { file } = usePermissionsConfig()
    const custom = Object.fromEntries(
      Object.entries(
        setPermissionPreset(
          { preset: 'readonly', custom: {} as never },
          'custom',
        ).custom,
      ).map(([k]) => [k, false]),
    ) as never
    file.value.principals.external = { preset: 'custom', custom }

    const notes = await dispatchCapability('notes.timeline', undefined, {
      principal: { kind: 'external' },
    })
    expect(notes).toEqual({ ok: true, result: 'notes' })

    // ローカルデータ read は floor 外なので拒否される
    const memos = await dispatchCapability('memos.list', undefined, {
      principal: { kind: 'external' },
    })
    expect(memos.ok).toBe(false)
  })

  it('permission_denied メッセージに principal が明示される', async () => {
    registerCapability(
      makeCapability({ id: 'notes.create', permissions: ['notes.write'] }),
    )
    setPrincipalPreset('external', 'readonly')
    const r = await dispatchCapability('notes.create', undefined, {
      principal: { kind: 'external' },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('principal "external"')
      expect(r.error).toContain('permissions.json5')
    }
  })

  it('plugin の拒否は pluginDenials に記録される (#712 §8.4)', async () => {
    _clearPluginDenialsForTest()
    registerCapability(
      makeCapability({ id: 'notes.create', permissions: ['notes.write'] }),
    )
    setPrincipalPreset('plugin', 'readonly')
    await dispatchCapability('notes.create', undefined, {
      principal: { kind: 'plugin', pluginId: 'my-plugin' },
    })
    await dispatchCapability('notes.create', undefined, {
      principal: { kind: 'plugin', pluginId: 'my-plugin' },
    })
    const entry = getPluginDenial('my-plugin')
    expect(entry).not.toBeNull()
    expect(entry?.lastTarget).toBe('notes.create')
    expect(entry?.lastKeys).toContain('notes.write')
    expect(entry?.count).toBe(2)
    // 非 plugin principal の拒否は記録されない
    await dispatchCapability('notes.create', undefined, {
      principal: { kind: 'external' },
    })
    expect(getPluginDenial('my-plugin')?.count).toBe(2)
  })
})
