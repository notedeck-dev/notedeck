import { createHash } from 'node:crypto'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginItem } from '@/stores/plugins'
import type { SkillItem } from '@/stores/skills'
import type { ThemeItem } from '@/stores/theme'
import type { WidgetItem } from '@/stores/widgets'

const h = vi.hoisted(() => ({
  skillsStore: {
    items: [] as unknown[],
    ensureLoaded: vi.fn(),
    add: vi.fn(async (input: Record<string, unknown>) => ({
      ...input,
      createdAt: 0,
      updatedAt: 0,
    })),
    applyStoreUpdate: vi.fn(async () => true),
    recordStoreBaseline: vi.fn(async () => undefined),
  },
  pluginsStore: {
    items: [] as unknown[],
    ensureLoaded: vi.fn(),
    link: vi.fn(async () => true),
    add: vi.fn(async (input: Record<string, unknown>) => ({
      ...input,
      id: input.id ?? 'p-test-1',
      createdAt: 0,
      updatedAt: 0,
    })),
    applyStoreUpdate: vi.fn(async () => true),
    recordStoreBaseline: vi.fn(async () => undefined),
  },
  widgetsStore: {
    items: [] as unknown[],
    ensureLoaded: vi.fn(),
    get: vi.fn((id: string) =>
      (h.widgetsStore.items as { id?: string }[]).find((w) => w.id === id),
    ),
    add: vi.fn(async (input: Record<string, unknown>) => ({
      ...input,
      id: input.id ?? 'w-test-1',
      createdAt: 0,
      updatedAt: 0,
    })),
    link: vi.fn(async () => true),
    applyStoreUpdate: vi.fn(async () => true),
    recordStoreBaseline: vi.fn(async () => undefined),
  },
  queriesStore: {
    items: [] as unknown[],
    ensureLoaded: vi.fn(),
    link: vi.fn(async () => true),
    add: vi.fn(async () => undefined),
    applyStoreUpdate: vi.fn(async () => true),
    recordStoreBaseline: vi.fn(async () => undefined),
  },
  themeStore: {
    items: [] as unknown[],
    ensureLoaded: vi.fn(),
    add: vi.fn(async (input: Record<string, unknown>) => ({
      ...input,
      createdAt: 0,
      updatedAt: 0,
    })),
    applyStoreUpdate: vi.fn(async () => true),
    link: vi.fn(async () => true),
    recordStoreBaseline: vi.fn(async () => undefined),
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
  h.skillsStore.items = []
  h.pluginsStore.items = []
  h.widgetsStore.items = []
  h.queriesStore.items = []
  h.themeStore.items = []
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
      /ハッシュが一致しません/,
    )
  })
})

/** 既存の skill (既定: ストア 'ent-skill' 由来) */
function existingSkill(over: Partial<SkillItem>): SkillItem {
  return {
    id: 'local-1',
    name: 'My Skill',
    store: { id: 'ent-skill' },
    scope: { kind: 'none' },
    content: '',
    extra: {
      version: '1',
      mode: 'manual',
      triggers: [],
      builtIn: false,
      cheapCheckCapabilities: [],
      isPersona: false,
    },
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

describe('installSkill', () => {
  const source =
    '---\nname: Greeter\nmode: always\ntriggers: [hi, hello]\n---\nGreet the user'

  it('adds a new skill built from frontmatter + entry fallback', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    await store.installSkill(skillEntry({ sha512: sha512Hex(source) }))
    expect(h.skillsStore.add).toHaveBeenCalledTimes(1)
    const added = h.skillsStore.add.mock.calls[0]?.[0] as unknown as SkillItem
    expect(added).toMatchObject({
      id: 'ent-skill',
      name: 'Greeter',
      content: 'Greet the user',
      store: { id: 'ent-skill', sha512: sha512Hex(source), version: '1.0.0' },
      scope: { kind: 'none' },
      extra: { mode: 'always', triggers: ['hi', 'hello'], builtIn: false },
    })
    expect(store.installingSkill).toBeNull()
  })

  it('新規は frontmatter の id 宣言より storeId を正としてローカル ID にする (#913)', async () => {
    const store = useMisStoreStore()
    const declared = '---\nid: distributed-own-id\nname: Greeter\n---\nbody'
    fetchMock.mockResolvedValue(okText(declared))
    await store.installSkill(skillEntry({ sha512: sha512Hex(declared) }))
    const added = h.skillsStore.add.mock.calls[0]?.[0] as unknown as SkillItem
    expect(added.id).toBe('ent-skill')
    expect(added.store?.id).toBe('ent-skill')
  })

  it('storeId 不一致の既存 ID が storeId を占有していたら suffix で回避する (#913)', async () => {
    const store = useMisStoreStore()
    h.skillsStore.items = [
      existingSkill({ id: 'ent-skill', name: '自作', store: undefined }),
    ]
    fetchMock.mockResolvedValue(okText(source))
    await store.installSkill(skillEntry({ sha512: sha512Hex(source) }))
    expect(h.skillsStore.applyStoreUpdate).not.toHaveBeenCalled()
    const added = h.skillsStore.add.mock.calls[0]?.[0] as unknown as SkillItem
    expect(added.id).toBe('ent-skill-2')
    expect(added.store?.id).toBe('ent-skill')
  })

  it('falls back to mode=manual and entry metadata when frontmatter is absent', async () => {
    const store = useMisStoreStore()
    const bare = 'just a body'
    fetchMock.mockResolvedValue(okText(bare))
    await store.installSkill(skillEntry({ sha512: sha512Hex(bare) }))
    const added = h.skillsStore.add.mock.calls[0]?.[0] as unknown as SkillItem
    expect(added.name).toBe('Test Skill')
    expect(added.extra.mode).toBe('manual')
    expect(added.content).toBe(bare)
  })

  it('既存は storeId で照合しローカル ID・name・mode を維持して上書き更新する (#913)', async () => {
    const store = useMisStoreStore()
    h.skillsStore.items = [
      existingSkill({
        id: 'local-1',
        name: 'My Renamed',
        extra: { ...existingSkill({}).extra, mode: 'heartbeat' },
      }),
    ]
    fetchMock.mockResolvedValue(okText(source))
    await store.installSkill(skillEntry({ sha512: sha512Hex(source) }))
    expect(h.skillsStore.add).not.toHaveBeenCalled()
    expect(h.skillsStore.applyStoreUpdate).toHaveBeenCalledTimes(1)
    const [id, patch] = h.skillsStore.applyStoreUpdate.mock
      .calls[0] as unknown as [string, Record<string, unknown>]
    expect(id).toBe('local-1')
    expect(patch).toMatchObject({
      content: 'Greet the user',
      triggers: ['hi', 'hello'],
      store: { id: 'ent-skill', sha512: sha512Hex(source), version: '1.0.0' },
    })
    // ローカル値 (改名・実行モード・ID) は配布ソースの patch に含めない
    expect(patch).not.toHaveProperty('name')
    expect(patch).not.toHaveProperty('mode')
    expect(patch).not.toHaveProperty('id')
  })

  it('keeps mode: heartbeat instead of falling back to manual (#967)', async () => {
    const store = useMisStoreStore()
    const hb = '---\nname: Pulse\nmode: heartbeat\n---\nreport'
    fetchMock.mockResolvedValue(okText(hb))
    await store.installSkill(skillEntry({ sha512: sha512Hex(hb) }))
    const added = h.skillsStore.add.mock.calls[0]?.[0] as unknown as SkillItem
    expect(added.extra.mode).toBe('heartbeat')
  })

  it('takes isPersona from frontmatter (#967)', async () => {
    const store = useMisStoreStore()
    const persona = '---\nname: Aizu\nisPersona: true\n---\npersona body'
    fetchMock.mockResolvedValue(okText(persona))
    await store.installSkill(skillEntry({ sha512: sha512Hex(persona) }))
    const added = h.skillsStore.add.mock.calls[0]?.[0] as unknown as SkillItem
    expect(added.extra.isPersona).toBe(true)
  })

  it('defaults isPersona to false when frontmatter omits it (#967)', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    await store.installSkill(skillEntry({ sha512: sha512Hex(source) }))
    const added = h.skillsStore.add.mock.calls[0]?.[0] as unknown as SkillItem
    expect(added.extra.isPersona).toBe(false)
  })

  it('rejects on hash mismatch and resets installingSkill', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    await expect(
      store.installSkill(skillEntry({ sha512: 'deadbeef' })),
    ).rejects.toThrow(/ハッシュが一致しません/)
    expect(h.skillsStore.add).not.toHaveBeenCalled()
    expect(store.installingSkill).toBeNull()
  })

  it('isSkillInstalled は storeId のみで照合する (内部 ID 一致では真にならない #913)', () => {
    const store = useMisStoreStore()
    h.skillsStore.items = [existingSkill({ id: 'local-id' })]
    expect(store.isSkillInstalled(skillEntry())).toBe(true)
    h.skillsStore.items = [existingSkill({ id: 'ent-skill', store: undefined })]
    expect(store.isSkillInstalled(skillEntry())).toBe(false)
    h.skillsStore.items = [existingSkill({ id: 'other', store: undefined })]
    expect(store.isSkillInstalled(skillEntry())).toBe(false)
  })
})

describe('installQuery', () => {
  const source = 'note.text != null'

  it('新規は add にストア由来 3 点 (id / sha512 / version) を渡す (#913)', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    await store.installQuery(queryEntry({ sha512: sha512Hex(source) }))
    expect(h.queriesStore.add).toHaveBeenCalledTimes(1)
    expect(h.queriesStore.add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Query',
        description: 'desc',
        content: source,
        store: { id: 'ent-query', sha512: sha512Hex(source), version: '1.0.0' },
      }),
    )
    expect(store.installingQuery).toBeNull()
  })

  it('既存 (storeId 一致) は applyStoreUpdate で更新し name を渡さない (#913)', async () => {
    const store = useMisStoreStore()
    h.queriesStore.items = [
      { id: 'q-local', store: { id: 'ent-query' }, name: 'My Renamed' },
    ]
    fetchMock.mockResolvedValue(okText(source))
    await store.installQuery(queryEntry({ sha512: sha512Hex(source) }))
    expect(h.queriesStore.add).not.toHaveBeenCalled()
    expect(h.queriesStore.applyStoreUpdate).toHaveBeenCalledTimes(1)
    const [id, patch] = h.queriesStore.applyStoreUpdate.mock
      .calls[0] as unknown as [string, Record<string, unknown>]
    expect(id).toBe('q-local')
    expect(patch).toMatchObject({
      content: source,
      description: 'desc',
      store: { id: 'ent-query', sha512: sha512Hex(source), version: '1.0.0' },
    })
    expect(patch).not.toHaveProperty('name')
  })

  it('installedIn は storeId で照合する', () => {
    const store = useMisStoreStore()
    h.queriesStore.items = [{ id: 'q1', store: { id: 'ent-query' } }]
    expect(store.installedIn('query', queryEntry())).toBe(true)
    h.queriesStore.items = [{ id: 'ent-query' }]
    expect(store.installedIn('query', queryEntry())).toBe(false)
  })

  it('installedIn: スコープ指定はそのスコープに参加している個体だけを済みとみなす (プラグインと同じ粒度)', () => {
    const store = useMisStoreStore()
    h.queriesStore.items = [
      {
        id: 'q1',
        store: { id: 'ent-query' },
        scope: { kind: 'shared', global: false, installedFor: ['yami.ski:u1'] },
      },
    ]
    expect(
      store.installedIn('query', queryEntry(), {
        kind: 'account',
        key: 'yami.ski:u1',
      }),
    ).toBe(true)
    expect(
      store.installedIn('query', queryEntry(), {
        kind: 'account',
        key: 'cloud.example:u2',
      }),
    ).toBe(false)
    expect(store.installedIn('query', queryEntry(), { kind: 'global' })).toBe(
      false,
    )
    h.queriesStore.items = [
      {
        id: 'q1',
        store: { id: 'ent-query' },
        scope: { kind: 'shared', global: true, installedFor: [] },
      },
    ]
    expect(store.installedIn('query', queryEntry(), { kind: 'global' })).toBe(
      true,
    )
  })

  it('既存 (storeId 一致) に別スコープからインストールすると、そのスコープへ参加させる (プラグインと同型)', async () => {
    const store = useMisStoreStore()
    h.queriesStore.items = [
      {
        id: 'q-local',
        store: { id: 'ent-query' },
        content: source,
        scope: { kind: 'shared', global: true, installedFor: [] },
      },
    ]
    fetchMock.mockResolvedValue(okText(source))
    await store.installQuery(queryEntry({ sha512: sha512Hex(source) }), {
      kind: 'account',
      key: 'yami.ski:u1',
    })
    expect(h.queriesStore.add).not.toHaveBeenCalled()
    expect(h.queriesStore.link).toHaveBeenCalledWith('q-local', {
      kind: 'account',
      key: 'yami.ski:u1',
    })
  })
})

/** 既存の個体 (既定: ストア 'ent-plugin' 由来、id 'p1') */
function existingPlugin(over: Partial<PluginItem>): PluginItem {
  return {
    id: 'p1',
    name: 'My Plugin',
    store: { id: 'ent-plugin' },
    scope: { kind: 'shared', global: true, installedFor: [] },
    content: '',
    extra: { version: '1', configData: {}, active: true },
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

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
    h.pluginsStore.items = [existingPlugin({})]
    fetchMock.mockResolvedValue(okText(source))
    h.parsePluginMeta.mockReturnValue(meta)
    await store.installPlugin(pluginEntry({ sha512: sha512Hex(source) }), {
      kind: 'global',
    })
    expect(h.pluginsStore.applyStoreUpdate).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        content: source,
        version: '1.0.0',
        config: meta.config,
        store: {
          id: 'ent-plugin',
          sha512: sha512Hex(source),
          version: '1.0.0',
        },
      }),
    )
    expect(h.pluginsStore.link).toHaveBeenCalledWith('p1', {
      kind: 'global',
    })
    expect(h.pluginsStore.add).not.toHaveBeenCalled()
    expect(store.installing).toBeNull()
  })

  it('新規は既定の設定値で全体スコープに追加する (起動は plugins store の add が行う)', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    h.parsePluginMeta.mockReturnValue(meta)
    await store.installPlugin(pluginEntry({ sha512: sha512Hex(source) }), {
      kind: 'global',
    })
    expect(h.pluginsStore.add).toHaveBeenCalledTimes(1)
    const added = h.pluginsStore.add.mock.calls[0]?.[0] as unknown as PluginItem
    expect(added).toMatchObject({
      // ローカル ID = storeId (#913)
      id: 'ent-plugin',
      name: 'MyPlugin',
      content: source,
      store: { id: 'ent-plugin', sha512: sha512Hex(source), version: '1.0.0' },
      scope: { kind: 'shared', global: true, installedFor: [] },
      extra: { active: true, configData: { greet: 'hi' } },
    })
    expect(h.launchPlugin).not.toHaveBeenCalled()
    expect(store.installing).toBeNull()
  })

  it('同名の自作プラグインがあってもストア経路のインストールは拒否しない (#913)', async () => {
    const store = useMisStoreStore()
    h.pluginsStore.items = [
      existingPlugin({ id: 'p9', name: 'MyPlugin', store: undefined }),
    ]
    fetchMock.mockResolvedValue(okText(source))
    h.parsePluginMeta.mockReturnValue(meta)
    await store.installPlugin(pluginEntry({ sha512: sha512Hex(source) }), {
      kind: 'global',
    })
    expect(h.pluginsStore.add).toHaveBeenCalledTimes(1)
  })

  it('installs into installedFor for an account scope', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    h.parsePluginMeta.mockReturnValue(meta)
    await store.installPlugin(pluginEntry({ sha512: sha512Hex(source) }), {
      kind: 'account',
      key: 'yami.ski:u1',
    })
    const added = h.pluginsStore.add.mock.calls[0]?.[0] as unknown as PluginItem
    expect(added.scope).toEqual({
      kind: 'shared',
      global: false,
      installedFor: ['yami.ski:u1'],
    })
  })

  it('rejects when plugin metadata cannot be parsed', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    h.parsePluginMeta.mockReturnValue(null)
    await expect(
      store.installPlugin(pluginEntry({ sha512: sha512Hex(source) }), {
        kind: 'global',
      }),
    ).rejects.toThrow(/メタデータを読み取れませんでした/)
  })

  it('既存への追加インストールで権限が拡大するなら再同意を取る (#1040)', async () => {
    const store = useMisStoreStore()
    const newSrc = '/* v2 */'
    h.pluginsStore.items = [
      existingPlugin({
        content: '/* v1 */',
        store: { id: 'ent-plugin', sha512: 'old-sha' },
        extra: {
          version: '1',
          configData: {},
          active: true,
          permissions: ['read:account'],
        },
      }),
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
        content: newSrc,
        permissions: ['read:account', 'write:notes'],
      }),
    )
  })

  it('権限拡大の再同意を断ったら本体・権限は据え置きで scope だけ足す', async () => {
    const store = useMisStoreStore()
    const newSrc = '/* v2 */'
    h.pluginsStore.items = [
      existingPlugin({
        content: '/* v1 */',
        store: { id: 'ent-plugin', sha512: 'old-sha' },
        extra: {
          version: '1',
          configData: {},
          active: true,
          permissions: ['read:account'],
        },
      }),
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
    expect(h.pluginsStore.link).toHaveBeenCalledWith('p1', {
      kind: 'global',
    })
  })

  it('ソースが変わっていなければ scope のリンクだけ行う (本体・権限を触らない)', async () => {
    const store = useMisStoreStore()
    h.pluginsStore.items = [
      existingPlugin({
        content: source,
        store: { id: 'ent-plugin', sha512: sha512Hex(source) },
        extra: {
          version: '1',
          configData: {},
          active: true,
          permissions: ['read:account'],
        },
      }),
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
    expect(h.pluginsStore.link).toHaveBeenCalledWith('p1', {
      kind: 'account',
      key: 'yami.ski:u1',
    })
  })

  it('isInstalled は storeId のみで照合する (名前一致では真にならない #913)', () => {
    const store = useMisStoreStore()
    h.pluginsStore.items = [existingPlugin({})]
    expect(store.isInstalled(pluginEntry())).toBe(true)
    h.pluginsStore.items = [
      existingPlugin({ name: 'Test Plugin', store: undefined }),
    ]
    expect(store.isInstalled(pluginEntry())).toBe(false)
  })
})

describe('installWidget', () => {
  it('既存 (storeId 一致) は early return せず本体とメタを上書き更新する (#913)', async () => {
    const store = useMisStoreStore()
    const source = '<: "widget v2"'
    const existing = {
      id: 'w0',
      store: { id: 'ent-widget' },
      content: '',
    } as WidgetItem
    h.widgetsStore.items = [existing]
    fetchMock.mockResolvedValue(okText(source))
    await expect(
      store.installWidget(widgetEntry({ sha512: sha512Hex(source) })),
    ).resolves.toBe(existing)
    expect(h.widgetsStore.applyStoreUpdate).toHaveBeenCalledWith(
      'w0',
      expect.objectContaining({
        content: source,
        store: {
          id: 'ent-widget',
          sha512: sha512Hex(source),
          version: '1.0.0',
        },
      }),
    )
    expect(h.widgetsStore.add).not.toHaveBeenCalled()
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
      id: 'ent-widget',
      name: 'Test Widget',
      content: source,
      extra: { autoRun: true },
      store: { id: 'ent-widget', sha512: sha512Hex(source), version: '1.0.0' },
      // scope を渡さなければ全体スコープ
      scope: { kind: 'shared', global: true, installedFor: [] },
    })
    expect(h.widgetsStore.add).toHaveBeenCalledTimes(1)
    expect(store.installingWidget).toBeNull()
  })

  it('scope 指定: 既存の本体があれば増やさず紐付けを足す (#1202 決定 (b))', async () => {
    const store = useMisStoreStore()
    const source = '<: "widget"'
    h.widgetsStore.items = [
      { id: 'ent-widget', store: { id: 'ent-widget' }, content: source },
    ]
    fetchMock.mockResolvedValue(okText(source))
    await store.installWidget(widgetEntry({ sha512: sha512Hex(source) }), {
      kind: 'account',
      key: 'misskey.io:u1',
    })
    expect(h.widgetsStore.add).not.toHaveBeenCalled()
    expect(h.widgetsStore.link).toHaveBeenCalledWith('ent-widget', {
      kind: 'account',
      key: 'misskey.io:u1',
    })
    // 本文が同じなら確認は挟まず、ストア由来の基準だけ記録し直す
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.widgetsStore.applyStoreUpdate).toHaveBeenCalledTimes(1)
  })

  it('scope 指定で新規なら、その紐付けを持つ本体を作る', async () => {
    const store = useMisStoreStore()
    const source = '<: "widget"'
    fetchMock.mockResolvedValue(okText(source))
    await store.installWidget(widgetEntry({ sha512: sha512Hex(source) }), {
      kind: 'account',
      key: 'misskey.io:u1',
    })
    expect(h.widgetsStore.add).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: {
          kind: 'shared',
          global: false,
          installedFor: ['misskey.io:u1'],
        },
      }),
    )
  })

  it('isWidgetInstalled matches by storeId', () => {
    const store = useMisStoreStore()
    h.widgetsStore.items = [{ store: { id: 'ent-widget' } }]
    expect(store.isWidgetInstalled(widgetEntry())).toBe(true)
    expect(store.isWidgetInstalled(widgetEntry({ id: 'other' }))).toBe(false)
  })
})

/** 既存の個体 (既定: ストア 'ent-theme' 由来、id 'custom-1') */
function existingTheme(over: Partial<ThemeItem>): ThemeItem {
  return {
    id: 'custom-1',
    name: 'Test Theme',
    store: { id: 'ent-theme' },
    createdAt: 0,
    updatedAt: 0,
    scope: { kind: 'shared', global: false, installedFor: [] },
    content: { base: 'dark', props: { accent: '#f00' } },
    extra: {},
    ...over,
  }
}

describe('installTheme', () => {
  const source = "{ id: 'ent-theme', props: { accent: '#f00' } }"

  it('既存 (storeId 一致) は本体とストア由来を上書きし、紐付けを足す (ローカル ID と name は維持)', async () => {
    const store = useMisStoreStore()
    h.themeStore.items = [
      existingTheme({
        name: 'My Renamed',
        scope: { kind: 'shared', global: false, installedFor: ['acc1'] },
        content: { base: 'dark', props: { accent: '#0f0' } },
      }),
    ]
    fetchMock.mockResolvedValue(okText(source))
    await store.installTheme(themeEntry({ sha512: sha512Hex(source) }), [
      'acc2',
      'acc1',
    ])
    expect(h.themeStore.add).not.toHaveBeenCalled()
    expect(h.themeStore.applyStoreUpdate).toHaveBeenCalledWith('custom-1', {
      content: { base: 'dark', props: { accent: '#f00' } },
      store: { id: 'ent-theme', sha512: sha512Hex(source), version: '1.0.0' },
    })
    expect(h.themeStore.link.mock.calls).toEqual([
      ['custom-1', { kind: 'account', key: 'acc2' }],
      ['custom-1', { kind: 'account', key: 'acc1' }],
    ])
    expect(store.installingTheme).toBeNull()
  })

  it('新規はローカル ID = storeId で、紐付けはカラムの文脈のアカウント', async () => {
    const store = useMisStoreStore()
    fetchMock.mockResolvedValue(okText(source))
    await store.installTheme(themeEntry({ sha512: sha512Hex(source) }), [
      'acc1',
    ])
    expect(h.themeStore.add).toHaveBeenCalledTimes(1)
    expect(h.themeStore.add.mock.calls[0]?.[0]).toMatchObject({
      id: 'ent-theme',
      name: 'Test Theme',
      store: { id: 'ent-theme', sha512: sha512Hex(source), version: '1.0.0' },
      scope: { kind: 'shared', global: false, installedFor: ['acc1'] },
      content: { base: 'dark', props: { accent: '#f00' } },
    })
  })

  it('storeId 不一致の既存 ID が占有していたら suffix で避ける (#913)', async () => {
    const store = useMisStoreStore()
    h.themeStore.items = [existingTheme({ id: 'ent-theme', store: undefined })]
    fetchMock.mockResolvedValue(okText(source))
    await store.installTheme(themeEntry({ sha512: sha512Hex(source) }))
    expect(h.themeStore.add.mock.calls[0]?.[0]).toMatchObject({
      id: 'ent-theme-2',
      scope: { kind: 'shared', global: false, installedFor: [] },
    })
  })

  it('props の無いソースはテーマではないので拒否する', async () => {
    const store = useMisStoreStore()
    const bare = "{ id: 'ent-theme', name: 'no props' }"
    fetchMock.mockResolvedValue(okText(bare))
    await expect(
      store.installTheme(themeEntry({ sha512: sha512Hex(bare) })),
    ).rejects.toThrow(/テーマのインストールに失敗/)
    expect(h.themeStore.add).not.toHaveBeenCalled()
    expect(store.installingTheme).toBeNull()
  })

  it('isThemeInstalled は store.id のみで照合する (内部 ID 一致では真にならない #913)', () => {
    const store = useMisStoreStore()
    h.themeStore.items = [existingTheme({})]
    expect(store.isThemeInstalled(themeEntry())).toBe(true)
    h.themeStore.items = [existingTheme({ id: 'ent-theme', store: undefined })]
    expect(store.isThemeInstalled(themeEntry())).toBe(false)
    h.themeStore.items = [existingTheme({ id: 'other', store: undefined })]
    expect(store.isThemeInstalled(themeEntry())).toBe(false)
  })
})

describe('更新検知 (#1040)', () => {
  it('hasWidgetUpdate: 記録済み storeSha512 と registry sha512 の不一致で true', () => {
    const store = useMisStoreStore()
    const entry = widgetEntry({ sha512: 'sha-new' })
    h.widgetsStore.items = [
      { id: 'w0', store: { id: 'ent-widget', sha512: 'sha-old' } },
    ]
    expect(store.hasWidgetUpdate(entry)).toBe(true)
    h.widgetsStore.items = [
      { id: 'w0', store: { id: 'ent-widget', sha512: 'sha-new' } },
    ]
    expect(store.hasWidgetUpdate(entry)).toBe(false)
  })

  it('未インストール / storeSha512 未記録 (baseline 前) は false', () => {
    const store = useMisStoreStore()
    const entry = widgetEntry({ sha512: 'sha-new' })
    h.widgetsStore.items = []
    expect(store.hasWidgetUpdate(entry)).toBe(false)
    h.widgetsStore.items = [{ id: 'w0', store: { id: 'ent-widget' } }]
    expect(store.hasWidgetUpdate(entry)).toBe(false)
  })

  it('version 文字列は判定に使わない (同一 version でも sha 不一致なら更新あり)', () => {
    const store = useMisStoreStore()
    const entry = widgetEntry({ sha512: 'sha-new', version: '1.0.0' })
    h.widgetsStore.items = [
      {
        id: 'w0',
        store: { id: 'ent-widget', sha512: 'sha-old', version: '1.0.0' },
      },
    ]
    expect(store.hasWidgetUpdate(entry)).toBe(true)
  })

  it('hasSkillUpdate / hasPluginUpdate / hasQueryUpdate は storeId で照合する', () => {
    const store = useMisStoreStore()
    h.skillsStore.items = [
      existingSkill({
        id: 'local-1',
        store: { id: 'ent-skill', sha512: 'sha-old' },
      }),
    ]
    expect(store.hasSkillUpdate(skillEntry({ sha512: 'sha-new' }))).toBe(true)
    expect(store.hasSkillUpdate(skillEntry({ sha512: 'sha-old' }))).toBe(false)

    h.pluginsStore.items = [
      existingPlugin({ store: { id: 'ent-plugin', sha512: 'sha-old' } }),
    ]
    expect(store.hasPluginUpdate(pluginEntry({ sha512: 'sha-new' }))).toBe(true)

    h.queriesStore.items = [
      { id: 'q1', store: { id: 'ent-query', sha512: 'sha-old' } },
    ]
    expect(store.hasQueryUpdate(queryEntry({ sha512: 'sha-new' }))).toBe(true)
  })

  it('hasThemeUpdate は store.id / sha512 で照合する', () => {
    const store = useMisStoreStore()
    h.themeStore.items = [
      existingTheme({ store: { id: 'ent-theme', sha512: 'sha-old' } }),
    ]
    expect(store.hasThemeUpdate(themeEntry({ sha512: 'sha-new' }))).toBe(true)
    expect(store.hasThemeUpdate(themeEntry({ sha512: 'sha-old' }))).toBe(false)
    // baseline 前 (sha512 未記録) は false
    h.themeStore.items = [existingTheme({})]
    expect(store.hasThemeUpdate(themeEntry({ sha512: 'sha-new' }))).toBe(false)
  })
})

describe('baseline 無通知記録 (#1040)', () => {
  it('fetchWidgets: storeSha512 未記録のインストール済みへ現行値を記録する', async () => {
    const store = useMisStoreStore()
    h.widgetsStore.items = [{ id: 'w0', store: { id: 'ent-widget' } }]
    const entry = widgetEntry({ sha512: 'sha-now', version: '2.0.0' })
    fetchMock.mockResolvedValue(okJson({ widgets: [entry] }))
    await store.fetchWidgets()
    // widget は envelope のストア由来 3 点の形で受ける (#1202 段階 1)
    expect(h.widgetsStore.recordStoreBaseline).toHaveBeenCalledWith('w0', {
      sha512: 'sha-now',
      version: '2.0.0',
    })
  })

  it('fetchWidgets: 記録済みの本体には baseline を記録しない', async () => {
    const store = useMisStoreStore()
    h.widgetsStore.items = [
      { id: 'w2', store: { id: 'ent-widget', sha512: 'sha-cur' } },
    ]
    fetchMock.mockResolvedValue(
      okJson({
        widgets: [widgetEntry({ sha512: 'sha-cur', version: '1.2.0' })],
      }),
    )
    await store.fetchWidgets()
    expect(h.widgetsStore.recordStoreBaseline).not.toHaveBeenCalled()
  })

  it('記録済み storeSha512 があるものには触れない (更新検知を上書きしない)', async () => {
    const store = useMisStoreStore()
    h.widgetsStore.items = [
      { id: 'w0', store: { id: 'ent-widget', sha512: 'sha-old' } },
    ]
    fetchMock.mockResolvedValue(
      okJson({ widgets: [widgetEntry({ sha512: 'sha-now' })] }),
    )
    await store.fetchWidgets()
    expect(h.widgetsStore.recordStoreBaseline).not.toHaveBeenCalled()
  })

  it('fetchSkills / fetchPlugins / fetchQueries も未記録分へ記録する', async () => {
    const store = useMisStoreStore()
    h.skillsStore.items = [existingSkill({ id: 'local-1' })]
    h.pluginsStore.items = [existingPlugin({})]
    h.queriesStore.items = [{ id: 'q1', store: { id: 'ent-query' } }]
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
    // skill / plugin / query は envelope のストア由来 3 点の形で受ける (#1202 段階 1)
    expect(h.skillsStore.recordStoreBaseline).toHaveBeenCalledWith('local-1', {
      sha512: 's-sha',
      version: '1.0.0',
    })
    expect(h.pluginsStore.recordStoreBaseline).toHaveBeenCalledWith('p1', {
      sha512: 'p-sha',
      version: '1.0.0',
    })
    expect(h.queriesStore.recordStoreBaseline).toHaveBeenCalledWith('q1', {
      sha512: 'q-sha',
      version: '1.0.0',
    })
  })

  it('fetchThemes: sha512 未記録のテーマへ記録する', async () => {
    const store = useMisStoreStore()
    h.themeStore.items = [existingTheme({})]
    fetchMock.mockResolvedValue(
      okJson({ themes: [themeEntry({ sha512: 't-sha' })] }),
    )
    await store.fetchThemes()
    expect(h.themeStore.recordStoreBaseline).toHaveBeenCalledWith('custom-1', {
      sha512: 't-sha',
      version: '1.0.0',
    })
  })

  it('インストールされていない registry エントリには何も記録しない', async () => {
    const store = useMisStoreStore()
    h.widgetsStore.items = [{ id: 'w9', store: { id: 'other-widget' } }]
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
      /ハッシュが一致しません/,
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
    expect(widget.store?.sha512).toBe(sha512Hex(newSrc))
    expect(widget.store?.version).toBe('1.1.0')
  })
})

describe('更新適用 (#1040)', () => {
  it('installWidget: 既存への再インストールも diff 確認を通す (#981)', async () => {
    const store = useMisStoreStore()
    const oldSrc = '<: "local edit"'
    const newSrc = '<: "widget v2"'
    h.widgetsStore.items = [
      {
        id: 'w0',
        store: { id: 'ent-widget' },
        name: 'My Widget',
        content: oldSrc,
      },
    ]
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
      id: 'w0',
      store: { id: 'ent-widget' },
      content: '<: "local edit"',
    } as WidgetItem
    h.widgetsStore.items = [existing]
    const newSrc = '<: "widget v2"'
    fetchMock.mockResolvedValue(okText(newSrc))
    await expect(
      store.installWidget(widgetEntry({ sha512: sha512Hex(newSrc) })),
    ).resolves.toBe(existing)
    expect(h.widgetsStore.applyStoreUpdate).not.toHaveBeenCalled()
  })

  it('installQuery: 既存への再インストールも diff 確認を通す (#981)', async () => {
    const store = useMisStoreStore()
    const newSrc = '<: "query v2"'
    h.queriesStore.items = [
      {
        id: 'q0',
        store: { id: 'ent-query' },
        name: 'Q',
        content: '<: "local edit"',
      },
    ]
    fetchMock.mockResolvedValue(okText(newSrc))
    await store.installQuery(queryEntry({ sha512: sha512Hex(newSrc) }))
    const opts = h.confirm.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts.diff).toEqual({
      old: '<: "local edit"',
      new: newSrc,
      language: 'aiscript',
    })
    expect(h.queriesStore.applyStoreUpdate).toHaveBeenCalled()
  })

  it('installQuery: 確認をキャンセルしたら src を書き換えない (#981)', async () => {
    const store = useMisStoreStore()
    h.confirm.mockResolvedValueOnce(false)
    h.queriesStore.items = [
      {
        id: 'q0',
        store: { id: 'ent-query' },
        name: 'Q',
        content: '<: "local edit"',
      },
    ]
    const newSrc = '<: "query v2"'
    fetchMock.mockResolvedValue(okText(newSrc))
    await store.installQuery(queryEntry({ sha512: sha512Hex(newSrc) }))
    expect(h.queriesStore.applyStoreUpdate).not.toHaveBeenCalled()
  })

  it('installSkill: 既存への再インストールも diff 確認を通す (#981)', async () => {
    const store = useMisStoreStore()
    const body = '# v2\n\n新しい本文'
    const source = `---\nname: Test Skill\n---\n${body}`
    h.skillsStore.items = [
      existingSkill({ id: 'sk0', name: 'Test Skill', content: '# v1' }),
    ]
    fetchMock.mockResolvedValue(okText(source))
    await store.installSkill(skillEntry({ sha512: sha512Hex(source) }))
    const opts = h.confirm.mock.calls[0]?.[0] as Record<string, unknown>
    expect(opts.diff).toEqual({
      old: '# v1',
      new: body,
      language: 'markdown',
    })
    expect(h.skillsStore.applyStoreUpdate).toHaveBeenCalled()
  })

  it('installSkill: 確認をキャンセルしたら本文を書き換えない (#981)', async () => {
    const store = useMisStoreStore()
    h.confirm.mockResolvedValueOnce(false)
    h.skillsStore.items = [
      existingSkill({ id: 'sk0', name: 'Test Skill', content: '# v1' }),
    ]
    const source = '---\nname: Test Skill\n---\n# v2'
    fetchMock.mockResolvedValue(okText(source))
    await store.installSkill(skillEntry({ sha512: sha512Hex(source) }))
    expect(h.skillsStore.applyStoreUpdate).not.toHaveBeenCalled()
  })

  it('installTheme: 見た目が変わらない再インストール (紐付け追加だけ) は確認しない (#981)', async () => {
    const store = useMisStoreStore()
    const source = "{ id: 'ent-theme', name: 'T', props: { accent: '#f00' } }"
    h.themeStore.items = [
      existingTheme({
        scope: { kind: 'shared', global: false, installedFor: ['acc1'] },
      }),
    ]
    fetchMock.mockResolvedValue(okText(source))
    await store.installTheme(themeEntry({ sha512: sha512Hex(source) }), [
      'acc2',
    ])
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.themeStore.applyStoreUpdate).toHaveBeenCalledTimes(1)
    expect(h.themeStore.link).toHaveBeenCalledWith('custom-1', {
      kind: 'account',
      key: 'acc2',
    })
  })

  it('installTheme: props が変わる再インストールは diff 確認を通す (#981)', async () => {
    const store = useMisStoreStore()
    const source = "{ id: 'ent-theme', name: 'T', props: { accent: '#0f0' } }"
    h.themeStore.items = [existingTheme({})]
    fetchMock.mockResolvedValue(okText(source))
    await store.installTheme(themeEntry({ sha512: sha512Hex(source) }))
    const opts = h.confirm.mock.calls[0]?.[0] as Record<string, unknown>
    const diff = opts.diff as { old: string; new: string }
    expect(diff.old).toContain("accent: '#f00'")
    expect(diff.new).toContain("accent: '#0f0'")
  })

  it('updateWidget: diff 付き確認 → 承認で確認に使ったソースをそのまま適用する', async () => {
    const store = useMisStoreStore()
    const oldSrc = '<: "widget v1"'
    const newSrc = '<: "widget v2"'
    h.widgetsStore.items = [
      {
        id: 'w0',
        store: { id: 'ent-widget', sha512: sha512Hex(oldSrc) },
        name: 'My Widget',
        content: oldSrc,
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
        content: newSrc,
        store: {
          id: 'ent-widget',
          sha512: sha512Hex(newSrc),
          version: '2.0.0',
        },
      }),
    )
    // 承認後の再 fetch なし: ソース取得は確認前の 1 回だけ (#981 不変条件)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(store.installingWidget).toBeNull()
  })

  it('updateWidget: キャンセルで適用しない', async () => {
    const store = useMisStoreStore()
    const newSrc = '<: "v2"'
    h.widgetsStore.items = [
      { id: 'w0', store: { id: 'ent-widget', sha512: 'x' }, content: 'old' },
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
    h.widgetsStore.items = []
    await expect(store.updateWidget(widgetEntry())).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('updatePlugin: permissions が拡大する更新は新規権限を明示する', async () => {
    const store = useMisStoreStore()
    const newSrc = '/* v2 */'
    h.pluginsStore.items = [
      existingPlugin({
        content: '/* v1 */',
        store: { id: 'ent-plugin', sha512: 'old-sha' },
        extra: {
          version: '1',
          configData: {},
          active: true,
          permissions: ['read:account'],
        },
      }),
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
        content: newSrc,
        permissions: ['read:account', 'write:notes'],
        store: {
          id: 'ent-plugin',
          sha512: sha512Hex(newSrc),
          version: '1.0.0',
        },
      }),
    )
    // 更新はスコープに触れない (link を呼ばない)
    expect(h.pluginsStore.link).not.toHaveBeenCalled()
  })

  it('updatePlugin: permissions が拡大しなければ警告文を出さない', async () => {
    const store = useMisStoreStore()
    const newSrc = '/* v2 */'
    h.pluginsStore.items = [
      existingPlugin({
        content: '/* v1 */',
        store: { id: 'ent-plugin', sha512: 'old-sha' },
        extra: {
          version: '1',
          configData: {},
          active: true,
          permissions: ['read:account'],
        },
      }),
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
    h.skillsStore.items = [
      existingSkill({
        id: 'local-1',
        name: 'My Renamed',
        content: 'Old body',
        store: { id: 'ent-skill', sha512: 'old-sha' },
      }),
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
    expect(h.skillsStore.applyStoreUpdate).toHaveBeenCalledWith(
      'local-1',
      expect.objectContaining({
        content: 'New body',
        store: {
          id: 'ent-skill',
          sha512: sha512Hex(newSource),
          version: '1.0.0',
        },
      }),
    )
    // ローカル値は維持 (installSkill の上書き更新と同じ境界)
    const patch = (
      h.skillsStore.applyStoreUpdate.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
      ]
    )[1]
    expect(patch).not.toHaveProperty('name')
    expect(patch).not.toHaveProperty('mode')
  })

  it('updateQuery: src の diff 確認 → applyStoreUpdate に確認したソースを渡す', async () => {
    const store = useMisStoreStore()
    const newSrc = 'note.text == null'
    h.queriesStore.items = [
      {
        id: 'q-local',
        store: { id: 'ent-query', sha512: 'old-sha' },
        name: 'My Query',
        content: 'note.text != null',
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
        content: newSrc,
        store: expect.objectContaining({ sha512: sha512Hex(newSrc) }),
      }),
    )
  })

  it('updateTheme: ファイルに書く形の json5 diff で確認し、本体とストア由来だけ適用する', async () => {
    const store = useMisStoreStore()
    const source = "{ id: 'new-uuid', props: { accent: '#0f0' } }"
    h.themeStore.items = [
      existingTheme({
        name: 'My Theme',
        store: { id: 'ent-theme', sha512: 'old-sha' },
      }),
    ]
    fetchMock.mockResolvedValue(okText(source))
    await expect(
      store.updateTheme(themeEntry({ sha512: sha512Hex(source) })),
    ).resolves.toBe(true)
    const opts = h.confirm.mock.calls[0]?.[0] as {
      diff: { old: string; new: string; language: string }
    }
    expect(opts.diff.language).toBe('json5')
    expect(opts.diff.old).toContain('#f00')
    // ローカル ID / 改名は維持される (#913 と同じ境界)
    expect(opts.diff.new).toContain("id: 'custom-1'")
    expect(opts.diff.new).toContain("name: 'My Theme'")
    expect(opts.diff.new).toContain(`storeSha512: '${sha512Hex(source)}'`)
    expect(h.themeStore.applyStoreUpdate).toHaveBeenCalledWith('custom-1', {
      content: { base: 'dark', props: { accent: '#0f0' } },
      store: { id: 'ent-theme', sha512: sha512Hex(source), version: '1.0.0' },
    })
    // 更新は参加先に触れない (有効範囲はローカル値)
    expect(h.themeStore.link).not.toHaveBeenCalled()
  })

  it('更新も sha 不一致なら index 再取得の 1 回リトライを経て新 entry を適用する', async () => {
    const store = useMisStoreStore()
    const newSrc = 'note.userId != null'
    h.queriesStore.items = [
      {
        id: 'q-local',
        store: { id: 'ent-query', sha512: 'old-sha' },
        content: 'old',
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
      expect.objectContaining({
        content: newSrc,
        store: expect.objectContaining({ version: '3.0.0' }),
      }),
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
