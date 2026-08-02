import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'

const apiApShow = vi.hoisted(() => vi.fn())

vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: { apiApShow },
  }
})

vi.mock('@/adapters/factory', () => ({
  destroyAdapter: vi.fn(),
}))

vi.mock('@/composables/useMemos', () => ({
  deleteAllMemos: vi.fn(),
}))

import {
  type Account,
  accountScopeKey,
  useAccountsStore,
} from '@/stores/accounts'
import {
  _clearResolutionCacheForTest,
  invalidateResolutionCache,
  resolveNoteFor,
  resolveNoteUriFor,
} from './entityResolution'

function makeAccount(overrides: Partial<Account> & { id: string }): Account {
  return {
    host: 'a.example',
    userId: `user-${overrides.id}`,
    username: `user-${overrides.id}`,
    displayName: null,
    avatarUrl: null,
    software: 'misskey-dev/misskey',
    hasToken: true,
    ...overrides,
  }
}

function makeNote(
  overrides: Partial<NormalizedNote> & {
    id: string
    _accountId: string
    _serverHost: string
  },
): NormalizedNote {
  return {
    createdAt: '2025-01-01T00:00:00.000Z',
    text: null,
    cw: null,
    user: {
      id: 'u1',
      username: 'test',
      host: null,
      name: 'Test',
      avatarUrl: null,
    },
    visibility: 'public',
    emojis: {},
    reactionEmojis: {},
    reactions: {},
    renoteCount: 0,
    repliesCount: 0,
    files: [],
    ...overrides,
  }
}

const REMOTE_URI = 'https://remote.example/notes/remote1'

function apShowOk(type: string, object: unknown) {
  apiApShow.mockResolvedValue({ status: 'ok', data: { type, object } })
}

function apShowError(code: string, message: string, apiCode?: string) {
  apiApShow.mockResolvedValue({
    status: 'error',
    error: { code, message, apiCode: apiCode ?? null },
  })
}

describe('resolveNoteUriFor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    _clearResolutionCacheForTest()
    apiApShow.mockReset()
  })

  it('アカウントが見つからなければ throw する', async () => {
    await expect(resolveNoteUriFor('missing', REMOTE_URI)).rejects.toThrow()
  })

  it('同一ホストのノート URL は ap/show なしで解決する', async () => {
    const store = useAccountsStore()
    store.accounts.push(makeAccount({ id: 'acc-1', host: 'a.example' }))

    const result = await resolveNoteUriFor(
      'acc-1',
      'https://a.example/notes/n1',
    )

    expect(result).toEqual({ ok: true, noteId: 'n1' })
    expect(apiApShow).not.toHaveBeenCalled()
  })

  it('同一ホスト高速パスはトークンなしでも動く', async () => {
    const store = useAccountsStore()
    store.accounts.push(
      makeAccount({ id: 'acc-1', host: 'a.example', hasToken: false }),
    )

    const result = await resolveNoteUriFor(
      'acc-1',
      'https://a.example/notes/n1',
    )

    expect(result).toEqual({ ok: true, noteId: 'n1' })
  })

  it('リモート URI でトークンがなければ no_token を返す', async () => {
    const store = useAccountsStore()
    store.accounts.push(makeAccount({ id: 'acc-1', hasToken: false }))

    const result = await resolveNoteUriFor('acc-1', REMOTE_URI)

    expect(result).toMatchObject({ ok: false, code: 'no_token' })
    expect(apiApShow).not.toHaveBeenCalled()
  })

  it('ap/show が Note を返せばローカル noteId に解決する', async () => {
    const store = useAccountsStore()
    store.accounts.push(makeAccount({ id: 'acc-1' }))
    apShowOk('Note', { id: 'local1' })

    const result = await resolveNoteUriFor('acc-1', REMOTE_URI)

    expect(result).toEqual({ ok: true, noteId: 'local1' })
    expect(apiApShow).toHaveBeenCalledWith('acc-1', REMOTE_URI)
  })

  it('ap/show が Note 以外を返せば not_found', async () => {
    const store = useAccountsStore()
    store.accounts.push(makeAccount({ id: 'acc-1' }))
    apShowOk('User', { id: 'u1' })

    const result = await resolveNoteUriFor('acc-1', REMOTE_URI)

    expect(result).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('ap/show の object.id が文字列でなければ not_found', async () => {
    const store = useAccountsStore()
    store.accounts.push(makeAccount({ id: 'acc-1' }))
    apShowOk('Note', {})

    const result = await resolveNoteUriFor('acc-1', REMOTE_URI)

    expect(result).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('NO_SUCH 系 API エラーは not_found にマップする', async () => {
    const store = useAccountsStore()
    store.accounts.push(makeAccount({ id: 'acc-1' }))
    apShowError(
      'API',
      'misskey api error: NO_SUCH_OBJECT: object not found',
      'NO_SUCH_OBJECT',
    )

    const result = await resolveNoteUriFor('acc-1', REMOTE_URI)

    expect(result).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('404 を含むエラーは not_found にマップする', async () => {
    const store = useAccountsStore()
    store.accounts.push(makeAccount({ id: 'acc-1' }))
    apShowError('API', 'HTTP 404 Not Found')

    const result = await resolveNoteUriFor('acc-1', REMOTE_URI)

    expect(result).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('ネットワーク系エラーは retryable にマップする', async () => {
    const store = useAccountsStore()
    store.accounts.push(makeAccount({ id: 'acc-1' }))
    apShowError('NETWORK', 'connection refused')

    const result = await resolveNoteUriFor('acc-1', REMOTE_URI)

    expect(result).toMatchObject({ ok: false, code: 'retryable' })
  })

  it('レート制限エラーは retryable にマップする', async () => {
    const store = useAccountsStore()
    store.accounts.push(makeAccount({ id: 'acc-1' }))
    apShowError('API', 'misskey api error: RATE_LIMIT_EXCEEDED: slow down')

    const result = await resolveNoteUriFor('acc-1', REMOTE_URI)

    expect(result).toMatchObject({ ok: false, code: 'retryable' })
  })

  it('解決結果はキャッシュされ ap/show は 1 回しか呼ばれない', async () => {
    const store = useAccountsStore()
    store.accounts.push(makeAccount({ id: 'acc-1' }))
    apShowOk('Note', { id: 'local1' })

    const first = await resolveNoteUriFor('acc-1', REMOTE_URI)
    const second = await resolveNoteUriFor('acc-1', REMOTE_URI)

    expect(first).toEqual({ ok: true, noteId: 'local1' })
    expect(second).toEqual({ ok: true, noteId: 'local1' })
    expect(apiApShow).toHaveBeenCalledTimes(1)
  })

  it('失敗は負キャッシュされず再試行できる', async () => {
    const store = useAccountsStore()
    store.accounts.push(makeAccount({ id: 'acc-1' }))
    apShowError('NETWORK', 'connection refused')

    const first = await resolveNoteUriFor('acc-1', REMOTE_URI)
    apShowOk('Note', { id: 'local1' })
    const second = await resolveNoteUriFor('acc-1', REMOTE_URI)

    expect(first).toMatchObject({ ok: false, code: 'retryable' })
    expect(second).toEqual({ ok: true, noteId: 'local1' })
    expect(apiApShow).toHaveBeenCalledTimes(2)
  })

  it('invalidateResolutionCache でスコープのキャッシュが無効化される', async () => {
    const store = useAccountsStore()
    const account = makeAccount({ id: 'acc-1' })
    store.accounts.push(account)
    apShowOk('Note', { id: 'local1' })

    await resolveNoteUriFor('acc-1', REMOTE_URI)
    invalidateResolutionCache(accountScopeKey(account))
    await resolveNoteUriFor('acc-1', REMOTE_URI)

    expect(apiApShow).toHaveBeenCalledTimes(2)
  })

  it('キャッシュキーはアカウントスコープ別に分かれる', async () => {
    const store = useAccountsStore()
    store.accounts.push(makeAccount({ id: 'acc-1' }))
    store.accounts.push(makeAccount({ id: 'acc-2', host: 'b.example' }))
    apShowOk('Note', { id: 'local1' })

    await resolveNoteUriFor('acc-1', REMOTE_URI)
    await resolveNoteUriFor('acc-2', REMOTE_URI)

    expect(apiApShow).toHaveBeenCalledTimes(2)
  })
})

describe('resolveNoteFor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    _clearResolutionCacheForTest()
    apiApShow.mockReset()
  })

  it('同一アカウントのノートは短絡して自身の id を返す', async () => {
    const note = makeNote({
      id: 'n1',
      _accountId: 'acc-1',
      _serverHost: 'a.example',
    })

    const result = await resolveNoteFor('acc-1', note)

    expect(result).toEqual({ ok: true, noteId: 'n1' })
    expect(apiApShow).not.toHaveBeenCalled()
  })

  it('別アカウントのノートは getNoteUri 経由で解決する', async () => {
    const store = useAccountsStore()
    store.accounts.push(makeAccount({ id: 'acc-2', host: 'b.example' }))
    apShowOk('Note', { id: 'local-b' })
    const note = makeNote({
      id: 'n1',
      _accountId: 'acc-1',
      _serverHost: 'a.example',
      uri: REMOTE_URI,
    })

    const result = await resolveNoteFor('acc-2', note)

    expect(result).toEqual({ ok: true, noteId: 'local-b' })
    expect(apiApShow).toHaveBeenCalledWith('acc-2', REMOTE_URI)
  })

  it('uri のないローカルノートは推定 URI で解決する', async () => {
    const store = useAccountsStore()
    store.accounts.push(makeAccount({ id: 'acc-2', host: 'b.example' }))
    apShowOk('Note', { id: 'local-b' })
    const note = makeNote({
      id: 'n1',
      _accountId: 'acc-1',
      _serverHost: 'a.example',
    })

    const result = await resolveNoteFor('acc-2', note)

    expect(result).toEqual({ ok: true, noteId: 'local-b' })
    expect(apiApShow).toHaveBeenCalledWith(
      'acc-2',
      'https://a.example/notes/n1',
    )
  })
})
