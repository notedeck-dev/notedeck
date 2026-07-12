import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@/adapters/types'
import {
  type ChatThreadDeps,
  type ChatThreadSubscription,
  type ChatThreadTarget,
  chatThreadId,
  useChatThread,
} from './useChatThread'

// ---- fakes ----

function msg(id: string, createdAt = '2026-07-01T00:00:00.000Z'): ChatMessage {
  return { id, createdAt, fromUserId: 'u-from', text: `text-${id}` }
}

function makeStore() {
  const map = new Map<string, ChatMessage>()
  return {
    put: (msgs: ChatMessage[]) => {
      for (const m of msgs) map.set(m.id, m)
    },
    resolve: (ids: string[]) =>
      ids.flatMap((id) => {
        const m = map.get(id)
        return m ? [m] : []
      }),
    remove: (id: string) => {
      map.delete(id)
    },
  }
}

const USER_TARGET: ChatThreadTarget = { kind: 'user', otherId: 'other-1' }
const ROOM_TARGET: ChatThreadTarget = { kind: 'room', roomId: 'room-1' }

interface DepsOverrides {
  cached?: ChatMessage[] | (() => Promise<ChatMessage[]>)
  fetched?: ChatMessage[] | (() => Promise<ChatMessage[]>)
  /** resolveApi が null を返す (= adapter 不在) */
  noApi?: boolean
}

function makeDeps(overrides: DepsOverrides = {}) {
  const store = makeStore()
  const subs: Array<{ disposed: boolean }> = []
  const onIncoming = vi.fn()
  const fetch = vi.fn(
    async (_t: ChatThreadTarget, _opts?: { untilId?: string }) => {
      const f = overrides.fetched ?? []
      return typeof f === 'function' ? f() : f
    },
  )
  const getCached = vi.fn(
    async (
      _accountId: string,
      _threadId: string,
      _untilId: string | null,
      _limit: number,
    ) => {
      const c = overrides.cached ?? []
      return typeof c === 'function' ? c() : c
    },
  )
  const subscribe = vi.fn(
    (
      _accountId: string,
      _target: ChatThreadTarget,
      _handlers: {
        onInsert(m: ChatMessage): void
        onDelete(id: string): void
      },
    ): ChatThreadSubscription => {
      const sub = { disposed: false }
      subs.push(sub)
      return {
        dispose: () => {
          sub.disposed = true
        },
      }
    },
  )
  const deps: ChatThreadDeps = {
    store,
    getCached,
    resolveApi: async () => (overrides.noApi ? null : { fetch }),
    subscribe,
    onIncoming,
  }
  return { deps, store, fetch, getCached, subscribe, subs, onIncoming }
}

// cache/API は newest-first で返る (Misskey API と同じ向き)
const newestFirst = (...ids: string[]) =>
  ids.map((id, i) => msg(id, `2026-07-0${9 - i}T00:00:00.000Z`))

// ---- tests ----

describe('chatThreadId', () => {
  it('room は r: prefix、user は u: prefix', () => {
    expect(chatThreadId(ROOM_TARGET)).toBe('r:room-1')
    expect(chatThreadId(USER_TARGET)).toBe('u:other-1')
  })
})

describe('open: cache hydrate → API reconcile (#460 B-2)', () => {
  it('キャッシュがあれば先に oldest-first で表示し onHydrated を呼ぶ', async () => {
    const hydrated: string[][] = []
    const { deps } = makeDeps({
      cached: newestFirst('c2', 'c1'),
      fetched: newestFirst('a3', 'a2', 'a1'),
    })
    const thread = useChatThread(deps)

    const outcome = await thread.open('acc-1', USER_TARGET, {
      loggedOut: false,
      onHydrated: () => hydrated.push(thread.messages.value.map((m) => m.id)),
    })

    expect(outcome).toBe('opened')
    // hydrate 時点ではキャッシュの reverse (oldest-first)
    expect(hydrated).toEqual([['c1', 'c2']])
    // reconcile 後は API 結果で完全置換
    expect(thread.messages.value.map((m) => m.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('ログアウト中はキャッシュのみで API fetch も購読もしない', async () => {
    const { deps, fetch, subscribe } = makeDeps({
      cached: newestFirst('c2', 'c1'),
    })
    const thread = useChatThread(deps)

    await thread.open('acc-1', USER_TARGET, { loggedOut: true })

    expect(thread.messages.value.map((m) => m.id)).toEqual(['c1', 'c2'])
    expect(fetch).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('ログイン中に adapter を解決できなければ aborted (状態を変えない)', async () => {
    const { deps, getCached } = makeDeps({ noApi: true })
    const thread = useChatThread(deps)

    const outcome = await thread.open('acc-1', USER_TARGET, {
      loggedOut: false,
    })

    expect(outcome).toBe('aborted')
    expect(getCached).not.toHaveBeenCalled()
    expect(thread.target.value).toBeNull()
  })

  it('API fetch 失敗でもキャッシュ hydrate 済みなら表示を保つ', async () => {
    const { deps } = makeDeps({
      cached: newestFirst('c2', 'c1'),
      fetched: () => Promise.reject(new Error('offline')),
    })
    const thread = useChatThread(deps)

    await thread.open('acc-1', USER_TARGET, { loggedOut: false })
    expect(thread.messages.value.map((m) => m.id)).toEqual(['c1', 'c2'])
  })

  it('API fetch 失敗かつキャッシュ空なら空リストで確定する', async () => {
    const { deps } = makeDeps({
      fetched: () => Promise.reject(new Error('offline')),
    })
    const thread = useChatThread(deps)

    await thread.open('acc-1', USER_TARGET, { loggedOut: false })
    expect(thread.messages.value).toEqual([])
  })

  it('キャッシュ読み失敗は空扱いで続行する', async () => {
    const { deps } = makeDeps({
      cached: () => Promise.reject(new Error('db broken')),
      fetched: newestFirst('a1'),
    })
    const thread = useChatThread(deps)

    await thread.open('acc-1', USER_TARGET, { loggedOut: false })
    expect(thread.messages.value.map((m) => m.id)).toEqual(['a1'])
  })

  it('再 open で前の購読を dispose する', async () => {
    const { deps, subs } = makeDeps()
    const thread = useChatThread(deps)

    await thread.open('acc-1', USER_TARGET, { loggedOut: false })
    await thread.open('acc-1', ROOM_TARGET, { loggedOut: false })

    expect(subs).toHaveLength(2)
    expect(subs[0]?.disposed).toBe(true)
    expect(subs[1]?.disposed).toBe(false)
    expect(thread.target.value).toEqual(ROOM_TARGET)
  })
})

describe('ライブ購読イベント', () => {
  it('onInsert は onIncoming へ委譲し、onDelete はメッセージを取り除く', async () => {
    const { deps, subscribe, onIncoming } = makeDeps({
      fetched: newestFirst('a2', 'a1'),
    })
    const thread = useChatThread(deps)
    await thread.open('acc-1', USER_TARGET, { loggedOut: false })

    const handlers = subscribe.mock.calls[0]?.[2]
    const incoming = msg('live-1')
    handlers?.onInsert(incoming)
    expect(onIncoming).toHaveBeenCalledExactlyOnceWith(incoming)

    handlers?.onDelete('a2')
    expect(thread.messages.value.map((m) => m.id)).toEqual(['a1'])
  })
})

describe('append / prepend', () => {
  it('append は重複 id を無視する', async () => {
    const { deps } = makeDeps({ fetched: newestFirst('a1') })
    const thread = useChatThread(deps)
    await thread.open('acc-1', USER_TARGET, { loggedOut: false })

    thread.append(msg('a2'))
    thread.append(msg('a2'))
    expect(thread.messages.value.map((m) => m.id)).toEqual(['a1', 'a2'])
  })
})

describe('loadOlder (#460 過去分取得)', () => {
  it('oldest.id を untilId に API 取得し、oldest-first で前置する', async () => {
    const { deps, fetch } = makeDeps({ fetched: newestFirst('a2', 'a1') })
    const thread = useChatThread(deps)
    await thread.open('acc-1', USER_TARGET, { loggedOut: false })

    fetch.mockResolvedValueOnce(newestFirst('o2', 'o1'))
    const added = await thread.loadOlder('acc-1', { loggedOut: false })

    expect(added).toBe(true)
    expect(fetch).toHaveBeenLastCalledWith(USER_TARGET, { untilId: 'a1' })
    expect(thread.messages.value.map((m) => m.id)).toEqual([
      'o1',
      'o2',
      'a1',
      'a2',
    ])
  })

  it('API 失敗時はキャッシュへ fallback する', async () => {
    const { deps, fetch, getCached } = makeDeps({
      fetched: newestFirst('a1'),
    })
    const thread = useChatThread(deps)
    await thread.open('acc-1', USER_TARGET, { loggedOut: false })

    fetch.mockRejectedValueOnce(new Error('offline'))
    getCached.mockResolvedValueOnce(newestFirst('o1'))
    const added = await thread.loadOlder('acc-1', { loggedOut: false })

    expect(added).toBe(true)
    expect(getCached).toHaveBeenLastCalledWith('acc-1', 'u:other-1', 'a1', 50)
    expect(thread.messages.value.map((m) => m.id)).toEqual(['o1', 'a1'])
  })

  it('ログアウト中はキャッシュのみから取得する', async () => {
    const { deps, fetch, getCached } = makeDeps({
      cached: newestFirst('a1'),
    })
    const thread = useChatThread(deps)
    await thread.open('acc-1', USER_TARGET, { loggedOut: true })

    getCached.mockResolvedValueOnce(newestFirst('o1'))
    const added = await thread.loadOlder('acc-1', { loggedOut: true })

    expect(added).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    expect(thread.messages.value.map((m) => m.id)).toEqual(['o1', 'a1'])
  })

  it('結果が空なら false を返し状態を変えない', async () => {
    const { deps, fetch } = makeDeps({ fetched: newestFirst('a1') })
    const thread = useChatThread(deps)
    await thread.open('acc-1', USER_TARGET, { loggedOut: false })

    fetch.mockResolvedValueOnce([])
    const added = await thread.loadOlder('acc-1', { loggedOut: false })
    expect(added).toBe(false)
    expect(thread.messages.value.map((m) => m.id)).toEqual(['a1'])
  })

  it('メッセージが無い / thread 未 open のときは何もしない', async () => {
    const { deps, fetch } = makeDeps()
    const thread = useChatThread(deps)
    expect(await thread.loadOlder('acc-1', { loggedOut: false })).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('close', () => {
  it('購読を dispose し state を初期化する', async () => {
    const { deps, subs } = makeDeps({ fetched: newestFirst('a1') })
    const thread = useChatThread(deps)
    await thread.open('acc-1', USER_TARGET, { loggedOut: false })

    thread.close()

    expect(subs[0]?.disposed).toBe(true)
    expect(thread.messageIds.value).toEqual([])
    expect(thread.target.value).toBeNull()
  })
})
