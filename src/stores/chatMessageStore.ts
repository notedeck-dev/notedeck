/**
 * 正規化されたチャットメッセージストア (#460)。
 *
 * 設計は noteStore (`src/stores/notes.ts`) と同パターン:
 * - グローバル `Map<message_id, ChatMessage>` を唯一の実体として持つ
 * - UI/カラムは ID 参照のみ持ち、`resolve(ids)` で実体を引く
 * - WS の `react` / `unreact` / `deleted` は `applyUpdate(event)` で吸収し、
 *   in-place 更新で全カラムに自動伝播する
 * - LRU 風 FIFO eviction (`chatMessageStoreMax`)
 *
 * 詳細は ARCHITECTURE.md「チャットキャッシュ・アーキテクチャ」を参照。
 */
import { defineStore } from 'pinia'
import { shallowRef, triggerRef } from 'vue'
import type { ChatMessage } from '@/adapters/types'
import { useFrameScheduler } from '@/composables/useFrameScheduler'
import { usePerformanceStore } from '@/stores/performance'

/**
 * `bindings.ChatReactionUser` (string | null) と `ChatMessageReaction['user']`
 * (string | undefined) の両方を受けるための広めの reactor 型。
 * 内部で null → undefined に正規化してから格納する。
 */
type ReactorInput = {
  id: string
  username: string
  name?: string | null
  host?: string | null
  avatarUrl?: string | null
} | null

/** 同じ react/unreact event が複数経路から重複到達した時の dedup window。 */
const CHAT_UPDATE_DEDUP_WINDOW_MS = 1500

export type ChatMessageUpdateEvent =
  | {
      type: 'reacted'
      messageId: string
      userId?: string | null
      reaction: string
      reactor?: ReactorInput
    }
  | {
      type: 'unreacted'
      messageId: string
      userId?: string | null
      reaction: string
      reactor?: ReactorInput
    }
  | {
      type: 'deleted'
      messageId: string
    }

function chatUpdateSig(event: ChatMessageUpdateEvent): string {
  if (event.type === 'deleted') return 'deleted'
  return `${event.type}${event.userId ?? ''}${event.reaction ?? ''}`
}

export const useChatMessageStore = defineStore('chatMessages', () => {
  const perfStore = usePerformanceStore()
  const { schedule } = useFrameScheduler()
  const messageMap = shallowRef(new Map<string, ChatMessage>())
  const deleteListeners = new Set<(id: string) => void>()
  const recentUpdateSigs = new Map<string, string>()
  const recentUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** カラムが現在表示している ID 集合の供給源。退避時に live を保護する。 */
  const roots = new Set<() => Iterable<string>>()

  let triggerScheduled = false
  const doTrigger = () => {
    triggerScheduled = false
    triggerRef(messageMap)
  }
  function scheduleTrigger() {
    if (triggerScheduled) return
    triggerScheduled = true
    schedule(doTrigger, 'normal')
  }

  function registerRoot(provider: () => Iterable<string>): () => void {
    roots.add(provider)
    return () => {
      roots.delete(provider)
    }
  }

  function collectLiveIds(): Set<string> {
    const live = new Set<string>()
    for (const provider of roots) {
      for (const id of provider()) live.add(id)
    }
    return live
  }

  function evictIfNeeded() {
    const map = messageMap.value
    const max = perfStore.get('chatMessageStoreMax')
    if (map.size <= max) return

    const live = collectLiveIds()

    // 1st pass: live でない (= どのカラムも参照していない) ものを古い順に削除
    if (map.size > max && live.size < map.size) {
      for (const key of map.keys()) {
        if (map.size <= max) break
        if (!live.has(key)) map.delete(key)
      }
    }

    // 2nd pass: 全部 live の稀ケース。createdAt 降順で古い側を削除。
    if (map.size > max) {
      const excess = map.size - max
      const byAge: ChatMessage[] = []
      for (const m of map.values()) byAge.push(m)
      byAge.sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
      )
      for (let i = 0; i < excess && i < byAge.length; i++) {
        const m = byAge[i]
        if (m) map.delete(m.id)
      }
    }
  }

  function put(messages: ChatMessage[], skipTrigger = false) {
    const map = messageMap.value
    for (const m of messages) {
      map.set(m.id, m)
    }
    evictIfNeeded()
    if (!skipTrigger) scheduleTrigger()
  }

  function get(id: string): ChatMessage | undefined {
    const map = messageMap.value
    const m = map.get(id)
    // LRU refresh: 直近アクセスは insertion order の末尾に持ってくる
    if (m) {
      map.delete(id)
      map.set(id, m)
    }
    return m
  }

  /** Pure: ID 配列を ChatMessage[] に変換。Map は変更しない (computed 内で使える)。 */
  function resolve(ids: string[]): ChatMessage[] {
    const map = messageMap.value
    const result: ChatMessage[] = []
    for (const id of ids) {
      const m = map.get(id)
      if (m) result.push(m)
    }
    return result
  }

  function update(id: string, message: ChatMessage) {
    messageMap.value.set(id, message)
    scheduleTrigger()
  }

  function remove(id: string) {
    messageMap.value.delete(id)
    scheduleTrigger()
    for (const listener of deleteListeners) listener(id)
  }

  function onDelete(listener: (id: string) => void): () => void {
    deleteListeners.add(listener)
    return () => deleteListeners.delete(listener)
  }

  function applyUpdate(event: ChatMessageUpdateEvent) {
    if (event.type === 'deleted') {
      remove(event.messageId)
      return
    }

    // 未ロードのメッセージには sig を記録しない（ロード後の再配送を dedup で捨てないため）
    const msg = messageMap.value.get(event.messageId)
    if (!msg) return

    // 同一 sig の重複 event は dedup
    const sig = chatUpdateSig(event)
    if (recentUpdateSigs.get(event.messageId) === sig) return
    recentUpdateSigs.set(event.messageId, sig)
    const existing = recentUpdateTimers.get(event.messageId)
    if (existing != null) clearTimeout(existing)
    const timer = setTimeout(() => {
      recentUpdateSigs.delete(event.messageId)
      recentUpdateTimers.delete(event.messageId)
    }, CHAT_UPDATE_DEDUP_WINDOW_MS)
    recentUpdateTimers.set(event.messageId, timer)

    switch (event.type) {
      case 'reacted': {
        const r = event.reactor
        const user = r
          ? {
              id: r.id,
              username: r.username,
              name: r.name ?? undefined,
              host: r.host ?? undefined,
              avatarUrl: r.avatarUrl ?? undefined,
            }
          : null
        const reactions = [
          ...(msg.reactions ?? []),
          { user, reaction: event.reaction },
        ]
        messageMap.value.set(event.messageId, { ...msg, reactions })
        scheduleTrigger()
        break
      }
      case 'unreacted': {
        const userId = event.userId
        if (!msg.reactions) return
        // (userId, reaction) が一致する最初の 1 件を削除
        const idx = msg.reactions.findIndex(
          (r) =>
            r.reaction === event.reaction &&
            (r.user?.id ?? null) === (userId ?? null),
        )
        if (idx === -1) return
        const reactions = [...msg.reactions]
        reactions.splice(idx, 1)
        messageMap.value.set(event.messageId, { ...msg, reactions })
        scheduleTrigger()
        break
      }
    }
  }

  return {
    messageMap,
    put,
    get,
    resolve,
    update,
    remove,
    onDelete,
    applyUpdate,
    registerRoot,
  }
})
