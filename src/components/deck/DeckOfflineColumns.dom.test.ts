// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountsStore } from '@/stores/accounts'
import { useOfflineModeStore } from '@/stores/offlineMode'
import {
  bindings,
  flush,
  makeAccount,
  makeColumn,
  mountColumn,
  setupStores,
} from './columnTestKit'
import DeckChatColumn from './DeckChatColumn.vue'
import DeckNotificationColumn from './DeckNotificationColumn.vue'

vi.mock('@/bindings', async () => ({
  ...(await import('./columnTestKit.bindings')).bindingsMock(),
  // チャットカラムはリアクションのイベントを購読する
  events: new Proxy({}, { get: () => ({ listen: async () => noop }) }),
}))

const noop = () => undefined

/** サーバーへ出ていく command (キャッシュの読取と設定の読み書きは含めない) */
const NETWORK = [
  'apiGetNotifications',
  'apiGetNotificationsGrouped',
  'apiGetChatHistory',
  'apiGetChatRoomHistory',
  'streamConnect',
  'streamSubscribeMain',
  'querySubscribeNotifications',
]
const networkCalls = () =>
  bindings.calls.map((c) => c.name).filter((n) => NETWORK.includes(n))

beforeEach(() => {
  bindings.reset()
  // 購読は snapshot を返す (空配列のままだと購読の登録で落ちる)
  bindings.responses.querySubscribeNotifications = {
    queryId: 'q1',
    key: { kind: 'notifications', account_id: 'acc-1' },
    runtimeState: 'live',
    subscriberCount: 1,
    revision: 0,
    sourceSubscriptionId: null,
  }
})

describe('オフライン中のカラムはサーバーへ取りに行かない (#1350)', () => {
  it('通知カラム: 開いても取得せず購読も張らず、解除したら繋ぐ', async () => {
    setupStores()
    void useOfflineModeStore().enable()
    await mountColumn(
      DeckNotificationColumn,
      makeColumn({ type: 'notifications' }),
      {},
    )
    expect(networkCalls()).toEqual([])

    void useOfflineModeStore().disable()
    await flush()
    expect(networkCalls()).toContain('apiGetNotifications')
  })

  it('通知カラム: オンラインなら開いたときに取得する', async () => {
    setupStores()
    await mountColumn(
      DeckNotificationColumn,
      makeColumn({ type: 'notifications' }),
      {},
    )
    expect(networkCalls()).toContain('apiGetNotifications')
  })

  it('チャットカラム: 開いてもキャッシュだけ読み、解除したら取りに行く', async () => {
    setupStores()
    void useOfflineModeStore().enable()
    await mountColumn(DeckChatColumn, makeColumn({ type: 'chat' }), {})
    expect(bindings.callsOf('apiGetCachedChatHistory').length).toBeGreaterThan(
      0,
    )
    expect(networkCalls()).toEqual([])

    void useOfflineModeStore().disable()
    await flush()
    expect(networkCalls()).toContain('apiGetChatHistory')
  })

  it('チャットカラム: オンラインなら開いたときに履歴を取る', async () => {
    setupStores()
    await mountColumn(DeckChatColumn, makeColumn({ type: 'chat' }), {})
    expect(networkCalls()).toContain('apiGetChatHistory')
  })

  it('通知カラム (全アカウント): オフライン中に口座が増えても取りに行かない', async () => {
    setupStores()
    void useOfflineModeStore().enable()
    await mountColumn(
      DeckNotificationColumn,
      makeColumn({ type: 'notifications', accountId: null }),
      {},
    )
    const accounts = useAccountsStore()
    accounts.accounts = [
      ...accounts.accounts,
      makeAccount({ id: 'acc-2', userId: 'uid-2', username: 'bob' }),
    ]
    await flush()
    expect(networkCalls()).toEqual([])
  })

  it('チャットカラム: 読み込みの途中でオフラインに入っても、解除で取り直す', async () => {
    setupStores()
    // キャッシュを読んでいる間にオフラインへ切り替わる
    bindings.responses.apiGetCachedChatHistory = () => {
      void useOfflineModeStore().enable()
      return []
    }
    await mountColumn(DeckChatColumn, makeColumn({ type: 'chat' }), {})
    expect(networkCalls()).toEqual([])

    bindings.responses.apiGetCachedChatHistory = []
    void useOfflineModeStore().disable()
    await flush()
    expect(networkCalls()).toContain('apiGetChatHistory')
  })
})
