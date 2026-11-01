import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _clearCapabilitiesForTest,
  registerCapability,
} from '@/capabilities/registry'
import type { Capability } from '@/capabilities/types'
import { useCommandStore } from '@/commands/registry'
import { assertMisskeyApiAllowed } from '@/permissions/misskeyApiGate'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { useAiScriptLogsStore } from '@/stores/aiscriptLogs'
import { type PluginItem, usePluginsStore } from '@/stores/plugins'
import { useToast } from '@/stores/toast'
import { commands } from '@/utils/tauriInvoke'
import { openSafeUrl } from '@/utils/url'
import { emitNoteDeckEvent } from './events'
import {
  abortAllPlugins,
  abortPlugin,
  applyNotePostInterruptors,
  applyNoteViewInterruptors,
  getPluginHandlers,
  launchAllPlugins,
  launchPlugin,
  parsePluginMeta,
  withPluginAccountContext,
} from './plugin-api'

vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      apiRequest: vi.fn(async () => ({ status: 'ok', data: null })),
    },
  }
})

vi.mock('@/permissions/misskeyApiGate', () => ({
  assertMisskeyApiAllowed: vi.fn(() => Promise.resolve()),
}))

// requiresConfirmation の確認ダイアログは node 環境で開けないので、決定だけ差し替える
const confirmDecision = vi.hoisted(() => ({ accepted: true, remember: false }))
vi.mock('@/stores/confirm', async () => {
  const actual =
    await vi.importActual<typeof import('@/stores/confirm')>('@/stores/confirm')
  return {
    ...actual,
    useConfirm: () => ({
      ...actual.useConfirm(),
      confirmWithDecision: async () => ({ ...confirmDecision }),
    }),
  }
})

vi.mock('@/utils/url', async () => {
  const actual =
    await vi.importActual<typeof import('@/utils/url')>('@/utils/url')
  return { ...actual, openSafeUrl: vi.fn(() => Promise.resolve()) }
})

// unit プロジェクトは node 環境のため localStorage を stub する
// (capabilities/builtins/plugins.test.ts と同じ方式)
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
  get length() {
    return storage.size
  },
})

// Note: 本テストは「メタデータのパース」「handler 登録とスコープ評価 (#771)」
// 「interruptor の適用」「Mk:api のアカウント文脈ブリッジ」を実 AiScript
// インタプリタ経由で検証する。UI からの handler 発火は実機で確認する。
// プラグインは本家 Misskey 同様バージョンヘッダー必須 (>= 0.12) で、
// 実行は常に modern interpreter (1.x)。ヘッダー無し・0.12 未満は
// parsePluginMeta が null を返し、launchPlugin も run ログ通知付きで拒否する。

const apiRequestMock = vi.mocked(commands.apiRequest)
const gateMock = vi.mocked(assertMisskeyApiAllowed)
const openSafeUrlMock = vi.mocked(openSafeUrl)

let seq = 0
const launchedIds: string[] = []

/** テスト用の個体。`src` / `active` / `global` / `installedFor` は envelope に畳む */
interface PluginSeed {
  src?: string
  active?: boolean
  global?: boolean
  installedFor?: string[]
  config?: PluginItem['extra']['config']
  configData?: PluginItem['extra']['configData']
}

function makePlugin(overrides: PluginSeed = {}): PluginItem {
  return {
    id: `test-plugin-${++seq}`,
    name: 'TestPlugin',
    scope: {
      kind: 'shared',
      global: overrides.global ?? true,
      installedFor: overrides.installedFor ?? [],
    },
    content: overrides.src ?? '',
    extra: {
      version: '1.0.0',
      config: overrides.config,
      configData: overrides.configData ?? {},
      active: overrides.active ?? true,
    },
    createdAt: 0,
    updatedAt: 0,
  }
}

/**
 * plugins store に登録した上で launchPlugin する（スコープ評価が効く状態にする）。
 * バージョンヘッダーは必須仕様のため自動前置する。ヘッダー検証自体のテストは
 * makePlugin + launchPlugin を直接使うこと。
 */
async function installAndLaunch(
  src: string,
  overrides: PluginSeed = {},
): Promise<PluginItem> {
  const headered =
    src === '' || src.startsWith('///') ? src : `/// @ 1.2.1\n${src}`
  const plugin = makePlugin({ ...overrides, src: headered })
  usePluginsStore().items.push(plugin)
  launchedIds.push(plugin.id)
  await launchPlugin(plugin)
  return plugin
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    host: 'example.com',
    userId: 'u1',
    username: 'alice',
    displayName: null,
    avatarUrl: null,
    software: 'misskey-dev/misskey',
    hasToken: true,
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  apiRequestMock.mockResolvedValue({ status: 'ok', data: null })
})

afterEach(() => {
  for (const id of launchedIds) abortPlugin(id)
  launchedIds.length = 0
})

describe('parsePluginMeta', () => {
  it('parses a full metadata header including nested config', () => {
    const meta = parsePluginMeta(`/// @ 1.2.1
### {
  name: "Hello"
  version: "1.2.0"
  author: "alice"
  description: "greets"
  permissions: ["read:account"]
  config: {
    msg: {
      type: "string"
      label: "Message"
      default: "hi"
    }
  }
}
Mk:toast("hi")
`)
    expect(meta).not.toBeNull()
    expect(meta?.name).toBe('Hello')
    expect(meta?.version).toBe('1.2.0')
    expect(meta?.author).toBe('alice')
    expect(meta?.description).toBe('greets')
    expect(meta?.permissions).toEqual(['read:account'])
    expect(meta?.config?.msg).toMatchObject({
      type: 'string',
      label: 'Message',
      default: 'hi',
    })
  })

  it('allows a version declaration line before the ### header', () => {
    const meta = parsePluginMeta(
      '/// @ 0.19.0\n### {\n  name: "Old"\n  version: "1"\n}\n',
    )
    expect(meta).toMatchObject({ name: 'Old', version: '1' })
  })

  it('strips line comments inside the header', () => {
    const meta = parsePluginMeta(
      '/// @ 1.2.1\n### {\n  // this is a comment\n  name: "C"\n  version: "2"\n}\n',
    )
    expect(meta).toMatchObject({ name: 'C', version: '2' })
  })

  it('returns null when the ### header is missing', () => {
    expect(parsePluginMeta('/// @ 1.2.1\nMk:toast("no header")')).toBeNull()
  })

  it('returns null when the AiScript version header is missing', () => {
    expect(
      parsePluginMeta('### {\n  name: "NoLang"\n  version: "1"\n}\n'),
    ).toBeNull()
  })

  it('returns null for an unsupported AiScript version (< 0.12)', () => {
    expect(
      parsePluginMeta(
        '/// @ 0.11.0\n### {\n  name: "Old"\n  version: "1"\n}\n',
      ),
    ).toBeNull()
  })

  it('returns null when name or version is missing', () => {
    expect(
      parsePluginMeta('/// @ 1.2.1\n### {\n  name: "OnlyName"\n}\n'),
    ).toBeNull()
    expect(
      parsePluginMeta('/// @ 1.2.1\n### {\n  version: "1"\n}\n'),
    ).toBeNull()
  })

  it('returns null for unbalanced braces', () => {
    expect(
      parsePluginMeta('/// @ 1.2.1\n### {\n  name: "X"\n  version: "1"\n'),
    ).toBeNull()
  })

  it('filters non-string entries out of permissions', () => {
    const meta = parsePluginMeta(
      '/// @ 1.2.1\n### {\n  name: "P"\n  version: "1"\n  permissions: ["a", 1, true]\n}\n',
    )
    expect(meta?.permissions).toEqual(['a'])
  })
})

describe('launchPlugin / handler registry', () => {
  it('registers a note_action handler with its title', async () => {
    const plugin = await installAndLaunch(
      'Plugin:register_note_action("Copy", @(note) { note })',
    )
    const handlers = getPluginHandlers('note_action')
    expect(handlers).toHaveLength(1)
    expect(handlers[0]?.title).toBe('Copy')
    expect(handlers[0]?.pluginInstallId).toBe(plugin.id)
    // 他 type には出てこない
    expect(getPluginHandlers('user_action')).toHaveLength(0)
  })

  it('supports the colon-style alias (Plugin:register:note_action)', async () => {
    await installAndLaunch(
      'Plugin:register:note_action("Alias", @(note) { note })',
    )
    expect(getPluginHandlers('note_action')[0]?.title).toBe('Alias')
  })

  it('does nothing for an inactive plugin or empty src', async () => {
    await installAndLaunch(
      'Plugin:register_note_action("X", @(note) { note })',
      { active: false },
    )
    await installAndLaunch('', {})
    expect(getPluginHandlers('note_action')).toHaveLength(0)
  })

  it('re-launching the same plugin does not duplicate handlers', async () => {
    const plugin = await installAndLaunch(
      'Plugin:register_note_action("Once", @(note) { note })',
    )
    await launchPlugin(plugin)
    expect(getPluginHandlers('note_action')).toHaveLength(1)
  })

  it('records "run completed" in the run log on success', async () => {
    const plugin = await installAndLaunch('let x = 1')
    const entries = useAiScriptLogsStore().entriesFor('plugin', plugin.id)
    expect(entries.map((e) => e.message)).toContain('run completed')
  })

  it('records a parse error in the run log and registers no handlers', async () => {
    const plugin = await installAndLaunch(
      'Plugin:register_note_action("bad", @(note) { note })\nlet x = (',
    )
    const entries = useAiScriptLogsStore().entriesFor('plugin', plugin.id)
    expect(entries.some((e) => e.message.startsWith('parse error:'))).toBe(true)
    expect(getPluginHandlers('note_action')).toHaveLength(0)
  })

  it('resolves Plugin:config from defaults and configData overrides', async () => {
    const config = {
      msg: { type: 'string' as const, label: 'Message', default: 'DefTitle' },
    }
    await installAndLaunch(
      'Plugin:register_note_action(Plugin:config.msg, @(note) { note })',
      { config },
    )
    await installAndLaunch(
      'Plugin:register_note_action(Plugin:config.msg, @(note) { note })',
      { config, configData: { msg: 'Custom' } },
    )
    const titles = getPluginHandlers('note_action').map((h) => h.title)
    expect(titles).toEqual(['DefTitle', 'Custom'])
  })

  it('Plugin:open_url delegates to openSafeUrl', async () => {
    await installAndLaunch('Plugin:open_url("https://example.com/")')
    expect(openSafeUrlMock).toHaveBeenCalledWith('https://example.com/')
  })
})

describe('getPluginHandlers scope evaluation (#771)', () => {
  const SRC = 'Plugin:register_note_action("S", @(note) { note })'

  it('a global-scope plugin is effective with and without an account context', async () => {
    await installAndLaunch(SRC, { global: true })
    expect(getPluginHandlers('note_action')).toHaveLength(1)
    expect(getPluginHandlers('note_action', 'unknown-id')).toHaveLength(1)
  })

  it('an account-scoped plugin is effective only for a matching account', async () => {
    useAccountsStore().accounts.push(makeAccount({ id: 'acc-1' }))
    useAccountsStore().accounts.push(
      makeAccount({ id: 'acc-2', host: 'other.example', userId: 'u2' }),
    )
    await installAndLaunch(SRC, {
      global: false,
      installedFor: ['example.com:u1'],
    })
    expect(getPluginHandlers('note_action', 'acc-1')).toHaveLength(1)
    expect(getPluginHandlers('note_action', 'acc-2')).toHaveLength(0)
    // アカウント文脈なし = 全体スコープのみ有効
    expect(getPluginHandlers('note_action')).toHaveLength(0)
  })

  it('a plugin missing from the plugins store is filtered out', async () => {
    const plugin = makePlugin({ src: SRC })
    launchedIds.push(plugin.id)
    // store に登録せず launch → handler は登録されるが scope 評価で落ちる
    await launchPlugin(plugin)
    expect(getPluginHandlers('note_action')).toHaveLength(0)
  })
})

describe('interruptors', () => {
  it('applyNoteViewInterruptors applies the registered transform', async () => {
    await installAndLaunch(
      '/// @ 1.2.1\nPlugin:register_note_view_interruptor(@(note) { Obj:set(note, "seen", true)\nreturn note })',
    )
    const result = applyNoteViewInterruptors({ id: 'n1' })
    expect(result).toEqual({ id: 'n1', seen: true })
  })

  it('applyNoteViewInterruptors keeps the original note when the handler returns null', async () => {
    await installAndLaunch(
      '/// @ 1.2.1\nPlugin:register_note_view_interruptor(@(note) { return null })',
    )
    const note = { id: 'n1' }
    expect(applyNoteViewInterruptors(note)).toBe(note)
  })

  it('applyNotePostInterruptors applies the registered transform', async () => {
    await installAndLaunch(
      '/// @ 1.2.1\nPlugin:register_note_post_interruptor(@(form) { Obj:set(form, "text", "mod")\nreturn form })',
    )
    const result = applyNotePostInterruptors({ text: 'orig' })
    expect(result).toEqual({ text: 'mod' })
  })

  it('returns the input unchanged when no interruptors are registered', () => {
    const note = { id: 'n1' }
    expect(applyNoteViewInterruptors(note)).toBe(note)
    expect(applyNotePostInterruptors(note)).toBe(note)
  })

  it('runs 0.x (>= 0.12) plugins on the modern interpreter so interruptors work', async () => {
    await installAndLaunch(
      '/// @ 0.16.0\nPlugin:register_note_view_interruptor(@(note) { Obj:set(note, "seen", true)\nreturn note })',
    )
    expect(applyNoteViewInterruptors({ id: 'n1' })).toEqual({
      id: 'n1',
      seen: true,
    })
  })
})

describe('AiScript version header requirement (launch)', () => {
  async function launchRaw(src: string): Promise<PluginItem> {
    const plugin = makePlugin({ src })
    usePluginsStore().items.push(plugin)
    launchedIds.push(plugin.id)
    await launchPlugin(plugin)
    return plugin
  }

  it('rejects launch when the version header is missing, with a run log message', async () => {
    const plugin = await launchRaw(
      'Plugin:register_note_action("A", @(note) { note })',
    )
    expect(getPluginHandlers('note_action')).toHaveLength(0)
    const entries = useAiScriptLogsStore().entriesFor('plugin', plugin.id)
    expect(entries.some((e) => e.message.includes('version header'))).toBe(true)
  })

  it('rejects launch for an unsupported AiScript version (< 0.12)', async () => {
    const plugin = await launchRaw(
      '/// @ 0.11.0\nPlugin:register_note_action("A", @(note) { note })',
    )
    expect(getPluginHandlers('note_action')).toHaveLength(0)
    const entries = useAiScriptLogsStore().entriesFor('plugin', plugin.id)
    expect(entries.some((e) => e.message.includes('not supported'))).toBe(true)
  })
})

describe('post_form_action bridging', () => {
  it('exposes an update callback that converts AiScript values back to JS', async () => {
    await installAndLaunch(
      'Plugin:register_post_form_action("Fill", @(form, update) { update("text", "hi") })',
    )
    const handler = getPluginHandlers('post_form_action')[0]
    expect(handler?.title).toBe('Fill')
    const update = vi.fn()
    handler?.handler({ text: '' }, update)
    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledWith('text', 'hi')
    })
  })
})

describe('Mk:api account context bridging', () => {
  const SRC =
    'Plugin:register_note_action("api", @(note) { Mk:api("notes/show", { noteId: note.id }) })'

  it('reports an error when no account context is set', async () => {
    const plugin = await installAndLaunch(SRC)
    getPluginHandlers('note_action')[0]?.handler({ id: 'n1' })
    await vi.waitFor(() => {
      const entries = useAiScriptLogsStore().entriesFor('plugin', plugin.id)
      expect(
        entries.some(
          (e) =>
            e.level === 'error' && e.message.includes('no account context'),
        ),
      ).toBe(true)
    })
    expect(apiRequestMock).not.toHaveBeenCalled()
  })

  it('routes Mk:api through the gate and apiRequest with the set account', async () => {
    apiRequestMock.mockResolvedValue({ status: 'ok', data: { id: 'n1' } })
    const plugin = await installAndLaunch(SRC)
    await withPluginAccountContext(plugin.id, 'acc-9', () =>
      getPluginHandlers('note_action')[0]?.handler({ id: 'n1' }),
    )
    expect(apiRequestMock).toHaveBeenCalledWith('acc-9', 'notes/show', {
      noteId: 'n1',
    })
    expect(gateMock).toHaveBeenCalledWith(
      { kind: 'plugin', pluginId: plugin.id, name: plugin.name },
      'notes/show',
      { onBehalfOf: [] },
    )
  })

  it('Nd:register_command の handler から呼ぶ Mk:api は呼び出し元の権限も検査する (#1099)', async () => {
    apiRequestMock.mockResolvedValue({ status: 'ok', data: { id: 'n1' } })
    const plugin = await installAndLaunch(
      'Nd:register_command("call", "Call", "ti-x", @(p) { Mk:api("notes/show", { noteId: "n1" }) }, { aiTool: true, signature: { description: "d" } })',
    )
    const { listCapabilities } = await import('@/capabilities/registry')
    const cap = listCapabilities().find((c) => c.id.endsWith(':call'))
    expect(cap).toBeDefined()
    // アカウント文脈は dispatcher が capCtx.accountId で渡す (#1306)
    await cap?.execute(
      { x: 1 },
      { principal: { kind: 'ai.chat' }, accountId: 'acc-9' },
    )
    expect(gateMock).toHaveBeenCalledWith(
      { kind: 'plugin', pluginId: plugin.id, name: plugin.name },
      'notes/show',
      { onBehalfOf: [{ kind: 'ai.chat' }] },
    )
    expect(apiRequestMock).toHaveBeenCalledWith('acc-9', 'notes/show', {
      noteId: 'n1',
    })
  })
})

describe('withPluginAccountContext (#821)', () => {
  const SRC =
    'Plugin:register_note_action("api", @(note) { Mk:api("notes/show", { noteId: note.id }) })'

  it('handler 完了後に文脈が必ず null へ戻る (以後の Mk:api は fail-closed)', async () => {
    const plugin = await installAndLaunch(SRC)
    const handler = getPluginHandlers('note_action')[0]?.handler
    await withPluginAccountContext(plugin.id, 'acc-1', () =>
      handler?.({ id: 'n1' }),
    )
    expect(apiRequestMock).toHaveBeenCalledWith('acc-1', 'notes/show', {
      noteId: 'n1',
    })
    apiRequestMock.mockClear()
    // 文脈外の発火は no account context エラー (既存挙動の維持)
    await handler?.({ id: 'n2' })
    expect(apiRequestMock).not.toHaveBeenCalled()
    const entries = useAiScriptLogsStore().entriesFor('plugin', plugin.id)
    expect(
      entries.some(
        (e) => e.level === 'error' && e.message.includes('no account context'),
      ),
    ).toBe(true)
  })

  it('同一プラグインの並行呼び出しを直列化し、各 handler が自分のアカウントを見る', async () => {
    const calls: string[] = []
    apiRequestMock.mockImplementation(async (accountId) => {
      calls.push(accountId)
      // handler A の実行を跨いで handler B が開始されうる時間差を作る
      await new Promise((r) => setTimeout(r, 10))
      return { status: 'ok', data: null }
    })
    const plugin = await installAndLaunch(SRC)
    const handler = getPluginHandlers('note_action')[0]?.handler
    await Promise.all([
      withPluginAccountContext(plugin.id, 'acc-1', () =>
        handler?.({ id: 'n1' }),
      ),
      withPluginAccountContext(plugin.id, 'acc-2', () =>
        handler?.({ id: 'n2' }),
      ),
    ])
    expect(calls).toEqual(['acc-1', 'acc-2'])
  })

  it('起動していないプラグイン (文脈なし) でも fn 自体は実行される', async () => {
    const result = await withPluginAccountContext(
      'nonexistent',
      'acc-1',
      () => 42,
    )
    expect(result).toBe(42)
  })
})

/**
 * Mk:api の呼び出しを `<accountId>:<endpoint>` で記録し、users/show だけ遅くする。
 * 遅い handler の実行中に別の実行が割り込む状況を作るための共通の仕込み
 */
function slowUsersShow(): string[] {
  const calls: string[] = []
  apiRequestMock.mockImplementation(async (accountId, endpoint) => {
    calls.push(`${accountId}:${endpoint}`)
    if (endpoint === 'users/show') {
      await new Promise((r) => setTimeout(r, 40))
    }
    return { status: 'ok', data: null }
  })
  return calls
}

describe('detach したコールバックのアカウント文脈 (#1301)', () => {
  // note_action の handler は遅延して Mk:api を呼ぶ (handler 自体は即終了)。
  // user_action の handler は遅い Mk:api を待つ (この実行中に timer が発火する)
  const SRC = [
    'Plugin:register_note_action("delay", @(note) { Async:timeout(5, @() { Mk:api("notes/show", { noteId: note.id }) }) })',
    'Plugin:register_user_action("slow", @(user) { Mk:api("users/show", { userId: user.id }) })',
  ].join('\n')

  it('handler A が仕込んだ Async:timeout は handler B の実行中に発火しても A のアカウントで Mk:api を呼ぶ', async () => {
    const calls = slowUsersShow()
    const plugin = await installAndLaunch(SRC)
    const delay = getPluginHandlers('note_action')[0]?.handler
    const slow = getPluginHandlers('user_action')[0]?.handler
    await withPluginAccountContext(plugin.id, 'acc-a', () =>
      delay?.({ id: 'n1' }),
    )
    await withPluginAccountContext(plugin.id, 'acc-b', () =>
      slow?.({ id: 'u1' }),
    )
    await vi.waitFor(() => {
      expect(calls.some((c) => c.endsWith(':notes/show'))).toBe(true)
    })
    expect(calls).toContain('acc-a:notes/show')
    expect(calls).not.toContain('acc-b:notes/show')
  })

  it('文脈の外 (top-level) で仕込んだ Async:timeout は handler B の実行中に発火しても fail-closed のまま', async () => {
    const calls = slowUsersShow()
    const plugin = await installAndLaunch(
      [
        'Plugin:register_user_action("slow", @(user) { Mk:api("users/show", { userId: user.id }) })',
        'Async:timeout(5, @() { Mk:api("notes/show", { noteId: "n1" }) })',
      ].join('\n'),
    )
    const slow = getPluginHandlers('user_action')[0]?.handler
    await withPluginAccountContext(plugin.id, 'acc-b', () =>
      slow?.({ id: 'u1' }),
    )
    await vi.waitFor(() => {
      const entries = useAiScriptLogsStore().entriesFor('plugin', plugin.id)
      expect(
        entries.some(
          (e) =>
            e.level === 'error' && e.message.includes('no account context'),
        ),
      ).toBe(true)
    })
    expect(calls.filter((c) => c.endsWith(':notes/show'))).toEqual([])
  })

  it('Async:interval の各 tick も仕込んだ handler のアカウントを持ち続ける', async () => {
    const calls = slowUsersShow()
    const plugin = await installAndLaunch(
      [
        'var stop = null',
        'var n = 0',
        'Plugin:register_note_action("poll", @(note) { stop = Async:interval(5, @() { n += 1; Mk:api("notes/show", { noteId: note.id }); if n >= 2 { stop() } }) })',
        'Plugin:register_user_action("slow", @(user) { Mk:api("users/show", { userId: user.id }) })',
      ].join('\n'),
    )
    const poll = getPluginHandlers('note_action')[0]?.handler
    const slow = getPluginHandlers('user_action')[0]?.handler
    await withPluginAccountContext(plugin.id, 'acc-a', () =>
      poll?.({ id: 'n1' }),
    )
    await withPluginAccountContext(plugin.id, 'acc-b', () =>
      slow?.({ id: 'u1' }),
    )
    await vi.waitFor(() => {
      expect(
        calls.filter((c) => c.endsWith(':notes/show')).length,
      ).toBeGreaterThanOrEqual(2)
    })
    // B の実行中に積まれた tick も含め、すべて A のアカウント
    const ticks = calls.filter((c) => c.endsWith(':notes/show'))
    expect(ticks.every((c) => c === 'acc-a:notes/show')).toBe(true)
  })
})

describe('直列化の外から入る実行のアカウント文脈 (#1306)', () => {
  const SLOW =
    'Plugin:register_user_action("slow", @(user) { Mk:api("users/show", { userId: user.id }) })'

  /**
   * handler B を走らせ、Mk:api を await している最中 (5ms 後) に戻る。
   * async 関数が Promise を return すると平坦化されて B の完了を待ってしまうので
   * オブジェクトに包んで返す
   */
  async function startSlow(
    pluginId: string,
  ): Promise<{ running: Promise<unknown> }> {
    const slow = getPluginHandlers('user_action')[0]?.handler
    const running = withPluginAccountContext(pluginId, 'acc-b', () =>
      slow?.({ id: 'u1' }),
    )
    await new Promise((r) => setTimeout(r, 5))
    return { running }
  }

  function notesShowCalls(calls: string[]): string[] {
    return calls.filter((c) => c.endsWith(':notes/show'))
  }

  it('Nd:on の handler は payload のアカウントで走り、無ければ別の handler の実行中でも fail-closed', async () => {
    const calls = slowUsersShow()
    const plugin = await installAndLaunch(
      [
        SLOW,
        'Nd:on("memo:created", @(m) { Mk:api("notes/show", { noteId: m.id }) })',
      ].join('\n'),
    )
    const { running } = await startSlow(plugin.id)
    emitNoteDeckEvent('memo:created', { id: 'm1', accountId: 'acc-a' })
    emitNoteDeckEvent('memo:created', { id: 'm2' })
    await running
    await vi.waitFor(() => {
      expect(notesShowCalls(calls)).toEqual(['acc-a:notes/show'])
      const entries = useAiScriptLogsStore().entriesFor('plugin', plugin.id)
      expect(
        entries.some(
          (e) =>
            e.level === 'error' && e.message.includes('no account context'),
        ),
      ).toBe(true)
    })
  })

  it('コマンドパレットからの Nd:register_command は別の handler の実行中でも fail-closed', async () => {
    const calls = slowUsersShow()
    const plugin = await installAndLaunch(
      [
        SLOW,
        'Nd:register_command("cmd", "Cmd", "ti-x", @() { Mk:api("notes/show", { noteId: "n1" }) })',
      ].join('\n'),
    )
    const command = [...useCommandStore().commands.values()].find((c) =>
      c.id.endsWith(':cmd'),
    )
    expect(command).toBeDefined()
    const { running } = await startSlow(plugin.id)
    await command?.execute()
    await running
    await vi.waitFor(() => {
      const entries = useAiScriptLogsStore().entriesFor('plugin', plugin.id)
      expect(
        entries.some(
          (e) =>
            e.level === 'error' && e.message.includes('no account context'),
        ),
      ).toBe(true)
    })
    expect(notesShowCalls(calls)).toEqual([])
  })

  it('capability 経由の実行は呼び出し文脈のアカウントで走り、別の handler のアカウントを拾わない', async () => {
    const calls = slowUsersShow()
    const plugin = await installAndLaunch(
      [
        SLOW,
        'Nd:register_command("cap", "Cap", "ti-x", @(p) { Mk:api("notes/show", { noteId: "n1" }) }, { aiTool: true, signature: { description: "d" } })',
      ].join('\n'),
    )
    const { listCapabilities } = await import('@/capabilities/registry')
    const cap = listCapabilities().find((c) => c.id.endsWith(':cap'))
    expect(cap).toBeDefined()
    const { running } = await startSlow(plugin.id)
    const executed = cap?.execute(
      { x: 1 },
      { principal: { kind: 'ai.chat' }, accountId: 'acc-a' },
    )
    await running
    await executed
    expect(notesShowCalls(calls)).toEqual(['acc-a:notes/show'])
  })

  it('handler の中から Nd:call で自分の capability を呼んでも止まらず、handler のアカウントで走る', async () => {
    const calls = slowUsersShow()
    const plugin = await installAndLaunch(
      [
        'Nd:register_command("inner", "Inner", "ti-x", @(p) { Mk:api("notes/show", { noteId: "n1" }) }, { aiTool: true, signature: { description: "d" } })',
        'Plugin:register_note_action("outer", @(note) { Nd:call(note.id, { x: 1 }) })',
      ].join('\n'),
    )
    const { listCapabilities } = await import('@/capabilities/registry')
    const inner = listCapabilities().find((c) => c.id.endsWith(':inner'))
    expect(inner).toBeDefined()
    const outer = getPluginHandlers('note_action')[0]?.handler
    const done = withPluginAccountContext(plugin.id, 'acc-a', () =>
      outer?.({ id: inner?.id }),
    )
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('deadlock')), 1000),
    )
    await expect(Promise.race([done, timeout])).resolves.toBeUndefined()
    expect(notesShowCalls(calls)).toEqual(['acc-a:notes/show'])
  })
})

describe('abort / launchAll', () => {
  it("abortPlugin removes only that plugin's handlers", async () => {
    const a = await installAndLaunch(
      'Plugin:register_note_action("A", @(note) { note })',
    )
    await installAndLaunch('Plugin:register_note_action("B", @(note) { note })')
    expect(getPluginHandlers('note_action')).toHaveLength(2)
    abortPlugin(a.id)
    const titles = getPluginHandlers('note_action').map((h) => h.title)
    expect(titles).toEqual(['B'])
  })

  it('launchAllPlugins launches only active plugins with src', async () => {
    const active = makePlugin({
      src: '/// @ 1.2.1\nPlugin:register_note_action("On", @(note) { note })',
    })
    const inactive = makePlugin({
      src: '/// @ 1.2.1\nPlugin:register_note_action("Off", @(note) { note })',
      active: false,
    })
    const empty = makePlugin({ src: '' })
    const store = usePluginsStore()
    store.items.push(active, inactive, empty)
    launchedIds.push(active.id, inactive.id, empty.id)
    await launchAllPlugins([active, inactive, empty])
    const titles = getPluginHandlers('note_action').map((h) => h.title)
    expect(titles).toEqual(['On'])
  })

  it('abortAllPlugins removes every handler', async () => {
    await installAndLaunch('Plugin:register_note_action("A", @(note) { note })')
    await installAndLaunch('Plugin:register_user_action("B", @(user) { user })')
    abortAllPlugins()
    expect(getPluginHandlers('note_action')).toHaveLength(0)
    expect(getPluginHandlers('user_action')).toHaveLength(0)
  })
})

describe('セーフモード (#794)', () => {
  afterEach(() => {
    localStorage.removeItem('nd-safe-mode')
  })

  it('セーフモード中は active なプラグインでも起動しない', async () => {
    localStorage.setItem('nd-safe-mode', 'true')
    await installAndLaunch('Plugin:register_note_action("A", @(note) { note })')
    expect(getPluginHandlers('note_action')).toHaveLength(0)
  })

  it('セーフモード解除後は通常どおり起動する', async () => {
    await installAndLaunch('Plugin:register_note_action("A", @(note) { note })')
    expect(getPluginHandlers('note_action')).toHaveLength(1)
  })
})

describe('Mk:toast (プラグイン env の配線)', () => {
  // onToast 未配線だと Mk:toast が無言の no-op になり、プラグインからの
  // 成否フィードバックがユーザーに一切届かない (実機で「押しても無反応」)
  it('プラグインの Mk:toast がトーストとして表示される', async () => {
    const { toasts } = useToast()
    toasts.value.splice(0)
    await installAndLaunch('Mk:toast("saved", "success")')
    expect(toasts.value.map((t) => [t.text, t.type])).toEqual([
      ['saved', 'success'],
    ])
  })

  it('note action ハンドラからの Mk:toast も表示される', async () => {
    const { toasts } = useToast()
    toasts.value.splice(0)
    await installAndLaunch(
      'Plugin:register_note_action("T", @(note) { Mk:toast("done", "info") })',
    )
    // handler は execFn の Promise を返す (#821) ので await だけで完了を追える
    await getPluginHandlers('note_action')[0]?.handler({ id: 'n1' })
    expect(toasts.value.map((t) => t.text)).toEqual(['done'])
  })
})

describe('UI 起点の実行エラー表示 (#1072 / #1074)', () => {
  function makeCapability(overrides: Partial<Capability>): Capability {
    return {
      id: 'test.cap',
      label: 'test',
      icon: 'ti-flask',
      category: 'general',
      permissions: [],
      signature: { description: 'test capability' },
      execute: () => 'ok',
      ...overrides,
    }
  }

  beforeEach(() => {
    _clearCapabilitiesForTest()
    confirmDecision.accepted = true
    useToast().toasts.value.splice(0)
  })

  afterEach(() => {
    _clearCapabilitiesForTest()
  })

  it('note_action の実行時エラーはプラグイン名付きの toast で通知される', async () => {
    // AiScript に try/catch が無いためプラグイン側では回避できない。runLog だけに
    // 流すと「メニューを押したのに何も起きない」に見える (#1072)
    const plugin = await installAndLaunch(
      'Plugin:register_note_action("boom", @(note) { Nd:call("nope.nope") })',
    )
    await getPluginHandlers('note_action')[0]?.handler({ id: 'n1' })
    const { toasts } = useToast()
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0]?.type).toBe('error')
    expect(toasts.value[0]?.source).toBe(plugin.name)
    expect(toasts.value[0]?.text).toContain('unknown_capability')
    // runLog への記録は従来どおり残す (詳細はそちらで追う)
    const entries = useAiScriptLogsStore().entriesFor('plugin', plugin.id)
    expect(entries.some((e) => e.level === 'error')).toBe(true)
  })

  it('user_action / post_form_action も同じ経路で通知される', async () => {
    await installAndLaunch(
      'Plugin:register_user_action("u", @(user) { Nd:call("nope.user") })',
    )
    await installAndLaunch(
      'Plugin:register_post_form_action("p", @(form, update) { Nd:call("nope.form") })',
    )
    await getPluginHandlers('user_action')[0]?.handler({ id: 'u1' })
    await getPluginHandlers('post_form_action')[0]?.handler(
      { text: '' },
      vi.fn(),
    )
    const texts = useToast().toasts.value.map((t) => t.text)
    expect(texts.some((t) => t.includes('nope.user'))).toBe(true)
    expect(texts.some((t) => t.includes('nope.form'))).toBe(true)
  })

  it('正常終了では toast を出さない', async () => {
    await installAndLaunch(
      'Plugin:register_note_action("ok", @(note) { note.id })',
    )
    await getPluginHandlers('note_action')[0]?.handler({ id: 'n1' })
    expect(useToast().toasts.value).toHaveLength(0)
  })

  it('確認ダイアログのキャンセルは error にならず toast も出ない (#1074)', async () => {
    const execute = vi.fn().mockReturnValue('should not run')
    registerCapability(
      makeCapability({
        id: 'demo.confirm',
        requiresConfirmation: true,
        execute,
      }),
    )
    confirmDecision.accepted = false
    // プラグインは戻り値の型で「キャンセルされた」と見分けられる
    const plugin = await installAndLaunch(
      'Plugin:register_note_action("c", @(note) { let r = Nd:call("demo.confirm"); Mk:toast(Core:type(r)) })',
    )
    await getPluginHandlers('note_action')[0]?.handler({ id: 'n1' })
    expect(execute).not.toHaveBeenCalled()
    expect(useToast().toasts.value.map((t) => [t.text, t.type])).toEqual([
      ['error', 'info'],
    ])
    const entries = useAiScriptLogsStore().entriesFor('plugin', plugin.id)
    expect(entries.some((e) => e.level === 'error')).toBe(false)
  })

  it('handler のエラー後も同じプラグインの別の action は動く', async () => {
    // interpreter を abortOnError で止めると、設定を直して再クリックしても
    // 以後ずっと無言になる — toast が初回にしか効かない
    await installAndLaunch(
      [
        'Plugin:register_note_action("boom", @(note) { Nd:call("nope.nope") })',
        'Plugin:register_note_action("ok", @(note) { Mk:toast("alive") })',
      ].join('\n'),
    )
    const handlers = getPluginHandlers('note_action')
    await handlers.find((h) => h.title === 'boom')?.handler({ id: 'n1' })
    await handlers.find((h) => h.title === 'ok')?.handler({ id: 'n1' })
    await handlers.find((h) => h.title === 'boom')?.handler({ id: 'n1' })
    const texts = useToast().toasts.value.map((t) => t.text)
    expect(texts).toContain('alive')
    // 2 回目のエラーも toast に届く (同文は積み直さず延長される)
    expect(texts.filter((t) => t.includes('nope.nope'))).toHaveLength(1)
  })

  it('interruptor のエラーは描画のたびに走るので toast にしない', async () => {
    await installAndLaunch(
      'Plugin:register_note_view_interruptor(@(note) { Core:add(1, "a") })',
    )
    applyNoteViewInterruptors({ id: 'n1' })
    expect(useToast().toasts.value).toHaveLength(0)
  })
})
