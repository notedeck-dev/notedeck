// @vitest-environment happy-dom
import JSON5 from 'json5'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** インメモリ疑似 FS (profiles/ ディレクトリ相当)。 */
const files = new Map<string, string>()

vi.mock('@/utils/settingsFs', () => ({
  isTauri: true,
  isMainDeckWindow: () => true,
  PROFILE_EXT: '.ndprofile.json5',
  listProfileDirFiles: async () => Array.from(files.keys()),
  readProfile: async (f: string) => {
    const c = files.get(f)
    if (c === undefined) throw new Error(`not found: ${f}`)
    return c
  },
  writeProfile: async (f: string, c: string) => {
    files.set(f, c)
  },
  deleteProfile: async (f: string) => {
    files.delete(f)
  },
  renameProfile: async (a: string, b: string) => {
    if (!files.has(a)) throw new Error(`not found: ${a}`)
    if (files.has(b)) throw new Error(`already exists: ${b}`)
    files.set(b, files.get(a) as string)
    files.delete(a)
  },
}))

import type { DeckColumn } from '@/stores/deck'
import { useDeckProfileStore } from '@/stores/deckProfile'
import { STORAGE_KEYS, setStorageJson, setStorageString } from '@/utils/storage'

const EXT = '.ndprofile.json5'

const profileFile = (data: Record<string, unknown>) =>
  JSON5.stringify(data, null, 2)

const homeColumn = (id: string) =>
  ({ id, type: 'home' }) as unknown as DeckColumn

async function initStore() {
  const store = useDeckProfileStore()
  store.ensureDefaults([], [])
  await vi.waitFor(() => {
    expect(store.initialized).toBe(true)
  })
  return store
}

describe('useDeckProfileStore — ファイル対応表配線 (#913)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    files.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('ファイル内の id を採用し fileBase (対応表) を保持する', async () => {
    files.set(
      `main${EXT}`,
      profileFile({
        id: 'my-id',
        name: 'メイン',
        columns: [],
        layout: [],
        createdAt: 1,
      }),
    )
    const store = await initStore()
    const p = store.getProfiles().find((x) => x.id === 'my-id')
    expect(p).toBeDefined()
    expect(p?.fileBase).toBe('main')
    expect(p?.name).toBe('メイン')
  })

  it('id 欠損は拡張子込みの完全ファイル名で凍結し、規約外名は slug へ正規化する', async () => {
    files.set(
      `プロファイル 1${EXT}`,
      profileFile({
        name: 'プロファイル 1',
        columns: [],
        layout: [],
        createdAt: 1,
      }),
    )
    const store = await initStore()
    // 凍結: 実効値 = 拡張子込みの旧完全ファイル名 (= 現行フォールバックと同値)
    const p = store.getProfiles().find((x) => x.id === `プロファイル 1${EXT}`)
    expect(p).toBeDefined()
    // 移行 (a): ファイルだけ slug 化 (表示名 'プロファイル 1' → '1')
    expect(p?.fileBase).toBe('1')
    expect(files.has(`1${EXT}`)).toBe(true)
    expect(files.has(`プロファイル 1${EXT}`)).toBe(false)
    // 凍結 ID は生内容への最小変換で注入されている
    expect(files.get(`1${EXT}`)).toContain(`id: 'プロファイル 1${EXT}'`)
  })

  it('凍結により activeProfileId / windowProfileId / デッキ内容が無追随で生き続ける', async () => {
    const legacyId = `プロファイル 1${EXT}`
    const col = homeColumn('col-1')
    files.set(
      legacyId,
      profileFile({
        name: 'プロファイル 1',
        columns: [col],
        layout: [['col-1']],
        createdAt: 1,
      }),
    )
    setStorageJson(STORAGE_KEYS.deckProfiles, [
      {
        id: legacyId,
        name: 'プロファイル 1',
        columns: [col],
        layout: [['col-1']],
        createdAt: 1,
      },
    ])
    setStorageString(STORAGE_KEYS.deckActiveProfile, legacyId)

    const store = await initStore()
    store.initWindowProfile(legacyId)

    expect(store.activeProfileId).toBe(legacyId)
    expect(store.windowProfileId).toBe(legacyId)
    expect(store.currentProfile?.name).toBe('プロファイル 1')
    expect(store.currentProfile?.columns).toEqual([col])
    expect(store.currentProfile?.layout).toEqual([['col-1']])
  })

  it('リネームは表示名のみ変更し (ID 不変)、ファイルは rename で追随する', async () => {
    files.set(
      `work${EXT}`,
      profileFile({
        id: 'work',
        name: 'Work',
        columns: [],
        layout: [],
        createdAt: 1,
      }),
    )
    setStorageJson(STORAGE_KEYS.deckProfiles, [
      { id: 'work', name: 'Work', columns: [], layout: [], createdAt: 1 },
    ])
    setStorageString(STORAGE_KEYS.deckActiveProfile, 'work')
    const store = await initStore()
    store.initWindowProfile('work')

    store.renameProfile('work', 'Play')

    await vi.waitFor(() => {
      expect(files.has(`play${EXT}`)).toBe(true)
    })
    expect(files.has(`work${EXT}`)).toBe(false)
    const p = store.getProfiles().find((x) => x.id === 'work')
    expect(p?.name).toBe('Play')
    expect(p?.fileBase).toBe('play')
    // ID が不変なので参照の追随は不要
    expect(store.activeProfileId).toBe('work')
    expect(store.windowProfileId).toBe('work')
    expect(files.get(`play${EXT}`)).toContain("id: 'work'")
  })

  it('新規作成はファイル名・ID とも slug 形式になる', async () => {
    const store = await initStore()
    const created = store.createEmptyProfile('My Deck')
    expect(created.id).toBe('my-deck')
    await vi.waitFor(() => {
      expect(files.has(`my-deck${EXT}`)).toBe(true)
    })
    expect(files.get(`my-deck${EXT}`)).toContain("id: 'my-deck'")
  })

  it('デフォルトプロファイルも ASCII slug ファイル名で作られる (日本語ファイル名を生まない)', async () => {
    const store = await initStore()
    // slugifyName('プロファイル 1') は数字だけ残して '1' になる
    await vi.waitFor(() => {
      expect(files.has(`1${EXT}`)).toBe(true)
    })
    expect(store.activeProfileId).toBe('1')
    expect(store.getProfiles()[0]?.name).toBe('プロファイル 1')
    for (const name of files.keys()) {
      expect(name).toMatch(/^[a-z0-9-]+\.ndprofile\.json5$/)
    }
  })

  it('移行 (b): ミラーに在りファイル不在のプロファイルを slug 名で再作成する', async () => {
    setStorageJson(STORAGE_KEYS.deckProfiles, [
      { id: 'lost-id', name: 'Lost', columns: [], layout: [], createdAt: 5 },
    ])
    setStorageString(STORAGE_KEYS.deckActiveProfile, 'lost-id')
    const store = await initStore()
    await vi.waitFor(() => {
      expect(files.has(`lost${EXT}`)).toBe(true)
    })
    expect(files.get(`lost${EXT}`)).toContain("id: 'lost-id'")
    expect(store.activeProfileId).toBe('lost-id')
  })

  it('memOnly マージは「ID 一致 or 名前+作成日時一致」で複製を落とす', async () => {
    files.set(
      `main${EXT}`,
      profileFile({ name: 'メイン', columns: [], layout: [], createdAt: 42 }),
    )
    // ダウングレード往復でファイル内 id が剥がれ、ミラーだけ旧 ID を持つ状況
    setStorageJson(STORAGE_KEYS.deckProfiles, [
      {
        id: 'stale-mirror-id',
        name: 'メイン',
        columns: [],
        layout: [],
        createdAt: 42,
      },
    ])
    const store = await initStore()
    const withName = store.getProfiles().filter((p) => p.name === 'メイン')
    expect(withName).toHaveLength(1)
    expect(withName[0]?.id).toBe(`main${EXT}`)
    // ミラー複製が移行 (b) でファイル再作成されない
    expect(files.size).toBe(1)
    // マージで落ちた ID を指していたアクティブ参照は修復される
    expect(store.activeProfileId).toBe(`main${EXT}`)
  })

  it('削除は対応表のファイルを消す', async () => {
    files.set(
      `work${EXT}`,
      profileFile({
        id: 'w1',
        name: 'Work',
        columns: [],
        layout: [],
        createdAt: 1,
      }),
    )
    const store = await initStore()
    store.deleteProfile('w1')
    await vi.waitFor(() => {
      expect(files.has(`work${EXT}`)).toBe(false)
    })
  })

  it('保存はファイル内の未知フィールドを保持し fileBase を書かない', async () => {
    files.set(
      `main${EXT}`,
      profileFile({
        id: 'm',
        name: 'メイン',
        columns: [],
        layout: [],
        createdAt: 1,
        futureField: 'keep',
      }),
    )
    const store = await initStore()
    store.initWindowProfile('m')
    store.setColumns([homeColumn('c-new')])
    store.flushPersist()
    await vi.waitFor(() => {
      expect(files.get(`main${EXT}`)).toContain('c-new')
    })
    expect(files.get(`main${EXT}`)).toContain('futureField')
    expect(files.get(`main${EXT}`)).toContain("id: 'm'")
    expect(files.get(`main${EXT}`)).not.toContain('fileBase')
  })

  it('保存の直前にミラーの対応表を読み直す (別ウィンドウのリネーム追随)', async () => {
    files.set(
      `main${EXT}`,
      profileFile({
        id: 'm',
        name: 'メイン',
        columns: [],
        layout: [],
        createdAt: 1,
      }),
    )
    const store = await initStore()
    store.initWindowProfile('m')
    // 別ウィンドウのリネームをシミュレート (ファイルとミラーだけが動き、
    // このウィンドウのメモリは古いまま)
    files.set(`renamed${EXT}`, files.get(`main${EXT}`) as string)
    files.delete(`main${EXT}`)
    setStorageJson(STORAGE_KEYS.deckProfiles, [
      {
        id: 'm',
        name: 'メイン',
        columns: [],
        layout: [],
        createdAt: 1,
        fileBase: 'renamed',
      },
    ])

    store.setColumns([homeColumn('c-new')])
    store.flushPersist()
    await vi.waitFor(() => {
      expect(files.get(`renamed${EXT}`)).toContain('c-new')
    })
    expect(files.has(`main${EXT}`)).toBe(false)
  })

  it('削除の直前にミラーの対応表を読み直す (stale 名の空振りで復活させない)', async () => {
    files.set(
      `main${EXT}`,
      profileFile({
        id: 'm',
        name: 'メイン',
        columns: [],
        layout: [],
        createdAt: 1,
      }),
    )
    const store = await initStore()
    // 別ウィンドウのリネームをシミュレート
    files.set(`renamed${EXT}`, files.get(`main${EXT}`) as string)
    files.delete(`main${EXT}`)
    setStorageJson(STORAGE_KEYS.deckProfiles, [
      {
        id: 'm',
        name: 'メイン',
        columns: [],
        layout: [],
        createdAt: 1,
        fileBase: 'renamed',
      },
    ])

    store.deleteProfile('m')
    await vi.waitFor(() => {
      expect(files.has(`renamed${EXT}`)).toBe(false)
    })
  })
})
