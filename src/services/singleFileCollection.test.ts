import JSON5 from 'json5'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { injectFrontmatterId, injectJson5Id } from '@/services/idFreeze'
import {
  createSingleFileCollection,
  type SingleFileCollectionConfig,
  type SingleItemFile,
} from '@/services/singleFileCollection'
import { parseSkillFile } from '@/utils/skillFrontmatter'

/** テーマ相当 (単一 JSON5 ファイル) のアイテム。 */
interface Item extends SingleItemFile {
  id: string
  name: string
  props: Record<string, string>
}

type Parsed = Record<string, unknown>

const EXT = '.ndtheme.json5'

/** インメモリ疑似 FS。ファイル名 → 内容。Rust 側の意味論に合わせる:
 *  read = 不在で throw / remove = 不在で no-op / rename = 元不在・先在りで throw */
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
      if (!files.has(oldFilename)) throw new Error(`not found: ${oldFilename}`)
      if (files.has(newFilename))
        throw new Error(`already exists: ${newFilename}`)
      files.set(newFilename, files.get(oldFilename) as string)
      files.delete(oldFilename)
    },
  }
}

function makeCollection(
  fs: ReturnType<typeof makeFakeFs>,
  overrides?: Partial<SingleFileCollectionConfig<Item, Parsed>>,
) {
  const config: SingleFileCollectionConfig<Item, Parsed> = {
    logTag: 'test',
    kindFallback: 'theme',
    ext: EXT,
    list: fs.list,
    read: fs.read,
    write: fs.write,
    remove: fs.remove,
    rename: fs.rename,
    parse: (raw) => JSON5.parse(raw) as Parsed,
    accepts: (p) => !!p && typeof p === 'object' && !!p.props,
    rawIdOf: (p) => p.id,
    effectiveIdOf: (filename) => `custom-${filename}`,
    injectId: (raw, id) => injectJson5Id(raw, 'id', id),
    fromFile: (p, id, filename) => ({
      id,
      name: typeof p.name === 'string' && p.name ? p.name : filename,
      props: p.props as Record<string, string>,
    }),
    displayNameOf: (p) => (typeof p.name === 'string' ? p.name : ''),
    idOf: (t) => t.id,
    nameOf: (t) => t.name,
    serialize: (t) =>
      JSON5.stringify({ id: t.id, name: t.name, props: t.props }, null, 2),
    ...overrides,
  }
  return createSingleFileCollection(config)
}

const item = (partial: Partial<Item>): Item => ({
  id: 't1',
  name: 'alpha',
  props: { bg: '#000' },
  ...partial,
})

const file = (id: string | null, name: string) =>
  id === null
    ? `{ name: '${name}', props: { bg: '#000' } }`
    : `{ id: '${id}', name: '${name}', props: { bg: '#000' } }`

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  warn.mockRestore()
})

describe('loadAll', () => {
  it('規定拡張子のファイルをパースして復元し fileBase を保持する', async () => {
    const fs = makeFakeFs({
      [`a${EXT}`]: file('i-a', 'a'),
      [`b${EXT}`]: file('i-b', 'b'),
      'plain.json5': '{ id: "x", props: {} }', // 規定拡張子でない → 無視
    })
    const col = makeCollection(fs)

    const { items, entryFileCount } = await col.loadAll()
    expect(entryFileCount).toBe(2)
    expect(items.map((i) => [i.id, i.name, i.fileBase])).toEqual([
      ['i-a', 'a', 'a'],
      ['i-b', 'b', 'b'],
    ])
  })

  it('ファイル名の辞書順 (バイト順) で決定的に処理する', async () => {
    const fs = makeFakeFs()
    fs.files.set(`z${EXT}`, file('i-z', 'z'))
    fs.files.set(`A${EXT}`, file('i-A', 'A'))
    const col = makeCollection(fs)

    const { items } = await col.loadAll()
    // 'A' (0x41) < 'z' (0x7a)
    expect(items.map((i) => i.fileBase)).toEqual(['A', 'z'])
  })

  describe('ID 凍結 (常設規則)', () => {
    it('ID キー不在なら実効値 (custom-<完全ファイル名>) を注入して書き戻す', async () => {
      const fs = makeFakeFs({
        [`My Theme${EXT}`]: `{\n  name: 'My Theme',\n  props: { bg: '#000' },\n}`,
      })
      const col = makeCollection(fs)

      const { items } = await col.loadAll()
      expect(items[0]?.id).toBe(`custom-My Theme${EXT}`)
      expect(fs.files.get(`My Theme${EXT}`)).toContain(
        `id: 'custom-My Theme${EXT}'`,
      )
      const again = await col.loadAll()
      expect(again.items[0]?.id).toBe(`custom-My Theme${EXT}`)
    })

    it('凍結は冪等 (2 回目の読込で内容が変わらない)', async () => {
      const fs = makeFakeFs({ [`w${EXT}`]: file(null, 'w') })
      const col = makeCollection(fs)
      await col.loadAll()
      const frozen = fs.files.get(`w${EXT}`)
      await col.loadAll()
      expect(fs.files.get(`w${EXT}`)).toBe(frozen)
    })

    it('空文字列・非文字列・256 文字超の ID は欠損として凍結する', async () => {
      const fs = makeFakeFs({
        [`a${EXT}`]: `{ id: '', props: {} }`,
        [`b${EXT}`]: `{ id: 42, props: {} }`,
        [`c${EXT}`]: `{ id: '${'x'.repeat(257)}', props: {} }`,
      })
      const col = makeCollection(fs)
      const { items } = await col.loadAll()
      expect(items.map((i) => i.id)).toEqual([
        `custom-a${EXT}`,
        `custom-b${EXT}`,
        `custom-c${EXT}`,
      ])
    })

    it('制御文字を含む ID は欠損と判定しない (再凍結しない)', async () => {
      const fs = makeFakeFs({
        [`a${EXT}`]: `{ id: 'we\\tird', props: {} }`,
      })
      const col = makeCollection(fs)
      const before = fs.files.get(`a${EXT}`)
      const { items } = await col.loadAll()
      expect(items[0]?.id).toBe('we\tird')
      expect(fs.files.get(`a${EXT}`)).toBe(before)
    })

    it('凍結はコメントを保持する', async () => {
      const fs = makeFakeFs({
        [`w${EXT}`]: `{\n  // handwritten\n  props: { bg: '#000' },\n}`,
      })
      const col = makeCollection(fs)
      await col.loadAll()
      expect(fs.files.get(`w${EXT}`)).toContain('// handwritten')
    })
  })

  it('accepts が false の個体は警告スキップし、凍結もしない', async () => {
    const noProps = `{ name: 'not a theme' }`
    const fs = makeFakeFs({ [`x${EXT}`]: noProps })
    const col = makeCollection(fs)
    const { items, entryFileCount } = await col.loadAll()
    expect(items).toEqual([])
    expect(entryFileCount).toBe(1)
    expect(fs.files.get(`x${EXT}`)).toBe(noProps)
    expect(warn).toHaveBeenCalled()
  })

  it('同一 ID の 2 件目以降は警告してスキップし、ファイルは削除しない', async () => {
    const fs = makeFakeFs({
      [`a${EXT}`]: file('dup', 'a'),
      [`b${EXT}`]: file('dup', 'b'),
    })
    const col = makeCollection(fs)
    const { items, entryFileCount } = await col.loadAll()
    expect(entryFileCount).toBe(2)
    expect(items).toHaveLength(1)
    expect(items[0]?.fileBase).toBe('a')
    expect(warn).toHaveBeenCalled()
    expect(fs.files.has(`b${EXT}`)).toBe(true)
  })

  it('同一 ID の 2 件目は notify フックで UI 通知を出す', async () => {
    const fs = makeFakeFs({
      [`a${EXT}`]: file('dup', 'a'),
      [`b${EXT}`]: file('dup', 'b'),
    })
    const notify = vi.fn()
    const col = makeCollection(fs, { notify })
    await col.loadAll()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0]?.[0]).toContain('dup')
    expect(notify.mock.calls[0]?.[0]).toContain(`b${EXT}`)
  })

  it('パースに失敗したファイルはスキップし、他は復元する', async () => {
    const fs = makeFakeFs({
      [`broken${EXT}`]: '{{{ not json5',
      [`ok${EXT}`]: file('ok', 'ok'),
    })
    const col = makeCollection(fs)
    const { items, entryFileCount } = await col.loadAll()
    expect(entryFileCount).toBe(2)
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('ok')
    expect(warn).toHaveBeenCalled()
  })

  it('ファイルが無ければ entryFileCount=0 で空を返す', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    const { items, entryFileCount } = await col.loadAll()
    expect(items).toEqual([])
    expect(entryFileCount).toBe(0)
  })
})

describe('persistItem', () => {
  it('fileBase 未割当なら表示名の slug を割り当てて書く', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    const t = item({ name: 'My Theme!' })
    await col.persistItem(t, [t])

    expect(t.fileBase).toBe('my-theme')
    expect(fs.files.get(`my-theme${EXT}`)).toContain("id: 't1'")
  })

  it('serialize には fileBase が漏れない', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    const t = item({ name: 'a' })
    await col.persistItem(t, [t])
    expect(fs.files.get(`a${EXT}`)).not.toContain('fileBase')
  })

  it('表示名が slug 不能なら種別 fallback に落ちる', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    const t = item({ name: 'テーマ' })
    await col.persistItem(t, [t])
    expect(t.fileBase).toBe('theme')
  })

  it('ディレクトリ実列挙との衝突は -2 連番で回避する (casefold)', async () => {
    const fs = makeFakeFs({ [`Alpha${EXT}`]: '{{{ broken' })
    const col = makeCollection(fs)
    const t = item({ name: 'alpha' })
    await col.persistItem(t, [t])
    expect(t.fileBase).toBe('alpha-2')
  })

  it('対応表 (他アイテムの fileBase) と種別内 ID も占有として扱う', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    const other = item({ id: 'x', name: 'other', fileBase: 'alpha' })
    const idOwner = item({ id: 'alpha-2', name: 'idowner' })
    const t = item({ id: 'p9', name: 'alpha' })
    await col.persistItem(t, [other, idOwner, t])
    expect(t.fileBase).toBe('alpha-3')
  })

  it('履歴サイドカーの basename も占有として扱う', async () => {
    const fs = makeFakeFs({ 'alpha.history.json5': '{ entries: [] }' })
    const col = makeCollection(fs)
    const t = item({ name: 'alpha' })
    await col.persistItem(t, [t])
    expect(t.fileBase).toBe('alpha-2')
  })

  it('preferredBase が規約適合で空いていればそれを使う (builtin seed / store install)', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs, {
      preferredBase: (t) => (t.id === 't1' ? 'notedeck-guide' : undefined),
    })
    const t = item({ name: 'NoteDeck ガイド' })
    await col.persistItem(t, [t])
    expect(t.fileBase).toBe('notedeck-guide')
  })

  it('preferredBase が占有済みなら連番 suffix で回避する', async () => {
    const fs = makeFakeFs({ [`notedeck-guide${EXT}`]: file('other', 'x') })
    const col = makeCollection(fs, {
      preferredBase: () => 'notedeck-guide',
    })
    const t = item({ name: 'guide' })
    await col.persistItem(t, [t])
    expect(t.fileBase).toBe('notedeck-guide-2')
  })

  it('preferredBase が規約不適合なら無視して表示名 slug に落ちる', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs, {
      preferredBase: () => '日本語ID',
    })
    const t = item({ name: 'Alpha' })
    await col.persistItem(t, [t])
    expect(t.fileBase).toBe('alpha')
  })

  it('fileBase 割当済みなら name が変わっても再計算しない', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    const t = item({ name: 'a' })
    await col.persistItem(t, [t])
    t.name = 'renamed'
    await col.persistItem(t, [t])
    expect(t.fileBase).toBe('a')
    expect(fs.files.has(`renamed${EXT}`)).toBe(false)
    expect(fs.files.get(`a${EXT}`)).toContain('renamed')
  })
})

describe('deleteItemFiles', () => {
  it('主ファイルと履歴サイドカーを削除する', async () => {
    const fs = makeFakeFs({
      [`a${EXT}`]: file('i', 'a'),
      'a.history.json5': '{ entries: [] }',
    })
    const col = makeCollection(fs)
    await col.deleteItemFiles(item({ fileBase: 'a' }))
    expect(fs.files.size).toBe(0)
  })

  it('履歴サイドカーが無くても失敗しない', async () => {
    const fs = makeFakeFs({ [`a${EXT}`]: file('i', 'a') })
    const col = makeCollection(fs)
    await col.deleteItemFiles(item({ fileBase: 'a' }))
    expect(fs.files.size).toBe(0)
  })

  it('fileBase 未割当なら no-op', async () => {
    const fs = makeFakeFs({ [`a${EXT}`]: file('i', 'a') })
    const col = makeCollection(fs)
    await col.deleteItemFiles(item({}))
    expect(fs.files.size).toBe(1)
  })
})

describe('renameItemFiles', () => {
  it('主ファイル → 履歴を新 slug へ rename し fileBase を更新する', async () => {
    const fs = makeFakeFs({
      [`old${EXT}`]: file('p1', 'old'),
      'old.history.json5': '{ entries: [] }',
    })
    const col = makeCollection(fs)
    const t = item({ name: 'New Name', fileBase: 'old' })
    await col.renameItemFiles(t, [t])

    expect(t.fileBase).toBe('new-name')
    expect(fs.files.has(`new-name${EXT}`)).toBe(true)
    expect(fs.files.has('new-name.history.json5')).toBe(true)
    expect(fs.files.has(`old${EXT}`)).toBe(false)
    expect(fs.files.has('old.history.json5')).toBe(false)
  })

  it('履歴サイドカーが無ければ skip する', async () => {
    const fs = makeFakeFs({ [`old${EXT}`]: file('p1', 'old') })
    const col = makeCollection(fs)
    const t = item({ name: 'fresh', fileBase: 'old' })
    await col.renameItemFiles(t, [t])
    expect(fs.files.has(`fresh${EXT}`)).toBe(true)
    expect(fs.files.has('fresh.history.json5')).toBe(false)
  })

  it('占有されていれば連番で回避する', async () => {
    const fs = makeFakeFs({
      [`old${EXT}`]: file('p1', 'old'),
      [`taken${EXT}`]: file('p2', 'taken'),
    })
    const col = makeCollection(fs)
    const t = item({ name: 'taken', fileBase: 'old' })
    await col.renameItemFiles(t, [t])
    expect(t.fileBase).toBe('taken-2')
  })

  it('slug が変わらないリネームは no-op (自身は占有と見なさない)', async () => {
    const fs = makeFakeFs({ [`alpha${EXT}`]: file('p1', 'alpha') })
    const col = makeCollection(fs)
    const t = item({ name: 'Alpha', fileBase: 'alpha' })
    await col.renameItemFiles(t, [t])
    expect(t.fileBase).toBe('alpha')
    expect(fs.files.has(`alpha${EXT}`)).toBe(true)
  })

  it('casefold 一致 (大文字小文字のみ違い) は中間名経由の 2 段で行う', async () => {
    const fs = makeFakeFs({ [`Alpha${EXT}`]: file('p1', 'Alpha') })
    const col = makeCollection(fs)
    const t = item({ name: 'alpha', fileBase: 'Alpha' })
    await col.renameItemFiles(t, [t])
    expect(t.fileBase).toBe('alpha')
    expect(fs.files.has(`alpha${EXT}`)).toBe(true)
    expect(fs.files.has(`Alpha${EXT}`)).toBe(false)
    // 中間名の残骸が無い
    expect(fs.files.size).toBe(1)
  })

  it('fileBase 未割当なら no-op (persist 側で割当する)', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    const t = item({ name: 'a' })
    await col.renameItemFiles(t, [t])
    expect(t.fileBase).toBeUndefined()
  })
})

describe('migrateItems (copy-adopt)', () => {
  it('規約外名を新 slug へ copy-adopt し旧ファイルを削除する (生内容保持)', async () => {
    const raw = `{\n  // keep me\n  id: 'i1',\n  name: 'My Theme',\n  props: { bg: '#000' },\n}`
    const fs = makeFakeFs({ [`My Theme${EXT}`]: raw })
    const col = makeCollection(fs)
    const { items } = await col.loadAll()
    await col.migrateItems(items)

    expect(items[0]?.fileBase).toBe('my-theme')
    // 生内容の最小変換 (コメント保持・再シリアライズしない)
    expect(fs.files.get(`my-theme${EXT}`)).toBe(raw)
    expect(fs.files.has(`My Theme${EXT}`)).toBe(false)
  })

  it('規約適合名は触らない (冪等)', async () => {
    const fs = makeFakeFs({ [`ok${EXT}`]: file('i1', 'ok') })
    const col = makeCollection(fs)
    const { items } = await col.loadAll()
    const before = new Map(fs.files)
    await col.migrateItems(items)
    expect(fs.files).toEqual(before)
    expect(items[0]?.fileBase).toBe('ok')
  })

  it('2 回実行しても結果が変わらない (冪等)', async () => {
    const fs = makeFakeFs({ [`Bad Name${EXT}`]: file('i1', 'Bad Name') })
    const col = makeCollection(fs)
    const { items } = await col.loadAll()
    await col.migrateItems(items)
    const after1 = new Map(fs.files)
    await col.migrateItems(items)
    expect(fs.files).toEqual(after1)
    const reloaded = await col.loadAll()
    await col.migrateItems(reloaded.items)
    expect(fs.files).toEqual(after1)
  })

  describe('slug 衝突時の達成済み判定', () => {
    it('衝突先が同 ID かつ同内容なら旧削除のみ再実行する', async () => {
      // クラッシュ残骸: 新名は書けたが旧削除前に落ちたケース
      const raw = file('i1', 'Bad Name')
      const fs = makeFakeFs({
        [`Bad Name${EXT}`]: raw,
        [`bad-name${EXT}`]: raw,
      })
      const col = makeCollection(fs)
      const { items } = await col.loadAll()
      expect(items).toHaveLength(1)
      expect(items[0]?.fileBase).toBe('Bad Name')

      await col.migrateItems(items)
      expect(items[0]?.fileBase).toBe('bad-name')
      expect(fs.files.has(`Bad Name${EXT}`)).toBe(false)
      expect(fs.files.get(`bad-name${EXT}`)).toBe(raw)
      expect(fs.files.has(`bad-name-2${EXT}`)).toBe(false)
    })

    it('同 ID・内容不一致なら削除せず suffix へ退避する', async () => {
      const fs = makeFakeFs({
        [`Bad Name${EXT}`]: `{ id: 'i1', name: 'Bad Name', props: { bg: '#111' } }`,
        [`bad-name${EXT}`]: `{ id: 'i1', name: 'Bad Name', props: { bg: '#222' } }`,
      })
      const col = makeCollection(fs)
      const { items } = await col.loadAll()
      await col.migrateItems(items)
      expect(fs.files.get(`bad-name${EXT}`)).toContain('#222')
      expect(items[0]?.fileBase).toBe('bad-name-2')
      expect(fs.files.get(`bad-name-2${EXT}`)).toContain('#111')
      expect(fs.files.has(`Bad Name${EXT}`)).toBe(false)
    })

    it('ID 不一致なら単純な占有として suffix する', async () => {
      const fs = makeFakeFs({
        [`Bad Name${EXT}`]: file('i1', 'Bad Name'),
        [`bad-name${EXT}`]: file('other', 'bad-name'),
      })
      const col = makeCollection(fs)
      const { items } = await col.loadAll()
      await col.migrateItems(items)
      const migrated = items.find((i) => i.id === 'i1')
      expect(migrated?.fileBase).toBe('bad-name-2')
      expect(fs.files.get(`bad-name${EXT}`)).toContain('other')
    })
  })

  it('新旧名が casefold 一致なら中間名経由で移行する', async () => {
    const fs = makeFakeFs({ [`Alpha${EXT}`]: file('i1', 'Alpha') })
    const col = makeCollection(fs)
    const { items } = await col.loadAll()
    await col.migrateItems(items)
    expect(items[0]?.fileBase).toBe('alpha')
    expect(fs.files.has(`alpha${EXT}`)).toBe(true)
    expect(fs.files.has(`Alpha${EXT}`)).toBe(false)
    // 中間名の残骸が無い
    expect(fs.files.size).toBe(1)
  })

  it('表示名が欠損なら種別 fallback で slug 化する', async () => {
    const fs = makeFakeFs({ [`無題${EXT}`]: `{ id: 'i1', props: {} }` })
    const col = makeCollection(fs)
    const { items } = await col.loadAll()
    await col.migrateItems(items)
    expect(items[0]?.fileBase).toBe('theme')
    expect(fs.files.has(`theme${EXT}`)).toBe(true)
  })
})

describe('sweepHistory', () => {
  it('主ファイルと対応の取れない .history.json5 を削除する', async () => {
    const fs = makeFakeFs({
      [`alive${EXT}`]: file('i1', 'alive'),
      'alive.history.json5': '{ entries: [] }',
      'dead.history.json5': '{ entries: [] }',
    })
    const col = makeCollection(fs)
    await col.sweepHistory()
    expect(fs.files.has('alive.history.json5')).toBe(true)
    expect(fs.files.has('dead.history.json5')).toBe(false)
  })

  it('パース不能な主ファイルの履歴は保全する (読込採否を問わない)', async () => {
    const fs = makeFakeFs({
      [`broken${EXT}`]: '{{{ not json5',
      'broken.history.json5': '{ entries: [] }',
    })
    const col = makeCollection(fs)
    await col.sweepHistory()
    expect(fs.files.has('broken.history.json5')).toBe(true)
  })

  it('照合は casefold で行う', async () => {
    const fs = makeFakeFs({
      [`Alpha${EXT}`]: file('i1', 'Alpha'),
      'alpha.history.json5': '{ entries: [] }',
    })
    const col = makeCollection(fs)
    await col.sweepHistory()
    expect(fs.files.has('alpha.history.json5')).toBe(true)
  })
})

// --- スキル相当 (frontmatter 付き .md) の構成でも同じ仕様が成立すること ---

interface SkillItem extends SingleItemFile {
  id: string
  name: string
  body: string
}

function makeSkillCollection(fs: ReturnType<typeof makeFakeFs>) {
  const config: SingleFileCollectionConfig<
    SkillItem,
    ReturnType<typeof parseSkillFile>
  > = {
    logTag: 'test-skill',
    kindFallback: 'skill',
    ext: '.md',
    list: fs.list,
    read: fs.read,
    write: fs.write,
    remove: fs.remove,
    rename: fs.rename,
    parse: (raw) => parseSkillFile(raw),
    rawIdOf: (p) => p.meta.id,
    // スキルの凍結実効値 = 拡張子を除いた basename (現行 fallbackId と同値)
    effectiveIdOf: (_filename, base) => base,
    injectId: (raw, id) => injectFrontmatterId(raw, id),
    fromFile: (p, id, filename) => ({
      id,
      name:
        typeof p.meta.name === 'string' && p.meta.name
          ? p.meta.name
          : filename.replace(/\.md$/, ''),
      body: p.body,
    }),
    displayNameOf: (p) => (typeof p.meta.name === 'string' ? p.meta.name : ''),
    idOf: (s) => s.id,
    nameOf: (s) => s.name,
    serialize: (s) => `---\nid: ${s.id}\nname: ${s.name}\n---\n${s.body}`,
  }
  return createSingleFileCollection(config)
}

describe('スキル相当構成 (.md + frontmatter)', () => {
  it('frontmatter の id 欠損は拡張子なし basename を注入して凍結する', async () => {
    const fs = makeFakeFs({
      'My Skill.md': '---\nname: My Skill\n---\nbody text',
    })
    const col = makeSkillCollection(fs)
    const { items } = await col.loadAll()
    expect(items[0]?.id).toBe('My Skill')
    expect(items[0]?.body).toBe('body text')
    expect(fs.files.get('My Skill.md')).toContain("id: 'My Skill'")
    // 冪等
    const frozen = fs.files.get('My Skill.md')
    await col.loadAll()
    expect(fs.files.get('My Skill.md')).toBe(frozen)
  })

  it('copy-adopt は frontmatter の表示名から slug 化し本文を保持する', async () => {
    const fs = makeFakeFs({
      'マイスキル.md': '---\nid: my-skill\nname: My Skill\n---\nbody text',
    })
    const col = makeSkillCollection(fs)
    const { items } = await col.loadAll()
    await col.migrateItems(items)
    expect(items[0]?.fileBase).toBe('my-skill')
    expect(fs.files.get('my-skill.md')).toBe(
      '---\nid: my-skill\nname: My Skill\n---\nbody text',
    )
    expect(fs.files.has('マイスキル.md')).toBe(false)
  })

  it('履歴 sweep は .md の basename と casefold 照合する', async () => {
    const fs = makeFakeFs({
      'keep.md': '---\nid: keep\n---\nbody',
      'keep.history.json5': '{ entries: [] }',
      'gone.history.json5': '{ entries: [] }',
    })
    const col = makeSkillCollection(fs)
    await col.sweepHistory()
    expect(fs.files.has('keep.history.json5')).toBe(true)
    expect(fs.files.has('gone.history.json5')).toBe(false)
  })
})
