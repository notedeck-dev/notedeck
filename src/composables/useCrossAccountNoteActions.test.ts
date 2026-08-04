import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import { AppError } from '@/utils/errors'

const {
  resolveNoteForMock,
  createReactionMock,
  deleteReactionMock,
  createNoteMock,
  getOrCreateMock,
  toastShowMock,
  confirmMock,
} = vi.hoisted(() => ({
  resolveNoteForMock: vi.fn(),
  createReactionMock: vi.fn(),
  deleteReactionMock: vi.fn(),
  createNoteMock: vi.fn(),
  getOrCreateMock: vi.fn(),
  toastShowMock: vi.fn(),
  confirmMock: vi.fn<(opts: unknown) => Promise<boolean>>(),
}))

vi.mock('@/services/entityResolution', () => ({
  resolveNoteFor: resolveNoteForMock,
}))
vi.mock('@/composables/useMultiAccountAdapters', () => ({
  useMultiAccountAdapters: () => ({ getOrCreate: getOrCreateMock }),
}))
vi.mock('@/stores/toast', () => ({
  useToast: () => ({ show: toastShowMock }),
}))
vi.mock('@/stores/confirm', () => ({
  useConfirm: () => ({ confirm: confirmMock }),
}))

import { useAccountsStore } from '@/stores/accounts'
import { useCrossAccountNoteActions } from './useCrossAccountNoteActions'

function note(partial: Partial<NormalizedNote> = {}): NormalizedNote {
  return {
    id: 'n1',
    _accountId: 'acc-src',
    _serverHost: 'misskey.example',
    createdAt: '2026-07-01T00:00:00.000Z',
    text: 'hello',
    cw: null,
    user: {
      id: 'u1',
      username: 'alice',
      host: null,
      name: 'アリス',
      avatarUrl: null,
    },
    visibility: 'public',
    emojis: {},
    reactionEmojis: {},
    reactions: {},
    renoteCount: 0,
    repliesCount: 0,
    files: [],
    localOnly: false,
    ...partial,
  }
}

/** unwrap が投げる Rust 側エラーの shape（AppError.from で解釈される） */
const apiError = (code: string) =>
  new AppError('API', `notes/reactions/create: ${code}: detail`, code)

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  useAccountsStore().accounts.push({
    id: 'acc-2',
    host: 'other.example',
    userId: 'u-remote',
    username: 'bob',
    displayName: 'ボブ',
    avatarUrl: null,
    software: 'misskey-dev/misskey',
    hasToken: true,
  })
  getOrCreateMock.mockResolvedValue({
    api: {
      createReaction: createReactionMock,
      deleteReaction: deleteReactionMock,
      createNote: createNoteMock,
    },
  })
})

describe('useCrossAccountNoteActions: reactAs (#627)', () => {
  it('resolve 失敗 (no_token) では toast を出して createReaction を呼ばない', async () => {
    resolveNoteForMock.mockResolvedValueOnce({
      ok: false,
      code: 'no_token',
      message: 'no token',
    })
    await useCrossAccountNoteActions().reactAs('acc-2', note(), '👍')
    expect(toastShowMock).toHaveBeenCalledWith(
      expect.stringContaining('未ログイン'),
      'error',
    )
    expect(createReactionMock).not.toHaveBeenCalled()
  })

  it('resolve 失敗 (not_found) では toast を出して createReaction を呼ばない', async () => {
    resolveNoteForMock.mockResolvedValueOnce({
      ok: false,
      code: 'not_found',
      message: 'not found',
    })
    await useCrossAccountNoteActions().reactAs('acc-2', note(), '👍')
    expect(toastShowMock).toHaveBeenCalledWith(
      expect.stringContaining('見つけられませんでした'),
      'error',
    )
    expect(createReactionMock).not.toHaveBeenCalled()
  })

  it('resolve 失敗 (retryable) では toast を出して createReaction を呼ばない', async () => {
    resolveNoteForMock.mockResolvedValueOnce({
      ok: false,
      code: 'retryable',
      message: 'timeout',
    })
    await useCrossAccountNoteActions().reactAs('acc-2', note(), '👍')
    expect(toastShowMock).toHaveBeenCalledWith(
      expect.stringContaining('再試行'),
      'error',
    )
    expect(createReactionMock).not.toHaveBeenCalled()
  })

  it('成功パス: 解決した noteId で createReaction し success toast を出す', async () => {
    resolveNoteForMock.mockResolvedValueOnce({ ok: true, noteId: 'remote-n1' })
    createReactionMock.mockResolvedValueOnce(undefined)
    await useCrossAccountNoteActions().reactAs('acc-2', note(), '👍')
    expect(resolveNoteForMock).toHaveBeenCalledWith(
      'acc-2',
      expect.objectContaining({ id: 'n1' }),
    )
    expect(createReactionMock).toHaveBeenCalledWith('remote-n1', '👍')
    expect(toastShowMock).toHaveBeenCalledWith(
      '@bob@other.example でリアクションしました',
      'success',
    )
    expect(confirmMock).not.toHaveBeenCalled()
  })

  it('ALREADY_REACTED で confirm 承諾なら deleteReaction を呼ぶ', async () => {
    resolveNoteForMock.mockResolvedValueOnce({ ok: true, noteId: 'remote-n1' })
    createReactionMock.mockRejectedValueOnce(apiError('ALREADY_REACTED'))
    confirmMock.mockResolvedValueOnce(true)
    deleteReactionMock.mockResolvedValueOnce(undefined)
    await useCrossAccountNoteActions().reactAs('acc-2', note(), '👍')
    expect(confirmMock).toHaveBeenCalled()
    expect(deleteReactionMock).toHaveBeenCalledWith('remote-n1')
    expect(toastShowMock).toHaveBeenCalledWith(
      expect.stringContaining('解除しました'),
      'success',
    )
  })

  it('ALREADY_REACTED で confirm 拒否なら何もしない', async () => {
    resolveNoteForMock.mockResolvedValueOnce({ ok: true, noteId: 'remote-n1' })
    createReactionMock.mockRejectedValueOnce(apiError('ALREADY_REACTED'))
    confirmMock.mockResolvedValueOnce(false)
    await useCrossAccountNoteActions().reactAs('acc-2', note(), '👍')
    expect(deleteReactionMock).not.toHaveBeenCalled()
    // 成功 toast も失敗 toast も出さない
    expect(toastShowMock).not.toHaveBeenCalled()
  })

  it('その他の createReaction エラーは confirm せず error toast を出す', async () => {
    resolveNoteForMock.mockResolvedValueOnce({ ok: true, noteId: 'remote-n1' })
    createReactionMock.mockRejectedValueOnce(apiError('RATE_LIMIT_EXCEEDED'))
    await useCrossAccountNoteActions().reactAs('acc-2', note(), '👍')
    expect(confirmMock).not.toHaveBeenCalled()
    expect(deleteReactionMock).not.toHaveBeenCalled()
    expect(toastShowMock).toHaveBeenCalledWith(
      expect.stringContaining('RATE_LIMIT_EXCEEDED'),
      'error',
    )
  })
})

describe('useCrossAccountNoteActions: renoteAs (#627)', () => {
  it('成功パス: 解決した noteId で createNote({ renoteId }) し success toast を出す', async () => {
    resolveNoteForMock.mockResolvedValueOnce({ ok: true, noteId: 'remote-n1' })
    createNoteMock.mockResolvedValueOnce(undefined)
    await useCrossAccountNoteActions().renoteAs('acc-2', note())
    expect(createNoteMock).toHaveBeenCalledWith({ renoteId: 'remote-n1' })
    expect(toastShowMock).toHaveBeenCalledWith(
      '@bob@other.example でリノートしました',
      'success',
    )
  })

  it('resolve 失敗では createNote を呼ばず error toast を出す', async () => {
    resolveNoteForMock.mockResolvedValueOnce({
      ok: false,
      code: 'not_found',
      message: 'not found',
    })
    await useCrossAccountNoteActions().renoteAs('acc-2', note())
    expect(createNoteMock).not.toHaveBeenCalled()
    expect(toastShowMock).toHaveBeenCalledWith(
      expect.stringContaining('見つけられませんでした'),
      'error',
    )
  })

  it('createNote エラーは error toast を出す', async () => {
    resolveNoteForMock.mockResolvedValueOnce({ ok: true, noteId: 'remote-n1' })
    createNoteMock.mockRejectedValueOnce(apiError('CANNOT_RENOTE'))
    await useCrossAccountNoteActions().renoteAs('acc-2', note())
    expect(toastShowMock).toHaveBeenCalledWith(
      expect.stringContaining('CANNOT_RENOTE'),
      'error',
    )
  })
})

describe('useCrossAccountNoteActions: quoteAs (#627)', () => {
  it('成功パス: 投稿フォーム起動用の { accountId, renoteId } を返す', async () => {
    resolveNoteForMock.mockResolvedValueOnce({ ok: true, noteId: 'remote-n1' })
    const target = await useCrossAccountNoteActions().quoteAs('acc-2', note())
    expect(target).toEqual({ accountId: 'acc-2', renoteId: 'remote-n1' })
    expect(toastShowMock).not.toHaveBeenCalled()
  })

  it('resolve 失敗では null を返し error toast を出す', async () => {
    resolveNoteForMock.mockResolvedValueOnce({
      ok: false,
      code: 'retryable',
      message: 'timeout',
    })
    const target = await useCrossAccountNoteActions().quoteAs('acc-2', note())
    expect(target).toBeNull()
    expect(toastShowMock).toHaveBeenCalledWith(
      expect.stringContaining('再試行'),
      'error',
    )
  })
})
