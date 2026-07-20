import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/tauriInvoke', () => {
  const ok = { status: 'ok', data: null }
  return {
    commands: {
      apiCreateNote: vi.fn(async () => ok),
      apiDeleteNote: vi.fn(async () => ok),
      apiUpdateNote: vi.fn(async () => ok),
      apiCreateReaction: vi.fn(async () => ok),
      apiDeleteReaction: vi.fn(async () => ok),
      apiFollowUser: vi.fn(async () => ok),
      apiUnfollowUser: vi.fn(async () => ok),
      apiCreateFavorite: vi.fn(async () => ok),
      apiDeleteFavorite: vi.fn(async () => ok),
    },
    unwrap: (r: { status: string; data?: unknown; error?: unknown }) => {
      if (r.status === 'ok') return r.data
      throw r.error
    },
  }
})

import { commands } from '@/utils/tauriInvoke'
import { type CliHandlerDeps, createCliHandlers } from './cliHandlers'

interface FakeColumn {
  id: string
  type: string
  accountId: string | null
  tl?: string
}

function makeDeps(
  overrides: { activeAccountId?: string | null; columns?: FakeColumn[] } = {},
) {
  const deckStore = {
    columns: overrides.columns ?? [],
    addColumn: vi.fn(),
    setActiveColumn: vi.fn(),
    invalidateColumnByKey: vi.fn(),
  }
  const accountsStore = {
    activeAccount:
      overrides.activeAccountId === null
        ? undefined
        : { id: overrides.activeAccountId ?? 'acc-1' },
  }
  const deps = {
    deckStore,
    accountsStore,
    navigateToNote: vi.fn(),
    navigateToUser: vi.fn(),
    toggleAccountMenu: vi.fn(),
  }
  return {
    deps,
    handlers: createCliHandlers(deps as unknown as CliHandlerDeps),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('post', () => {
  it('does nothing without an active account or without text', async () => {
    const noAccount = makeDeps({ activeAccountId: null })
    await noAccount.handlers.post?.('hello')
    const withAccount = makeDeps()
    await withAccount.handlers.post?.('   ')
    expect(commands.apiCreateNote).not.toHaveBeenCalled()
  })

  it('posts plain text with public visibility defaults', async () => {
    const { handlers } = makeDeps()
    await handlers.post?.('hello world')
    expect(commands.apiCreateNote).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({
        text: 'hello world',
        cw: null,
        visibility: 'public',
        replyId: null,
        localOnly: null,
      }),
      null,
    )
  })

  it('parses --cw (quoted), --visibility, --reply-to and --local-only flags', async () => {
    const { handlers } = makeDeps()
    await handlers.post?.(
      '--cw "spoiler alert" --visibility followers --reply-to n123 --local-only hi there',
    )
    expect(commands.apiCreateNote).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({
        text: 'hi there',
        cw: 'spoiler alert',
        visibility: 'followers',
        replyId: 'n123',
        localOnly: true,
      }),
      null,
    )
  })

  it('falls back to public for invalid visibility values', async () => {
    const { handlers } = makeDeps()
    await handlers.post?.('--visibility bogus hi')
    expect(commands.apiCreateNote).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({ visibility: 'public', text: 'hi' }),
      null,
    )
  })

  it('does not post when only flags remain (no positional text)', async () => {
    const { handlers } = makeDeps()
    await handlers.post?.('--cw secret')
    expect(commands.apiCreateNote).not.toHaveBeenCalled()
  })
})

describe('column-opening handlers', () => {
  it('search adds a search column with the trimmed query', async () => {
    const { deps, handlers } = makeDeps()
    await handlers.search?.('  misskey  ')
    expect(deps.deckStore.addColumn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'search',
        accountId: 'acc-1',
        query: 'misskey',
      }),
    )
  })

  it('timeline defaults to home when no args given', async () => {
    const { deps, handlers } = makeDeps()
    await handlers.timeline?.('')
    expect(deps.deckStore.addColumn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'timeline',
        tl: 'home',
        accountId: 'acc-1',
      }),
    )
  })

  it('timeline focuses an existing matching column instead of adding', async () => {
    const existing: FakeColumn = {
      id: 'col-1',
      type: 'timeline',
      tl: 'local',
      accountId: 'acc-1',
    }
    const { deps, handlers } = makeDeps({ columns: [existing] })
    await handlers.timeline?.('local')
    expect(deps.deckStore.setActiveColumn).toHaveBeenCalledWith('col-1')
    expect(deps.deckStore.addColumn).not.toHaveBeenCalled()
  })

  it('notifications dedupes per account', async () => {
    const existing: FakeColumn = {
      id: 'col-n',
      type: 'notifications',
      accountId: 'acc-1',
    }
    const { deps, handlers } = makeDeps({ columns: [existing] })
    await handlers.notifications?.('')
    expect(deps.deckStore.setActiveColumn).toHaveBeenCalledWith('col-n')
    expect(deps.deckStore.addColumn).not.toHaveBeenCalled()
  })
})

describe('note navigation and mutation', () => {
  it('note navigates to the trimmed note id', async () => {
    const { deps, handlers } = makeDeps()
    await handlers.note?.(' n42 ')
    expect(deps.navigateToNote).toHaveBeenCalledWith('acc-1', 'n42')
  })

  it('user navigates to the trimmed user id', async () => {
    const { deps, handlers } = makeDeps()
    await handlers.user?.('u7')
    expect(deps.navigateToUser).toHaveBeenCalledWith('acc-1', 'u7')
  })

  it('delete calls apiDeleteNote with the note id', async () => {
    const { handlers } = makeDeps()
    await handlers.delete?.('n99')
    expect(commands.apiDeleteNote).toHaveBeenCalledWith('acc-1', 'n99')
  })

  it('update requires both id and text', async () => {
    const { handlers } = makeDeps()
    await handlers.update?.('only-id')
    expect(commands.apiUpdateNote).not.toHaveBeenCalled()
  })

  it('update parses id, --cw flag and remaining text', async () => {
    const { handlers } = makeDeps()
    await handlers.update?.('n1 --cw warn new body text')
    expect(commands.apiUpdateNote).toHaveBeenCalledWith(
      'acc-1',
      'n1',
      expect.objectContaining({ text: 'new body text', cw: 'warn' }),
    )
  })

  it('renote creates a note with renoteId only', async () => {
    const { handlers } = makeDeps()
    await handlers.renote?.('n5')
    expect(commands.apiCreateNote).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({
        text: null,
        renoteId: 'n5',
        visibility: 'public',
      }),
      null,
    )
  })
})

describe('react', () => {
  it('requires both note id and reaction', async () => {
    const { handlers } = makeDeps()
    await handlers.react?.('n1')
    expect(commands.apiCreateReaction).not.toHaveBeenCalled()
  })

  it('sends the reaction, joining trailing parts with spaces', async () => {
    const { handlers } = makeDeps()
    await handlers.react?.('n1 :ablob: extra')
    expect(commands.apiCreateReaction).toHaveBeenCalledWith(
      'acc-1',
      'n1',
      ':ablob: extra',
    )
  })
})

describe('favorite / unfavorite', () => {
  it('favorite calls the API and invalidates the favorites column', async () => {
    const { deps, handlers } = makeDeps()
    await handlers.favorite?.('n1')
    expect(commands.apiCreateFavorite).toHaveBeenCalledWith('acc-1', 'n1')
    expect(deps.deckStore.invalidateColumnByKey).toHaveBeenCalledWith(
      'favorites',
    )
  })

  it('unfavorite calls the API and invalidates the favorites column', async () => {
    const { deps, handlers } = makeDeps()
    await handlers.unfavorite?.('n1')
    expect(commands.apiDeleteFavorite).toHaveBeenCalledWith('acc-1', 'n1')
    expect(deps.deckStore.invalidateColumnByKey).toHaveBeenCalledWith(
      'favorites',
    )
  })
})

describe('accounts', () => {
  it('toggles the account menu even without an active account', async () => {
    const { deps, handlers } = makeDeps({ activeAccountId: null })
    await handlers.accounts?.('')
    expect(deps.toggleAccountMenu).toHaveBeenCalled()
  })
})
