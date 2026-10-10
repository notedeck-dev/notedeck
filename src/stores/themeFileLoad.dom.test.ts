import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** インメモリ疑似 FS (themes/ ディレクトリ相当)。 */
const files = new Map<string, string>()
/** true の間は一覧の取得が失敗する (読み込みごと失敗する状況の再現) */
let listFails = false

vi.mock('@/utils/settingsFs', async () => {
  const actual =
    await vi.importActual<typeof import('@/utils/settingsFs')>(
      '@/utils/settingsFs',
    )
  return {
    ...actual,
    isTauri: true,
    isMainDeckWindow: () => true,
    listThemeDirFiles: async () => {
      if (listFails) throw new Error('list failed')
      return Array.from(files.keys())
    },
    readTheme: async (f: string) => {
      const c = files.get(f)
      if (c === undefined) throw new Error(`not found: ${f}`)
      return c
    },
    writeTheme: async (f: string, c: string) => {
      files.set(f, c)
    },
    deleteTheme: async (f: string) => {
      files.delete(f)
    },
    renameTheme: async () => undefined,
    readCustomCss: async () => '',
    writeCustomCss: async () => undefined,
    readThemeDropInRecordVersioned: async () => ({ content: '', version: 0 }),
  }
})

import { useThemeStore } from './theme'

const EXT = '.ndtheme.json5'

describe('useThemeStore — 読み込みに失敗したとき', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    files.clear()
    listFails = false
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('同じ ID のテーマを入れても、既存のファイルの横に別名で書かない', async () => {
    const existing = `{ id: 'ame', name: 'AME', base: 'dark', props: { bg: '#000' } }`
    files.set(`ame${EXT}`, existing)
    listFails = true

    const store = useThemeStore()
    store.init()
    // 読み込み (失敗) が済むのを待つ
    await new Promise((r) => setTimeout(r, 0))
    listFails = false

    await store.installTheme(
      JSON.stringify({ id: 'ame', name: 'AME', base: 'dark', props: {} }),
    )
    await new Promise((r) => setTimeout(r, 0))

    expect([...files.keys()]).toEqual([`ame${EXT}`])
    expect(files.get(`ame${EXT}`)).toBe(existing)
  })
})
