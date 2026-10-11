// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { abortPlugin, launchPlugin } from '@/aiscript/plugin-api'
import { useAccountsStore } from '@/stores/accounts'
import { pushSnapshot } from '@/utils/historyFs'
import {
  getStorageByPrefix,
  STORAGE_KEYS,
  setStorageJson,
  setStorageString,
} from '@/utils/storage'
import { type PluginItem, usePluginsStore } from './plugins'

vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))
vi.mock('@/aiscript/plugin-api', () => ({
  launchPlugin: vi.fn(async () => undefined),
  abortPlugin: vi.fn(),
}))

/** hook の起動 / 停止は実行基盤を遅延参照するので 1 tick 待つ */
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

function makePlugin(id: string, partial: Partial<PluginItem> = {}): PluginItem {
  return {
    id,
    name: id,
    content: `src of ${id}`,
    scope: { kind: 'shared', global: true, installedFor: [] },
    extra: { version: '1.0.0', configData: {}, active: false },
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

function newPlugin(id: string, partial: Partial<PluginItem> = {}) {
  const { createdAt: _c, updatedAt: _u, ...input } = makePlugin(id, partial)
  return input
}

/** ロード前の localStorage ミラーに個体を仕込む (移行はロード直後に走る) */
function seed(...plugins: PluginItem[]) {
  setStorageJson(STORAGE_KEYS.plugins, plugins)
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
  localStorage.clear()
  vi.mocked(launchPlugin).mockClear()
  vi.mocked(abortPlugin).mockClear()
  vi.mocked(pushSnapshot).mockClear()
})

describe('起動 / 停止は store の hook に一本化する', () => {
  it('有効なプラグインを追加すると起動し、無効なら起動しない', async () => {
    const store = usePluginsStore()
    const on = await store.add(
      newPlugin('on', {
        extra: { version: '1', configData: {}, active: true },
      }),
    )
    await store.add(newPlugin('off'))
    await flush()
    expect(launchPlugin).toHaveBeenCalledTimes(1)
    expect(vi.mocked(launchPlugin).mock.calls[0]?.[0]).toBe(on)
  })

  it('setEnabled(true) で起動し、setEnabled(false) で止める', async () => {
    const store = usePluginsStore()
    await store.add(newPlugin('p1'))
    await flush()
    expect(launchPlugin).not.toHaveBeenCalled()

    expect(await store.setEnabled('p1', true)).toBe(true)
    await flush()
    expect(launchPlugin).toHaveBeenCalledTimes(1)
    expect(vi.mocked(launchPlugin).mock.calls[0]?.[0]?.extra.active).toBe(true)

    expect(await store.setEnabled('p1', false)).toBe(true)
    await flush()
    expect(abortPlugin).toHaveBeenCalledWith('p1')
    expect(launchPlugin).toHaveBeenCalledTimes(1)
  })

  it('同じ値への setEnabled は何もしない', async () => {
    const store = usePluginsStore()
    await store.add(newPlugin('p1'))
    await store.setEnabled('p1', false)
    await flush()
    expect(launchPlugin).not.toHaveBeenCalled()
    expect(abortPlugin).not.toHaveBeenCalled()
  })

  it('本文の更新は有効なら新しいソースで起動し直し、無効なら起動しない', async () => {
    const store = usePluginsStore()
    await store.add(
      newPlugin('on', {
        extra: { version: '1', configData: {}, active: true },
      }),
    )
    await store.add(newPlugin('off'))
    await flush()
    vi.mocked(launchPlugin).mockClear()

    await store.update('on', { content: 'edited' })
    await store.update('off', { content: 'edited' })
    await flush()
    expect(launchPlugin).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(launchPlugin).mock.calls[0]?.[0]
    expect(arg?.id).toBe('on')
    expect(arg?.content).toBe('edited')
  })

  it('同じ本文の保存では起動し直さない', async () => {
    const store = usePluginsStore()
    await store.add(
      newPlugin('on', {
        extra: { version: '1', configData: {}, active: true },
      }),
    )
    await flush()
    vi.mocked(launchPlugin).mockClear()
    await store.update('on', { content: 'src of on' })
    await flush()
    expect(launchPlugin).not.toHaveBeenCalled()
  })

  it('設定値の更新は有効なら新しい値で起動し直す (Plugin:config は起動時に組まれる)', async () => {
    const store = usePluginsStore()
    await store.add(
      newPlugin('on', {
        extra: { version: '1', configData: {}, active: true },
      }),
    )
    await flush()
    vi.mocked(launchPlugin).mockClear()

    expect(await store.setConfigData('on', { greet: 'hi' })).toBe(true)
    await flush()
    expect(store.get('on')?.extra.configData).toEqual({ greet: 'hi' })
    expect(launchPlugin).toHaveBeenCalledTimes(1)
    expect(
      vi.mocked(launchPlugin).mock.calls[0]?.[0]?.extra.configData,
    ).toEqual({ greet: 'hi' })
  })

  it('削除で止め、undo で戻した本体が有効なら起動し直す', async () => {
    const store = usePluginsStore()
    await store.add(
      newPlugin('on', {
        extra: { version: '1', configData: {}, active: true },
      }),
    )
    await flush()
    vi.mocked(launchPlugin).mockClear()

    const undo = await store.remove('on')
    await flush()
    expect(abortPlugin).toHaveBeenCalledWith('on')
    expect(store.get('on')).toBeUndefined()

    undo?.()
    await flush()
    expect(store.get('on')).toBeDefined()
    expect(launchPlugin).toHaveBeenCalledTimes(1)
  })
})

describe('remove (undo) — #988', () => {
  it('元の位置に戻す undo を返す', async () => {
    const store = usePluginsStore()
    await store.add(newPlugin('p1'))
    await store.add(newPlugin('p2', { content: 'two' }))
    await store.add(newPlugin('p3'))

    const undo = await store.remove('p2')
    expect(store.get('p2')).toBeUndefined()
    expect(undo).toBeTypeOf('function')

    undo?.()
    expect(store.items.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(store.get('p2')?.content).toBe('two')
  })

  it('未知の id には undefined を返す', async () => {
    const store = usePluginsStore()
    expect(await store.remove('nope')).toBeUndefined()
  })

  it('Mk:save の領域を削除で消し、undo で復元する', async () => {
    const store = usePluginsStore()
    await store.add(newPlugin('p1'))
    const key = `${STORAGE_KEYS.aiscriptPlugin('p1')}counter`
    setStorageString(key, '42')

    const undo = await store.remove('p1')
    expect(getStorageByPrefix(STORAGE_KEYS.aiscriptPlugin('p1'))).toEqual({})

    undo?.()
    expect(getStorageByPrefix(STORAGE_KEYS.aiscriptPlugin('p1'))).toEqual({
      [key]: '42',
    })
  })
})

describe('レガシー紐付けの移行 (#771)', () => {
  async function loadWith(...plugins: PluginItem[]) {
    setupAccounts()
    seed(...plugins)
    const store = usePluginsStore()
    store.ensureLoaded()
    await flush()
    return store
  }
  const scoped = (installedFor: string[]) =>
    ({ kind: 'shared', global: false, installedFor }) as const

  it('現行アカウントの UUID は安定キーに置き換える', async () => {
    const store = await loadWith(
      makePlugin('p1', { scope: scoped(['uuid-yami']) }),
    )
    expect(store.get('p1')?.scope).toEqual(scoped(['yami.ski:u1']))
  })

  it('現存しない UUID は捨てる (一部だけなら残りを安定キー化)', async () => {
    const store = await loadWith(
      makePlugin('p1', { scope: scoped(['uuid-yami', 'uuid-dead']) }),
    )
    expect(store.get('p1')?.scope).toEqual(scoped(['yami.ski:u1']))
  })

  it('紐付け先が全滅した個体はライブラリのみになる (どこにも効かない)', async () => {
    const store = await loadWith(
      makePlugin('p1', { scope: scoped(['uuid-dead-1', 'uuid-dead-2']) }),
    )
    expect(store.get('p1')?.scope).toEqual(scoped([]))
  })

  it('全現行アカウントをカバーする旧スナップショットは全体スコープへ昇格する', async () => {
    const store = await loadWith(
      makePlugin('p1', {
        scope: scoped(['uuid-yami', 'uuid-cloud', 'uuid-dead']),
      }),
    )
    expect(store.get('p1')?.scope).toEqual({
      kind: 'shared',
      global: true,
      installedFor: [],
    })
  })

  it('安定キーだけの個体と、どこにも参加していない個体には触れない (ライブラリのみは保たれる)', async () => {
    const store = await loadWith(
      makePlugin('p1', { scope: scoped(['yami.ski:u1']) }),
      makePlugin('p2', { scope: scoped(['yami.ski:u1', 'misskey.cloud:u2']) }),
      makePlugin('lib', { scope: scoped([]) }),
    )
    expect(store.get('p1')?.scope).toEqual(scoped(['yami.ski:u1']))
    // 意図的に全アカウントへ個別紐付けした安定キーは global へ昇格しない
    expect(store.get('p2')?.scope).toEqual(
      scoped(['yami.ski:u1', 'misskey.cloud:u2']),
    )
    expect(store.get('lib')?.scope).toEqual(scoped([]))
  })

  it('accounts の読込が後なら、読み込まれてから走る', async () => {
    seed(makePlugin('p1', { scope: scoped(['uuid-yami']) }))
    const store = usePluginsStore()
    store.ensureLoaded()
    await flush()
    expect(store.get('p1')?.scope).toEqual(scoped(['uuid-yami']))

    setupAccounts()
    await flush()
    expect(store.get('p1')?.scope).toEqual(scoped(['yami.ski:u1']))
  })
})

describe('同梱をやめたプラグインの移行 (#746)', () => {
  it('旧同梱の id にストアの追跡 ID を足し、ローカルの内容は保つ', async () => {
    seed(
      makePlugin('ai-actions-builtin', {
        name: '自分で改名した',
        content: 'ユーザーが書き換えたソース',
        extra: { version: '1', configData: { prompt: '自作' }, active: false },
      }),
    )
    const store = usePluginsStore()
    store.ensureLoaded()
    const p = store.get('ai-actions-builtin')
    expect(p?.store).toEqual({ id: 'ai-actions' })
    expect(p).toMatchObject({
      name: '自分で改名した',
      content: 'ユーザーが書き換えたソース',
      extra: { configData: { prompt: '自作' }, active: false },
    })
  })
})

describe('applyStoreUpdate (#913 ストア再インストール)', () => {
  it('本体とストア由来を上書きし、ローカル値 (name / active / scope / configData) を維持する', async () => {
    const store = usePluginsStore()
    await store.add(
      newPlugin('p1', {
        name: 'My Renamed',
        store: { id: 'ent-plugin' },
        extra: {
          version: '1.0.0',
          config: { greet: { type: 'string', label: 'greet', default: 'hi' } },
          configData: { greet: 'こんにちは' },
          active: false,
        },
      }),
    )
    expect(
      await store.applyStoreUpdate('p1', {
        content: 'new src',
        version: '2.0.0',
        description: 'new desc',
        config: {
          greet: { type: 'string', label: 'greet', default: 'hi' },
          extra: { type: 'string', label: 'extra', default: 'def' },
        },
        iconUrl: 'https://example.com/icon.svg',
        store: { id: 'ent-plugin', sha512: 'abc', version: '2.0.0' },
      }),
    ).toBe(true)
    const p = store.get('p1')
    expect(p).toMatchObject({
      content: 'new src',
      description: 'new desc',
      iconUrl: 'https://example.com/icon.svg',
      store: { id: 'ent-plugin', sha512: 'abc', version: '2.0.0' },
      // ローカル値は維持
      name: 'My Renamed',
      scope: { kind: 'shared', global: true, installedFor: [] },
      extra: { version: '2.0.0', active: false },
    })
    // 既存の設定値は維持し、新キーのみデフォルト補完
    expect(p?.extra.configData).toEqual({ greet: 'こんにちは', extra: 'def' })
  })

  it('ソース欠損の readOnly 個体は検証済み配布ソースで復旧し、履歴は積まない', async () => {
    const store = usePluginsStore()
    await store.add(newPlugin('p1', { content: '' }))
    const live = store.get('p1')
    if (live) live.readOnly = true
    await store.applyStoreUpdate('p1', {
      content: 'recovered',
      version: '1.0.0',
      store: { id: 'ent', sha512: 'abc', version: '1.0.0' },
    })
    const p = store.get('p1')
    expect(p?.content).toBe('recovered')
    expect(p?.readOnly).toBeFalsy()
    expect(pushSnapshot).not.toHaveBeenCalled()
  })

  it('未知の id は false', async () => {
    const store = usePluginsStore()
    expect(
      await store.applyStoreUpdate('nope', {
        content: 'x',
        version: '1',
        store: { id: 'e' },
      }),
    ).toBe(false)
  })
})

describe('読取専用 (ソース欠損) のプラグインは変更を拒否する (#1111)', () => {
  it('有効 / 改名 / 設定値 / スコープ / 本文の変更を拒否して false を返す', async () => {
    const store = usePluginsStore()
    await store.add(
      newPlugin('ro', {
        content: '',
        extra: { version: '1', configData: {}, active: true },
      }),
    )
    const live = store.get('ro')
    if (live) live.readOnly = true
    expect(await store.setEnabled('ro', false)).toBe(false)
    expect(store.get('ro')?.extra.active).toBe(true)
    expect(await store.update('ro', { name: 'renamed' })).toBe(false)
    expect(store.get('ro')?.name).toBe('ro')
    expect(await store.setConfigData('ro', { k: 1 })).toBe(false)
    expect(store.get('ro')?.extra.configData).toEqual({})
    expect(await store.unlink('ro', { kind: 'global' })).toBe(false)
    expect(store.get('ro')?.scope).toEqual({
      kind: 'shared',
      global: true,
      installedFor: [],
    })
    expect(await store.update('ro', { content: 'x' })).toBe(false)
  })
})

describe('アカウント削除でスコープ参加を掃除する (#1114)', () => {
  it('そのアカウントのキーだけを全プラグインから外し、全体スコープと他アカウントは残す', async () => {
    const store = usePluginsStore()
    const scoped = (installedFor: string[]) =>
      ({ kind: 'shared', global: false, installedFor }) as const
    await store.add(
      newPlugin('a', { scope: scoped(['yami.ski:u1', 'misskey.cloud:u2']) }),
    )
    await store.add(newPlugin('b', { scope: scoped(['yami.ski:u1']) }))
    await store.add(newPlugin('c'))
    await store.purgeAccount('yami.ski:u1')
    expect(store.get('a')?.scope).toEqual(scoped(['misskey.cloud:u2']))
    // 参加先が無くなった本体はライブラリに残る (ピッカーから再追加できる)
    expect(store.get('b')?.scope).toEqual(scoped([]))
    expect(store.get('c')?.scope).toEqual({
      kind: 'shared',
      global: true,
      installedFor: [],
    })
  })
})
