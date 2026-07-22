import { describe, expect, it, vi } from 'vitest'

import {
  createSidecarCollection,
  type SidecarCollectionConfig,
} from '@/services/sidecarFileCollection'

interface Item {
  installId: string
  name: string
  src: string
  active: boolean
}

interface FileMeta {
  installId: string
  name: string
  active: boolean
}

/** インメモリ疑似 FS。ファイル名 → 内容。 */
function makeFakeFs() {
  const files = new Map<string, string>()
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
  }
}

function makeCollection(fs: ReturnType<typeof makeFakeFs>) {
  const config: SidecarCollectionConfig<Item, FileMeta> = {
    logTag: 'test',
    srcFilename: (base) => `${base}.is`,
    metaFilename: (base) => `${base}.meta.json5`,
    list: fs.list,
    read: fs.read,
    write: fs.write,
    remove: fs.remove,
    baseName: (item) => item.name || item.installId,
    srcOf: (item) => item.src,
    toFileMeta: (item) => ({
      installId: item.installId,
      name: item.name,
      active: item.active,
    }),
    fromFile: (meta, src, metaFile) => ({
      installId: meta.installId || metaFile,
      name: meta.name || metaFile,
      src,
      active: meta.active ?? false,
    }),
  }
  return createSidecarCollection(config)
}

const item = (partial: Partial<Item>): Item => ({
  installId: 'p1',
  name: 'alpha',
  src: '### {}',
  active: true,
  ...partial,
})

describe('persistItem', () => {
  it('src と meta の 2 ファイルを書き込む', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    await col.persistItem(item({ name: 'alpha', src: 'let x = 1' }))

    expect(fs.files.get('alpha.is')).toBe('let x = 1')
    const meta = fs.files.get('alpha.meta.json5')
    expect(meta).toContain('installId')
    expect(meta).toContain('alpha')
  })

  it('name が空なら installId をファイル名の基底に使う', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    await col.persistItem(item({ name: '', installId: 'p-fallback' }))

    expect(fs.files.has('p-fallback.is')).toBe(true)
    expect(fs.files.has('p-fallback.meta.json5')).toBe(true)
  })
})

describe('persistAll', () => {
  it('全アイテムのファイルペアを書き込む', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    await col.persistAll([item({ name: 'a' }), item({ name: 'b' })])

    expect(fs.files.size).toBe(4)
    expect(fs.files.has('a.is')).toBe(true)
    expect(fs.files.has('b.meta.json5')).toBe(true)
  })
})

describe('deleteItemFiles', () => {
  it('src と meta の両方を削除する', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    await col.persistItem(item({ name: 'a' }))
    await col.deleteItemFiles(item({ name: 'a' }))

    expect(fs.files.size).toBe(0)
  })
})

describe('loadAll', () => {
  it('meta + src ペアをパースして復元する', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    await col.persistAll([
      item({ name: 'a', src: 'src-a', active: true }),
      item({ name: 'b', src: 'src-b', active: false }),
    ])

    const { items, entryFileCount } = await col.loadAll()
    expect(entryFileCount).toBe(2)
    expect(items.map((i) => [i.name, i.src, i.active])).toEqual([
      ['a', 'src-a', true],
      ['b', 'src-b', false],
    ])
  })

  it('src ファイルが無い meta は src="" で復元する', async () => {
    const fs = makeFakeFs()
    fs.files.set('orphan.meta.json5', '{ installId: "o1", name: "orphan" }')
    const col = makeCollection(fs)

    const { items } = await col.loadAll()
    expect(items).toHaveLength(1)
    expect(items[0]?.src).toBe('')
    expect(items[0]?.active).toBe(false)
  })

  it('パースに失敗した meta はスキップし、他は復元する', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fs = makeFakeFs()
    fs.files.set('broken.meta.json5', '{{{ not json5')
    const col = makeCollection(fs)
    await col.persistItem(item({ name: 'ok' }))

    const { items, entryFileCount } = await col.loadAll()
    expect(entryFileCount).toBe(2)
    expect(items).toHaveLength(1)
    expect(items[0]?.name).toBe('ok')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('ファイルが無ければ entryFileCount=0 で空を返す', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)

    const { items, entryFileCount } = await col.loadAll()
    expect(items).toEqual([])
    expect(entryFileCount).toBe(0)
  })

  it('meta 以外のファイル (src 単体等) はエントリとして数えない', async () => {
    const fs = makeFakeFs()
    fs.files.set('stray.is', 'let x = 1')
    const col = makeCollection(fs)

    const { items, entryFileCount } = await col.loadAll()
    expect(items).toEqual([])
    expect(entryFileCount).toBe(0)
  })
})
