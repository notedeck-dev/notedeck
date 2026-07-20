import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, describe, expect, it } from 'vitest'
import { createMisskeyApi } from '@/adapters/misskey/api'
import type { NormalizedNote } from '@/bindings'
import { AppError } from '@/utils/errors'

/**
 * mockIPC (Tauri 公式モック) で IPC 境界を横取りし、specta 生成 bindings の
 * 実コード (snake_case コマンド名・引数シリアライズ・Result 包み) ごと検証する。
 * フィクスチャは bindings 生成型で型固定し、Rust 側の型変更を vue-tsc で検出する。
 */

interface IpcCall {
  cmd: string
  args: Record<string, unknown>
}

function interceptIPC(respond: (cmd: string) => unknown): IpcCall[] {
  const calls: IpcCall[] = []
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: args as Record<string, unknown> })
    return respond(cmd)
  })
  return calls
}

const mockNote: NormalizedNote = {
  id: 'note-1',
  _accountId: 'acc-1',
  _serverHost: 'example.com',
  createdAt: '2025-01-01T00:00:00Z',
  text: 'Hello world',
  cw: null,
  user: {
    id: 'user-1',
    username: 'test',
    host: null,
    name: 'Test',
    avatarUrl: null,
  },
  visibility: 'public',
  emojis: {},
  reactionEmojis: {},
  reactions: { '👍': 3 },
  myReaction: '👍',
  renoteCount: 1,
  repliesCount: 2,
  files: [],
  modeFlags: {},
}

describe('createMisskeyApi', () => {
  const api = createMisskeyApi('acc-1', 'example.com')

  afterEach(() => {
    clearMocks()
  })

  describe('getNote', () => {
    it('invokes api_get_note and returns the result', async () => {
      const calls = interceptIPC(() => mockNote)

      const note = await api.getNote('note-1')

      expect(note.id).toBe('note-1')
      expect(note.text).toBe('Hello world')
      expect(note._accountId).toBe('acc-1')
      expect(note._serverHost).toBe('example.com')

      expect(calls).toEqual([
        { cmd: 'api_get_note', args: { accountId: 'acc-1', noteId: 'note-1' } },
      ])
    })
  })

  describe('createReaction', () => {
    it('invokes api_create_reaction', async () => {
      const calls = interceptIPC(() => null)

      await api.createReaction('note-1', '👍')

      expect(calls).toEqual([
        {
          cmd: 'api_create_reaction',
          args: { accountId: 'acc-1', noteId: 'note-1', reaction: '👍' },
        },
      ])
    })

    it('rejects with AppError(AUTH) in guest mode without touching IPC', async () => {
      const guestApi = createMisskeyApi('acc-1', 'example.com', false)
      const calls = interceptIPC(() => null)

      await expect(guestApi.createReaction('note-1', '👍')).rejects.toThrow(
        AppError,
      )
      expect(calls).toEqual([])
    })
  })

  describe('deleteReaction', () => {
    it('invokes api_delete_reaction', async () => {
      const calls = interceptIPC(() => null)

      await api.deleteReaction('note-1')

      expect(calls).toEqual([
        {
          cmd: 'api_delete_reaction',
          args: { accountId: 'acc-1', noteId: 'note-1' },
        },
      ])
    })
  })

  describe('getTimeline', () => {
    it('invokes api_get_timeline with defaulted options', async () => {
      const calls = interceptIPC(() => [])

      await api.getTimeline('home', { limit: 10 })

      expect(calls).toEqual([
        {
          cmd: 'api_get_timeline',
          args: {
            accountId: 'acc-1',
            timelineType: 'home',
            options: {
              limit: 10,
              sinceId: null,
              untilId: null,
              filters: null,
              listId: null,
            },
          },
        },
      ])
    })
  })

  describe('getUserNotes', () => {
    it('invokes api_get_user_notes with pagination options', async () => {
      const calls = interceptIPC(() => [])

      await api.getUserNotes('user-1', { limit: 20, untilId: 'last-1' })

      expect(calls).toEqual([
        {
          cmd: 'api_get_user_notes',
          args: {
            accountId: 'acc-1',
            userId: 'user-1',
            options: {
              limit: 20,
              sinceId: null,
              untilId: 'last-1',
              filters: null,
            },
          },
        },
      ])
    })
  })

  describe('error handling', () => {
    it('propagates Rust-side errors via the Result error path', async () => {
      interceptIPC(() => {
        // Rust コマンドの reject は Error インスタンスではなく素のオブジェクト
        throw { code: 'API', message: 'notes/show (404)' }
      })

      await expect(api.getNote('bad-id')).rejects.toEqual({
        code: 'API',
        message: 'notes/show (404)',
      })
    })
  })
})
