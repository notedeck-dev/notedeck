import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '@/adapters/types'
import { useChatMessageStore } from '@/stores/chatMessageStore'

const ME = 'user-me'
const OTHER = 'user-other'
const R = ':meow:'

function makeMessage(): ChatMessage {
  return {
    id: 'm1',
    createdAt: '2026-01-01T00:00:00.000Z',
    text: 'hi',
    fromUserId: OTHER,
    reactions: [],
  } as unknown as ChatMessage
}

const meReactor = {
  id: ME,
  username: 'me',
  name: 'Me',
  host: null,
  avatarUrl: null,
}

describe('chatMessageStore.applyUpdate の reaction dedup', () => {
  let store: ReturnType<typeof useChatMessageStore>

  function reactions() {
    return store.messageMap.get('m1')?.reactions ?? []
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useChatMessageStore()
    store.put([makeMessage()])
  })

  // 1on1 の WS react は本家仕様で reactor を含まない。楽観的更新側が自分を
  // reactor に入れると sig が食い違って dedup をすり抜け、同じリアクションが
  // 二重に載る (DeckChatColumn.updateMessageReaction の 1on1 分岐の回帰テスト)。
  it('1on1: reactor 無しの楽観的更新と WS event は 1 件に dedup される', () => {
    const optimistic = {
      type: 'reacted',
      messageId: 'm1',
      userId: null,
      reaction: R,
      reactor: null,
    } as const
    const ws = { ...optimistic }

    store.applyUpdate(optimistic)
    store.applyUpdate(ws)

    expect(reactions()).toHaveLength(1)
  })

  it('1on1: WS が楽観的更新より先着しても 1 件に収まる', () => {
    const event = {
      type: 'reacted',
      messageId: 'm1',
      userId: null,
      reaction: R,
      reactor: null,
    } as const

    store.applyUpdate(event) // WS
    store.applyUpdate(event) // 楽観的更新 (API 応答が後)

    expect(reactions()).toHaveLength(1)
  })

  it('room: reactor 付きの楽観的更新と WS event も 1 件に dedup される', () => {
    const event = {
      type: 'reacted',
      messageId: 'm1',
      userId: ME,
      reaction: R,
      reactor: meReactor,
    } as const

    store.applyUpdate(event)
    store.applyUpdate(event)

    expect(reactions()).toHaveLength(1)
  })

  it('room: 別ユーザーの同一リアクションは dedup されず両方載る', () => {
    store.applyUpdate({
      type: 'reacted',
      messageId: 'm1',
      userId: ME,
      reaction: R,
      reactor: meReactor,
    })
    store.applyUpdate({
      type: 'reacted',
      messageId: 'm1',
      userId: 'user-third',
      reaction: R,
      reactor: { ...meReactor, id: 'user-third', username: 'third' },
    })

    expect(reactions()).toHaveLength(2)
  })

  it('1on1: reactor 無しの unreacted は reactor 無しの reaction を消す', () => {
    store.applyUpdate({
      type: 'reacted',
      messageId: 'm1',
      userId: null,
      reaction: R,
      reactor: null,
    })
    store.applyUpdate({
      type: 'unreacted',
      messageId: 'm1',
      userId: null,
      reaction: R,
      reactor: null,
    })

    expect(reactions()).toHaveLength(0)
  })
})
