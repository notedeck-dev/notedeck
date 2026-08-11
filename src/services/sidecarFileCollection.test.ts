import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createSidecarCollection,
  type SidecarCollectionConfig,
  type SidecarItemFile,
} from '@/services/sidecarFileCollection'

interface Item extends SidecarItemFile {
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
  overrides?: Partial<SidecarCollectionConfig<Item, FileMeta>>,
) {
  const config: SidecarCollectionConfig<Item, FileMeta> = {
    logTag: 'test',
    kindFallback: 'widget',
    idKey: 'installId',
    list: fs.list,
    read: fs.read,
    write: fs.write,
    remove: fs.remove,
    rename: fs.rename,
    idOf: (item) => item.installId,
    nameOf: (item) => item.name,
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
    ...overrides,
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

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  warn.mockRestore()
})

describe('loadAll', () => {
  it('meta + src ペアをパースして復元し fileBase を保持する', async () => {
    const fs = makeFakeFs({
      'a.meta.json5': '{ installId: "i-a", name: "a", active: true }',
      'a.is': 'src-a',
      'b.meta.json5': '{ installId: "i-b", name: "b", active: false }',
      'b.is': 'src-b',
    })
    const col = makeCollection(fs)

    const { items, entryFileCount } = await col.loadAll()
    expect(entryFileCount).toBe(2)
    expect(items.map((i) => [i.name, i.src, i.active, i.fileBase])).toEqual([
      ['a', 'src-a', true, 'a'],
      ['b', 'src-b', false, 'b'],
    ])
  })

  it('ファイル名の辞書順 (バイト順) で決定的に処理する', async () => {
    const fs = makeFakeFs()
    // list が返す順序をあえて逆順にする
    fs.files.set('z.meta.json5', '{ installId: "i-z", name: "z" }')
    fs.files.set('z.is', 's')
    fs.files.set('A.meta.json5', '{ installId: "i-A", name: "A" }')
    fs.files.set('A.is', 's')
    const col = makeCollection(fs)

    const { items } = await col.loadAll()
    // 'A' (0x41) < 'z' (0x7a)
    expect(items.map((i) => i.fileBase)).toEqual(['A', 'z'])
  })

  describe('ID 凍結 (常設規則)', () => {
    it('ID キー不在ならメタファイル完全名を注入して書き戻す', async () => {
      const fs = makeFakeFs({
        'My Widget.meta.json5': '{\n  name: "My Widget",\n}',
        'My Widget.is': 'code',
      })
      const col = makeCollection(fs)

      const { items } = await col.loadAll()
      expect(items[0]?.installId).toBe('My Widget.meta.json5')
      expect(fs.files.get('My Widget.meta.json5')).toContain(
        "installId: 'My Widget.meta.json5'",
      )
      // コメントではなくメンバーとして注入されている (パース可能)
      const again = await col.loadAll()
      expect(again.items[0]?.installId).toBe('My Widget.meta.json5')
    })

    it('凍結は冪等 (2 回目の読込で内容が変わらない)', async () => {
      const fs = makeFakeFs({
        'w.meta.json5': '{ name: "w" }',
        'w.is': 'code',
      })
      const col = makeCollection(fs)
      await col.loadAll()
      const frozen = fs.files.get('w.meta.json5')
      await col.loadAll()
      expect(fs.files.get('w.meta.json5')).toBe(frozen)
    })

    it('空文字列・非文字列・256 文字超の ID は欠損として凍結する', async () => {
      const fs = makeFakeFs({
        'a.meta.json5': '{ installId: "", name: "a" }',
        'a.is': 's',
        'b.meta.json5': '{ installId: 42, name: "b" }',
        'b.is': 's',
        'c.meta.json5': `{ installId: "${'x'.repeat(257)}", name: "c" }`,
        'c.is': 's',
      })
      const col = makeCollection(fs)
      const { items } = await col.loadAll()
      expect(items.map((i) => i.installId)).toEqual([
        'a.meta.json5',
        'b.meta.json5',
        'c.meta.json5',
      ])
    })

    it('制御文字を含む ID は欠損と判定しない (再凍結しない)', async () => {
      const fs = makeFakeFs({
        'a.meta.json5': '{ installId: "we\\tird", name: "a" }',
        'a.is': 's',
      })
      const col = makeCollection(fs)
      const before = fs.files.get('a.meta.json5')
      const { items } = await col.loadAll()
      expect(items[0]?.installId).toBe('we\tird')
      expect(fs.files.get('a.meta.json5')).toBe(before)
    })

    it('凍結はコメントを保持する', async () => {
      const fs = makeFakeFs({
        'w.meta.json5': '{\n  // handwritten\n  name: "w",\n}',
        'w.is': 'code',
      })
      const col = makeCollection(fs)
      await col.loadAll()
      expect(fs.files.get('w.meta.json5')).toContain('// handwritten')
    })
  })

  describe('重複 ID', () => {
    it('同一 ID の 2 件目以降は警告してスキップし、ファイルは削除しない', async () => {
      const fs = makeFakeFs({
        'a.meta.json5': '{ installId: "dup", name: "a" }',
        'a.is': 'src-a',
        'b.meta.json5': '{ installId: "dup", name: "b" }',
        'b.is': 'src-b',
      })
      const col = makeCollection(fs)
      const { items, entryFileCount } = await col.loadAll()
      expect(entryFileCount).toBe(2)
      expect(items).toHaveLength(1)
      // バイト順で先勝ち
      expect(items[0]?.fileBase).toBe('a')
      expect(warn).toHaveBeenCalled()
      expect(fs.files.has('b.meta.json5')).toBe(true)
      expect(fs.files.has('b.is')).toBe(true)
    })

    it('notify フックで UI 通知を出す', async () => {
      const fs = makeFakeFs({
        'a.meta.json5': '{ installId: "dup", name: "a" }',
        'a.is': 'src-a',
        'b.meta.json5': '{ installId: "dup", name: "b" }',
        'b.is': 'src-b',
      })
      const notify = vi.fn()
      const col = makeCollection(fs, { notify })
      await col.loadAll()
      expect(notify).toHaveBeenCalledTimes(1)
      expect(notify.mock.calls[0]?.[0]).toContain('dup')
      expect(notify.mock.calls[0]?.[0]).toContain('b.meta.json5')
    })
  })

  describe('メタあり・ソースなし', () => {
    it('ミラーに同 ID の本文があればソースを再作成して通常読込する', async () => {
      const fs = makeFakeFs({
        'orphan.meta.json5': '{ installId: "o1", name: "orphan" }',
      })
      const col = makeCollection(fs, {
        mirrorSrcById: (id) => (id === 'o1' ? 'mirror-body' : undefined),
      })
      const { items } = await col.loadAll()
      expect(items[0]?.src).toBe('mirror-body')
      expect(items[0]?.readOnly).toBeUndefined()
      expect(fs.files.get('orphan.is')).toBe('mirror-body')
    })

    it('ミラー本文が無ければ readOnly フラグ付きで返す', async () => {
      const fs = makeFakeFs({
        'orphan.meta.json5': '{ installId: "o1", name: "orphan" }',
      })
      const col = makeCollection(fs)
      const { items } = await col.loadAll()
      expect(items).toHaveLength(1)
      expect(items[0]?.readOnly).toBe(true)
      expect(items[0]?.src).toBe('')
      // 空ソースは書かない
      expect(fs.files.has('orphan.is')).toBe(false)
      expect(warn).toHaveBeenCalled()
    })

    it('ミラー本文が空文字列なら再作成せず readOnly にする', async () => {
      const fs = makeFakeFs({
        'orphan.meta.json5': '{ installId: "o1", name: "orphan" }',
      })
      const col = makeCollection(fs, { mirrorSrcById: () => '' })
      const { items } = await col.loadAll()
      expect(items[0]?.readOnly).toBe(true)
      expect(fs.files.has('orphan.is')).toBe(false)
    })
  })

  it('パースに失敗した meta はスキップし、他は復元する', async () => {
    const fs = makeFakeFs({
      'broken.meta.json5': '{{{ not json5',
      'ok.meta.json5': '{ installId: "ok", name: "ok" }',
      'ok.is': 's',
    })
    const col = makeCollection(fs)
    const { items, entryFileCount } = await col.loadAll()
    expect(entryFileCount).toBe(2)
    expect(items).toHaveLength(1)
    expect(items[0]?.name).toBe('ok')
    expect(warn).toHaveBeenCalled()
  })

  it('ファイルが無ければ entryFileCount=0 で空を返す', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    const { items, entryFileCount } = await col.loadAll()
    expect(items).toEqual([])
    expect(entryFileCount).toBe(0)
  })

  it('孤児 .is (メタなし) はアイテム化しない', async () => {
    const fs = makeFakeFs({ 'stray.is': 'let x = 1' })
    const col = makeCollection(fs)
    const { items, entryFileCount } = await col.loadAll()
    expect(items).toEqual([])
    expect(entryFileCount).toBe(0)
    expect(fs.files.has('stray.is')).toBe(true)
  })
})

describe('persistItem', () => {
  it('fileBase 未割当なら表示名の slug を割り当て src → meta を書く', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    const w = item({ name: 'My Widget!', src: 'let x = 1' })
    await col.persistItem(w, [w])

    expect(w.fileBase).toBe('my-widget')
    expect(fs.files.get('my-widget.is')).toBe('let x = 1')
    expect(fs.files.get('my-widget.meta.json5')).toContain('installId')
  })

  it('meta には fileBase / readOnly が漏れない', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    const w = item({ name: 'a' })
    await col.persistItem(w, [w])
    const meta = fs.files.get('a.meta.json5') ?? ''
    expect(meta).not.toContain('fileBase')
    expect(meta).not.toContain('readOnly')
  })

  it('表示名が slug 不能なら種別 fallback に落ちる', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    const w = item({ name: 'ウィジェット' })
    await col.persistItem(w, [w])
    expect(w.fileBase).toBe('widget')
  })

  it('ディレクトリ実列挙との衝突は -2 連番で回避する (casefold)', async () => {
    const fs = makeFakeFs({ 'Alpha.meta.json5': '{{{ broken' })
    const col = makeCollection(fs)
    const w = item({ name: 'alpha' })
    await col.persistItem(w, [w])
    // 大文字小文字のみ違う既存名も占有とみなす
    expect(w.fileBase).toBe('alpha-2')
  })

  it('対応表 (他アイテムの fileBase) と種別内 ID も占有として扱う', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    const other = item({ installId: 'x', name: 'other', fileBase: 'alpha' })
    const idOwner = item({ installId: 'alpha-2', name: 'idowner' })
    const w = item({ installId: 'p9', name: 'alpha' })
    await col.persistItem(w, [other, idOwner, w])
    expect(w.fileBase).toBe('alpha-3')
  })

  it('履歴サイドカーの basename も占有として扱う', async () => {
    const fs = makeFakeFs({ 'alpha.history.json5': '{ entries: [] }' })
    const col = makeCollection(fs)
    const w = item({ name: 'alpha' })
    await col.persistItem(w, [w])
    expect(w.fileBase).toBe('alpha-2')
  })

  it('fileBase 割当済みなら name が変わっても再計算しない', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    const w = item({ name: 'a' })
    await col.persistItem(w, [w])
    w.name = 'renamed'
    await col.persistItem(w, [w])
    expect(w.fileBase).toBe('a')
    expect(fs.files.has('renamed.is')).toBe(false)
    expect(fs.files.get('a.meta.json5')).toContain('renamed')
  })

  it('readOnly アイテムは書き込まない (persist 抑止)', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    const w = item({ name: 'a', readOnly: true, fileBase: 'a', src: '' })
    await col.persistItem(w, [w])
    expect(fs.files.size).toBe(0)
  })

  it('preferredBase が規約適合で空いていればそれを使う (ストアインストール #913)', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs, { preferredBase: () => 'store-item' })
    const w = item({ name: 'とても日本語な表示名' })
    await col.persistItem(w, [w])
    expect(w.fileBase).toBe('store-item')
    expect(fs.files.has('store-item.meta.json5')).toBe(true)
  })

  it('preferredBase が占有済みなら連番 suffix で回避する', async () => {
    const fs = makeFakeFs({ 'store-item.meta.json5': '{}' })
    const col = makeCollection(fs, { preferredBase: () => 'store-item' })
    const w = item({ name: 'alpha' })
    await col.persistItem(w, [w])
    expect(w.fileBase).toBe('store-item-2')
  })

  it('preferredBase が規約不適合なら無視して表示名 slug に落ちる', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs, { preferredBase: () => '日本語ID' })
    const w = item({ name: 'alpha' })
    await col.persistItem(w, [w])
    expect(w.fileBase).toBe('alpha')
  })
})

describe('persistAll', () => {
  it('全アイテムを書き、同名は連番で分離する', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    const a = item({ installId: 'i1', name: 'same' })
    const b = item({ installId: 'i2', name: 'same' })
    await col.persistAll([a, b], [a, b])
    expect(a.fileBase).toBe('same')
    expect(b.fileBase).toBe('same-2')
    expect(fs.files.size).toBe(4)
  })
})

describe('deleteItemFiles', () => {
  it('meta → src → 履歴サイドカーを削除する', async () => {
    const fs = makeFakeFs({
      'a.meta.json5': '{}',
      'a.is': 's',
      'a.history.json5': '{ entries: [] }',
    })
    const col = makeCollection(fs)
    await col.deleteItemFiles(item({ name: 'a', fileBase: 'a' }))
    expect(fs.files.size).toBe(0)
  })

  it('履歴サイドカーが無くても失敗しない', async () => {
    const fs = makeFakeFs({ 'a.meta.json5': '{}', 'a.is': 's' })
    const col = makeCollection(fs)
    await col.deleteItemFiles(item({ name: 'a', fileBase: 'a' }))
    expect(fs.files.size).toBe(0)
  })

  it('fileBase 未割当なら no-op', async () => {
    const fs = makeFakeFs({ 'a.meta.json5': '{}' })
    const col = makeCollection(fs)
    await col.deleteItemFiles(item({ name: 'a' }))
    expect(fs.files.size).toBe(1)
  })
})

describe('renameItemFiles', () => {
  it('src → meta → 履歴を新 slug へ rename し fileBase を更新する', async () => {
    const fs = makeFakeFs({
      'old.meta.json5': '{ installId: "p1", name: "old" }',
      'old.is': 'code',
      'old.history.json5': '{ entries: [] }',
    })
    const col = makeCollection(fs)
    const w = item({ name: 'New Name', fileBase: 'old' })
    await col.renameItemFiles(w, [w])

    expect(w.fileBase).toBe('new-name')
    expect(fs.files.get('new-name.is')).toBe('code')
    expect(fs.files.has('new-name.meta.json5')).toBe(true)
    expect(fs.files.has('new-name.history.json5')).toBe(true)
    expect(fs.files.has('old.is')).toBe(false)
    expect(fs.files.has('old.meta.json5')).toBe(false)
  })

  it('履歴サイドカーが無ければ skip する', async () => {
    const fs = makeFakeFs({
      'old.meta.json5': '{}',
      'old.is': 'code',
    })
    const col = makeCollection(fs)
    const w = item({ name: 'fresh', fileBase: 'old' })
    await col.renameItemFiles(w, [w])
    expect(fs.files.has('fresh.is')).toBe(true)
    expect(fs.files.has('fresh.history.json5')).toBe(false)
  })

  it('占有されていれば連番で回避する', async () => {
    const fs = makeFakeFs({
      'old.meta.json5': '{}',
      'old.is': 'code',
      'taken.meta.json5': '{}',
    })
    const col = makeCollection(fs)
    const w = item({ name: 'taken', fileBase: 'old' })
    await col.renameItemFiles(w, [w])
    expect(w.fileBase).toBe('taken-2')
  })

  it('slug が変わらないリネームは no-op (自身は占有と見なさない)', async () => {
    const fs = makeFakeFs({
      'alpha.meta.json5': '{}',
      'alpha.is': 'code',
    })
    const col = makeCollection(fs)
    const w = item({ name: 'Alpha', fileBase: 'alpha' })
    await col.renameItemFiles(w, [w])
    expect(w.fileBase).toBe('alpha')
    expect(fs.files.has('alpha.is')).toBe(true)
  })

  it('casefold 一致 (大文字小文字のみ違い) は中間名経由の 2 段で行う', async () => {
    const fs = makeFakeFs({
      'Alpha.meta.json5': '{ installId: "p1" }',
      'Alpha.is': 'code',
    })
    const col = makeCollection(fs)
    const w = item({ name: 'alpha', fileBase: 'Alpha' })
    await col.renameItemFiles(w, [w])
    expect(w.fileBase).toBe('alpha')
    expect(fs.files.get('alpha.is')).toBe('code')
    expect(fs.files.has('Alpha.is')).toBe(false)
    // 中間名の残骸が無い
    expect(fs.files.size).toBe(2)
  })

  it('fileBase 未割当なら no-op (persist 側で割当する)', async () => {
    const fs = makeFakeFs()
    const col = makeCollection(fs)
    const w = item({ name: 'a' })
    await col.renameItemFiles(w, [w])
    expect(w.fileBase).toBeUndefined()
  })
})

describe('migrateItems (copy-adopt)', () => {
  it('規約外名を新 slug へ copy-adopt し旧ファイルを削除する', async () => {
    const fs = makeFakeFs({
      'My Widget.meta.json5':
        '{\n  // keep me\n  installId: "i1",\n  name: "My Widget",\n}',
      'My Widget.is': 'code',
    })
    const col = makeCollection(fs)
    const { items } = await col.loadAll()
    await col.migrateItems(items)

    expect(items[0]?.fileBase).toBe('my-widget')
    // 生メタ内容の最小変換 (コメント保持・再シリアライズしない)
    expect(fs.files.get('my-widget.meta.json5')).toContain('// keep me')
    expect(fs.files.get('my-widget.is')).toBe('code')
    expect(fs.files.has('My Widget.meta.json5')).toBe(false)
    expect(fs.files.has('My Widget.is')).toBe(false)
  })

  it('規約適合名は触らない (冪等)', async () => {
    const fs = makeFakeFs({
      'ok.meta.json5': '{ installId: "i1", name: "ok" }',
      'ok.is': 'code',
    })
    const col = makeCollection(fs)
    const { items } = await col.loadAll()
    const before = new Map(fs.files)
    await col.migrateItems(items)
    expect(fs.files).toEqual(before)
    expect(items[0]?.fileBase).toBe('ok')
  })

  it('2 回実行しても結果が変わらない (冪等)', async () => {
    const fs = makeFakeFs({
      'Bad Name.meta.json5': '{ installId: "i1", name: "Bad Name" }',
      'Bad Name.is': 'code',
    })
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

  it('ソースを欠く readOnly アイテムは据え置く', async () => {
    const fs = makeFakeFs({
      'Bad Name.meta.json5': '{ installId: "i1", name: "Bad Name" }',
    })
    const col = makeCollection(fs)
    const { items } = await col.loadAll()
    expect(items[0]?.readOnly).toBe(true)
    await col.migrateItems(items)
    expect(fs.files.has('Bad Name.meta.json5')).toBe(true)
    expect(fs.files.has('bad-name.meta.json5')).toBe(false)
    // 空ソースを書かない
    expect(fs.files.has('bad-name.is')).toBe(false)
  })

  describe('slug 衝突時の達成済み判定', () => {
    it('衝突先が同 ID かつ同内容なら旧削除のみ再実行する', async () => {
      // クラッシュ残骸: 新名は書けたが旧削除前に落ちたケース
      const oldMeta = '{ installId: "i1", name: "Bad Name" }'
      const fs = makeFakeFs({
        'Bad Name.meta.json5': oldMeta,
        'Bad Name.is': 'code',
        'bad-name.meta.json5': oldMeta,
        'bad-name.is': 'code',
      })
      const col = makeCollection(fs)
      const { items } = await col.loadAll()
      // バイト順で 'Bad Name' が先勝ち、'bad-name' は重複 ID skip
      expect(items).toHaveLength(1)
      expect(items[0]?.fileBase).toBe('Bad Name')

      await col.migrateItems(items)
      expect(items[0]?.fileBase).toBe('bad-name')
      expect(fs.files.has('Bad Name.meta.json5')).toBe(false)
      expect(fs.files.has('Bad Name.is')).toBe(false)
      expect(fs.files.get('bad-name.is')).toBe('code')
      // suffix 名は作られない
      expect(fs.files.has('bad-name-2.meta.json5')).toBe(false)
    })

    it('同 ID・内容不一致なら削除せず suffix へ退避する', async () => {
      const fs = makeFakeFs({
        'Bad Name.meta.json5': '{ installId: "i1", name: "Bad Name" }',
        'Bad Name.is': 'new-code',
        'bad-name.meta.json5': '{ installId: "i1", name: "Bad Name" }',
        'bad-name.is': 'old-code',
      })
      const col = makeCollection(fs)
      const { items } = await col.loadAll()
      await col.migrateItems(items)
      // 衝突先は温存、対象は suffix 名で正規化
      expect(fs.files.get('bad-name.is')).toBe('old-code')
      expect(items[0]?.fileBase).toBe('bad-name-2')
      expect(fs.files.get('bad-name-2.is')).toBe('new-code')
      expect(fs.files.has('Bad Name.is')).toBe(false)
    })

    it('ID 不一致なら単純な占有として suffix する', async () => {
      const fs = makeFakeFs({
        'Bad Name.meta.json5': '{ installId: "i1", name: "Bad Name" }',
        'Bad Name.is': 'code',
        'bad-name.meta.json5': '{ installId: "other", name: "bad-name" }',
        'bad-name.is': 'other-code',
      })
      const col = makeCollection(fs)
      const { items } = await col.loadAll()
      await col.migrateItems(items)
      const migrated = items.find((i) => i.installId === 'i1')
      expect(migrated?.fileBase).toBe('bad-name-2')
      expect(fs.files.get('bad-name.is')).toBe('other-code')
    })
  })

  it('新旧名が casefold 一致なら中間名経由で移行する', async () => {
    const fs = makeFakeFs({
      'Alpha.meta.json5': '{ installId: "i1", name: "Alpha" }',
      'Alpha.is': 'code',
    })
    const col = makeCollection(fs)
    const { items } = await col.loadAll()
    await col.migrateItems(items)
    expect(items[0]?.fileBase).toBe('alpha')
    expect(fs.files.get('alpha.is')).toBe('code')
    expect(fs.files.has('Alpha.is')).toBe(false)
    expect(fs.files.has('Alpha.meta.json5')).toBe(false)
    // 中間名の残骸が無い (meta/src の 2 ファイルのみ)
    expect(fs.files.size).toBe(2)
  })

  it('表示名が欠損なら種別 fallback で slug 化する', async () => {
    const fs = makeFakeFs({
      '無題.meta.json5': '{ installId: "i1" }',
      '無題.is': 'code',
    })
    const col = makeCollection(fs)
    const { items } = await col.loadAll()
    await col.migrateItems(items)
    expect(items[0]?.fileBase).toBe('widget')
    expect(fs.files.has('widget.is')).toBe(true)
  })
})

describe('sweepHistory', () => {
  it('主ファイルと対応の取れない .history.json5 を削除する', async () => {
    const fs = makeFakeFs({
      'alive.meta.json5': '{ installId: "i1", name: "alive" }',
      'alive.is': 'code',
      'alive.history.json5': '{ entries: [] }',
      'dead.history.json5': '{ entries: [] }',
    })
    const col = makeCollection(fs)
    await col.sweepHistory()
    expect(fs.files.has('alive.history.json5')).toBe(true)
    expect(fs.files.has('dead.history.json5')).toBe(false)
  })

  it('パース不能・スキップ個体の主ファイルの履歴は保全する (読込採否を問わない)', async () => {
    const fs = makeFakeFs({
      'broken.meta.json5': '{{{ not json5',
      'broken.history.json5': '{ entries: [] }',
      'orphan.is': 'code',
      'orphan.history.json5': '{ entries: [] }',
    })
    const col = makeCollection(fs)
    await col.sweepHistory()
    expect(fs.files.has('broken.history.json5')).toBe(true)
    expect(fs.files.has('orphan.history.json5')).toBe(true)
  })

  it('照合は casefold で行う', async () => {
    const fs = makeFakeFs({
      'Alpha.meta.json5': '{}',
      'alpha.history.json5': '{ entries: [] }',
    })
    const col = makeCollection(fs)
    await col.sweepHistory()
    expect(fs.files.has('alpha.history.json5')).toBe(true)
  })
})
