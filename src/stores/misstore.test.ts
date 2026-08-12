import { createHash } from 'node:crypto'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginMeta } from '@/stores/plugins'
import type { SkillMeta } from '@/stores/skills'
import type { WidgetMeta } from '@/stores/widgets'

const h = vi.hoisted(() => ({
  skillsStore: {
    skills: [] as unknown[],
    add: vi.fn(),
    update: vi.fn(),
    recordStoreBaseline: vi.fn(),
  },
  pluginsStore: {
    plugins: [] as unknown[],
    linkScope: vi.fn(),
    addPlugin: vi.fn(),
    applyStoreUpdate: vi.fn(),
    recordStoreBaseline: vi.fn(),
  },
  widgetsStore: {
    widgets: [] as unknown[],
    addWidget: vi.fn(),
    applyStoreUpdate: vi.fn(),
    recordStoreBaseline: vi.fn(),
  },
  queriesStore: {
    queries: [] as unknown[],
    ensureLoaded: vi.fn(),
    createQuery: vi.fn(async () => undefined),
    applyStoreUpdate: vi.fn(async () => undefined),
    recordStoreBaseline: vi.fn(async () => undefined),
  },
  themeStore: {
    installedThemes: [] as unknown[],
    installTheme: vi.fn(async (_json: string) => true),
    recordStoreBaseline: vi.fn(),
  },
  launchPlugin: vi.fn(async () => undefined),
  parsePluginMeta: vi.fn(),
  confirm: vi.fn(async (_opts: Record<string, unknown>) => true),
}))

vi.mock('@/aiscript/plugin-api', () => ({
  launchPlugin: h.launchPlugin,
  parsePluginMeta: h.parsePluginMeta,
}))
vi.mock('@/stores/plugins', () => ({
  usePluginsStore: () => h.pluginsStore,
}))
vi.mock('@/stores/skills', () => ({
  useSkillsStore: () => h.skillsStore,
}))
vi.mock('@/stores/widgets', () => ({
  useWidgetsStore: () => h.widgetsStore,
  generateWidgetId: () => 'w-test-1',
}))
vi.mock('@/stores/columnQueries', () => ({
  useColumnQueriesStore: () => h.queriesStore,
}))
vi.mock('@/stores/theme', () => ({
  useThemeStore: () => h.themeStore,
}))
vi.mock('@/stores/confirm', () => ({
  useConfirm: () => ({ confirm: h.confirm }),
}))

import {
  getPluginDetailUrl,
  type StorePluginEntry,
  type StoreQueryEntry,
  type StoreSkillEntry,
  type StoreThemeEntry,
  type StoreWidgetEntry,
  skillCategoryLabel,
  useMisStoreStore,
} from '@/stores/misstore'

/** misstore と同じ CRLF 正規化を経た SHA-512 hex。 */
function sha512Hex(source: string): string {
  return createHash('sha512')
    .update(source.replace(/\r\n/g, '\n'))
    .digest('hex')
}

const okJson = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => data }) as unknown as Response
const okText = (text: string) =>
  ({ ok: true, status: 200, text: async () => text }) as unknown as Response
const httpError = (status: number) =>
  ({ ok: false, status }) as unknown as Response

const baseEntry = {
  version: '1.0.0',
  author: 'author',
  description: 'desc',
  tags: [],
  sourceUrl: 'https://store.notedeck.io/src',
  apiUrl: '',
  sha512: '',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
}

function pluginEntry(over: Partial<StorePluginEntry> = {}): StorePluginEntry {
  return {
    ...baseEntry,
    id: 'ent-plugin',
    name: 'Test Plugin',
    category: 'utility',
    ...over,
  }
}

function themeEntry(over: Partial<StoreThemeEntry> = {}): StoreThemeEntry {
  return {
    ...baseEntry,
    id: 'ent-theme',
    name: 'Test Theme',
    base: 'dark',
    themeProps: {},
    ...over,
  }
}

function widgetEntry(over: Partial<StoreWidgetEntry> = {}): StoreWidgetEntry {
  return {
    ...baseEntry,
    id: 'ent-widget',
    name: 'Test Widget',
    icon: 'puzzle',
    autoRun: true,
    capabilities: [],
    ...over,
  }
}

function skillEntry(over: Partial<StoreSkillEntry> = {}): StoreSkillEntry {
  return {
    ...baseEntry,
    id: 'ent-skill',
    name: 'Test Skill',
    category: 'utility',
    ...over,
  }
}

function queryEntry(over: Partial<StoreQueryEntry> = {}): StoreQueryEntry {
  return {
    ...baseEntry,
    id: 'ent-query',
    name: 'Test Query',
    category: 'hide',
    ...over,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  h.skillsStore.skills = []
  h.pluginsStore.plugins = []
  h.widgetsStore.widgets = []
  h.queriesStore.queries = []
  h.themeStore.installedThemes = []
  h.themeStore.installTheme.mockResolvedValue(true)
  h.confirm.mockResolvedValue(true)
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useMisStoreStore registry fetch', () => {
  it('fetchPlugins populates plugins and clears loading', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okJson({ plugins: [pluginEntry()] }))
    await store.fetchPlugins()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://store.notedeck.io/registry/plugins.json',
    )
    expect(store.plugins).toHaveLength(1)
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('skips refetch while the cache is valid, refresh() forces one', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okJson({ plugins: [pluginEntry()] }))
    await store.fetchPlugins()
    await store.fetchPlugins()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await store.refresh()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('an empty registry result does not lock the cache', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okJson({ plugins: [] }))
    await store.fetchPlugins()
    await store.fetchPlugins()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('records an HTTP error and keeps plugins empty', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(httpError(500))
    await store.fetchPlugins()
    expect(store.error).toBe('HTTP 500')
    expect(store.plugins).toHaveLength(0)
    expect(store.loading).toBe(false)
  })

  it('records a network error message', async () => {
    const store = useMisStoreStore()
    fetchMock.mockRejectedValue(new Error('offline'))
    await store.fetchPlugins()
    expect(store.error).toBe('offline')
    expect(store.loading).toBe(false)
  })

  it('fetchThemes / fetchWidgets / fetchSkills read their own registry keys', async () => {
    const store = useMisStoreStore()
    fetchMock
      .mockResolvedValueOnce(okJson({ themes: [themeEntry()] }))
      .mockResolvedValueOnce(okJson({ widgets: [widgetEntry()] }))
      .mockResolvedValueOnce(okJson({ skills: [skillEntry()] }))
    await store.fetchThemes()
    await store.fetchWidgets()
    await store.fetchSkills()
    expect(store.themes.map((t) => t.id)).toEqual(['ent-theme'])
    expect(store.widgets.map((w) => w.id)).toEqual(['ent-widget'])
    expect(store.skills.map((s) => s.id)).toEqual(['ent-skill'])
  })
})

describe('fetchWidgetSource', () => {
  it('returns the source when the hash matches', async () => {
    const store = useMisStoreStore()
    const source = '<: "widget"'
    fetchMock.mockResolvedValue(okText(source))
    const entry = widgetEntry({ sha512: sha512Hex(source) })
    await expect(store.fetchWidgetSource(entry)).resolves.toBe(source)
  })

  it('accepts CRLF sources hashed after LF normalization', async () => {
    const store = useMisStoreStore()
    const source = 'line1\r\nline2'
    fetchMock.mockResolvedValue(okText(source))
    const entry = widgetEntry({ sha512: sha512Hex('line1\nline2') })
    await expect(store.fetchWidgetSource(entry)).resolves.toBe(source)
  })

  it('rejects on hash mismatch', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText('tampered'))
    const entry = widgetEntry({ sha512: sha512Hex('original') })
    await expect(store.fetchWidgetSource(entry)).rejects.toThrow(
      /ハッシュ不一致/,
    )
  })
})

describe('installSkill', () => {
  const source =
    '---\nname: Greeter\nmode: always\ntriggers: [hi, hello]\n---\nGreet the user'

  it('adds a new skill built from frontmatter + entry fallback', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    await store.installSkill(skillEntry({ sha512: sha512Hex(source) }))
    expect(h.skillsStore.add).toHaveBeenCalledTimes(1)
    const added = h.skillsStore.add.mock.calls[0]?.[0] as SkillMeta
    expect(added).toMatchObject({
      id: 'ent-skill',
      name: 'Greeter',
      mode: 'always',
      triggers: ['hi', 'hello'],
      scope: 'global',
      storeId: 'ent-skill',
      body: 'Greet the user',
      builtIn: false,
      storeSha512: sha512Hex(source),
      storeVersion: '1.0.0',
    })
    expect(store.installingSkill).toBeNull()
  })

  it('新規は frontmatter の id 宣言より storeId を正としてローカル ID にする (#913)', async () => {
    const store = useMisStoreStore()
    const declared = '---\nid: distributed-own-id\nname: Greeter\n---\nbody'
    fetchMock.mockResolvedValue(okText(declared))
    await store.installSkill(skillEntry({ sha512: sha512Hex(declared) }))
    const added = h.skillsStore.add.mock.calls[0]?.[0] as SkillMeta
    expect(added.id).toBe('ent-skill')
    expect(added.storeId).toBe('ent-skill')
  })

  it('storeId 不一致の既存 ID が storeId を占有していたら suffix で回避する (#913)', async () => {
    const store = useMisStoreStore()
    h.skillsStore.skills = [{ id: 'ent-skill', name: '自作' }]
    fetchMock.mockResolvedValue(okText(source))
    await store.installSkill(skillEntry({ sha512: sha512Hex(source) }))
    expect(h.skillsStore.update).not.toHaveBeenCalled()
    const added = h.skillsStore.add.mock.calls[0]?.[0] as SkillMeta
    expect(added.id).toBe('ent-skill-2')
    expect(added.storeId).toBe('ent-skill')
  })

  it('falls back to mode=manual and entry metadata when frontmatter is absent', async () => {
    const store = useMisStoreStore()
    const bare = 'just a body'
    fetchMock.mockResolvedValue(okText(bare))
    await store.installSkill(skillEntry({ sha512: sha512Hex(bare) }))
    const added = h.skillsStore.add.mock.calls[0]?.[0] as SkillMeta
    expect(added.name).toBe('Test Skill')
    expect(added.mode).toBe('manual')
    expect(added.body).toBe(bare)
  })

  it('既存は storeId で照合しローカル ID・name・mode を維持して上書き更新する (#913)', async () => {
    const store = useMisStoreStore()
    h.skillsStore.skills = [
      {
        id: 'local-1',
        storeId: 'ent-skill',
        name: 'My Renamed',
        mode: 'heartbeat',
      },
    ]
    fetchMock.mockResolvedValue(okText(source))
    await store.installSkill(skillEntry({ sha512: sha512Hex(source) }))
    expect(h.skillsStore.add).not.toHaveBeenCalled()
    expect(h.skillsStore.update).toHaveBeenCalledTimes(1)
    const [id, patch] = h.skillsStore.update.mock.calls[0] as [
      string,
      Partial<SkillMeta>,
    ]
    expect(id).toBe('local-1')
    expect(patch).toMatchObject({
      body: 'Greet the user',
      triggers: ['hi', 'hello'],
      storeId: 'ent-skill',
      storeSha512: sha512Hex(source),
      storeVersion: '1.0.0',
    })
    // ローカル値 (改名・実行モード・スコープ・ID) は更新で上書きしない
    expect(patch).not.toHaveProperty('name')
    expect(patch).not.toHaveProperty('mode')
    expect(patch).not.toHaveProperty('scope')
    expect(patch).not.toHaveProperty('installedFor')
    expect(patch).not.toHaveProperty('id')
  })

  it('keeps mode: heartbeat instead of falling back to manual (#967)', async () => {
    const store = useMisStoreStore()
    const hb = '---\nname: Pulse\nmode: heartbeat\n---\nreport'
    fetchMock.mockResolvedValue(okText(hb))
    await store.installSkill(skillEntry({ sha512: sha512Hex(hb) }))
    const added = h.skillsStore.add.mock.calls[0]?.[0] as SkillMeta
    expect(added.mode).toBe('heartbeat')
  })

  it('takes isPersona from frontmatter (#967)', async () => {
    const store = useMisStoreStore()
    const persona = '---\nname: Aizu\nisPersona: true\n---\npersona body'
    fetchMock.mockResolvedValue(okText(persona))
    await store.installSkill(skillEntry({ sha512: sha512Hex(persona) }))
    const added = h.skillsStore.add.mock.calls[0]?.[0] as SkillMeta
    expect(added.isPersona).toBe(true)
  })

  it('defaults isPersona to false when frontmatter omits it (#967)', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    await store.installSkill(skillEntry({ sha512: sha512Hex(source) }))
    const added = h.skillsStore.add.mock.calls[0]?.[0] as SkillMeta
    expect(added.isPersona).toBe(false)
  })

  it('rejects on hash mismatch and resets installingSkill', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    await expect(
      store.installSkill(skillEntry({ sha512: 'deadbeef' })),
    ).rejects.toThrow(/ハッシュ不一致/)
    expect(h.skillsStore.add).not.toHaveBeenCalled()
    expect(store.installingSkill).toBeNull()
  })

  it('isSkillInstalled は storeId のみで照合する (内部 ID 一致では真にならない #913)', () => {
    const store = useMisStoreStore()
    h.skillsStore.skills = [{ id: 'local-id', storeId: 'ent-skill' }]
    expect(store.isSkillInstalled(skillEntry())).toBe(true)
    h.skillsStore.skills = [{ id: 'ent-skill' }]
    expect(store.isSkillInstalled(skillEntry())).toBe(false)
    h.skillsStore.skills = [{ id: 'other' }]
    expect(store.isSkillInstalled(skillEntry())).toBe(false)
  })
})

describe('installQuery', () => {
  const source = 'note.text != null'

  it('新規は createQuery に storeId と storeSha512 / storeVersion を渡す (#913)', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    await store.installQuery(queryEntry({ sha512: sha512Hex(source) }))
    expect(h.queriesStore.createQuery).toHaveBeenCalledTimes(1)
    expect(h.queriesStore.createQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Query',
        description: 'desc',
        src: source,
        storeId: 'ent-query',
        storeSha512: sha512Hex(source),
        storeVersion: '1.0.0',
      }),
    )
    expect(store.installingQuery).toBeNull()
  })

  it('既存 (storeId 一致) は applyStoreUpdate で更新し name を渡さない (#913)', async () => {
    const store = useMisStoreStore()
    h.queriesStore.queries = [
      { id: 'q-local', storeId: 'ent-query', name: 'My Renamed' },
    ]
    fetchMock.mockResolvedValue(okText(source))
    await store.installQuery(queryEntry({ sha512: sha512Hex(source) }))
    expect(h.queriesStore.createQuery).not.toHaveBeenCalled()
    expect(h.queriesStore.applyStoreUpdate).toHaveBeenCalledTimes(1)
    const [id, patch] = h.queriesStore.applyStoreUpdate.mock
      .calls[0] as unknown as [string, Record<string, unknown>]
    expect(id).toBe('q-local')
    expect(patch).toMatchObject({
      src: source,
      description: 'desc',
      storeSha512: sha512Hex(source),
      storeVersion: '1.0.0',
    })
    expect(patch).not.toHaveProperty('name')
  })

  it('isQueryInstalled は storeId で照合する', () => {
    const store = useMisStoreStore()
    h.queriesStore.queries = [{ id: 'q1', storeId: 'ent-query' }]
    expect(store.isQueryInstalled(queryEntry())).toBe(true)
    h.queriesStore.queries = [{ id: 'ent-query' }]
    expect(store.isQueryInstalled(queryEntry())).toBe(false)
  })
})

describe('installPlugin', () => {
  const source = '/* plugin source */'
  const meta = {
    name: 'MyPlugin',
    version: '1.0.0',
    author: 'author',
    description: 'desc',
    permissions: [],
    config: { greet: { type: 'string', default: 'hi' } },
  }

  it('既存 (storeId 一致) は本体とストア由来メタを上書き更新して scope を追加する (#913)', async () => {
    const store = useMisStoreStore()
    h.pluginsStore.plugins = [{ installId: 'p1', storeId: 'ent-plugin' }]
    fetchMock.mockResolvedValue(okText(source))
    h.parsePluginMeta.mockReturnValue(meta)
    await store.installPlugin(pluginEntry({ sha512: sha512Hex(source) }), {
      kind: 'global',
    })
    expect(h.pluginsStore.applyStoreUpdate).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        src: source,
        version: '1.0.0',
        config: meta.config,
        storeSha512: sha512Hex(source),
        storeVersion: '1.0.0',
      }),
    )
    expect(h.pluginsStore.linkScope).toHaveBeenCalledWith('p1', {
      kind: 'global',
    })
    expect(h.pluginsStore.addPlugin).not.toHaveBeenCalled()
    expect(store.installing).toBeNull()
  })

  it('installs a new plugin with default configData and launches it (global scope)', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    h.parsePluginMeta.mockReturnValue(meta)
    await store.installPlugin(pluginEntry({ sha512: sha512Hex(source) }), {
      kind: 'global',
    })
    expect(h.pluginsStore.addPlugin).toHaveBeenCalledTimes(1)
    const added = h.pluginsStore.addPlugin.mock.calls[0]?.[0] as PluginMeta
    expect(added).toMatchObject({
      name: 'MyPlugin',
      src: source,
      active: true,
      storeId: 'ent-plugin',
      global: true,
      configData: { greet: 'hi' },
      storeSha512: sha512Hex(source),
      storeVersion: '1.0.0',
    })
    expect(added.installedFor).toBeUndefined()
    expect(h.launchPlugin).toHaveBeenCalledWith(added)
    expect(store.installing).toBeNull()
  })

  it('同名の自作プラグインがあってもストア経路のインストールは拒否しない (#913)', async () => {
    const store = useMisStoreStore()
    h.pluginsStore.plugins = [{ installId: 'p9', name: 'MyPlugin' }]
    fetchMock.mockResolvedValue(okText(source))
    h.parsePluginMeta.mockReturnValue(meta)
    await store.installPlugin(pluginEntry({ sha512: sha512Hex(source) }), {
      kind: 'global',
    })
    expect(h.pluginsStore.addPlugin).toHaveBeenCalledTimes(1)
  })

  it('installs into installedFor for an account scope', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    h.parsePluginMeta.mockReturnValue(meta)
    await store.installPlugin(pluginEntry({ sha512: sha512Hex(source) }), {
      kind: 'account',
      key: 'yami.ski:u1',
    })
    const added = h.pluginsStore.addPlugin.mock.calls[0]?.[0] as PluginMeta
    expect(added.installedFor).toEqual(['yami.ski:u1'])
    expect(added.global).toBeUndefined()
  })

  it('rejects when plugin metadata cannot be parsed', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    h.parsePluginMeta.mockReturnValue(null)
    await expect(
      store.installPlugin(pluginEntry({ sha512: sha512Hex(source) }), {
        kind: 'global',
      }),
    ).rejects.toThrow(/メタデータの解析に失敗/)
  })

  it('既存への追加インストールで権限が拡大するなら再同意を取る (#1040)', async () => {
    const store = useMisStoreStore()
    const newSrc = '/* v2 */'
    h.pluginsStore.plugins = [
      {
        installId: 'p1',
        storeId: 'ent-plugin',
        name: 'My Plugin',
        src: '/* v1 */',
        permissions: ['read:account'],
        storeSha512: 'old-sha',
      },
    ]
    h.parsePluginMeta.mockReturnValue({
      ...meta,
      permissions: ['read:account', 'write:notes'],
    })
    fetchMock.mockResolvedValue(okText(newSrc))
    await store.installPlugin(pluginEntry({ sha512: sha512Hex(newSrc) }), {
      kind: 'global',
    })
    const opts = h.confirm.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts.message).toContain('新しい権限: write:notes')
    expect(opts.type).toBe('warning')
    expect(h.pluginsStore.applyStoreUpdate).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        src: newSrc,
        permissions: ['read:account', 'write:notes'],
      }),
    )
  })

  it('権限拡大の再同意を断ったら本体・権限は据え置きで scope だけ足す', async () => {
    const store = useMisStoreStore()
    const newSrc = '/* v2 */'
    h.pluginsStore.plugins = [
      {
        installId: 'p1',
        storeId: 'ent-plugin',
        name: 'My Plugin',
        src: '/* v1 */',
        permissions: ['read:account'],
        storeSha512: 'old-sha',
      },
    ]
    h.parsePluginMeta.mockReturnValue({
      ...meta,
      permissions: ['read:account', 'write:notes'],
    })
    fetchMock.mockResolvedValue(okText(newSrc))
    h.confirm.mockResolvedValueOnce(false)
    await store.installPlugin(pluginEntry({ sha512: sha512Hex(newSrc) }), {
      kind: 'global',
    })
    expect(h.pluginsStore.applyStoreUpdate).not.toHaveBeenCalled()
    expect(h.pluginsStore.linkScope).toHaveBeenCalledWith('p1', {
      kind: 'global',
    })
  })

  it('ソースが変わっていなければ scope のリンクだけ行う (本体・権限を触らない)', async () => {
    const store = useMisStoreStore()
    h.pluginsStore.plugins = [
      {
        installId: 'p1',
        storeId: 'ent-plugin',
        name: 'My Plugin',
        src: source,
        permissions: ['read:account'],
        storeSha512: sha512Hex(source),
      },
    ]
    h.parsePluginMeta.mockReturnValue({
      ...meta,
      permissions: ['read:account', 'write:notes'],
    })
    fetchMock.mockResolvedValue(okText(source))
    await store.installPlugin(pluginEntry({ sha512: sha512Hex(source) }), {
      kind: 'account',
      key: 'yami.ski:u1',
    })
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.pluginsStore.applyStoreUpdate).not.toHaveBeenCalled()
    expect(h.pluginsStore.linkScope).toHaveBeenCalledWith('p1', {
      kind: 'account',
      key: 'yami.ski:u1',
    })
  })

  it('isInstalled は storeId のみで照合する (名前一致では真にならない #913)', () => {
    const store = useMisStoreStore()
    h.pluginsStore.plugins = [{ installId: 'p1', storeId: 'ent-plugin' }]
    expect(store.isInstalled(pluginEntry())).toBe(true)
    h.pluginsStore.plugins = [{ installId: 'p1', name: 'Test Plugin' }]
    expect(store.isInstalled(pluginEntry())).toBe(false)
  })
})

describe('installWidget', () => {
  it('既存 (storeId 一致) は early return せず本体とメタを上書き更新する (#913)', async () => {
    const store = useMisStoreStore()
    const source = '<: "widget v2"'
    const existing = { installId: 'w0', storeId: 'ent-widget' } as WidgetMeta
    const updated = { ...existing, src: source } as WidgetMeta
    h.widgetsStore.widgets = [existing]
    h.widgetsStore.applyStoreUpdate.mockReturnValue(updated)
    fetchMock.mockResolvedValue(okText(source))
    await expect(
      store.installWidget(widgetEntry({ sha512: sha512Hex(source) })),
    ).resolves.toBe(updated)
    expect(h.widgetsStore.applyStoreUpdate).toHaveBeenCalledWith(
      'w0',
      expect.objectContaining({
        src: source,
        storeSha512: sha512Hex(source),
        storeVersion: '1.0.0',
      }),
    )
    expect(h.widgetsStore.addWidget).not.toHaveBeenCalled()
    expect(store.installingWidget).toBeNull()
  })

  it('installs a new widget from the verified source', async () => {
    const store = useMisStoreStore()
    const source = '<: "widget"'
    fetchMock.mockResolvedValue(okText(source))
    const widget = await store.installWidget(
      widgetEntry({ sha512: sha512Hex(source) }),
    )
    expect(widget).toMatchObject({
      // 新規インストールのローカル ID = storeId (#913)
      installId: 'ent-widget',
      name: 'Test Widget',
      src: source,
      autoRun: true,
      storeId: 'ent-widget',
      storeSha512: sha512Hex(source),
      storeVersion: '1.0.0',
    })
    expect(h.widgetsStore.addWidget).toHaveBeenCalledWith(widget)
    expect(store.installingWidget).toBeNull()
  })

  it('isWidgetInstalled matches by storeId', () => {
    const store = useMisStoreStore()
    h.widgetsStore.widgets = [{ storeId: 'ent-widget' }]
    expect(store.isWidgetInstalled(widgetEntry())).toBe(true)
    expect(store.isWidgetInstalled(widgetEntry({ id: 'other' }))).toBe(false)
  })
})

describe('installTheme', () => {
  const source = "{ id: 'ent-theme', props: { accent: '#f00' } }"

  it('injects $notedeck (storeId / storeSha512) and unions installedFor with the existing install', async () => {
    const store = useMisStoreStore()
    h.themeStore.installedThemes = [
      {
        id: 'ent-theme',
        name: 'Test Theme',
        $notedeck: { storeId: 'ent-theme', installedFor: ['acc1'] },
      },
    ]
    fetchMock.mockResolvedValue(okText(source))
    await store.installTheme(themeEntry({ sha512: sha512Hex(source) }), [
      'acc2',
      'acc1',
    ])
    expect(h.themeStore.installTheme).toHaveBeenCalledTimes(1)
    const json = h.themeStore.installTheme.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(json)
    expect(parsed.id).toBe('ent-theme')
    expect(parsed.$notedeck).toEqual({
      storeId: 'ent-theme',
      storeSha512: sha512Hex(source),
      storeVersion: '1.0.0',
      installedFor: ['acc1', 'acc2'],
    })
    expect(store.installingTheme).toBeNull()
  })

  it('既存 (storeId 一致) は配布内 UUID が変わってもローカル ID と name を維持する (#913)', async () => {
    const store = useMisStoreStore()
    h.themeStore.installedThemes = [
      {
        id: 'custom-999',
        name: 'My Renamed',
        $notedeck: { storeId: 'ent-theme' },
      },
    ]
    const changed = "{ id: 'new-uuid', name: 'Distributed', props: { a: '1' } }"
    fetchMock.mockResolvedValue(okText(changed))
    await store.installTheme(themeEntry({ sha512: sha512Hex(changed) }))
    const json = h.themeStore.installTheme.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(json)
    expect(parsed.id).toBe('custom-999')
    expect(parsed.name).toBe('My Renamed')
    expect(parsed.$notedeck.storeId).toBe('ent-theme')
  })

  it('omits installedFor when no account context is given', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    await store.installTheme(themeEntry({ sha512: sha512Hex(source) }))
    const json = h.themeStore.installTheme.mock.calls[0]?.[0] as string
    expect(JSON.parse(json).$notedeck).toEqual({
      storeId: 'ent-theme',
      storeSha512: sha512Hex(source),
      storeVersion: '1.0.0',
    })
  })

  it('rejects when the theme store reports failure', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    h.themeStore.installTheme.mockResolvedValue(false)
    await expect(
      store.installTheme(themeEntry({ sha512: sha512Hex(source) })),
    ).rejects.toThrow(/テーマのインストールに失敗/)
    expect(store.installingTheme).toBeNull()
  })

  it('isThemeInstalled は $notedeck.storeId のみで照合する (内部 ID 一致では真にならない #913)', () => {
    const store = useMisStoreStore()
    h.themeStore.installedThemes = [
      { id: 'custom-123', $notedeck: { storeId: 'ent-theme' } },
    ]
    expect(store.isThemeInstalled(themeEntry())).toBe(true)
    h.themeStore.installedThemes = [{ id: 'ent-theme' }]
    expect(store.isThemeInstalled(themeEntry())).toBe(false)
    h.themeStore.installedThemes = [{ id: 'other' }]
    expect(store.isThemeInstalled(themeEntry())).toBe(false)
  })
})

describe('更新検知 (#1040)', () => {
  it('hasWidgetUpdate: 記録済み storeSha512 と registry sha512 の不一致で true', () => {
    const store = useMisStoreStore()
    const entry = widgetEntry({ sha512: 'sha-new' })
    h.widgetsStore.widgets = [
      { installId: 'w0', storeId: 'ent-widget', storeSha512: 'sha-old' },
    ]
    expect(store.hasWidgetUpdate(entry)).toBe(true)
    h.widgetsStore.widgets = [
      { installId: 'w0', storeId: 'ent-widget', storeSha512: 'sha-new' },
    ]
    expect(store.hasWidgetUpdate(entry)).toBe(false)
  })

  it('未インストール / storeSha512 未記録 (baseline 前) は false', () => {
    const store = useMisStoreStore()
    const entry = widgetEntry({ sha512: 'sha-new' })
    h.widgetsStore.widgets = []
    expect(store.hasWidgetUpdate(entry)).toBe(false)
    h.widgetsStore.widgets = [{ installId: 'w0', storeId: 'ent-widget' }]
    expect(store.hasWidgetUpdate(entry)).toBe(false)
  })

  it('version 文字列は判定に使わない (同一 version でも sha 不一致なら更新あり)', () => {
    const store = useMisStoreStore()
    const entry = widgetEntry({ sha512: 'sha-new', version: '1.0.0' })
    h.widgetsStore.widgets = [
      {
        installId: 'w0',
        storeId: 'ent-widget',
        storeSha512: 'sha-old',
        storeVersion: '1.0.0',
      },
    ]
    expect(store.hasWidgetUpdate(entry)).toBe(true)
  })

  it('hasSkillUpdate / hasPluginUpdate / hasQueryUpdate は storeId で照合する', () => {
    const store = useMisStoreStore()
    h.skillsStore.skills = [
      { id: 'local-1', storeId: 'ent-skill', storeSha512: 'sha-old' },
    ]
    expect(store.hasSkillUpdate(skillEntry({ sha512: 'sha-new' }))).toBe(true)
    expect(store.hasSkillUpdate(skillEntry({ sha512: 'sha-old' }))).toBe(false)

    h.pluginsStore.plugins = [
      { installId: 'p1', storeId: 'ent-plugin', storeSha512: 'sha-old' },
    ]
    expect(store.hasPluginUpdate(pluginEntry({ sha512: 'sha-new' }))).toBe(true)

    h.queriesStore.queries = [
      { id: 'q1', storeId: 'ent-query', storeSha512: 'sha-old' },
    ]
    expect(store.hasQueryUpdate(queryEntry({ sha512: 'sha-new' }))).toBe(true)
  })

  it('hasThemeUpdate は $notedeck.storeId / storeSha512 で照合する', () => {
    const store = useMisStoreStore()
    h.themeStore.installedThemes = [
      {
        id: 'custom-1',
        $notedeck: { storeId: 'ent-theme', storeSha512: 'sha-old' },
      },
    ]
    expect(store.hasThemeUpdate(themeEntry({ sha512: 'sha-new' }))).toBe(true)
    expect(store.hasThemeUpdate(themeEntry({ sha512: 'sha-old' }))).toBe(false)
    // baseline 前 (storeSha512 未記録) は false
    h.themeStore.installedThemes = [
      { id: 'custom-1', $notedeck: { storeId: 'ent-theme' } },
    ]
    expect(store.hasThemeUpdate(themeEntry({ sha512: 'sha-new' }))).toBe(false)
  })
})

describe('baseline 無通知記録 (#1040)', () => {
  it('fetchWidgets: storeSha512 未記録のインストール済みへ現行値を記録する', async () => {
    const store = useMisStoreStore()
    h.widgetsStore.widgets = [{ installId: 'w0', storeId: 'ent-widget' }]
    const entry = widgetEntry({ sha512: 'sha-now', version: '2.0.0' })
    fetchMock.mockResolvedValue(okJson({ widgets: [entry] }))
    await store.fetchWidgets()
    expect(h.widgetsStore.recordStoreBaseline).toHaveBeenCalledWith('w0', {
      storeSha512: 'sha-now',
      storeVersion: '2.0.0',
    })
  })

  it('記録済み storeSha512 があるものには触れない (更新検知を上書きしない)', async () => {
    const store = useMisStoreStore()
    h.widgetsStore.widgets = [
      { installId: 'w0', storeId: 'ent-widget', storeSha512: 'sha-old' },
    ]
    fetchMock.mockResolvedValue(
      okJson({ widgets: [widgetEntry({ sha512: 'sha-now' })] }),
    )
    await store.fetchWidgets()
    expect(h.widgetsStore.recordStoreBaseline).not.toHaveBeenCalled()
  })

  it('fetchSkills / fetchPlugins / fetchQueries も未記録分へ記録する', async () => {
    const store = useMisStoreStore()
    h.skillsStore.skills = [{ id: 'local-1', storeId: 'ent-skill' }]
    h.pluginsStore.plugins = [{ installId: 'p1', storeId: 'ent-plugin' }]
    h.queriesStore.queries = [{ id: 'q1', storeId: 'ent-query' }]
    fetchMock
      .mockResolvedValueOnce(
        okJson({ skills: [skillEntry({ sha512: 's-sha' })] }),
      )
      .mockResolvedValueOnce(
        okJson({ plugins: [pluginEntry({ sha512: 'p-sha' })] }),
      )
      .mockResolvedValueOnce(
        okJson({ queries: [queryEntry({ sha512: 'q-sha' })] }),
      )
    await store.fetchSkills()
    await store.fetchPlugins()
    await store.fetchQueries()
    expect(h.skillsStore.recordStoreBaseline).toHaveBeenCalledWith('local-1', {
      storeSha512: 's-sha',
      storeVersion: '1.0.0',
    })
    expect(h.pluginsStore.recordStoreBaseline).toHaveBeenCalledWith('p1', {
      storeSha512: 'p-sha',
      storeVersion: '1.0.0',
    })
    expect(h.queriesStore.recordStoreBaseline).toHaveBeenCalledWith('q1', {
      storeSha512: 'q-sha',
      storeVersion: '1.0.0',
    })
  })

  it('fetchThemes: $notedeck.storeSha512 未記録のテーマへ記録する', async () => {
    const store = useMisStoreStore()
    h.themeStore.installedThemes = [
      { id: 'custom-1', $notedeck: { storeId: 'ent-theme' } },
    ]
    fetchMock.mockResolvedValue(
      okJson({ themes: [themeEntry({ sha512: 't-sha' })] }),
    )
    await store.fetchThemes()
    expect(h.themeStore.recordStoreBaseline).toHaveBeenCalledWith('custom-1', {
      storeSha512: 't-sha',
      storeVersion: '1.0.0',
    })
  })

  it('インストールされていない registry エントリには何も記録しない', async () => {
    const store = useMisStoreStore()
    h.widgetsStore.widgets = [{ installId: 'w9', storeId: 'other-widget' }]
    fetchMock.mockResolvedValue(okJson({ widgets: [widgetEntry()] }))
    await store.fetchWidgets()
    expect(h.widgetsStore.recordStoreBaseline).not.toHaveBeenCalled()
  })
})

describe('ハッシュ不一致の 1 回リトライ (#1040)', () => {
  it('fetchWidgetSource: 不一致なら index を再取得して 1 回だけリトライする', async () => {
    const store = useMisStoreStore()
    const newSrc = '<: "widget v2"'
    // TTL 内の古い index (旧 sha) を持ったままストア側が更新されたケース
    const staleEntry = widgetEntry({ sha512: sha512Hex('old source') })
    const freshEntry = widgetEntry({
      sha512: sha512Hex(newSrc),
      version: '1.1.0',
    })
    fetchMock
      .mockResolvedValueOnce(okText(newSrc)) // ソース (旧 sha と不一致)
      .mockResolvedValueOnce(okJson({ widgets: [freshEntry] })) // index 再取得
      .mockResolvedValueOnce(okText(newSrc)) // ソース再取得 (新 sha と一致)
    await expect(store.fetchWidgetSource(staleEntry)).resolves.toBe(newSrc)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://store.notedeck.io/registry/widgets.json',
    )
  })

  it('再取得後も不一致なら従来どおり改ざん警告を出す (リトライは 1 回だけ)', async () => {
    const store = useMisStoreStore()
    const entry = widgetEntry({ sha512: sha512Hex('original') })
    fetchMock
      .mockResolvedValueOnce(okText('tampered'))
      .mockResolvedValueOnce(okJson({ widgets: [entry] }))
      .mockResolvedValueOnce(okText('tampered'))
    await expect(store.fetchWidgetSource(entry)).rejects.toThrow(
      /ハッシュ不一致/,
    )
    // ソース → index → ソースの 3 回で打ち止め (2 回目のリトライはしない)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('installWidget: リトライで得た新 entry の sha / version を記録する', async () => {
    const store = useMisStoreStore()
    const newSrc = '<: "widget v2"'
    const staleEntry = widgetEntry({ sha512: sha512Hex('old source') })
    const freshEntry = widgetEntry({
      sha512: sha512Hex(newSrc),
      version: '1.1.0',
    })
    fetchMock
      .mockResolvedValueOnce(okText(newSrc))
      .mockResolvedValueOnce(okJson({ widgets: [freshEntry] }))
      .mockResolvedValueOnce(okText(newSrc))
    const widget = await store.installWidget(staleEntry)
    expect(widget.storeSha512).toBe(sha512Hex(newSrc))
    expect(widget.storeVersion).toBe('1.1.0')
  })
})

describe('更新適用 (#1040)', () => {
  it('installWidget: 既存への再インストールも diff 確認を通す (#981)', async () => {
    const store = useMisStoreStore()
    const oldSrc = '<: "local edit"'
    const newSrc = '<: "widget v2"'
    h.widgetsStore.widgets = [
      {
        installId: 'w0',
        storeId: 'ent-widget',
        name: 'My Widget',
        src: oldSrc,
      },
    ]
    h.widgetsStore.applyStoreUpdate.mockReturnValue({
      installId: 'w0',
      src: newSrc,
    })
    fetchMock.mockResolvedValue(okText(newSrc))
    await store.installWidget(widgetEntry({ sha512: sha512Hex(newSrc) }))
    const opts = h.confirm.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts.diff).toEqual({
      old: oldSrc,
      new: newSrc,
      language: 'aiscript',
    })
  })

  it('installWidget: 確認をキャンセルしたらローカルの src を書き換えない (#981)', async () => {
    const store = useMisStoreStore()
    h.confirm.mockResolvedValueOnce(false)
    const existing = {
      installId: 'w0',
      storeId: 'ent-widget',
      src: '<: "local edit"',
    } as WidgetMeta
    h.widgetsStore.widgets = [existing]
    const newSrc = '<: "widget v2"'
    fetchMock.mockResolvedValue(okText(newSrc))
    await expect(
      store.installWidget(widgetEntry({ sha512: sha512Hex(newSrc) })),
    ).resolves.toBe(existing)
    expect(h.widgetsStore.applyStoreUpdate).not.toHaveBeenCalled()
  })

  it('installSkill: 既存への再インストールも diff 確認を通す (#981)', async () => {
    const store = useMisStoreStore()
    const body = '# v2\n\n新しい本文'
    const source = `---\nname: Test Skill\n---\n${body}`
    h.skillsStore.skills = [
      { id: 'sk0', storeId: 'ent-skill', name: 'Test Skill', body: '# v1' },
    ]
    fetchMock.mockResolvedValue(okText(source))
    await store.installSkill(skillEntry({ sha512: sha512Hex(source) }))
    const opts = h.confirm.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts.diff).toEqual({
      old: '# v1',
      new: body,
      language: 'markdown',
    })
    expect(h.skillsStore.update).toHaveBeenCalled()
  })

  it('installSkill: 確認をキャンセルしたら本文を書き換えない (#981)', async () => {
    const store = useMisStoreStore()
    h.confirm.mockResolvedValueOnce(false)
    h.skillsStore.skills = [
      { id: 'sk0', storeId: 'ent-skill', name: 'Test Skill', body: '# v1' },
    ]
    const source = '---\nname: Test Skill\n---\n# v2'
    fetchMock.mockResolvedValue(okText(source))
    await store.installSkill(skillEntry({ sha512: sha512Hex(source) }))
    expect(h.skillsStore.update).not.toHaveBeenCalled()
  })

  it('installTheme: 見た目が変わらない再インストール (installedFor 追加だけ) は確認しない (#981)', async () => {
    const store = useMisStoreStore()
    const source = "{ id: 'ent-theme', name: 'T', props: { accent: '#f00' } }"
    h.themeStore.installedThemes = [
      {
        id: 'ent-theme',
        name: 'T',
        props: { accent: '#f00' },
        $notedeck: { storeId: 'ent-theme', installedFor: ['acc1'] },
      },
    ]
    fetchMock.mockResolvedValue(okText(source))
    await store.installTheme(themeEntry({ sha512: sha512Hex(source) }), [
      'acc2',
    ])
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.themeStore.installTheme).toHaveBeenCalledTimes(1)
  })

  it('installTheme: props が変わる再インストールは diff 確認を通す (#981)', async () => {
    const store = useMisStoreStore()
    const source = "{ id: 'ent-theme', name: 'T', props: { accent: '#0f0' } }"
    h.themeStore.installedThemes = [
      {
        id: 'ent-theme',
        name: 'T',
        props: { accent: '#f00' },
        $notedeck: { storeId: 'ent-theme' },
      },
    ]
    fetchMock.mockResolvedValue(okText(source))
    await store.installTheme(themeEntry({ sha512: sha512Hex(source) }))
    const opts = h.confirm.mock.calls[0]?.[0] as Record<string, unknown>
    const diff = opts.diff as { old: string; new: string }
    expect(diff.old).toContain('"accent": "#f00"')
    expect(diff.new).toContain('"accent": "#0f0"')
  })

  it('updateWidget: diff 付き確認 → 承認で確認に使ったソースをそのまま適用する', async () => {
    const store = useMisStoreStore()
    const oldSrc = '<: "widget v1"'
    const newSrc = '<: "widget v2"'
    h.widgetsStore.widgets = [
      {
        installId: 'w0',
        storeId: 'ent-widget',
        name: 'My Widget',
        src: oldSrc,
        storeSha512: sha512Hex(oldSrc),
      },
    ]
    fetchMock.mockResolvedValue(okText(newSrc))
    const entry = widgetEntry({ sha512: sha512Hex(newSrc), version: '2.0.0' })
    await expect(store.updateWidget(entry)).resolves.toBe(true)
    expect(h.confirm).toHaveBeenCalledTimes(1)
    const opts = h.confirm.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts.diff).toEqual({
      old: oldSrc,
      new: newSrc,
      language: 'aiscript',
    })
    expect(h.widgetsStore.applyStoreUpdate).toHaveBeenCalledWith(
      'w0',
      expect.objectContaining({
        src: newSrc,
        storeSha512: sha512Hex(newSrc),
        storeVersion: '2.0.0',
      }),
    )
    // 承認後の再 fetch なし: ソース取得は確認前の 1 回だけ (#981 不変条件)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(store.installingWidget).toBeNull()
  })

  it('updateWidget: キャンセルで適用しない', async () => {
    const store = useMisStoreStore()
    const newSrc = '<: "v2"'
    h.widgetsStore.widgets = [
      { installId: 'w0', storeId: 'ent-widget', src: 'old', storeSha512: 'x' },
    ]
    fetchMock.mockResolvedValue(okText(newSrc))
    h.confirm.mockResolvedValue(false)
    await expect(
      store.updateWidget(widgetEntry({ sha512: sha512Hex(newSrc) })),
    ).resolves.toBe(false)
    expect(h.widgetsStore.applyStoreUpdate).not.toHaveBeenCalled()
  })

  it('updateWidget: 未インストールなら fetch せず false', async () => {
    const store = useMisStoreStore()
    h.widgetsStore.widgets = []
    await expect(store.updateWidget(widgetEntry())).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('updatePlugin: permissions が拡大する更新は新規権限を明示する', async () => {
    const store = useMisStoreStore()
    const newSrc = '/* v2 */'
    h.pluginsStore.plugins = [
      {
        installId: 'p1',
        storeId: 'ent-plugin',
        name: 'My Plugin',
        src: '/* v1 */',
        permissions: ['read:account'],
        storeSha512: 'old-sha',
      },
    ]
    h.parsePluginMeta.mockReturnValue({
      name: 'My Plugin',
      version: '2.0.0',
      permissions: ['read:account', 'write:notes'],
    })
    fetchMock.mockResolvedValue(okText(newSrc))
    await expect(
      store.updatePlugin(pluginEntry({ sha512: sha512Hex(newSrc) })),
    ).resolves.toBe(true)
    const opts = h.confirm.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts.message).toContain('新しい権限: write:notes')
    expect(opts.type).toBe('warning')
    expect(opts.diff).toMatchObject({ new: newSrc, language: 'aiscript' })
    expect(h.pluginsStore.applyStoreUpdate).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        src: newSrc,
        permissions: ['read:account', 'write:notes'],
        storeSha512: sha512Hex(newSrc),
      }),
    )
    // 更新はスコープに触れない (linkScope を呼ばない)
    expect(h.pluginsStore.linkScope).not.toHaveBeenCalled()
  })

  it('updatePlugin: permissions が拡大しなければ警告文を出さない', async () => {
    const store = useMisStoreStore()
    const newSrc = '/* v2 */'
    h.pluginsStore.plugins = [
      {
        installId: 'p1',
        storeId: 'ent-plugin',
        name: 'My Plugin',
        src: '/* v1 */',
        permissions: ['read:account'],
        storeSha512: 'old-sha',
      },
    ]
    h.parsePluginMeta.mockReturnValue({
      name: 'My Plugin',
      version: '2.0.0',
      permissions: ['read:account'],
    })
    fetchMock.mockResolvedValue(okText(newSrc))
    await store.updatePlugin(pluginEntry({ sha512: sha512Hex(newSrc) }))
    const opts = h.confirm.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts.message).not.toContain('新しい権限')
    expect(opts.type).toBeUndefined()
  })

  it('updateSkill: 本文 (body) 同士の markdown diff で確認し、承認でそのまま適用する', async () => {
    const store = useMisStoreStore()
    const newSource = '---\nname: Greeter\nversion: 2.0.0\n---\nNew body'
    h.skillsStore.skills = [
      {
        id: 'local-1',
        storeId: 'ent-skill',
        name: 'My Renamed',
        body: 'Old body',
        storeSha512: 'old-sha',
      },
    ]
    fetchMock.mockResolvedValue(okText(newSource))
    await expect(
      store.updateSkill(skillEntry({ sha512: sha512Hex(newSource) })),
    ).resolves.toBe(true)
    const opts = h.confirm.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts.diff).toEqual({
      old: 'Old body',
      new: 'New body',
      language: 'markdown',
    })
    expect(h.skillsStore.update).toHaveBeenCalledWith(
      'local-1',
      expect.objectContaining({
        body: 'New body',
        storeSha512: sha512Hex(newSource),
      }),
    )
    // ローカル値は維持 (installSkill の上書き更新と同じ境界)
    const patch = h.skillsStore.update.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >
    expect(patch).not.toHaveProperty('name')
    expect(patch).not.toHaveProperty('mode')
  })

  it('updateQuery: src の diff 確認 → applyStoreUpdate に確認したソースを渡す', async () => {
    const store = useMisStoreStore()
    const newSrc = 'note.text == null'
    h.queriesStore.queries = [
      {
        id: 'q-local',
        storeId: 'ent-query',
        name: 'My Query',
        src: 'note.text != null',
        storeSha512: 'old-sha',
      },
    ]
    fetchMock.mockResolvedValue(okText(newSrc))
    await expect(
      store.updateQuery(queryEntry({ sha512: sha512Hex(newSrc) })),
    ).resolves.toBe(true)
    const opts = h.confirm.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts.diff).toEqual({
      old: 'note.text != null',
      new: newSrc,
      language: 'aiscript',
    })
    expect(h.queriesStore.applyStoreUpdate).toHaveBeenCalledWith(
      'q-local',
      expect.objectContaining({
        src: newSrc,
        storeSha512: sha512Hex(newSrc),
      }),
    )
  })

  it('updateTheme: json5 diff で確認し、確認に使った全文をそのまま installTheme に渡す', async () => {
    const store = useMisStoreStore()
    const source = "{ id: 'new-uuid', props: { accent: '#0f0' } }"
    h.themeStore.installedThemes = [
      {
        id: 'custom-1',
        name: 'My Theme',
        base: 'dark',
        props: { accent: '#f00' },
        $notedeck: { storeId: 'ent-theme', storeSha512: 'old-sha' },
      },
    ]
    fetchMock.mockResolvedValue(okText(source))
    await expect(
      store.updateTheme(themeEntry({ sha512: sha512Hex(source) }), ['acc1']),
    ).resolves.toBe(true)
    const opts = h.confirm.mock.calls[0]?.[0] as {
      diff: { old: string; new: string; language: string }
    }
    expect(opts.diff.language).toBe('json5')
    expect(opts.diff.old).toContain('#f00')
    // ローカル ID / 改名は維持される (#913 と同じ境界)
    const applied = JSON.parse(opts.diff.new)
    expect(applied.id).toBe('custom-1')
    expect(applied.name).toBe('My Theme')
    expect(applied.$notedeck.storeSha512).toBe(sha512Hex(source))
    expect(applied.$notedeck.installedFor).toEqual(['acc1'])
    // 不変条件: 確認に使った全文 = 書き込む全文
    expect(h.themeStore.installTheme).toHaveBeenCalledWith(opts.diff.new)
  })

  it('更新も sha 不一致なら index 再取得の 1 回リトライを経て新 entry を適用する', async () => {
    const store = useMisStoreStore()
    const newSrc = 'note.userId != null'
    h.queriesStore.queries = [
      {
        id: 'q-local',
        storeId: 'ent-query',
        src: 'old',
        storeSha512: 'old-sha',
      },
    ]
    const staleEntry = queryEntry({ sha512: sha512Hex('stale') })
    const freshEntry = queryEntry({
      sha512: sha512Hex(newSrc),
      version: '3.0.0',
    })
    fetchMock
      .mockResolvedValueOnce(okText(newSrc))
      .mockResolvedValueOnce(okJson({ queries: [freshEntry] }))
      .mockResolvedValueOnce(okText(newSrc))
    await expect(store.updateQuery(staleEntry)).resolves.toBe(true)
    expect(h.queriesStore.applyStoreUpdate).toHaveBeenCalledWith(
      'q-local',
      expect.objectContaining({ src: newSrc, storeVersion: '3.0.0' }),
    )
  })
})

describe('helpers', () => {
  it('detail URLs encode the id', () => {
    expect(getPluginDetailUrl('a b/c')).toBe(
      'https://store.notedeck.io/plugins/a%20b%2Fc',
    )
  })

  it('skillCategoryLabel falls back to the raw category for unknown values', () => {
    expect(skillCategoryLabel('persona')).toBe('Persona')
    expect(skillCategoryLabel('my-custom')).toBe('my-custom')
  })
})
