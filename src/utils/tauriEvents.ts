import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { StreamConnectionState } from '@/adapters/types'
import type { ChatReactionUser } from '@/bindings'
import type { AiChatEventPayload } from '@/composables/useAiChat'
import type { HeartbeatTickPayload } from '@/composables/useHeartbeatDaemon'
import type { QueryRequest } from '@/core/apiBridge'
import type { Account } from '@/stores/accounts'
import type { DeckColumn } from '@/stores/deck'
import type { OgpData } from '@/utils/ogp'

/**
 * Rust TauriEmitter からの統合 stream イベント。
 * payload は kind ごとに形が異なる (stream-status は state、通知系 raw event は
 * eventType)。必要なフィールドだけ optional で持つ。
 */
export interface StreamEventEnvelope {
  kind: string
  payload: {
    accountId: string
    state?: StreamConnectionState
    eventType?: string
  }
}

/**
 * `stream-chat-message-reacted` / `stream-chat-message-unreacted` の WS payload (#460)。
 * notecli `StreamChatMessageReactedEvent` / `StreamChatMessageUnreactedEvent` と同形だが
 * specta export 対象外なので frontend 側で手書き定義する。
 */
export interface StreamChatReactionPayload {
  accountId: string
  subscriptionId: string
  messageId: string
  reaction: string
  user: ChatReactionUser | null
}

/**
 * Tauri イベント名 → payload 型のレジストリ。
 * emit / listen の対応関係をコンパイル時に保証する。
 * 動的イベント名 (`nd:query-response-<id>`) のみ対象外で、apiBridge が
 * 直接 emit する。
 */
export interface TauriEventPayloads {
  // Rust → JS
  'nd:accounts-early': Account[]
  'nd:hwheel': number
  'nd:quick-note': undefined
  'nd:toggle-offline-mode': undefined
  'nd:toggle-realtime-mode': undefined
  'nd:deep-link': string
  'nd:ogp-hints': Record<string, OgpData>
  'nd:ai-chat-event': AiChatEventPayload
  'nd:ai-heartbeat-tick': HeartbeatTickPayload
  'nd:query-request': QueryRequest
  'stream-event': StreamEventEnvelope
  'stream-chat-message-reacted': StreamChatReactionPayload
  'stream-chat-message-unreacted': StreamChatReactionPayload
  // JS ↔ JS (ウィンドウ間 IPC)
  'deck:move-column': { columnId: string; targetWindowId: string | null }
  'deck:window-closed': { windowId: string }
  'deck:drag-start': { columnId: string; sourceWindowId: string }
  'deck:drag-end': { columnId: string; sourceWindowId: string }
  'deck:profile-updated': { profileId: string }
  'deck:profiles-changed': undefined
  /** settings.json5 が永続化された (テーマ等をウィンドウ間で同期する) */
  'nd:settings-changed': { sourceId: string }
  'pip:return-to-deck': Omit<DeckColumn, 'id'>
}

export type TauriEventName = keyof TauriEventPayloads

export function listenTauri<K extends TauriEventName>(
  name: K,
  handler: (payload: TauriEventPayloads[K]) => void,
): Promise<UnlistenFn> {
  return listen(name, (event) => {
    handler(event.payload as TauriEventPayloads[K])
  })
}

export function emitTauri<K extends TauriEventName>(
  name: K,
  ...payload: TauriEventPayloads[K] extends undefined
    ? []
    : [TauriEventPayloads[K]]
): Promise<void> {
  return emit(name, payload[0])
}
