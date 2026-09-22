// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDropInRecord } from '@/services/themeDropIn'
import type { MisskeyTheme } from '@/theme/types'

/** インメモリ疑似 FS (themes/ ディレクトリ相当 + ルートの採用記録)。 */
const files = new Map<string, string>()
let record = ''

vi.mock('@/utils/settingsFs', () => ({
  isTauri: true,
  isMainDeckWindow: () => true,
  THEME_EXT: '.ndtheme.json5',
  listThemeDirFiles: async () => Array.from(files.keys()),
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
  renameTheme: async (a: string, b: string) => {
    files.set(b, files.get(a) as string)
    files.delete(a)
  },
  readThemeDropInRecord: async () => record,
  writeThemeDropInRecord: async (c: string) => {
    record = c
  },
}))

import { adoptDropIns } from './themeFileSync'

const COMMUNITY = `{
  id: "community-original-id",
  name: "Sakura",
  author: "someone",
  base: "light",
  props: { bg: "#fff" },
}`

describe('themeFileSync.adoptDropIns — themes/ の素の .json5 を取り込む (#1041)', () => {
  beforeEach(() => {
    files.clear()
    record = ''
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('テーマとして解釈できた素の .json5 を新 ID の slug 名ファイルにコピーして採用し、元ファイルは触らない', async () => {
    files.set('Sakura Theme.json5', COMMUNITY)
    const adopted = await adoptDropIns([])
    expect(adopted).toHaveLength(1)
    const t = adopted[0] as MisskeyTheme
    expect(t.id).not.toBe('community-original-id')
    expect(t.id).toMatch(/^custom-\d+/)
    expect(t.name).toBe('Sakura')
    expect(t.base).toBe('light')
    expect(t.fileBase).toBe('sakura')
    expect(files.get('sakura.ndtheme.json5')).toContain(t.id)
    // 元ファイルはそのまま
    expect(files.get('Sakura Theme.json5')).toBe(COMMUNITY)
    // 採用記録に元ファイル名 (casefold) → ID
    expect(parseDropInRecord(record)).toEqual({ 'sakura theme.json5': t.id })
  })

  it('採用済みの元ファイルは再起動しても再採用しない (採用後のリネームで slug が空いても)', async () => {
    files.set('sakura.json5', COMMUNITY)
    const [first] = await adoptDropIns([])
    if (!first) throw new Error('not adopted')
    // アプリ内リネームで slug が空いた状態を作る
    files.delete('sakura.ndtheme.json5')
    files.set('renamed.ndtheme.json5', '{ id: "x", props: {} }')
    const again = await adoptDropIns([{ ...first, fileBase: 'renamed' }])
    expect(again).toEqual([])
    expect(files.has('sakura.ndtheme.json5')).toBe(false)
  })

  it('テーマでない素の .json5 は採用も記録もしない', async () => {
    files.set('notes.json5', '{ hello: "world" }')
    expect(await adoptDropIns([])).toEqual([])
    expect(record).toBe('')
    expect(files.size).toBe(1)
  })

  it('元ファイルが消えたら記録を落とし、再 drop したら採用し直す', async () => {
    files.set('sakura.json5', COMMUNITY)
    const [first] = await adoptDropIns([])
    if (!first) throw new Error('not adopted')
    files.delete('sakura.json5')
    await adoptDropIns([first])
    expect(record).not.toContain('sakura.json5')

    files.set('sakura.json5', COMMUNITY)
    const [second] = await adoptDropIns([first])
    expect(second?.id).not.toBe(first.id)
    expect(second?.fileBase).toBe('sakura-2')
  })

  it('slug が既存テーマとぶつかれば連番で避ける', async () => {
    files.set(
      'sakura.ndtheme.json5',
      '{ id: "mine", name: "Sakura", props: {} }',
    )
    files.set('drop.json5', COMMUNITY)
    const mine: MisskeyTheme = {
      id: 'mine',
      name: 'Sakura',
      base: 'dark',
      props: {},
      fileBase: 'sakura',
    }
    const [t] = await adoptDropIns([mine])
    expect(t?.fileBase).toBe('sakura-2')
    expect(files.has('sakura-2.ndtheme.json5')).toBe(true)
  })
})
