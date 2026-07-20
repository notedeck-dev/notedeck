import { createHash } from 'node:crypto'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginMeta } from '@/stores/plugins'
import type { SkillMeta } from '@/stores/skills'
import type { WidgetMeta } from '@/stores/widgets'

const h = vi.hoisted(() => ({
  skillsStore: {
    skills: [] as unknown[],
    get: vi.fn(),
    add: vi.fn(),
    update: vi.fn(),
  },
  pluginsStore: {
    plugins: [] as unknown[],
    linkScope: vi.fn(),
    isDuplicate: vi.fn(() => false),
    addPlugin: vi.fn(),
  },
  widgetsStore: {
    widgets: [] as unknown[],
    addWidget: vi.fn(),
  },
  themeStore: {
    installedThemes: [] as unknown[],
    installTheme: vi.fn(async (_json: string) => true),
  },
  launchPlugin: vi.fn(async () => undefined),
  parsePluginMeta: vi.fn(),
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
vi.mock('@/stores/theme', () => ({
  useThemeStore: () => h.themeStore,
}))

import {
  getPluginDetailUrl,
  type StorePluginEntry,
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

const fetchMock = vi.fn()

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  h.skillsStore.skills = []
  h.skillsStore.get.mockReturnValue(undefined)
  h.pluginsStore.plugins = []
  h.pluginsStore.isDuplicate.mockReturnValue(false)
  h.widgetsStore.widgets = []
  h.themeStore.installedThemes = []
  h.themeStore.installTheme.mockResolvedValue(true)
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
    })
    expect(store.installingSkill).toBeNull()
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

  it('updates an existing skill and preserves createdAt', async () => {
    const store = useMisStoreStore()
    h.skillsStore.get.mockReturnValue({ createdAt: 111 })
    fetchMock.mockResolvedValue(okText(source))
    await store.installSkill(skillEntry({ sha512: sha512Hex(source) }))
    expect(h.skillsStore.add).not.toHaveBeenCalled()
    expect(h.skillsStore.update).toHaveBeenCalledWith(
      'ent-skill',
      expect.objectContaining({ createdAt: 111 }),
    )
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

  it('isSkillInstalled matches by storeId or id', () => {
    const store = useMisStoreStore()
    h.skillsStore.skills = [{ id: 'local-id', storeId: 'ent-skill' }]
    expect(store.isSkillInstalled(skillEntry())).toBe(true)
    h.skillsStore.skills = [{ id: 'ent-skill' }]
    expect(store.isSkillInstalled(skillEntry())).toBe(true)
    h.skillsStore.skills = [{ id: 'other' }]
    expect(store.isSkillInstalled(skillEntry())).toBe(false)
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

  it('only links the scope when the same storeId is already installed', async () => {
    const store = useMisStoreStore()
    h.pluginsStore.plugins = [{ installId: 'p1', storeId: 'ent-plugin' }]
    await store.installPlugin(pluginEntry(), { kind: 'global' })
    expect(h.pluginsStore.linkScope).toHaveBeenCalledWith('p1', {
      kind: 'global',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.pluginsStore.addPlugin).not.toHaveBeenCalled()
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
    })
    expect(added.installedFor).toBeUndefined()
    expect(h.launchPlugin).toHaveBeenCalledWith(added)
    expect(store.installing).toBeNull()
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

  it('rejects when the plugin name is already installed', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    h.parsePluginMeta.mockReturnValue(meta)
    h.pluginsStore.isDuplicate.mockReturnValue(true)
    await expect(
      store.installPlugin(pluginEntry({ sha512: sha512Hex(source) }), {
        kind: 'global',
      }),
    ).rejects.toThrow(/既にインストールされています/)
    expect(store.installing).toBeNull()
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

  it('isInstalled matches by plugin name', () => {
    const store = useMisStoreStore()
    h.pluginsStore.plugins = [{ name: 'Test Plugin' }]
    expect(store.isInstalled(pluginEntry())).toBe(true)
    expect(store.isInstalled(pluginEntry({ name: 'Other' }))).toBe(false)
  })
})

describe('installWidget', () => {
  it('returns the existing widget without refetching', async () => {
    const store = useMisStoreStore()
    const existing = { installId: 'w0', storeId: 'ent-widget' } as WidgetMeta
    h.widgetsStore.widgets = [existing]
    await expect(store.installWidget(widgetEntry())).resolves.toBe(existing)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.widgetsStore.addWidget).not.toHaveBeenCalled()
  })

  it('installs a new widget from the verified source', async () => {
    const store = useMisStoreStore()
    const source = '<: "widget"'
    fetchMock.mockResolvedValue(okText(source))
    const widget = await store.installWidget(
      widgetEntry({ sha512: sha512Hex(source) }),
    )
    expect(widget).toMatchObject({
      installId: 'w-test-1',
      name: 'Test Widget',
      src: source,
      autoRun: true,
      storeId: 'ent-widget',
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

  it('injects $notedeck.storeId and unions installedFor with the existing install', async () => {
    const store = useMisStoreStore()
    h.themeStore.installedThemes = [
      { id: 'ent-theme', $notedeck: { installedFor: ['acc1'] } },
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
      installedFor: ['acc1', 'acc2'],
    })
    expect(store.installingTheme).toBeNull()
  })

  it('omits installedFor when no account context is given', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    await store.installTheme(themeEntry({ sha512: sha512Hex(source) }))
    const json = h.themeStore.installTheme.mock.calls[0]?.[0] as string
    expect(JSON.parse(json).$notedeck).toEqual({ storeId: 'ent-theme' })
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

  it('isThemeInstalled matches by id or $notedeck.storeId', () => {
    const store = useMisStoreStore()
    h.themeStore.installedThemes = [{ id: 'ent-theme' }]
    expect(store.isThemeInstalled(themeEntry())).toBe(true)
    h.themeStore.installedThemes = [
      { id: 'custom-123', $notedeck: { storeId: 'ent-theme' } },
    ]
    expect(store.isThemeInstalled(themeEntry())).toBe(true)
    h.themeStore.installedThemes = [{ id: 'other' }]
    expect(store.isThemeInstalled(themeEntry())).toBe(false)
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
