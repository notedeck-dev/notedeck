import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type SingleFileIo,
  singleFileCollectionFor,
} from '@/services/distributableCodecs/singleFile'
import {
  type SkillFile,
  skillCodec,
} from '@/services/distributableCodecs/skillCodec'
import {
  type ThemeFileInput,
  themeCodec,
} from '@/services/distributableCodecs/themeCodec'
import { injectFrontmatterId, injectJson5Id } from '@/services/idFreeze'

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

type FakeFs = ReturnType<typeof makeFakeFs>

/** stores/skills.ts と同じ規則の I/O */
function skillCollection(
  fs: FakeFs,
  overrides?: Partial<SingleFileIo<SkillFile>>,
) {
  return singleFileCollectionFor(skillCodec, {
    logTag: 'test',
    kindFallback: 'skill',
    ext: '.md',
    list: fs.list,
    read: fs.read,
    write: fs.write,
    remove: fs.remove,
    rename: fs.rename,
    rawIdOf: (p) => p.meta.id,
    effectiveIdOf: (_filename, base) => base,
    injectId: (raw, id) => injectFrontmatterId(raw, id),
    displayNameOf: (p) => (typeof p.meta.name === 'string' ? p.meta.name : ''),
    ...overrides,
  })
}

/** stores/themeFileSync.ts と同じ規則の I/O */
function themeCollection(fs: FakeFs) {
  return singleFileCollectionFor(themeCodec, {
    logTag: 'test',
    kindFallback: 'theme',
    ext: '.ndtheme.json5',
    list: fs.list,
    read: fs.read,
    write: fs.write,
    remove: fs.remove,
    rename: fs.rename,
    accepts: (p: ThemeFileInput) => !!p && typeof p === 'object' && !!p.props,
    rawIdOf: (p) => p.id,
    effectiveIdOf: (filename) => `custom-${filename}`,
    injectId: (raw, id) => injectJson5Id(raw, 'id', id),
    displayNameOf: (p) => (typeof p.name === 'string' ? p.name : ''),
  })
}

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

describe('singleFileCollectionFor (skillCodec)', () => {
  it('loadAll は frontmatter を codec の fromFile で envelope にし fileBase を付ける', async () => {
    const fs = makeFakeFs({
      'a.md':
        '---\nid: a\nname: A\nmode: trigger\ncreatedAt: 1\nupdatedAt: 2\n---\n\nbody',
      'a.history.json5': '{}',
    })
    const { items, outdated } = await skillCollection(fs).loadAll()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'a',
      name: 'A',
      content: 'body',
      createdAt: 1,
      updatedAt: 2,
      fileBase: 'a',
      extra: { mode: 'trigger' },
    })
    // skill は段階 0 で on-disk を変えないので outdated は常に空
    expect(outdated).toEqual([])
  })

  it('loadAll は ID の無いファイルに拡張子なし basename を凍結して書き戻す', async () => {
    const fs = makeFakeFs({ 'x.md': '---\nname: X\n---\n\nb' })
    const { items } = await skillCollection(fs).loadAll()
    expect(items[0]?.id).toBe('x')
    expect(fs.files.get('x.md')).toBe("---\nname: X\nid: 'x'\n---\n\nb")
  })

  it('時刻の無いファイルは現在時刻で埋めるが outdated にはしない', async () => {
    const fs = makeFakeFs({ 'x.md': '---\nid: x\n---\nb' })
    const { items, outdated } = await skillCollection(fs).loadAll()
    expect(items[0]?.createdAt).toBe(1700000000123)
    expect(outdated).toEqual([])
  })

  it('個体の ID は codec の fallback ではなくコレクションが凍結した実効値になる', async () => {
    const fs = makeFakeFs({ 'x.md': '---\nname: X\n---\nb' })
    const { items } = await skillCollection(fs, {
      effectiveIdOf: (_filename, base) => `frozen-${base}`,
    }).loadAll()
    expect(items[0]?.id).toBe('frozen-x')
  })

  it('persistItem は codec の toFile を encode した本文を書く', async () => {
    const fs = makeFakeFs({
      'a.md': '---\nid: a\nname: A\ncreatedAt: 1\nupdatedAt: 2\n---\nold',
    })
    const col = skillCollection(fs)
    const { items } = await col.loadAll()
    const item = items[0]
    if (!item) throw new Error('no item')
    const next = { ...item, content: 'new' }
    await col.persistItem(next, items)
    expect(fs.files.get('a.md')).toBe(
      '---\nid: a\nname: A\nversion: 0.1.0\nmode: manual\ncreatedAt: 1\nupdatedAt: 2\n---\n\nnew',
    )
  })

  it('新規個体のファイル名はストア由来なら storeId を優先する', async () => {
    const fs = makeFakeFs()
    const col = skillCollection(fs)
    const item = skillCodec.fromFile(
      { meta: { id: 'i', name: 'Some Name', storeId: 'hello' }, body: '' },
      { filename: 'unused.md', now: 0 },
    )
    await col.persistItem(item, [])
    expect(item.fileBase).toBe('hello')
    expect(fs.files.has('hello.md')).toBe(true)
  })

  it('新規個体で ID が同じ個体が対応表にあるときはそのファイルへ書く', async () => {
    const fs = makeFakeFs({ 'a.md': '---\nid: a\nname: A\n---\nold' })
    const col = skillCollection(fs)
    const { items } = await col.loadAll()
    const fresh = skillCodec.fromFile(
      { meta: { id: 'a', name: 'Renamed' }, body: 'new' },
      { filename: 'unused.md', now: 0 },
    )
    await col.persistItem(fresh, items)
    expect(fresh.fileBase).toBe('a')
    expect(fs.files.get('a.md')).toContain('new')
  })
})

describe('singleFileCollectionFor (themeCodec)', () => {
  it('loadAll は時刻の無いテーマを outdated に入れる', async () => {
    const fs = makeFakeFs({
      'a.ndtheme.json5': "{ id: 'a', name: 'A', props: { bg: '#000' } }",
      'b.ndtheme.json5':
        "{ id: 'b', name: 'B', props: {}, $notedeck: { createdAt: 1, updatedAt: 1 } }",
    })
    const { items, outdated } = await themeCollection(fs).loadAll()
    expect(items.map((t) => t.id)).toEqual(['a', 'b'])
    expect(outdated.map((t) => t.id)).toEqual(['a'])
  })

  it('props の無いファイルは採用せず、ID 凍結の書き戻しもしない', async () => {
    const original = "{ name: 'N' }"
    const fs = makeFakeFs({ 'n.ndtheme.json5': original })
    const { items } = await themeCollection(fs).loadAll()
    expect(items).toEqual([])
    expect(fs.files.get('n.ndtheme.json5')).toBe(original)
  })

  it('ID の無いテーマに custom-<完全ファイル名> を凍結して書き戻す', async () => {
    const fs = makeFakeFs({ 'x.ndtheme.json5': "{ name: 'X', props: {} }" })
    const { items } = await themeCollection(fs).loadAll()
    expect(items[0]?.id).toBe('custom-x.ndtheme.json5')
    expect(fs.files.get('x.ndtheme.json5')).toContain(
      "id: 'custom-x.ndtheme.json5'",
    )
  })

  it('persistItem は codec の encode (JSON5) で書き、$notedeck に時刻を足す', async () => {
    const fs = makeFakeFs({
      'a.ndtheme.json5': "{ id: 'a', name: 'A', props: { bg: '#000' } }",
    })
    const col = themeCollection(fs)
    const { items } = await col.loadAll()
    const item = items[0]
    if (!item) throw new Error('no item')
    await col.persistItem(item, items)
    expect(fs.files.get('a.ndtheme.json5')).toBe(
      "{\n  id: 'a',\n  name: 'A',\n  base: 'dark',\n  props: {\n    bg: '#000',\n  },\n  $notedeck: {\n    createdAt: 1700000000123,\n    updatedAt: 1700000000123,\n  },\n}",
    )
  })

  it('loadOne は ID 欠損でも書き戻さず custom-<ファイル名> を ID にする', async () => {
    const original = "{ name: 'X', props: {} }"
    const fs = makeFakeFs({ 'x.ndtheme.json5': original })
    const item = await themeCollection(fs).loadOne('x.ndtheme.json5')
    expect(item?.id).toBe('custom-x.ndtheme.json5')
    expect(item?.fileBase).toBe('x')
    expect(fs.files.get('x.ndtheme.json5')).toBe(original)
  })
})
