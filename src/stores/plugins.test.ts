import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/settingsFs', () => ({
  isTauri: false,
  isMainDeckWindow: () => true,
  PROFILE_EXT: '.ndprofile.json5',
  writePluginFile: vi.fn(async () => undefined),
  deletePluginFile: vi.fn(async () => undefined),
  listPluginFiles: vi.fn(async () => []),
  readPluginFile: vi.fn(async () => ''),
  renamePluginFile: vi.fn(async () => undefined),
}))

vi.mock('@/utils/storage', () => {
  const mem = new Map<string, unknown>()
  return {
    STORAGE_KEYS: {
      plugins: 'nd:plugins',
      pluginsSeededBuiltins: 'nd:plugins-seeded',
      aiscriptPlugin: (id: string) => `nd:aiscript-plugin:${id}`,
    },
    getStorageJson: (key: string, fallback: unknown) =>
      mem.has(key) ? mem.get(key) : fallback,
    setStorageJson: (key: string, value: unknown) => {
      mem.set(key, value)
    },
    getStorageByPrefix: (prefix: string) => {
      const out: Record<string, string> = {}
      for (const [key, value] of mem) {
        if (key.startsWith(prefix) && typeof value === 'string')
          out[key] = value
      }
      return out
    },
    setStorageString: (key: string, value: string) => {
      mem.set(key, value)
    },
    removeStorageByPrefix: (prefix: string) => {
      for (const key of [...mem.keys()]) {
        if (key.startsWith(prefix)) mem.delete(key)
      }
    },
    __mem: mem,
  }
})

vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))

import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import {
  isPluginEffectiveFor,
  type PluginMeta,
  usePluginsStore,
} from '@/stores/plugins'
import {
  getStorageByPrefix,
  STORAGE_KEYS,
  setStorageJson,
  setStorageString,
} from '@/utils/storage'

function makePlugin(partial: Partial<PluginMeta>): PluginMeta {
  return {
    installId: partial.installId ?? `p-${Math.random().toString(36).slice(2)}`,
    name: partial.name ?? 'test-plugin',
    version: '1.0.0',
    configData: {},
    src: '### {}',
    active: true,
    ...partial,
  }
}

const yami = {
  id: 'uuid-yami',
  host: 'yami.ski',
  userId: 'u1',
  username: 'hitalin',
  displayName: null,
  avatarUrl: null,
  software: 'misskey-dev/misskey' as const,
  hasToken: true,
}
const cloud = {
  id: 'uuid-cloud',
  host: 'misskey.cloud',
  userId: 'u2',
  username: 'hitalin',
  displayName: null,
  avatarUrl: null,
  software: 'misskey-dev/misskey' as const,
  hasToken: true,
}

function setupAccounts() {
  const accounts = useAccountsStore()
  accounts.accounts = [yami, cloud]
  accounts.isLoaded = true
  return accounts
}

beforeEach(() => {
  setActivePinia(createPinia())
  // seed 済み扱いにして built-in seed がテストを汚さないようにする
  setStorageJson(STORAGE_KEYS.pluginsSeededBuiltins, ['ai-actions-builtin'])
  setStorageJson(STORAGE_KEYS.plugins, [])
})

describe('accountScopeKey', () => {
  it('host と userId から安定キーを作る (内部 UUID 非依存)', () => {
    expect(accountScopeKey(yami)).toBe('yami.ski:u1')
  })
})

describe('isPluginEffectiveFor', () => {
  it('global プラグインはどのアカウントにも効く', () => {
    const p = makePlugin({ global: true })
    expect(isPluginEffectiveFor(p, 'yami.ski:u1')).toBe(true)
    expect(isPluginEffectiveFor(p, null)).toBe(true)
  })

  it('アカウント別スコープはキー一致時のみ効く', () => {
    const p = makePlugin({ installedFor: ['yami.ski:u1'] })
    expect(isPluginEffectiveFor(p, 'yami.ski:u1')).toBe(true)
    expect(isPluginEffectiveFor(p, 'misskey.cloud:u2')).toBe(false)
    expect(isPluginEffectiveFor(p, null)).toBe(false)
  })

  it('スコープなし (どちらも無い) はどこにも効かない (ライブラリのみ)', () => {
    const p = makePlugin({})
    expect(isPluginEffectiveFor(p, 'yami.ski:u1')).toBe(false)
    expect(isPluginEffectiveFor(p, null)).toBe(false)
  })
})

describe('scope link/unlink', () => {
  it('linkGlobalScope / unlinkGlobalScope で全体スコープを付け外しできる', () => {
    setupAccounts()
    const store = usePluginsStore()
    const p = makePlugin({ installId: 'p1' })
    store.addPlugin(p)

    store.linkGlobalScope('p1')
    expect(store.getPlugin('p1')?.global).toBe(true)

    store.unlinkGlobalScope('p1')
    expect(store.getPlugin('p1')?.global).toBeUndefined()
    // 本体はライブラリに残る (widgets の detach と同じ)
    expect(store.getPlugin('p1')).toBeTruthy()
  })

  it('linkAccountScope / unlinkAccountScope で安定キーを付け外しできる', () => {
    setupAccounts()
    const store = usePluginsStore()
    store.addPlugin(makePlugin({ installId: 'p1' }))

    store.linkAccountScope('p1', 'yami.ski:u1')
    store.linkAccountScope('p1', 'yami.ski:u1') // 重複 union
    store.linkAccountScope('p1', 'misskey.cloud:u2')
    expect(store.getPlugin('p1')?.installedFor).toEqual([
      'yami.ski:u1',
      'misskey.cloud:u2',
    ])

    store.unlinkAccountScope('p1', 'yami.ski:u1')
    expect(store.getPlugin('p1')?.installedFor).toEqual(['misskey.cloud:u2'])

    // 最後のスコープを外しても本体は残る
    store.unlinkAccountScope('p1', 'misskey.cloud:u2')
    expect(store.getPlugin('p1')).toBeTruthy()
    expect(
      isPluginEffectiveFor(store.getPlugin('p1') as PluginMeta, 'yami.ski:u1'),
    ).toBe(false)
  })
})

describe('レガシーデータ移行 (#771)', () => {
  it('installedFor なし (旧: 全アカウント) → global: true', () => {
    setupAccounts()
    setStorageJson(STORAGE_KEYS.plugins, [makePlugin({ installId: 'p1' })])
    const store = usePluginsStore()
    store.ensureLoaded()
    store.migrateScopes()
    expect(store.getPlugin('p1')?.global).toBe(true)
  })

  it('現行アカウント UUID → 安定キーに置換', () => {
    setupAccounts()
    setStorageJson(STORAGE_KEYS.plugins, [
      makePlugin({ installId: 'p1', installedFor: ['uuid-yami'] }),
    ])
    const store = usePluginsStore()
    store.ensureLoaded()
    store.migrateScopes()
    const p = store.getPlugin('p1')
    expect(p?.installedFor).toEqual(['yami.ski:u1'])
    expect(p?.global).toBeUndefined()
  })

  it('紐付け先が全て現存しない UUID → global: true (ゾンビ救済)', () => {
    setupAccounts()
    setStorageJson(STORAGE_KEYS.plugins, [
      makePlugin({
        installId: 'p1',
        installedFor: ['uuid-dead-1', 'uuid-dead-2'],
      }),
    ])
    const store = usePluginsStore()
    store.ensureLoaded()
    store.migrateScopes()
    const p = store.getPlugin('p1')
    expect(p?.global).toBe(true)
    expect(p?.installedFor).toBeUndefined()
  })

  it('全現行アカウントをカバーする旧スナップショット → global: true (全アカウント相当)', () => {
    setupAccounts()
    setStorageJson(STORAGE_KEYS.plugins, [
      makePlugin({
        installId: 'p1',
        installedFor: ['uuid-yami', 'uuid-cloud', 'uuid-dead'],
      }),
    ])
    const store = usePluginsStore()
    store.ensureLoaded()
    store.migrateScopes()
    const p = store.getPlugin('p1')
    expect(p?.global).toBe(true)
    expect(p?.installedFor).toBeUndefined()
  })

  it('一部アカウントのみの旧スナップショット → 安定キー化して per-account 維持', () => {
    setupAccounts()
    setStorageJson(STORAGE_KEYS.plugins, [
      makePlugin({
        installId: 'p1',
        installedFor: ['uuid-yami', 'uuid-dead'],
      }),
    ])
    const store = usePluginsStore()
    store.ensureLoaded()
    store.migrateScopes()
    const p = store.getPlugin('p1')
    expect(p?.global).toBeUndefined()
    expect(p?.installedFor).toEqual(['yami.ski:u1'])
  })

  it('移行済み (安定キーのみ) には再実行しても触れない (冪等)', () => {
    setupAccounts()
    setStorageJson(STORAGE_KEYS.plugins, [
      makePlugin({ installId: 'p1', installedFor: ['yami.ski:u1'] }),
      makePlugin({ installId: 'p2', global: true }),
    ])
    const store = usePluginsStore()
    store.ensureLoaded()
    store.migrateScopes()
    expect(store.getPlugin('p1')?.installedFor).toEqual(['yami.ski:u1'])
    expect(store.getPlugin('p1')?.global).toBeUndefined()
    expect(store.getPlugin('p2')?.global).toBe(true)
  })

  it('意図的に全アカウントへ個別紐付けした安定キーは global へ昇格しない', () => {
    setupAccounts()
    setStorageJson(STORAGE_KEYS.plugins, [
      makePlugin({
        installId: 'p1',
        installedFor: ['yami.ski:u1', 'misskey.cloud:u2'],
      }),
    ])
    const store = usePluginsStore()
    store.ensureLoaded()
    store.migrateScopes()
    const p = store.getPlugin('p1')
    expect(p?.global).toBeUndefined()
    expect(p?.installedFor).toEqual(['yami.ski:u1', 'misskey.cloud:u2'])
  })
})

describe('removePlugin (undo) — #988', () => {
  it('元の位置に戻す undo を返す', () => {
    setStorageJson(STORAGE_KEYS.plugins, [
      makePlugin({ installId: 'p1' }),
      makePlugin({ installId: 'p2', src: '### { name: "p2" }' }),
      makePlugin({ installId: 'p3' }),
    ])
    const store = usePluginsStore()
    store.ensureLoaded()

    const undo = store.removePlugin('p2')
    expect(store.getPlugin('p2')).toBeUndefined()
    expect(undo).toBeTypeOf('function')

    undo?.()
    expect(store.plugins.map((p) => p.installId)).toEqual(['p1', 'p2', 'p3'])
    expect(store.getPlugin('p2')?.src).toBe('### { name: "p2" }')
  })

  it('未知の installId には undefined を返す', () => {
    const store = usePluginsStore()
    store.ensureLoaded()
    expect(store.removePlugin('nope')).toBeUndefined()
  })

  it('undo で AiScript の保存領域も復元する', () => {
    setStorageJson(STORAGE_KEYS.plugins, [makePlugin({ installId: 'p1' })])
    const store = usePluginsStore()
    store.ensureLoaded()
    setStorageString(`${STORAGE_KEYS.aiscriptPlugin('p1')}:counter`, '42')

    const undo = store.removePlugin('p1')
    expect(getStorageByPrefix(STORAGE_KEYS.aiscriptPlugin('p1'))).toEqual({})

    undo?.()
    expect(getStorageByPrefix(STORAGE_KEYS.aiscriptPlugin('p1'))).toEqual({
      [`${STORAGE_KEYS.aiscriptPlugin('p1')}:counter`]: '42',
    })
  })

  it('undo までに同じ installId が再追加されていたら二重化しない', () => {
    setStorageJson(STORAGE_KEYS.plugins, [makePlugin({ installId: 'p1' })])
    const store = usePluginsStore()
    store.ensureLoaded()

    const undo = store.removePlugin('p1')
    store.plugins = [makePlugin({ installId: 'p1', name: 'readded' })]
    undo?.()

    expect(store.plugins.filter((p) => p.installId === 'p1')).toHaveLength(1)
    expect(store.getPlugin('p1')?.name).toBe('readded')
  })
})

describe('applyStoreUpdate (#913 ストア再インストール)', () => {
  it('本体とストア由来メタを上書きし、ローカル値 (name/active/scope/configData) を維持する', () => {
    const store = usePluginsStore()
    store.addPlugin(
      makePlugin({
        installId: 'p1',
        name: 'My Renamed',
        active: false,
        global: true,
        storeId: 'ent-plugin',
        config: {
          greet: { type: 'string', label: 'greet', default: 'hi' },
        },
        configData: { greet: 'こんにちは' },
      }),
    )
    store.applyStoreUpdate('p1', {
      src: 'new src',
      version: '2.0.0',
      description: 'new desc',
      config: {
        greet: { type: 'string', label: 'greet', default: 'hi' },
        extra: { type: 'string', label: 'extra', default: 'def' },
      },
      iconUrl: 'https://example.com/icon.svg',
      storeSha512: 'abc',
      storeVersion: '2.0.0',
    })
    const p = store.getPlugin('p1')
    expect(p).toMatchObject({
      src: 'new src',
      version: '2.0.0',
      description: 'new desc',
      iconUrl: 'https://example.com/icon.svg',
      storeSha512: 'abc',
      storeVersion: '2.0.0',
      // ローカル値は維持
      name: 'My Renamed',
      active: false,
      global: true,
    })
    // 既存の設定値は維持し、新キーのみデフォルト補完
    expect(p?.configData).toEqual({ greet: 'こんにちは', extra: 'def' })
  })

  it('ソース欠損の readOnly 個体は検証済み配布ソースで復旧する', () => {
    const store = usePluginsStore()
    store.addPlugin(makePlugin({ installId: 'p1', readOnly: true, src: '' }))
    store.applyStoreUpdate('p1', {
      src: 'recovered',
      version: '1.0.0',
      storeSha512: 'abc',
      storeVersion: '1.0.0',
    })
    const p = store.getPlugin('p1')
    expect(p?.src).toBe('recovered')
    expect(p?.readOnly).toBeFalsy()
  })
})
