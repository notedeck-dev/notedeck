// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** インメモリ疑似 FS (skills/ ディレクトリ相当)。 */
const files = new Map<string, string>()

vi.mock('@/windows/roles', () => ({
  announceWindow: async () => undefined,
  isRepresentativeNow: async () => true,
  whenRepresentative: async () => undefined,
  useRepresentative: () => ({
    isRepresentative: { value: true },
    isViewing: { value: true },
    representative: { value: 'main' },
    viewing: { value: 'main' },
  }),
}))

vi.mock('@/utils/settingsFs', () => ({
  isTauri: true,
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

import { type SkillItem, useSkillsStore } from '@/stores/skills'

const skillFile = (id: string, name: string, body = 'body') =>
  `---\nid: ${id}\nname: ${name}\nversion: 0.1.0\nmode: manual\ncreatedAt: 1\nupdatedAt: 1\n---\n${body}`

async function initStore() {
  const store = useSkillsStore()
  await store.whenReady()
  return store
}

function makeSkill(id: string, name: string, store?: SkillItem['store']) {
  return {
    id,
    name,
    store,
    scope: { kind: 'none' } as const,
    content: 'b',
    extra: {
      version: '0.1.0',
      mode: 'manual' as const,
      triggers: [],
      builtIn: false,
      cheapCheckCapabilities: [],
      isPersona: false,
    },
  }
}

describe('useSkillsStore — ファイル対応表配線 (#913)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    files.clear()
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
    await store.add(makeSkill('x1-abcd', 'My New Skill'))
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
    await store.update('a1', { name: 'Beta' })
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
    await store.update('a1', { content: 'new body' })
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
    await store.remove('a1')
    await vi.waitFor(() => {
      expect(files.has('alpha.md')).toBe(false)
    })
    expect(files.has('alpha.history.json5')).toBe(false)
  })

  it('同一 ID を主張する 2 件目のファイルは skip され削除されない', async () => {
    files.set('a.md', skillFile('dup', 'A'))
    files.set('b.md', skillFile('dup', 'B'))
    const store = await initStore()
    expect(store.items.filter((s) => s.id === 'dup')).toHaveLength(1)
    expect(store.get('dup')?.fileBase).toBe('a')
    expect(files.has('b.md')).toBe(true)
  })

  it('storeId 付きの新規 (ストアインストール) は storeId をファイル名にする (#913)', async () => {
    files.set('seed.md', skillFile('seed', 'Seed'))
    const store = await initStore()
    await store.add(
      makeSkill('ent-skill', '日本語の表示名', { id: 'ent-skill' }),
    )
    await vi.waitFor(() => {
      expect(files.has('ent-skill.md')).toBe(true)
    })
  })

  it('storeSha512 / storeVersion は frontmatter に永続化され読み戻せる (#913)', async () => {
    files.set(
      'greeter.md',
      '---\nid: g1\nname: Greeter\nversion: 1.0.0\nmode: manual\nstoreId: ent\nstoreSha512: abc123\nstoreVersion: 1.0.0\ncreatedAt: 1\nupdatedAt: 1\n---\nbody',
    )
    const store = await initStore()
    expect(store.get('g1')?.store).toEqual({
      id: 'ent',
      sha512: 'abc123',
      version: '1.0.0',
    })
    await store.update('g1', { content: 'new body' })
    await vi.waitFor(() => {
      expect(files.get('greeter.md')).toContain('new body')
    })
    expect(files.get('greeter.md')).toContain('storeSha512: abc123')
    expect(files.get('greeter.md')).toContain('storeVersion: 1.0.0')
  })
})

describe('useSkillsStore — 有効 / 無効のファイル化 (#1116)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    files.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('有効にするとファイルに active: true が書かれ、無効に戻すと消える', async () => {
    files.set('alpha.md', skillFile('alpha', 'Alpha'))
    const store = await initStore()
    await store.setActive('alpha', true)
    await vi.waitFor(() => {
      expect(files.get('alpha.md')).toContain('active: true')
    })
    await store.setActive('alpha', false)
    await vi.waitFor(() => {
      expect(files.get('alpha.md')).not.toContain('active')
    })
  })

  it('初回起動で端末ローカルの有効一覧をファイルへ移し、一覧は消す', async () => {
    files.set('alpha.md', skillFile('alpha', 'Alpha'))
    files.set('beta.md', skillFile('beta', 'Beta'))
    localStorage.setItem('nd-skills-active', JSON.stringify(['alpha', 'gone']))
    const store = await initStore()
    await vi.waitFor(() => {
      expect(files.get('alpha.md')).toContain('active: true')
    })
    expect(store.isActive('alpha')).toBe(true)
    expect(store.isActive('beta')).toBe(false)
    expect(files.get('beta.md')).not.toContain('active')
    expect(localStorage.getItem('nd-skills-active')).toBeNull()
  })
})

describe('useSkillsStore — 旧 active 一覧が壊れていても初期化を止めない (#1118 レビュー指摘)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    files.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('配列でない値 (オブジェクト等) は捨てて初期化を完了する', async () => {
    files.set('alpha.md', skillFile('alpha', 'Alpha'))
    localStorage.setItem('nd-skills-active', '{}')
    const store = await initStore()
    expect(store.get('alpha')).toBeDefined()
    expect(store.isActive('alpha')).toBe(false)
    expect(localStorage.getItem('nd-skills-active')).toBeNull()
  })
})

describe('useSkillsStore — 予約 skill AGENTS.md / HEARTBEAT.md (#1162)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    files.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('ファイル名から reserved を立て、mode はファイルが何と言おうと固定する', async () => {
    files.set(
      'AGENTS.md',
      skillFile('AGENTS', 'AGENTS').replace(
        'mode: manual',
        'mode: manual\nisPersona: true',
      ),
    )
    files.set('HEARTBEAT.md', skillFile('HEARTBEAT', 'HEARTBEAT'))
    files.set('agents-guide.md', skillFile('agents-guide', 'Agents Guide'))
    const store = await initStore()
    const agents = store.get('AGENTS')
    expect(agents?.extra.reserved).toBe(true)
    expect(agents?.extra.mode).toBe('always')
    expect(agents?.extra.isPersona).toBe(false)
    expect(agents?.fileBase).toBe('AGENTS')
    const heartbeat = store.get('HEARTBEAT')
    expect(heartbeat?.extra.reserved).toBe(true)
    expect(heartbeat?.extra.mode).toBe('heartbeat')
    expect(store.heartbeatSkills.map((s) => s.id)).toEqual(['HEARTBEAT'])
    // 似た名前の普通の skill は予約にならない
    expect(store.get('agents-guide')?.extra.reserved).toBeUndefined()
  })

  it('大文字のファイル名は規約外名の copy-adopt 移行の対象にしない', async () => {
    files.set('AGENTS.md', skillFile('AGENTS', 'AGENTS'))
    await initStore()
    expect(files.has('AGENTS.md')).toBe(true)
    expect(files.has('agents.md')).toBe(false)
  })

  it('改名 / mode 変更 / persona 化 / 有効無効 / 削除を拒否し、本文は書ける', async () => {
    files.set('HEARTBEAT.md', skillFile('HEARTBEAT', 'HEARTBEAT'))
    const store = await initStore()
    await expect(
      store.update('HEARTBEAT', { name: 'rounds' }),
    ).rejects.toThrow()
    await expect(
      store.update('HEARTBEAT', { extra: { mode: 'manual' } }),
    ).rejects.toThrow()
    await expect(
      store.update('HEARTBEAT', { extra: { isPersona: true } }),
    ).rejects.toThrow()
    await expect(store.setHeartbeat('HEARTBEAT', false)).rejects.toThrow()
    await expect(store.setActive('HEARTBEAT', true)).rejects.toThrow()
    await expect(store.remove('HEARTBEAT')).rejects.toThrow()
    expect(store.get('HEARTBEAT')?.extra.mode).toBe('heartbeat')
    // 同じ値を送るのは改名でも mode 変更でもない (エディタの自動保存)
    await store.update('HEARTBEAT', {
      name: 'HEARTBEAT',
      content: '- check drafts\n',
      extra: { mode: 'heartbeat' },
    })
    await vi.waitFor(() => {
      expect(files.get('HEARTBEAT.md')).toContain('- check drafts')
    })
  })

  it('reload は notemaid が置いたファイルを写しに載せる', async () => {
    const store = await initStore()
    files.set('HEARTBEAT.md', skillFile('HEARTBEAT', 'HEARTBEAT', ''))
    await store.reload('HEARTBEAT.md')
    const s = store.get('HEARTBEAT')
    expect(s?.extra.reserved).toBe(true)
    expect(s?.extra.mode).toBe('heartbeat')
    expect(s?.fileBase).toBe('HEARTBEAT')
  })
})
