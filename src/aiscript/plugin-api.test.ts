import { Parser, utils } from '@syuilo/aiscript'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertMisskeyApiAllowed } from '@/permissions/misskeyApiGate'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { useAiScriptLogsStore } from '@/stores/aiscriptLogs'
import { type PluginMeta, usePluginsStore } from '@/stores/plugins'
import { commands } from '@/utils/tauriInvoke'
import { openSafeUrl } from '@/utils/url'
import {
  abortAllPlugins,
  abortPlugin,
  applyNotePostInterruptors,
  applyNoteViewInterruptors,
  getPluginHandlers,
  isSupportedAiScriptVersion,
  launchAllPlugins,
  launchPlugin,
  parsePluginMeta,
  setPluginAccountContext,
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

function makePlugin(overrides: Partial<PluginMeta> = {}): PluginMeta {
  return {
    installId: `test-plugin-${++seq}`,
    name: 'TestPlugin',
    version: '1.0.0',
    configData: {},
    src: '',
    active: true,
    global: true,
    ...overrides,
  }
}

/**
 * plugins store に登録した上で launchPlugin する（スコープ評価が効く状態にする）。
 * バージョンヘッダーは必須仕様のため自動前置する。ヘッダー検証自体のテストは
 * makePlugin + launchPlugin を直接使うこと。
 */
async function installAndLaunch(
  src: string,
  overrides: Partial<PluginMeta> = {},
): Promise<PluginMeta> {
  const headered =
    src === '' || src.startsWith('///') ? src : `/// @ 1.2.1\n${src}`
  const plugin = makePlugin({ src: headered, ...overrides })
  usePluginsStore().plugins.push(plugin)
  launchedIds.push(plugin.installId)
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
    expect(handlers[0]?.pluginInstallId).toBe(plugin.installId)
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
    const entries = useAiScriptLogsStore().entriesFor(
      'plugin',
      plugin.installId,
    )
    expect(entries.map((e) => e.message)).toContain('run completed')
  })

  it('records a parse error in the run log and registers no handlers', async () => {
    const plugin = await installAndLaunch(
      'Plugin:register_note_action("bad", @(note) { note })\nlet x = (',
    )
    const entries = useAiScriptLogsStore().entriesFor(
      'plugin',
      plugin.installId,
    )
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
    launchedIds.push(plugin.installId)
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
  async function launchRaw(src: string): Promise<PluginMeta> {
    const plugin = makePlugin({ src })
    usePluginsStore().plugins.push(plugin)
    launchedIds.push(plugin.installId)
    await launchPlugin(plugin)
    return plugin
  }

  it('rejects launch when the version header is missing, with a run log message', async () => {
    const plugin = await launchRaw(
      'Plugin:register_note_action("A", @(note) { note })',
    )
    expect(getPluginHandlers('note_action')).toHaveLength(0)
    const entries = useAiScriptLogsStore().entriesFor(
      'plugin',
      plugin.installId,
    )
    expect(entries.some((e) => e.message.includes('version header'))).toBe(true)
  })

  it('rejects launch for an unsupported AiScript version (< 0.12)', async () => {
    const plugin = await launchRaw(
      '/// @ 0.11.0\nPlugin:register_note_action("A", @(note) { note })',
    )
    expect(getPluginHandlers('note_action')).toHaveLength(0)
    const entries = useAiScriptLogsStore().entriesFor(
      'plugin',
      plugin.installId,
    )
    expect(entries.some((e) => e.message.includes('not supported'))).toBe(true)
  })

  it('built-in plugin sources carry a supported header and parse on the modern parser', async () => {
    const sources = import.meta.glob('@/defaults/plugins/*.is', {
      query: '?raw',
      import: 'default',
    })
    const paths = Object.keys(sources)
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      const src = (await sources[path]?.()) as string
      const version = utils.getLangVersion(src)
      expect(version, path).not.toBeNull()
      expect(isSupportedAiScriptVersion(version as string), path).toBe(true)
      expect(() => new Parser().parse(src), path).not.toThrow()
    }
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
      const entries = useAiScriptLogsStore().entriesFor(
        'plugin',
        plugin.installId,
      )
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
    setPluginAccountContext(plugin.installId, 'acc-9')
    getPluginHandlers('note_action')[0]?.handler({ id: 'n1' })
    await vi.waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('acc-9', 'notes/show', {
        noteId: 'n1',
      })
    })
    expect(gateMock).toHaveBeenCalledWith(
      { kind: 'plugin', pluginId: plugin.installId, name: plugin.name },
      'notes/show',
    )
  })
})

describe('abort / launchAll', () => {
  it("abortPlugin removes only that plugin's handlers", async () => {
    const a = await installAndLaunch(
      'Plugin:register_note_action("A", @(note) { note })',
    )
    await installAndLaunch('Plugin:register_note_action("B", @(note) { note })')
    expect(getPluginHandlers('note_action')).toHaveLength(2)
    abortPlugin(a.installId)
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
    store.plugins.push(active, inactive, empty)
    launchedIds.push(active.installId, inactive.installId, empty.installId)
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
