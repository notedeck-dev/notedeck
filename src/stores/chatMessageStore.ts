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
import { evictByLiveness } from '@/services/mapEviction'
import type { ChatMessageUpdateEvent } from '@/services/streamUpdateMerge'
import {
  chatUpdateSig,
  createUpdateDeduper,
  mergeChatUpdate,
} from '@/services/streamUpdateMerge'
import { usePerformanceStore } from '@/stores/performance'

// イベント型とマージ規則は services/streamUpdateMerge に分離 (#782)。
// 既存の import 元を維持するため型は再 export する。
export type { ChatMessageUpdateEvent } from '@/services/streamUpdateMerge'

/** 同じ react/unreact event が複数経路から重複到達した時の dedup window。 */
const CHAT_UPDATE_DEDUP_WINDOW_MS = 1500

export const useChatMessageStore = defineStore('chatMessages', () => {
  const perfStore = usePerformanceStore()
  const { schedule } = useFrameScheduler()
  const messageMap = shallowRef(new Map<string, ChatMessage>())
  const deleteListeners = new Set<(id: string) => void>()
  const updateDeduper = createUpdateDeduper(CHAT_UPDATE_DEDUP_WINDOW_MS)
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

    evictByLiveness(
      map,
      max,
      collectLiveIds(),
      (m) => m.createdAt,
      (m) => m.id,
    )
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
    if (!updateDeduper.shouldApply(event.messageId, chatUpdateSig(event)))
      return

    const merged = mergeChatUpdate(msg, event)
    if (!merged) return
    messageMap.value.set(event.messageId, merged)
    scheduleTrigger()
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
