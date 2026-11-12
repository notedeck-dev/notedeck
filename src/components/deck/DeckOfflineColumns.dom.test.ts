// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/stores/settings'
import {
  bindings,
  flush,
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
    useSettingsStore().set('modes.offline', true)
    await mountColumn(
      DeckNotificationColumn,
      makeColumn({ type: 'notifications' }),
      {},
    )
    expect(networkCalls()).toEqual([])

    useSettingsStore().set('modes.offline', false)
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
    useSettingsStore().set('modes.offline', true)
    await mountColumn(DeckChatColumn, makeColumn({ type: 'chat' }), {})
    expect(bindings.callsOf('apiGetCachedChatHistory').length).toBeGreaterThan(
      0,
    )
    expect(networkCalls()).toEqual([])

    useSettingsStore().set('modes.offline', false)
    await flush()
    expect(networkCalls()).toContain('apiGetChatHistory')
  })

  it('チャットカラム: オンラインなら開いたときに履歴を取る', async () => {
    setupStores()
    await mountColumn(DeckChatColumn, makeColumn({ type: 'chat' }), {})
    expect(networkCalls()).toContain('apiGetChatHistory')
  })
})
