// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** インメモリ疑似 FS (skills/ ディレクトリ相当)。 */
const files = new Map<string, string>()

vi.mock('@/utils/settingsFs', () => ({
  isTauri: true,
  isMainDeckWindow: () => true,
  SKILL_EXT: '.md',
  PROFILE_EXT: '.ndprofile.json5',
  listSkillDirFiles: async () => Array.from(files.keys()),
  readSkillFile: async (f: string) => {
    const c = files.get(f)
    if (c === undefined) throw new Error(`not found: ${f}`)
    return c
  },
  writeSkillFile: async (f: string, c: string) => {
    files.set(f, c)
  },
  deleteSkillFile: async (f: string) => {
    files.delete(f)
  },
  renameSkillFile: async (a: string, b: string) => {
    if (!files.has(a)) throw new Error(`not found: ${a}`)
    if (files.has(b)) throw new Error(`already exists: ${b}`)
    files.set(b, files.get(a) as string)
    files.delete(a)
  },
  // historyFs (pushSnapshot) 用
  readHistorySidecar: async (_k: string, basename: string) =>
    files.get(`${basename}.history.json5`) ?? null,
  writeHistorySidecar: async (
    _k: string,
    basename: string,
    content: string,
  ) => {
    files.set(`${basename}.history.json5`, content)
  },
  deleteHistorySidecar: async (_k: string, basename: string) => {
    files.delete(`${basename}.history.json5`)
  },
}))

import { type SkillMeta, useSkillsStore } from '@/stores/skills'
import { STORAGE_KEYS, setStorageJson } from '@/utils/storage'

// builtin seed が試験対象のファイル群へ混入しないよう、テンプレ id を
// 「seed 済み」として localStorage に前置きする (テンプレ追加に追従)
const tplIds = Object.keys(
  import.meta.glob('@/defaults/skills/*.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
).map((p) => p.split('/').pop()?.replace(/\.md$/, '') ?? '')

const skillFile = (id: string, name: string, body = 'body') =>
  `---\nid: ${id}\nname: ${name}\nversion: 0.1.0\nmode: manual\nscope: global\ncreatedAt: 1\nupdatedAt: 1\n---\n${body}`

async function initStore() {
  const store = useSkillsStore()
  store.ensureLoaded()
  await vi.waitFor(() => {
    expect(store.initialized).toBe(true)
  })
  return store
}

function makeSkill(
  id: string,
  name: string,
): Omit<SkillMeta, 'createdAt' | 'updatedAt'> {
  return {
    id,
    name,
    version: '0.1.0',
    mode: 'manual',
    triggers: [],
    scope: 'global',
    body: 'b',
    cheapCheckCapabilities: [],
  }
}

describe('useSkillsStore — ファイル対応表配線 (#913)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    files.clear()
    setStorageJson(STORAGE_KEYS.skillsSeededBuiltins, tplIds)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('ファイルから読み込み fileBase (対応表) を保持する', async () => {
    files.set('alpha.md', skillFile('alpha', 'Alpha'))
    const store = await initStore()
    expect(store.get('alpha')?.fileBase).toBe('alpha')
  })

  it('frontmatter の id 欠損は拡張子なし basename を凍結する', async () => {
    files.set('my-skill.md', '---\nname: My Skill\n---\nbody')
    const store = await initStore()
    expect(store.get('my-skill')).toBeDefined()
    expect(files.get('my-skill.md')).toContain("id: 'my-skill'")
  })

  it('規約外名は起動時に copy-adopt で正規化される', async () => {
    files.set('マイスキル.md', skillFile('my-id', 'My Skill'))
    const store = await initStore()
    expect(files.has('my-skill.md')).toBe(true)
    expect(files.has('マイスキル.md')).toBe(false)
    expect(store.get('my-id')?.fileBase).toBe('my-skill')
  })

  it('孤児履歴は起動時 sweep で削除される', async () => {
    files.set('alpha.md', skillFile('alpha', 'Alpha'))
    files.set('alpha.history.json5', '{ entries: [] }')
    files.set('dead.history.json5', '{ entries: [] }')
    await initStore()
    expect(files.has('alpha.history.json5')).toBe(true)
    expect(files.has('dead.history.json5')).toBe(false)
  })

  it('新規作成は表示名 slug のファイル名で保存する (ID からではない)', async () => {
    files.set('seed.md', skillFile('seed', 'Seed'))
    const store = await initStore()
    store.add(makeSkill('x1-abcd', 'My New Skill'))
    await vi.waitFor(() => {
      expect(files.has('my-new-skill.md')).toBe(true)
    })
    expect(files.get('my-new-skill.md')).toContain('x1-abcd')
    expect(files.has('x1-abcd.md')).toBe(false)
  })

  it('表示名の変更はファイル rename で追随する (ID 不変・履歴も追随)', async () => {
    files.set('alpha.md', skillFile('a1', 'Alpha'))
    files.set('alpha.history.json5', '{ entries: [] }')
    const store = await initStore()
    store.update('a1', { name: 'Beta' })
    await vi.waitFor(() => {
      expect(files.has('beta.md')).toBe(true)
    })
    expect(files.has('alpha.md')).toBe(false)
    expect(files.has('beta.history.json5')).toBe(true)
    expect(files.has('alpha.history.json5')).toBe(false)
    expect(store.get('a1')?.fileBase).toBe('beta')
    expect(files.get('beta.md')).toContain('a1')
  })

  it('本文更新は編集前 snapshot を fileBase キーで残す', async () => {
    files.set('alpha.md', skillFile('a1', 'Alpha', 'old body'))
    const store = await initStore()
    store.update('a1', { body: 'new body' })
    await vi.waitFor(() => {
      expect(files.has('alpha.history.json5')).toBe(true)
    })
    expect(files.get('alpha.history.json5')).toContain('old body')
    await vi.waitFor(() => {
      expect(files.get('alpha.md')).toContain('new body')
    })
  })

  it('削除は主ファイルと履歴サイドカーを消す', async () => {
    files.set('alpha.md', skillFile('a1', 'Alpha'))
    files.set('alpha.history.json5', '{ entries: [] }')
    const store = await initStore()
    store.remove('a1')
    await vi.waitFor(() => {
      expect(files.has('alpha.md')).toBe(false)
    })
    expect(files.has('alpha.history.json5')).toBe(false)
  })

  it('同一 ID を主張する 2 件目のファイルは skip され削除されない', async () => {
    files.set('a.md', skillFile('dup', 'A'))
    files.set('b.md', skillFile('dup', 'B'))
    const store = await initStore()
    expect(store.skills.filter((s) => s.id === 'dup')).toHaveLength(1)
    expect(store.get('dup')?.fileBase).toBe('a')
    expect(files.has('b.md')).toBe(true)
  })
})
