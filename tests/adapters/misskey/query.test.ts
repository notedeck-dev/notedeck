import { emit } from '@tauri-apps/api/event'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createQuerySubscription,
  queryItemAsChatMessage,
  queryItemAsNote,
  queryItemAsNotification,
  toNoteUpdateEvent,
} from '@/adapters/misskey/query'
import type {
  NormalizedNote,
  QueryDelta,
  QueryItem,
  QuerySnapshot,
} from '@/bindings'
import { reattachQueryDeltaListener } from '@/core/queryDeltaBus'
import { _resetQueryRegistryForTest, getQueryInfo } from '@/core/queryRegistry'

/**
 * createQuerySubscription は mockIPC (+ shouldMockEvents) で IPC 境界だけを
 * モックし、queryDeltaBus / queryRegistry は実物を通す。query-delta イベントは
 * テストから emit() で注入する。
 */

interface IpcCall {
  cmd: string
  args: Record<string, unknown>
}

async function setup(
  respond: (cmd: string) => unknown = () => null,
): Promise<IpcCall[]> {
  const calls: IpcCall[] = []
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args: args as Record<string, unknown> })
      return respond(cmd)
    },
    { shouldMockEvents: true },
  )
  // bus の Tauri リスナーは module 状態で持ち回るため、テストごとに
  // 現行モックへ張り直す (フォアグラウンド復帰時と同じ経路)
  await reattachQueryDeltaListener()
  return calls
}

const mockNote: NormalizedNote = {
  id: 'note-1',
  _accountId: 'acc-1',
  _serverHost: 'example.com',
  createdAt: '2025-01-01T00:00:00Z',
  text: 'Hello',
  cw: null,
  user: {
    id: 'user-1',
    username: 'test',
    host: null,
    name: 'Test',
    avatarUrl: null,
  },
  visibility: 'public',
  myReaction: null,
  renoteCount: 0,
  repliesCount: 0,
  modeFlags: {},
}

const noteItem: QueryItem = { kind: 'note', ...mockNote }

function snapshot(overrides: Partial<QuerySnapshot> = {}): QuerySnapshot {
  return {
    queryId: 'q-1',
    key: {
      kind: 'timeline',
      account_id: 'acc-1',
      timeline_type: 'home',
      list_id: null,
    },
    runtimeState: 'live',
    subscriberCount: 1,
    revision: 5,
    sourceSubscriptionId: 'sub-1',
    ...overrides,
  }
}

function delta(overrides: Partial<QueryDelta> = {}): QueryDelta {
  return {
    queryId: 'q-1',
    revision: 6,
    inserts: [],
    deletes: [],
    updates: [],
    ...overrides,
  }
}

describe('toNoteUpdateEvent', () => {
  it('maps reacted with emoji passthrough and null userId → undefined', () => {
    expect(
      toNoteUpdateEvent('n1', {
        noteId: 'n1',
        updateType: 'reacted',
        body: {
          reaction: '👍',
          emoji: { name: 'thumbsup', url: 'https://e.com/t.png' },
          userId: null,
        },
      }),
    ).toEqual({
      noteId: 'n1',
      type: 'reacted',
      body: {
        reaction: '👍',
        emoji: { name: 'thumbsup', url: 'https://e.com/t.png' },
        userId: undefined,
      },
    })
  })

  it('maps unreacted', () => {
    expect(
      toNoteUpdateEvent('n1', {
        noteId: 'n1',
        updateType: 'unreacted',
        body: { reaction: '👍', userId: 'u1' },
      }),
    ).toEqual({
      noteId: 'n1',
      type: 'unreacted',
      body: { reaction: '👍', userId: 'u1' },
    })
  })

  it('maps pollVoted', () => {
    expect(
      toNoteUpdateEvent('n1', {
        noteId: 'n1',
        updateType: 'pollVoted',
        body: { choice: 2, userId: 'u1' },
      }),
    ).toEqual({
      noteId: 'n1',
      type: 'pollVoted',
      body: { choice: 2, userId: 'u1' },
    })
  })

  it('maps deleted with null deletedAt → undefined', () => {
    expect(
      toNoteUpdateEvent('n1', {
        noteId: 'n1',
        updateType: 'deleted',
        body: { deletedAt: null },
      }),
    ).toEqual({
      noteId: 'n1',
      type: 'deleted',
      body: { deletedAt: undefined },
    })
  })
})

describe('queryItemAs*', () => {
  it('narrows by kind tag and returns null otherwise', () => {
    expect(queryItemAsNote(noteItem)?.id).toBe('note-1')
    expect(queryItemAsNotification(noteItem)).toBeNull()
    expect(queryItemAsChatMessage(noteItem)).toBeNull()
  })
})

describe('createQuerySubscription', () => {
  beforeEach(() => {
    _resetQueryRegistryForTest()
  })

  afterEach(() => {
    clearMocks()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('open 解決後に subscriptionId と queryRegistry 登録が揃う', async () => {
    await setup()
    const sub = createQuerySubscription({
      open: async () => snapshot(),
      onInsert: vi.fn(),
    })
    await sub.whenReady()

    expect(sub.subscriptionId).toBe('sub-1')
    expect(getQueryInfo('q-1')).toEqual({ flavor: 'note', accountId: 'acc-1' })

    sub.dispose()
  })

  it('query-delta を inserts/deletes/updates に fan-out する', async () => {
    await setup()
    const onInsert = vi.fn()
    const onDelete = vi.fn()
    const onUpdate = vi.fn()
    const sub = createQuerySubscription({
      open: async () => snapshot(),
      onInsert,
      onDelete,
      onUpdate,
    })
    await sub.whenReady()

    await emit(
      'query-delta',
      delta({
        inserts: [noteItem],
        deletes: ['old-1'],
        updates: [
          {
            noteId: 'note-1',
            updateType: 'reacted',
            body: { reaction: '👍', emoji: null, userId: 'u1' },
          },
        ],
      }),
    )

    expect(onInsert).toHaveBeenCalledWith(noteItem)
    expect(onDelete).toHaveBeenCalledWith('old-1')
    expect(onUpdate).toHaveBeenCalledWith({
      noteId: 'note-1',
      type: 'reacted',
      body: { reaction: '👍', emoji: null, userId: 'u1' },
    })

    sub.dispose()
  })

  it('snapshot 以前・処理済み revision の delta は無視する', async () => {
    await setup()
    const onInsert = vi.fn()
    const sub = createQuerySubscription({
      open: async () => snapshot({ revision: 5 }),
      onInsert,
    })
    await sub.whenReady()

    await emit('query-delta', delta({ revision: 5, inserts: [noteItem] }))
    expect(onInsert).not.toHaveBeenCalled()

    await emit('query-delta', delta({ revision: 6, inserts: [noteItem] }))
    expect(onInsert).toHaveBeenCalledTimes(1)

    // 同じ revision の再配送 (replay) は捨てる
    await emit('query-delta', delta({ revision: 6, inserts: [noteItem] }))
    expect(onInsert).toHaveBeenCalledTimes(1)

    sub.dispose()
  })

  it('別 queryId の delta は届かない', async () => {
    await setup()
    const onInsert = vi.fn()
    const sub = createQuerySubscription({
      open: async () => snapshot(),
      onInsert,
    })
    await sub.whenReady()

    await emit(
      'query-delta',
      delta({ queryId: 'q-other', inserts: [noteItem] }),
    )
    expect(onInsert).not.toHaveBeenCalled()

    sub.dispose()
  })

  it('dispose で query_close + registry 解除 + 配信停止', async () => {
    const calls = await setup()
    const onInsert = vi.fn()
    const sub = createQuerySubscription({
      open: async () => snapshot(),
      onInsert,
    })
    await sub.whenReady()

    sub.dispose()

    expect(calls).toContainEqual({
      cmd: 'query_close',
      args: { queryId: 'q-1' },
    })
    expect(getQueryInfo('q-1')).toBeUndefined()

    await emit('query-delta', delta({ inserts: [noteItem] }))
    expect(onInsert).not.toHaveBeenCalled()
  })

  it('setRuntimeState は変化時のみ query_set_runtime_state を送る', async () => {
    const calls = await setup()
    const sub = createQuerySubscription({
      open: async () => snapshot(),
      onInsert: vi.fn(),
    })
    await sub.whenReady()

    sub.setRuntimeState('suspended')
    sub.setRuntimeState('suspended') // 同一 state は no-op

    const stateCalls = calls.filter((c) => c.cmd === 'query_set_runtime_state')
    expect(stateCalls).toEqual([
      {
        cmd: 'query_set_runtime_state',
        args: { queryId: 'q-1', state: 'suspended' },
      },
    ])

    sub.dispose()
  })

  it('open 前に設定した runtimeState は open 解決後に反映される', async () => {
    const calls = await setup()
    let release!: (s: QuerySnapshot) => void
    const gate = new Promise<QuerySnapshot>((r) => {
      release = r
    })
    const sub = createQuerySubscription({
      open: () => gate,
      onInsert: vi.fn(),
    })

    sub.setRuntimeState('warm')
    release(snapshot())
    await sub.whenReady()

    expect(calls).toContainEqual({
      cmd: 'query_set_runtime_state',
      args: { queryId: 'q-1', state: 'warm' },
    })

    sub.dispose()
  })

  it('open 失敗時は backoff 再試行し、成功後に ready になる', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await setup()

    let attempts = 0
    const sub = createQuerySubscription({
      open: async () => {
        attempts++
        if (attempts === 1) throw new Error('backend not ready')
        return snapshot()
      },
      onInsert: vi.fn(),
    })

    // 初回 backoff は 500-1000ms (Equal Jitter) — 1000ms 進めれば必ず発火する
    await vi.advanceTimersByTimeAsync(1000)
    await sub.whenReady()

    expect(attempts).toBe(2)
    expect(sub.subscriptionId).toBe('sub-1')

    sub.dispose()
  })
})
