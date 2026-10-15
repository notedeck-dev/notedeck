import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pluginCodec } from '@/services/distributableCodecs/pluginCodec'
import {
  decodeSidecar,
  sidecarCollectionFor,
  sidecarFileBaseOf,
  sidecarMetaText,
  storeFieldsOf,
  storeOriginOf,
} from '@/services/distributableCodecs/sidecar'

/** インメモリ疑似 FS (read = 不在で throw / remove = 不在で no-op) */
function makeFakeFs(initial?: Record<string, string>) {
  const files = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    files,
    list: async () => Array.from(files.keys()),
    read: async (filename: string) => {
      const content = files.get(filename)
      if (content === undefined) throw new Error(`not found: ${filename}`)
      return content
    },
    write: async (filename: string, content: string) => {
      files.set(filename, content)
    },
    remove: async (filename: string) => {
      files.delete(filename)
    },
    rename: async (oldFilename: string, newFilename: string) => {
      const content = files.get(oldFilename)
      if (content === undefined) throw new Error(`not found: ${oldFilename}`)
      files.set(newFilename, content)
      files.delete(oldFilename)
    },
  }
}

function pluginCollection(fs: ReturnType<typeof makeFakeFs>) {
  return sidecarCollectionFor(pluginCodec, {
    logTag: 'test',
    kindFallback: 'plugin',
    idKey: 'installId',
    list: fs.list,
    read: fs.read,
    write: fs.write,
    remove: fs.remove,
    rename: fs.rename,
  })
}

describe('sidecarMetaText', () => {
  it('JSON5 の 2 スペースインデント・単引用符・末尾カンマで書く', () => {
    expect(sidecarMetaText({ a: 'x', b: [1] })).toBe(
      "{\n  a: 'x',\n  b: [\n    1,\n  ],\n}",
    )
  })

  it('キー順は渡したオブジェクトの挿入順のまま', () => {
    expect(sidecarMetaText({ z: 1, a: 2 })).toBe('{\n  z: 1,\n  a: 2,\n}')
  })
})

describe('decodeSidecar', () => {
  it('メタは JSON5 として読み、src はそのまま持つ', () => {
    expect(decodeSidecar("{ a: 'x', /* c */ b: 1, }", 'src')).toEqual({
      meta: { a: 'x', b: 1 },
      src: 'src',
    })
  })

  it('JSON5 として壊れたメタは throw する', () => {
    expect(() => decodeSidecar('{ a: ', '')).toThrow()
  })

  it('sidecarMetaText で書いたものを読むと元に戻る', () => {
    const meta = { installId: 'p', nested: { k: [1, 'two'] }, flag: true }
    expect(decodeSidecar(sidecarMetaText(meta), '').meta).toEqual(meta)
  })
})

describe('storeOriginOf', () => {
  it('storeId が無いときは undefined (サイドロード)', () => {
    expect(storeOriginOf({})).toBeUndefined()
  })

  it('storeId が空文字のときも undefined で、sha512 / version は捨てる', () => {
    expect(
      storeOriginOf({ storeId: '', storeSha512: 'h', storeVersion: '1' }),
    ).toBeUndefined()
  })

  it('storeId だけのときは id だけを持ち sha512 / version のキーを作らない', () => {
    const origin = storeOriginOf({ storeId: 's' })
    expect(origin).toEqual({ id: 's' })
    expect(origin && 'sha512' in origin).toBe(false)
    expect(origin && 'version' in origin).toBe(false)
  })

  it('3 点が揃っているときは id / sha512 / version に写す', () => {
    expect(
      storeOriginOf({ storeId: 's', storeSha512: 'h', storeVersion: '2' }),
    ).toEqual({ id: 's', sha512: 'h', version: '2' })
  })

  it('空文字の sha512 / version は無いものとして扱う', () => {
    expect(
      storeOriginOf({ storeId: 's', storeSha512: '', storeVersion: '' }),
    ).toEqual({ id: 's' })
  })
})

describe('storeFieldsOf', () => {
  it('store が無いときは空オブジェクト', () => {
    expect(storeFieldsOf(undefined)).toEqual({})
  })

  it('id だけのときは storeId だけを書く', () => {
    expect(storeFieldsOf({ id: 's' })).toEqual({ storeId: 's' })
  })

  it('3 点を storeId / storeSha512 / storeVersion の順に書く', () => {
    const fields = storeFieldsOf({ version: '2', sha512: 'h', id: 's' })
    expect(Object.keys(fields)).toEqual([
      'storeId',
      'storeSha512',
      'storeVersion',
    ])
    expect(fields).toEqual({
      storeId: 's',
      storeSha512: 'h',
      storeVersion: '2',
    })
  })

  it('storeOriginOf と往復しても変わらない', () => {
    const fields = { storeId: 's', storeSha512: 'h', storeVersion: '2' }
    expect(storeFieldsOf(storeOriginOf(fields))).toEqual(fields)
  })
})

describe('sidecarFileBaseOf', () => {
  it('メタファイルなら .meta.json5 を剥がした基底名を返す', () => {
    expect(sidecarFileBaseOf('hello.meta.json5')).toBe('hello')
  })

  it('ソース (.is) は対象外で undefined', () => {
    expect(sidecarFileBaseOf('hello.is')).toBeUndefined()
  })

  it('履歴サイドカーは対象外で undefined', () => {
    expect(sidecarFileBaseOf('hello.history.json5')).toBeUndefined()
  })

  it('基底名に . を含んでも末尾の .meta.json5 だけを剥がす', () => {
    expect(sidecarFileBaseOf('a.b.meta.json5')).toBe('a.b')
  })
})

describe('sidecarCollectionFor (pluginCodec)', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.useFakeTimers()
    vi.setSystemTime(1700000000123)
  })

  afterEach(() => {
    vi.useRealTimers()
    warn.mockRestore()
  })

  it('loadAll はメタ + ソースを codec の fromFile で envelope にし fileBase を付ける', async () => {
    const fs = makeFakeFs({
      'p.meta.json5':
        "{ installId: 'p', name: 'P', version: '1', active: true, createdAt: 1, updatedAt: 2 }",
      'p.is': '<: 1',
    })
    const { items, outdated } = await pluginCollection(fs).loadAll()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'p',
      name: 'P',
      content: '<: 1',
      createdAt: 1,
      updatedAt: 2,
      fileBase: 'p',
      extra: { version: '1', active: true },
    })
    expect(outdated).toEqual([])
  })

  it('loadAll は時刻の無いメタを現在時刻で埋め、outdated に入れる', async () => {
    const fs = makeFakeFs({
      'p.meta.json5': "{ installId: 'p', name: 'P' }",
      'p.is': '',
    })
    const { items, outdated } = await pluginCollection(fs).loadAll()
    expect(items[0]?.createdAt).toBe(1700000000123)
    expect(items[0]?.updatedAt).toBe(1700000000123)
    expect(outdated).toEqual(items)
  })

  it('loadAll は ID の無いメタにメタファイルの完全名を凍結して書き戻す', async () => {
    const fs = makeFakeFs({
      'x.meta.json5': "{ name: 'X', createdAt: 1, updatedAt: 1 }",
      'x.is': '',
    })
    const { items } = await pluginCollection(fs).loadAll()
    expect(items[0]?.id).toBe('x.meta.json5')
    expect(fs.files.get('x.meta.json5')).toContain("installId: 'x.meta.json5'")
  })

  it('loadAll はソースの無い個体を readOnly にし、時刻が無くても outdated に入れない', async () => {
    const fs = makeFakeFs({ 'p.meta.json5': "{ installId: 'p' }" })
    const { items, outdated } = await pluginCollection(fs).loadAll()
    expect(items[0]?.readOnly).toBe(true)
    expect(items[0]?.content).toBe('')
    expect(outdated).toEqual([])
  })

  it('persistItem はソースと codec の toFile を encode したメタを書く', async () => {
    const fs = makeFakeFs({
      'p.meta.json5':
        "{ installId: 'p', name: 'P', version: '1', active: true, createdAt: 1, updatedAt: 2 }",
      'p.is': '<: 1',
    })
    const col = pluginCollection(fs)
    const { items } = await col.loadAll()
    const item = items[0]
    if (!item) throw new Error('no item')
    await col.persistItem({ ...item, content: '<: 2' }, items)
    expect(fs.files.get('p.is')).toBe('<: 2')
    expect(fs.files.get('p.meta.json5')).toBe(
      pluginCodec.encode(pluginCodec.toFile(item)),
    )
  })

  it('新規個体のファイル名はストア由来なら storeId を優先する', async () => {
    const fs = makeFakeFs()
    const col = pluginCollection(fs)
    const item = pluginCodec.fromFile(
      {
        meta: { installId: 'i', name: 'Some Name', storeId: 'hello' },
        src: '',
      },
      { filename: 'unused', now: 0 },
    )
    await col.persistItem(item, [])
    expect(item.fileBase).toBe('hello')
    expect(fs.files.has('hello.meta.json5')).toBe(true)
  })

  it('storeId が slug 規約に合わないときは表示名の slug に落ちる', async () => {
    const fs = makeFakeFs()
    const col = pluginCollection(fs)
    const item = pluginCodec.fromFile(
      {
        meta: { installId: 'i', name: 'Some Name', storeId: 'Bad ID' },
        src: '',
      },
      { filename: 'unused', now: 0 },
    )
    await col.persistItem(item, [])
    expect(item.fileBase).toBe('some-name')
  })

  it('ストア由来でなければ表示名の slug をファイル名にする', async () => {
    const fs = makeFakeFs()
    const col = pluginCollection(fs)
    const item = pluginCodec.fromFile(
      { meta: { installId: 'i', name: 'My Plugin' }, src: 'x' },
      { filename: 'unused', now: 0 },
    )
    await col.persistItem(item, [])
    expect(fs.files.get('my-plugin.is')).toBe('x')
  })

  it('loadOne は ID 欠損でも書き戻さずメタファイル名を ID にする', async () => {
    const original = "{ name: 'X', createdAt: 1, updatedAt: 1 }"
    const fs = makeFakeFs({ 'x.meta.json5': original, 'x.is': 'src' })
    const item = await pluginCollection(fs).loadOne('x.meta.json5')
    expect(item?.id).toBe('x.meta.json5')
    expect(item?.content).toBe('src')
    expect(fs.files.get('x.meta.json5')).toBe(original)
  })
})
