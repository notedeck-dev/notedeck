import { emit } from '@tauri-apps/api/event'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MisskeyStream } from '@/adapters/misskey/streaming'
import type { NoteUpdateEvent, RawStreamEvent } from '@/adapters/types'
import type {
  NormalizedNotification,
  NoteCaptureBatch,
  StreamEnvelope,
  StreamStatusEvent,
} from '@/bindings'

/**
 * mockIPC + shouldMockEvents で IPC/イベント境界を丸ごとモックし、
 * 現行 MisskeyStream (typed events #781 + subNote/unsubNote) を
 * Rust なしでイベント駆動テストする。
 * オフライン debounce (#507) は src/adapters/misskey/streaming.test.ts が
 * カバーしているのでここでは扱わない。
 */

interface IpcCall {
  cmd: string
  args: Record<string, unknown>
}

function interceptCommands(
  respond: (cmd: string) => unknown = () => null,
): IpcCall[] {
  const calls: IpcCall[] = []
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args: args as Record<string, unknown> })
      return respond(cmd)
    },
    { shouldMockEvents: true },
  )
  return calls
}

/** listen() 登録などの in-flight Promise を消化する */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const statusEvent = (
  accountId: string,
  state: StreamStatusEvent['state'],
): StreamStatusEvent => ({ accountId, state })

const notification: NormalizedNotification = {
  id: 'notif-1',
  _accountId: 'acc-1',
  _serverHost: 'example.com',
  createdAt: '2025-01-01T00:00:00Z',
  type: 'reaction',
  user: null,
  note: null,
  reaction: '👍',
}

describe('MisskeyStream (IPC boundary)', () => {
  afterEach(() => {
    clearMocks()
    vi.restoreAllMocks()
  })

  describe('connect', () => {
    it('invokes stream_connect and reflects stream-status events', async () => {
      const calls = interceptCommands()
      const stream = new MisskeyStream('acc-1')
      const onConnected = vi.fn()
      stream.on('connected', onConnected)

      stream.connect()
      await flush()

      expect(calls).toContainEqual({
        cmd: 'stream_connect',
        args: { accountId: 'acc-1' },
      })

      await emit('stream-status', statusEvent('acc-1', 'connected'))

      expect(stream.state).toBe('connected')
      expect(onConnected).toHaveBeenCalledTimes(1)
    })

    it('ignores stream-status for other accounts', async () => {
      interceptCommands()
      const stream = new MisskeyStream('acc-1')

      stream.connect()
      await flush()
      await emit('stream-status', statusEvent('acc-2', 'connected'))

      expect(stream.state).toBe('initializing')
    })

    it('falls to disconnected when stream_connect rejects', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      interceptCommands((cmd) => {
        if (cmd === 'stream_connect')
          throw { code: 'WS', message: 'connect failed' }
        return null
      })
      const stream = new MisskeyStream('acc-1')

      stream.connect()
      await flush()

      expect(stream.state).toBe('disconnected')
    })
  })

  describe('subNote / unsubNote', () => {
    it('invokes stream_sub_note and delivers note-capture-batch to the handler', async () => {
      const calls = interceptCommands()
      const stream = new MisskeyStream('acc-1')
      const handler = vi.fn<(event: NoteUpdateEvent) => void>()

      stream.connect()
      await flush()
      stream.subNote('note-1', handler)
      await flush()

      expect(calls).toContainEqual({
        cmd: 'stream_sub_note',
        args: { accountId: 'acc-1', noteId: 'note-1' },
      })

      const batch: NoteCaptureBatch = {
        captures: [
          {
            accountId: 'acc-1',
            noteId: 'note-1',
            updateType: 'reacted',
            body: { reaction: '👍', emoji: null, userId: 'user-1' },
          },
          // 他アカウント宛はフィルタされる
          {
            accountId: 'acc-2',
            noteId: 'note-1',
            updateType: 'reacted',
            body: { reaction: '🎉', emoji: null, userId: 'user-2' },
          },
        ],
      }
      await emit('note-capture-batch', batch)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith({
        noteId: 'note-1',
        type: 'reacted',
        body: { reaction: '👍', emoji: null, userId: 'user-1' },
      })
    })

    it('unsubNote invokes stream_unsub_note and stops delivery', async () => {
      const calls = interceptCommands()
      const stream = new MisskeyStream('acc-1')
      const handler = vi.fn()

      stream.connect()
      await flush()
      stream.subNote('note-1', handler)
      stream.unsubNote('note-1')
      await flush()

      expect(calls).toContainEqual({
        cmd: 'stream_unsub_note',
        args: { accountId: 'acc-1', noteId: 'note-1' },
      })

      await emit('note-capture-batch', {
        captures: [
          {
            accountId: 'acc-1',
            noteId: 'note-1',
            updateType: 'deleted',
            body: { deletedAt: '2025-01-01T00:00:00Z' },
          },
        ],
      } satisfies NoteCaptureBatch)

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('raw event tap (StreamInspector)', () => {
    it('delivers stream-envelope to onRawEvent handlers for the own account only', async () => {
      interceptCommands()
      const stream = new MisskeyStream('acc-1')
      const rawHandler = vi.fn<(event: RawStreamEvent) => void>()
      stream.onRawEvent(rawHandler)

      stream.connect()
      await flush()

      const envelope: StreamEnvelope = {
        kind: 'stream-notification',
        payload: { accountId: 'acc-1', subscriptionId: 'sub-1', notification },
      }
      await emit('stream-envelope', envelope)
      await emit('stream-envelope', {
        kind: 'stream-notification',
        payload: {
          accountId: 'acc-2',
          subscriptionId: 'sub-2',
          notification: { ...notification, _accountId: 'acc-2' },
        },
      } satisfies StreamEnvelope)

      expect(rawHandler).toHaveBeenCalledTimes(1)
      expect(rawHandler.mock.calls[0][0].kind).toBe('stream-notification')

      stream.offRawEvent(rawHandler)
      await emit('stream-envelope', envelope)
      expect(rawHandler).toHaveBeenCalledTimes(1)
    })
  })

  describe('disconnect', () => {
    it('invokes stream_disconnect and detaches all listeners', async () => {
      const calls = interceptCommands()
      const stream = new MisskeyStream('acc-1')
      const onConnected = vi.fn()
      stream.on('connected', onConnected)

      stream.connect()
      await flush()
      stream.disconnect()
      await flush()

      expect(calls).toContainEqual({
        cmd: 'stream_disconnect',
        args: { accountId: 'acc-1' },
      })

      await emit('stream-status', statusEvent('acc-1', 'connected'))

      expect(stream.state).toBe('disconnected')
      expect(onConnected).not.toHaveBeenCalled()
    })
  })
})
