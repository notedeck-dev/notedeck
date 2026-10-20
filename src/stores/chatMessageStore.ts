/**
 * 正規化されたチャットメッセージストア (#460)。
 *
 * 設計は noteStore (`src/stores/notes.ts`) と同パターン:
 * - グローバル `Map<VariantKey, ChatMessage>` を唯一の実体として持つ。キーは
 *   「取得元アカウント + メッセージ ID」(#1270)。Misskey の ID はサーバー内でしか
 *   一意でないので、全アカウント面で別サーバーの同じ ID が衝突しないようにする
 * - UI/カラムはキー参照のみ持ち、`resolve(keys)` で実体を引く
 * - WS の `react` / `unreact` / `deleted` は `applyUpdate(event)` で吸収し、
 *   受信アカウントのメッセージにだけ in-place 更新で当てて全カラムに自動伝播する
 * - LRU 風 FIFO eviction (`chatMessageStoreMax`)
 *
 * 詳細は ARCHITECTURE.md「チャットキャッシュ・アーキテクチャ」を参照。
 */
import { defineStore } from 'pinia'
import { shallowRef, triggerRef } from 'vue'
import type { ChatMessage } from '@/adapters/types'
import { useFrameScheduler } from '@/composables/useFrameScheduler'
import { evictByLiveness } from '@/services/mapEviction'
import { type VariantKey, variantKey, variantKeyOf } from '@/services/noteKey'
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
  const messageMap = shallowRef(new Map<VariantKey, ChatMessage>())
  const deleteListeners = new Set<(key: VariantKey) => void>()
  const updateDeduper = createUpdateDeduper(CHAT_UPDATE_DEDUP_WINDOW_MS)
  /** カラムが現在表示しているキー集合の供給源。退避時に live を保護する。 */
  const roots = new Set<() => Iterable<VariantKey>>()

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

  function registerRoot(provider: () => Iterable<VariantKey>): () => void {
    roots.add(provider)
    return () => {
      roots.delete(provider)
    }
  }

  function collectLiveKeys(): Set<VariantKey> {
    const live = new Set<VariantKey>()
    for (const provider of roots) {
      for (const key of provider()) live.add(key)
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
      collectLiveKeys(),
      (m) => m.createdAt,
      variantKeyOf,
    )
  }

  function put(messages: ChatMessage[], skipTrigger = false) {
    const map = messageMap.value
    for (const m of messages) {
      map.set(variantKeyOf(m), m)
    }
    evictIfNeeded()
    if (!skipTrigger) scheduleTrigger()
  }

  function get(key: VariantKey): ChatMessage | undefined {
    const map = messageMap.value
    const m = map.get(key)
    // LRU refresh: 直近アクセスは insertion order の末尾に持ってくる
    if (m) {
      map.delete(key)
      map.set(key, m)
    }
    return m
  }

  /** Pure: キー配列を ChatMessage[] に変換。Map は変更しない (computed 内で使える)。 */
  function resolve(keys: readonly VariantKey[]): ChatMessage[] {
    const map = messageMap.value
    const result: ChatMessage[] = []
    for (const key of keys) {
      const m = map.get(key)
      if (m) result.push(m)
    }
    return result
  }

  function update(key: VariantKey, message: ChatMessage) {
    messageMap.value.set(key, message)
    scheduleTrigger()
  }

  function remove(key: VariantKey) {
    messageMap.value.delete(key)
    scheduleTrigger()
    for (const listener of deleteListeners) listener(key)
  }

  function onDelete(listener: (key: VariantKey) => void): () => void {
    deleteListeners.add(listener)
    return () => deleteListeners.delete(listener)
  }

  function applyUpdate(event: ChatMessageUpdateEvent) {
    const key = variantKey(event.accountId, event.messageId)
    if (event.type === 'deleted') {
      remove(key)
      return
    }

    // 未ロードのメッセージには sig を記録しない（ロード後の再配送を dedup で捨てないため）
    const msg = messageMap.value.get(key)
    if (!msg) return

    // 同一 sig の重複 event は dedup
    if (!updateDeduper.shouldApply(key, chatUpdateSig(event))) return

    const merged = mergeChatUpdate(msg, event)
    if (!merged) return
    messageMap.value.set(key, merged)
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
