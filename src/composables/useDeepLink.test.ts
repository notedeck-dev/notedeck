import { beforeEach, describe, expect, it, vi } from 'vitest'

// アプリ全体向けルート (#512): compose / ai / memo/new / profile / column。
// アカウント付きルートの分岐 (notedeck://<host>/...) はここでは扱わない。

const {
  requestCompose,
  columns,
  addColumn,
  updateColumn,
  setActiveColumn,
  applyProfile,
  profiles,
  saveMemo,
  ensureMemosLoaded,
  confirm,
  misStore,
} = vi.hoisted(() => {
  type Col = {
    id: string
    type: string
    accountId: string | null
    aiInitialInput?: string
  }
  const columns: Col[] = []
  return {
    requestCompose: vi.fn(),
    columns,
    addColumn: vi.fn((partial: Omit<Col, 'id'>) => {
      const col = { ...partial, id: `c${columns.length + 1}` }
      columns.push(col)
      return col
    }),
    updateColumn: vi.fn((id: string, updates: Partial<Col>) => {
      const col = columns.find((c) => c.id === id)
      if (col) Object.assign(col, updates)
    }),
    setActiveColumn: vi.fn(),
    applyProfile: vi.fn(),
    profiles: [
      { id: 'main', name: 'Main' },
      { id: 'work-2', name: '仕事 用' },
    ],
    saveMemo: vi.fn(),
    ensureMemosLoaded: vi.fn(async () => undefined),
    confirm: vi.fn(async (_opts: { title: string; message: string }) => true),
    misStore: {
      plugins: [
        {
          id: 'p1',
          name: 'Translator',
          version: '1.0.0',
          author: 'alice',
          capabilities: ['misskey-api'],
        },
        {
          id: 'p2',
          name: 'Future',
          version: '9.0.0',
          author: 'carol',
          capabilities: ['teleport'],
        },
      ],
      themes: [{ id: 't1', name: 'Dusk', version: '2.0.0', author: 'bob' }],
      fetchPlugins: vi.fn(async () => undefined),
      fetchThemes: vi.fn(async () => undefined),
      isInstalled: vi.fn(() => false),
      isThemeInstalled: vi.fn(() => false),
      installPlugin: vi.fn(async () => undefined),
      installTheme: vi.fn(async () => undefined),
    },
  }
})

vi.mock('@/stores/ui', () => ({
  useUiStore: () => ({ requestCompose }),
}))

vi.mock('@/stores/accounts', () => ({
  useAccountsStore: () => ({ accounts: [] }),
}))

vi.mock('@/stores/deck', () => ({
  useDeckStore: () => ({
    columns,
    getColumn: (id: string) => columns.find((c) => c.id === id),
    addColumn,
    updateColumn,
    setActiveColumn,
    applyProfile,
  }),
}))

vi.mock('@/stores/deckProfile', () => ({
  useDeckProfileStore: () => ({ getProfiles: () => profiles }),
}))

vi.mock('@/stores/misstore', () => ({ useMisStoreStore: () => misStore }))
vi.mock('@/stores/confirm', () => ({ useConfirm: () => ({ confirm }) }))
vi.mock('@/stores/windows', () => ({
  useWindowsStore: () => ({ open: vi.fn() }),
}))

vi.mock('@/composables/useMemos', () => ({
  saveMemo,
  ensureMemosLoaded,
  generateMemoKey: () => 'memo-key-1',
}))

import { handleDeepLink } from '@/composables/useDeepLink'

beforeEach(() => {
  vi.clearAllMocks()
  columns.length = 0
})

describe('notedeck://compose', () => {
  it('投稿フォームを本文 / CW / 公開範囲つきで開く要求を出す (送信はしない)', async () => {
    await handleDeepLink(
      'notedeck://compose?text=hello%20world&cw=%E6%B3%A8%E6%84%8F&visibility=home',
    )
    expect(requestCompose).toHaveBeenCalledWith({
      text: 'hello world',
      cw: '注意',
      visibility: 'home',
    })
  })

  it('パラメータ無しでも開く要求だけは出す', async () => {
    await handleDeepLink('notedeck://compose')
    expect(requestCompose).toHaveBeenCalledWith({})
  })

  it('不正な公開範囲は捨てる', async () => {
    await handleDeepLink('notedeck://compose?text=a&visibility=secret')
    expect(requestCompose).toHaveBeenCalledWith({ text: 'a' })
  })
})

describe('notedeck://ai', () => {
  it('AI カラムが無ければ追加し、プロンプトを入力欄の初期値として渡す', async () => {
    await handleDeepLink(
      'notedeck://ai?prompt=%E8%A6%81%E7%B4%84%E3%81%97%E3%81%A6',
    )
    expect(addColumn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ai',
        accountId: null,
        aiInitialInput: '要約して',
      }),
    )
  })

  it('AI カラムが既にあれば再利用してフォーカスする', async () => {
    columns.push({ id: 'ai1', type: 'ai', accountId: null })
    await handleDeepLink('notedeck://ai?prompt=hi')
    expect(addColumn).not.toHaveBeenCalled()
    expect(updateColumn).toHaveBeenCalledWith('ai1', { aiInitialInput: 'hi' })
    expect(setActiveColumn).toHaveBeenCalledWith('ai1')
  })

  it('プロンプト無しでは入力欄に何も入れない', async () => {
    await handleDeepLink('notedeck://ai')
    expect(addColumn).toHaveBeenCalledWith(
      expect.not.objectContaining({ aiInitialInput: expect.anything() }),
    )
  })
})

describe('notedeck://memo/new', () => {
  it('本文つきでメモを 1 件作る', async () => {
    await handleDeepLink('notedeck://memo/new?text=buy%20milk')
    expect(ensureMemosLoaded).toHaveBeenCalled()
    expect(saveMemo).toHaveBeenCalledWith(
      'memo-key-1',
      expect.objectContaining({
        text: 'buy milk',
        visibility: 'public',
        tags: [],
      }),
    )
  })

  it('本文が無ければ作らない', async () => {
    await handleDeepLink('notedeck://memo/new')
    expect(saveMemo).not.toHaveBeenCalled()
  })
})

describe('notedeck://profile', () => {
  it('表示名でプロファイルを切り替える (URL エンコード済みの名前も可)', async () => {
    await handleDeepLink('notedeck://profile/%E4%BB%95%E4%BA%8B%20%E7%94%A8')
    expect(applyProfile).toHaveBeenCalledWith('work-2')
  })

  it('id でも切り替えられる', async () => {
    await handleDeepLink('notedeck://profile/main')
    expect(applyProfile).toHaveBeenCalledWith('main')
  })

  it('見つからなければ何もしない', async () => {
    await handleDeepLink('notedeck://profile/nope')
    expect(applyProfile).not.toHaveBeenCalled()
  })
})

describe('notedeck://column', () => {
  it('存在するカラムをアクティブにする', async () => {
    columns.push({ id: 'col-9', type: 'timeline', accountId: 'a' })
    await handleDeepLink('notedeck://column/col-9')
    expect(setActiveColumn).toHaveBeenCalledWith('col-9')
  })

  it('存在しないカラムでは何もしない', async () => {
    await handleDeepLink('notedeck://column/missing')
    expect(setActiveColumn).not.toHaveBeenCalled()
  })
})

// リンクは Web ページに埋め込んで踏ませられるので、インストールは確認を経る (#1204)
describe('notedeck://install-plugin', () => {
  it('名前・作者・要求する機能を見せて確認し、承認されたら全体スコープで入れる', async () => {
    await handleDeepLink('notedeck://install-plugin?id=p1')
    expect(confirm).toHaveBeenCalledTimes(1)
    const opts = confirm.mock.calls[0]?.[0]
    expect(opts?.message).toContain('Translator')
    expect(opts?.message).toContain('alice')
    expect(opts?.message).toContain('misskey-api')
    expect(misStore.installPlugin).toHaveBeenCalledWith(misStore.plugins[0], {
      kind: 'global',
    })
  })

  it('承認しなければ入れない', async () => {
    confirm.mockResolvedValueOnce(false)
    await handleDeepLink('notedeck://install-plugin?id=p1')
    expect(misStore.installPlugin).not.toHaveBeenCalled()
  })

  // ストアのカラムと同じ判定 (#1205)。未対応の機能を要求するものは入れずに理由を伝える
  it('未対応の機能を要求するプラグインは入れず、未対応の機能名を伝える', async () => {
    await handleDeepLink('notedeck://install-plugin?id=p2')
    expect(confirm).toHaveBeenCalledTimes(1)
    const opts = confirm.mock.calls[0]?.[0] as {
      message: string
      hideCancel?: boolean
    }
    expect(opts.message).toContain('teleport')
    expect(opts.hideCancel).toBe(true)
    expect(misStore.installPlugin).not.toHaveBeenCalled()
  })

  it('入っているものは確認も出さない', async () => {
    misStore.isInstalled.mockReturnValueOnce(true)
    await handleDeepLink('notedeck://install-plugin?id=p1')
    expect(confirm).not.toHaveBeenCalled()
    expect(misStore.installPlugin).not.toHaveBeenCalled()
  })
})

describe('notedeck://install-theme', () => {
  it('名前と作者を見せて確認し、承認されたら入れる', async () => {
    await handleDeepLink('notedeck://install-theme?id=t1')
    const opts = confirm.mock.calls[0]?.[0]
    expect(opts?.message).toContain('Dusk')
    expect(opts?.message).toContain('bob')
    expect(misStore.installTheme).toHaveBeenCalledWith(misStore.themes[0])
  })

  it('承認しなければ入れない', async () => {
    confirm.mockResolvedValueOnce(false)
    await handleDeepLink('notedeck://install-theme?id=t1')
    expect(misStore.installTheme).not.toHaveBeenCalled()
  })
})
