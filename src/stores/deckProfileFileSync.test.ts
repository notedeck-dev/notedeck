// @vitest-environment happy-dom
import JSON5 from 'json5'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** インメモリ疑似 FS (profiles/ ディレクトリ相当)。 */
const files = new Map<string, string>()
/** true の間は一覧の取得が失敗する (読み込みごと失敗する状況の再現) */
let listFails = false

/** 別ウィンドウの書込通知 (useSettingsFileSync が配線表へ配った後の形)。 */
async function notifyOtherWindow(name: string, op: 'write' | 'delete') {
  await dispatchSettingsChange({ subdir: 'profiles', name, op })
}

vi.mock('@/utils/settingsFs', () => ({
  isTauri: true,
  isMainDeckWindow: () => true,
  PROFILE_EXT: '.ndprofile.json5',
  listProfileDirFiles: async () => {
    if (listFails) throw new Error('list failed')
    return Array.from(files.keys())
  },
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

import { dispatchSettingsChange } from '@/services/settingsFileSync'
import type { DeckColumn } from '@/stores/deck'
import { useDeckProfileStore } from '@/stores/deckProfile'
import { STORAGE_KEYS, setStorageString } from '@/utils/storage'

const EXT = '.ndprofile.json5'

const profileFile = (data: Record<string, unknown>) =>
  JSON5.stringify(data, null, 2)

const homeColumn = (id: string) =>
  ({ id, type: 'home' }) as unknown as DeckColumn

async function initStore() {
  const store = useDeckProfileStore()
  // main.ts と同じ順: 描画前にファイルを読み、デッキ初期化で既定を補う
  await store.preloadFiles()
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
    listFails = false
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

  it('ファイルがあれば初回起動用の仮プロファイルを作らない (#1011)', async () => {
    files.set(
      `main${EXT}`,
      profileFile({
        id: 'main',
        name: 'メイン',
        columns: [],
        layout: [],
        createdAt: 42,
      }),
    )
    const store = await initStore()
    expect(store.getProfiles().map((p) => p.id)).toEqual(['main'])
    expect(files.size).toBe(1)
    expect(store.activeProfileId).toBe('main')
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

  it('別ウィンドウのリネーム通知で対応表を揃え、保存が新しいファイル名へ届く', async () => {
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
    // 別ウィンドウのリネームをシミュレート: ファイルが動き、通知が
    // 「新名の write → 旧名の delete」の順で届く
    files.set(`renamed${EXT}`, files.get(`main${EXT}`) as string)
    files.delete(`main${EXT}`)
    await notifyOtherWindow(`renamed${EXT}`, 'write')
    await notifyOtherWindow(`main${EXT}`, 'delete')
    expect(store.getProfiles().map((p) => p.fileBase)).toEqual(['renamed'])

    store.setColumns([homeColumn('c-new')])
    store.flushPersist()
    await vi.waitFor(() => {
      expect(files.get(`renamed${EXT}`)).toContain('c-new')
    })
    expect(files.has(`main${EXT}`)).toBe(false)
  })

  it('別ウィンドウのリネーム通知の後の削除は新しいファイル名を消す', async () => {
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
    files.set(`renamed${EXT}`, files.get(`main${EXT}`) as string)
    files.delete(`main${EXT}`)
    await notifyOtherWindow(`renamed${EXT}`, 'write')
    await notifyOtherWindow(`main${EXT}`, 'delete')

    store.deleteProfile('m')
    await vi.waitFor(() => {
      expect(files.has(`renamed${EXT}`)).toBe(false)
    })
  })

  it('別ウィンドウの書込通知で写しを揃える (内容の差し替え・追加・削除)', async () => {
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

    // 差し替え: 別ウィンドウがカラムを足した
    files.set(
      `main${EXT}`,
      profileFile({
        id: 'm',
        name: 'メイン',
        columns: [homeColumn('c-other')],
        layout: [['c-other']],
        createdAt: 1,
      }),
    )
    await notifyOtherWindow(`main${EXT}`, 'write')
    expect(store.columns.map((c) => c.id)).toEqual(['c-other'])

    // 追加: 別ウィンドウが新しいプロファイルを作った
    files.set(
      `work${EXT}`,
      profileFile({
        id: 'w',
        name: 'Work',
        columns: [],
        layout: [],
        createdAt: 2,
      }),
    )
    await notifyOtherWindow(`work${EXT}`, 'write')
    expect(store.getProfiles().map((p) => p.id)).toEqual(['m', 'w'])

    // 削除: 表示中のプロファイルが消えたらアクティブへ退避する
    setStorageString(STORAGE_KEYS.deckActiveProfile, 'w')
    files.delete(`main${EXT}`)
    await notifyOtherWindow(`main${EXT}`, 'delete')
    expect(store.getProfiles().map((p) => p.id)).toEqual(['w'])
    expect(store.windowProfileId).toBe('w')
    expect(store.currentProfileName).toBe('Work')
  })

  it('履歴ファイルの通知は無視する', async () => {
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
    await notifyOtherWindow('main.history.json5', 'write')
    expect(store.getProfiles().map((p) => p.id)).toEqual(['m'])
  })
})

describe('useDeckProfileStore — 読み込みに失敗したとき', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    files.clear()
    listFails = false
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('既定のプロファイルで表示はするが、ファイルには書かない (起動のたびに増えない)', async () => {
    const existing = profileFile({
      id: 'main',
      name: 'メイン',
      columns: [],
      layout: [],
      createdAt: 1,
    })
    files.set(`main${EXT}`, existing)
    setStorageString(STORAGE_KEYS.deckActiveProfile, 'main')
    listFails = true

    const store = await initStore()
    expect(store.getProfiles()).toHaveLength(1)
    // 次回の起動で元のアクティブに戻れるよう、保存済みのアクティブは残す
    expect(localStorage.getItem(STORAGE_KEYS.deckActiveProfile)).toBe('main')

    // 一覧が読めるようになっても、このセッション中の変更は書かない
    listFails = false
    const id = store.getProfiles()[0]?.id ?? ''
    store.renameProfile(id, '別名')
    store.flushPersist()
    await new Promise((r) => setTimeout(r, 0))

    expect([...files.keys()]).toEqual([`main${EXT}`])
    expect(files.get(`main${EXT}`)).toBe(existing)
  })
})
