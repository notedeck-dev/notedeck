// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/windows/roles', () => ({
  announceWindow: async () => undefined,
  isRepresentativeNow: async () => true,
  whenRepresentative: async () => undefined,
  useRepresentative: () => ({
    isRepresentative: { value: true },
    isViewing: { value: true },
    representative: { value: 'main' },
    viewing: { value: 'main' },
  }),
}))

vi.mock('@/utils/settingsFs', async () => {
  const actual =
    await vi.importActual<typeof import('@/utils/settingsFs')>(
      '@/utils/settingsFs',
    )
  return { ...actual, isTauri: true }
})

vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))

import type {
  DistributableCodec,
  DistributableFileCollection,
  DistributableMeta,
} from '@/services/distributable'
import {
  _resetSettingsFileHandlersForTest,
  dispatchSettingsChange,
} from '@/services/settingsFileSync'
import {
  createDistributableStore,
  type DistributableStoreDeclaration,
  type PurgeAccountPolicy,
} from '@/stores/distributableStore'
import { pushSnapshot } from '@/utils/historyFs'

/**
 * factory の共通層を、kind を 1 つ偽装して固定する。本文は文字列、extra は
 * 有効フラグだけ。ファイルは in-memory の偽コレクション (呼ばれた記録を残す)
 */
type Item = DistributableMeta<string, { active: boolean }>

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

function item(partial: Partial<Item> & { id: string }): Item {
  return {
    name: partial.id,
    createdAt: 1,
    updatedAt: 1,
    scope: { kind: 'shared', global: false, installedFor: [] },
    content: 'src',
    extra: { active: true },
    fileBase: partial.id,
    ...partial,
  }
}

function fakeFiles(initial: Item[] = [], outdated: Item[] = []) {
  const persisted: Item[] = []
  const deleted: Item[] = []
  const renamed: Item[] = []
  const calls: string[] = []
  const files: DistributableFileCollection<Item> = {
    loadAll: async () => {
      calls.push('loadAll')
      return { items: initial.map((i) => ({ ...i })), outdated }
    },
    loadOne: vi.fn(async () => undefined),
    persistItem: async (i) => {
      calls.push(`persist:${i.id}`)
      persisted.push({ ...i })
    },
    deleteItemFiles: async (i) => {
      calls.push(`delete:${i.id}`)
      deleted.push(i)
    },
    renameItemFiles: async (i) => {
      calls.push(`rename:${i.id}`)
      renamed.push(i)
    },
    migrateItems: async () => {
      calls.push('migrate')
    },
    sweepHistory: async () => {
      calls.push('sweep')
    },
  }
  return { files, persisted, deleted, renamed, calls }
}

const enabledCodec: Pick<DistributableCodec<unknown, Item>, 'enabled'> = {
  enabled: {
    get: (i) => i.extra.active,
    set: (i, enabled) => ({ ...i, extra: { ...i.extra, active: enabled } }),
  },
}

function makeStore(
  overrides: Partial<DistributableStoreDeclaration<string, Item>> & {
    files: DistributableFileCollection<Item>
  },
) {
  let seq = 0
  return createDistributableStore<string, Item>({
    logTag: 'fake',
    codec: enabledCodec,
    settingsScope: 'fakes',
    fileBaseOf: (name) =>
      name.endsWith('.meta') ? name.slice(0, -'.meta'.length) : undefined,
    generateId: () => `gen-${++seq}`,
    history: { kind: 'query', snapshot: (i) => ({ content: i.content }) },
    purgeAccount: 'unlink',
    ...overrides,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  _resetSettingsFileHandlersForTest()
  vi.mocked(pushSnapshot).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('初回読込', () => {
  it('ファイルの個体を写しに載せ、読込中にメモリへ足した個体は残す', async () => {
    const f = fakeFiles([item({ id: 'a' })])
    const store = makeStore({ files: f.files })
    store.ensureLoaded()
    const added = store.add({
      name: 'mem',
      scope: { kind: 'shared', global: false, installedFor: [] },
      content: 'x',
      extra: { active: true },
    })
    await store.whenReady()
    await added
    expect(store.items.value.map((i) => i.id)).toEqual(['a', 'gen-1'])
    // メインウィンドウは対応表の移行と履歴 sweep を回す
    expect(f.calls).toContain('migrate')
    expect(f.calls).toContain('sweep')
  })

  it('on-disk が古い個体はメインウィンドウが一度だけ書き戻す', async () => {
    const old = item({ id: 'old' })
    const f = fakeFiles([old], [old])
    const store = makeStore({ files: f.files })
    store.ensureLoaded()
    await store.whenReady()
    expect(f.persisted.map((i) => i.id)).toEqual(['old'])
  })

  it('一覧の読込に失敗した起動では onLoadFailed を呼び、以後ファイルに書かない', async () => {
    const f = fakeFiles()
    f.files.loadAll = async () => {
      throw new Error('list failed')
    }
    const onLoadFailed = vi.fn()
    const store = makeStore({ files: f.files, hooks: { onLoadFailed } })
    store.ensureLoaded()
    await store.whenReady()
    expect(onLoadFailed).toHaveBeenCalledTimes(1)
    await store.add({
      name: 'x',
      scope: { kind: 'shared', global: false, installedFor: [] },
      content: 'src',
      extra: { active: true },
    })
    expect(store.items.value).toHaveLength(1)
    expect(f.persisted).toHaveLength(0)
    await store.remove('gen-1')
    expect(f.deleted).toHaveLength(0)
  })

  it('migrate hook が返した個体を永続化する', async () => {
    const f = fakeFiles([item({ id: 'a' }), item({ id: 'b' })])
    const store = makeStore({
      files: f.files,
      hooks: {
        migrate: (items) => {
          const b = items.find((i) => i.id === 'b')
          if (!b) return []
          b.extra = { active: false }
          return [b]
        },
      },
    })
    store.ensureLoaded()
    await store.whenReady()
    await flush()
    expect(f.persisted.map((i) => i.id)).toEqual(['b'])
    expect(store.get('b')?.extra.active).toBe(false)
  })
})

describe('add / update / rename', () => {
  it('add は id と時刻を埋めて永続化する', async () => {
    vi.useFakeTimers({ now: 5000 })
    const f = fakeFiles()
    const store = makeStore({ files: f.files })
    const created = await store.add({
      name: 'n',
      scope: { kind: 'shared', global: true, installedFor: [] },
      content: 'c',
      extra: { active: true },
    })
    expect(created).toMatchObject({
      id: 'gen-1',
      createdAt: 5000,
      updatedAt: 5000,
    })
    expect(f.persisted.map((i) => i.id)).toEqual(['gen-1'])
  })

  it('本文が変わると履歴に積み afterContentChange を呼ぶ。同じ本文なら何もしない', async () => {
    const f = fakeFiles([item({ id: 'a', content: 'old' })])
    const afterContentChange = vi.fn()
    const store = makeStore({ files: f.files, hooks: { afterContentChange } })
    store.ensureLoaded()
    await store.whenReady()

    expect(await store.update('a', { content: 'old' })).toBe(true)
    expect(pushSnapshot).not.toHaveBeenCalled()
    expect(afterContentChange).not.toHaveBeenCalled()

    expect(await store.update('a', { content: 'new' })).toBe(true)
    expect(pushSnapshot).toHaveBeenCalledWith(
      'query',
      'a',
      { content: 'old' },
      undefined,
    )
    expect(afterContentChange).toHaveBeenCalledTimes(1)
    expect(afterContentChange.mock.calls[0]?.[0]).toMatchObject({
      content: 'new',
    })
    expect(afterContentChange.mock.calls[0]?.[2]).toBe('local')
    expect(store.get('a')?.updatedAt).toBeGreaterThan(1)
  })

  it('update の extra は編集として履歴に積み、他の extra は保つ', async () => {
    type Rich = DistributableMeta<string, { active: boolean; mode: string }>
    const f = fakeFiles([
      { ...item({ id: 'a' }), extra: { active: true, mode: 'manual' } } as Rich,
    ])
    const store = createDistributableStore<string, Rich>({
      logTag: 'fake',
      codec: {},
      files: f.files as unknown as DistributableFileCollection<Rich>,
      settingsScope: 'fakes',
      fileBaseOf: () => undefined,
      generateId: () => 'x',
      history: {
        kind: 'skill',
        snapshot: (i) => ({ content: i.content, mode: i.extra.mode }),
      },
      purgeAccount: 'unlink',
    })
    store.ensureLoaded()
    await store.whenReady()
    expect(await store.update('a', { extra: { mode: 'heartbeat' } })).toBe(true)
    expect(store.get('a')?.extra).toEqual({ active: true, mode: 'heartbeat' })
    expect(pushSnapshot).toHaveBeenCalledWith(
      'skill',
      'a',
      { content: 'src', mode: 'manual' },
      undefined,
    )
  })

  it('updateExtra は extra だけを差し替え、本文や有効の hook は呼ばない', async () => {
    const f = fakeFiles([item({ id: 'a' })])
    const afterContentChange = vi.fn()
    const afterEnabledChange = vi.fn()
    const store = makeStore({
      files: f.files,
      hooks: { afterContentChange, afterEnabledChange },
    })
    store.ensureLoaded()
    await store.whenReady()
    expect(await store.updateExtra('a', { active: false })).toBe(true)
    expect(store.get('a')?.extra).toEqual({ active: false })
    expect(store.get('a')?.updatedAt).toBeGreaterThan(1)
    expect(afterContentChange).not.toHaveBeenCalled()
    expect(afterEnabledChange).not.toHaveBeenCalled()
    expect(f.persisted).toHaveLength(1)
    // 読取専用は拒否
    store.items.value = [item({ id: 'ro', readOnly: true })]
    expect(await store.updateExtra('ro', { active: false })).toBe(false)
  })

  it('改名はファイル名を追随させてから永続化する', async () => {
    const f = fakeFiles([item({ id: 'a', name: 'before' })])
    const store = makeStore({ files: f.files })
    store.ensureLoaded()
    await store.whenReady()
    await store.update('a', { name: 'after' })
    expect(f.calls.slice(-2)).toEqual(['rename:a', 'persist:a'])
    expect(store.get('a')?.name).toBe('after')
  })

  it('読取専用の個体への変更は拒否して false', async () => {
    const f = fakeFiles([item({ id: 'ro', readOnly: true })])
    const store = makeStore({ files: f.files })
    store.ensureLoaded()
    await store.whenReady()
    expect(await store.update('ro', { content: 'x' })).toBe(false)
    expect(await store.setEnabled('ro', false)).toBe(false)
    expect(await store.link('ro', { kind: 'global' })).toBe(false)
    expect(f.persisted).toHaveLength(0)
  })

  it('未知の id は false', async () => {
    const store = makeStore({ files: fakeFiles().files })
    expect(await store.update('nope', { content: 'x' })).toBe(false)
    expect(await store.setEnabled('nope', false)).toBe(false)
  })
})

describe('有効切替', () => {
  it('codec の宣言で切り替え、afterEnabledChange を呼ぶ。同じ値なら永続化しない', async () => {
    const f = fakeFiles([item({ id: 'a' })])
    const afterEnabledChange = vi.fn()
    const store = makeStore({ files: f.files, hooks: { afterEnabledChange } })
    store.ensureLoaded()
    await store.whenReady()

    expect(await store.setEnabled('a', true)).toBe(true)
    expect(f.persisted).toHaveLength(0)

    expect(await store.setEnabled('a', false)).toBe(true)
    expect(store.get('a')?.extra.active).toBe(false)
    expect(afterEnabledChange).toHaveBeenCalledTimes(1)
    expect(f.persisted).toHaveLength(1)
  })

  it('「有効」を宣言しない kind では false', async () => {
    const store = makeStore({
      files: fakeFiles([item({ id: 'a' })]).files,
      codec: {},
    })
    store.ensureLoaded()
    await store.whenReady()
    expect(await store.setEnabled('a', false)).toBe(false)
  })
})

describe('ストア更新', () => {
  it('applyStoreUpdate は本文とストア由来を上書きし name は維持、readOnly を解除する', async () => {
    const f = fakeFiles([
      item({
        id: 'a',
        name: 'Renamed',
        content: 'old',
        readOnly: true,
        store: { id: 'ent' },
      }),
    ])
    const afterContentChange = vi.fn()
    const store = makeStore({ files: f.files, hooks: { afterContentChange } })
    store.ensureLoaded()
    await store.whenReady()
    await store.applyStoreUpdate('a', {
      content: 'new',
      description: 'd',
      store: { id: 'ent', sha512: 'h', version: '2' },
    })
    expect(store.get('a')).toMatchObject({
      name: 'Renamed',
      content: 'new',
      description: 'd',
      store: { id: 'ent', sha512: 'h', version: '2' },
    })
    expect(store.get('a')?.readOnly).toBeFalsy()
    expect(afterContentChange).toHaveBeenCalledTimes(1)
    // readOnly からの復旧は履歴に積まない (空ソースを残す意味が無い)
    expect(pushSnapshot).not.toHaveBeenCalled()
  })

  it('recordStoreBaseline は sha / version だけ記録し updatedAt に触れない', async () => {
    const f = fakeFiles([item({ id: 'a', store: { id: 'ent' } })])
    const store = makeStore({ files: f.files })
    store.ensureLoaded()
    await store.whenReady()
    await store.recordStoreBaseline('a', { sha512: 'h', version: '1' })
    expect(store.get('a')).toMatchObject({
      store: { id: 'ent', sha512: 'h', version: '1' },
      updatedAt: 1,
    })
    expect(f.persisted).toHaveLength(1)
  })
})

describe('削除と undo', () => {
  it('ファイルを消し、undo は元の位置に戻して永続化する。付帯状態は hook が戻す', async () => {
    const f = fakeFiles([
      item({ id: 'a' }),
      item({ id: 'b' }),
      item({ id: 'c' }),
    ])
    const snapshotForUndo = vi.fn(() => 'snap')
    const restoreFromUndo = vi.fn()
    const afterRemove = vi.fn()
    const store = makeStore({
      files: f.files,
      hooks: { snapshotForUndo, restoreFromUndo, afterRemove },
    })
    store.ensureLoaded()
    await store.whenReady()

    const undo = await store.remove('b')
    expect(store.items.value.map((i) => i.id)).toEqual(['a', 'c'])
    expect(f.deleted.map((i) => i.id)).toEqual(['b'])
    expect(snapshotForUndo).toHaveBeenCalledTimes(1)
    // 退避 → 掃除の順
    expect(afterRemove).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b' }),
    )
    expect(snapshotForUndo.mock.invocationCallOrder[0]).toBeLessThan(
      afterRemove.mock.invocationCallOrder[0] ?? 0,
    )

    undo?.()
    await flush()
    expect(store.items.value.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(restoreFromUndo).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b' }),
      'snap',
    )
    expect(f.persisted.map((i) => i.id)).toEqual(['b'])
  })

  it('undo までに同じ id が再追加されていたら二重化しない / 未知の id は undefined', async () => {
    const f = fakeFiles([item({ id: 'a' })])
    const store = makeStore({ files: f.files })
    store.ensureLoaded()
    await store.whenReady()
    expect(await store.remove('nope')).toBeUndefined()
    const undo = await store.remove('a')
    store.items.value = [item({ id: 'a', name: 'readded' })]
    undo?.()
    expect(store.items.value).toHaveLength(1)
    expect(store.get('a')?.name).toBe('readded')
  })
})

describe('スコープ', () => {
  it('link / unlink は参加先を変えて updatedAt を進める。変化が無ければ永続化しない', async () => {
    const f = fakeFiles([item({ id: 'a' })])
    const store = makeStore({ files: f.files })
    store.ensureLoaded()
    await store.whenReady()

    expect(await store.link('a', { kind: 'account', key: 'h:u1' })).toBe(true)
    expect(await store.link('a', { kind: 'account', key: 'h:u1' })).toBe(true)
    expect(await store.link('a', { kind: 'global' })).toBe(true)
    expect(store.get('a')?.scope).toEqual({
      kind: 'shared',
      global: true,
      installedFor: ['h:u1'],
    })
    expect(store.get('a')?.updatedAt).toBeGreaterThan(1)
    expect(f.persisted).toHaveLength(2)

    expect(await store.unlink('a', { kind: 'global' })).toBe(true)
    expect(await store.unlink('a', { kind: 'account', key: 'h:u1' })).toBe(true)
    expect(store.get('a')?.scope).toEqual({
      kind: 'shared',
      global: false,
      installedFor: [],
    })
    expect(f.persisted).toHaveLength(4)
  })

  it.each<[PurgeAccountPolicy, string[], string[]]>([
    // 紐付けを外すだけ (plugin / widget / query): 本体は残る
    ['unlink', ['only', 'both', 'other', 'none'], []],
    // 外して空なら消す (theme): 他に紐付く個体は残る
    ['unlinkOrRemove', ['both', 'other', 'none'], ['only']],
  ])('purgeAccount の方針 %s', async (policy, remaining, deleted) => {
    const f = fakeFiles([
      item({
        id: 'only',
        scope: { kind: 'shared', global: false, installedFor: ['h:gone'] },
      }),
      item({
        id: 'both',
        scope: {
          kind: 'shared',
          global: false,
          installedFor: ['h:gone', 'h:stay'],
        },
      }),
      item({
        id: 'other',
        scope: { kind: 'shared', global: false, installedFor: ['h:stay'] },
      }),
      item({ id: 'none' }),
    ])
    const store = makeStore({ files: f.files, purgeAccount: policy })
    store.ensureLoaded()
    await store.whenReady()
    await store.purgeAccount('h:gone')
    expect(store.items.value.map((i) => i.id)).toEqual(remaining)
    expect(f.deleted.map((i) => i.id)).toEqual(deleted)
    for (const i of store.items.value) {
      expect(i.scope).not.toMatchObject({
        installedFor: expect.arrayContaining(['h:gone']),
      })
    }
  })
})

describe('変更通知の受け口', () => {
  it('書込はその個体だけ読み直し、本文が変わっていれば afterContentChange / 有効が変わっていれば afterEnabledChange', async () => {
    const f = fakeFiles([item({ id: 'a', content: 'old' })])
    const afterContentChange = vi.fn()
    const afterEnabledChange = vi.fn()
    const store = makeStore({
      files: f.files,
      hooks: { afterContentChange, afterEnabledChange },
    })
    store.ensureLoaded()
    await store.whenReady()

    vi.mocked(f.files.loadOne).mockResolvedValueOnce(
      item({ id: 'a', content: 'new', extra: { active: false } }),
    )
    await dispatchSettingsChange({
      subdir: 'fakes',
      name: 'a.meta',
      op: 'write',
    })
    expect(f.files.loadOne).toHaveBeenCalledWith('a.meta')
    expect(store.get('a')).toMatchObject({
      content: 'new',
      extra: { active: false },
    })
    expect(afterContentChange).toHaveBeenCalledTimes(1)
    expect(afterContentChange.mock.calls[0]?.[2]).toBe('external')
    expect(afterEnabledChange).toHaveBeenCalledTimes(1)
    // 自分では書かない (書き手は別)
    expect(f.persisted).toHaveLength(0)
  })

  it('reload は通知を待たずに 1 ファイルを読み直す。対象外のファイル名は無視', async () => {
    const f = fakeFiles([item({ id: 'a', content: 'old' })])
    const store = makeStore({ files: f.files })
    store.ensureLoaded()
    await store.whenReady()
    vi.mocked(f.files.loadOne).mockResolvedValueOnce(
      item({ id: 'a', content: 'new' }),
    )
    await store.reload('a.meta')
    expect(store.get('a')?.content).toBe('new')
    await store.reload('a.src')
    expect(f.files.loadOne).toHaveBeenCalledTimes(1)
  })

  it('別の書き手による削除でも afterRemove で付帯状態を掃除する', async () => {
    const f = fakeFiles([item({ id: 'a' })])
    const afterRemove = vi.fn()
    const store = makeStore({ files: f.files, hooks: { afterRemove } })
    store.ensureLoaded()
    await store.whenReady()
    await dispatchSettingsChange({
      subdir: 'fakes',
      name: 'a.meta',
      op: 'delete',
    })
    expect(store.items.value).toEqual([])
    expect(afterRemove).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
    )
    // 該当しない削除では呼ばない
    await dispatchSettingsChange({
      subdir: 'fakes',
      name: 'zz.meta',
      op: 'delete',
    })
    expect(afterRemove).toHaveBeenCalledTimes(1)
  })

  it('新しいファイルは追加、削除は fileBase で外す。対象外のファイル名は無視', async () => {
    const f = fakeFiles([item({ id: 'a' })])
    const store = makeStore({ files: f.files })
    store.ensureLoaded()
    await store.whenReady()

    vi.mocked(f.files.loadOne).mockResolvedValueOnce(
      item({ id: 'b', fileBase: 'b' }),
    )
    await dispatchSettingsChange({
      subdir: 'fakes',
      name: 'b.meta',
      op: 'write',
    })
    expect(store.items.value.map((i) => i.id)).toEqual(['a', 'b'])

    await dispatchSettingsChange({
      subdir: 'fakes',
      name: 'a.meta',
      op: 'delete',
    })
    expect(store.items.value.map((i) => i.id)).toEqual(['b'])

    await dispatchSettingsChange({
      subdir: 'fakes',
      name: 'b.is',
      op: 'delete',
    })
    expect(store.items.value.map((i) => i.id)).toEqual(['b'])
  })
})
