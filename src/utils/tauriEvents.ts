import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { HeartbeatEvent, SettingsChange } from '@/bindings'
import type { AiChatEventPayload } from '@/composables/useAiChat'
import type { AiTurnEventPayload } from '@/composables/useAiTurn'
import type { QueryRequest } from '@/core/apiBridge'
import type { Account } from '@/stores/accounts'
import type { DeckColumn } from '@/stores/deck'
import type { OgpData } from '@/utils/ogp'

/**
 * Tauri イベント名 → payload 型のレジストリ。
 * emit / listen の対応関係をコンパイル時に保証する。
 * 動的イベント名 (`nd:query-response-<id>`) のみ対象外で、apiBridge が
 * 直接 emit する。
 */
export interface TauriEventPayloads {
  // Rust → JS
  'nd:accounts-early': Account[]
  /** バックエンド初期化の致命エラー (DB open 失敗など)。payload はメッセージ */
  'nd:backend-fatal': string
  'nd:hwheel': number
  'nd:quick-note': undefined
  'nd:toggle-offline-mode': undefined
  'nd:toggle-realtime-mode': undefined
  'nd:deep-link': string
  'nd:ogp-hints': Record<string, OgpData>
  'nd:ai-chat-event': AiChatEventPayload
  'nd:ai-turn-event': AiTurnEventPayload
  /** HEARTBEAT daemon (notecore) の出来事: 開始 / 終了 / 報告 / 通知 / toast (#1133) */
  'nd:ai-heartbeat-event': HeartbeatEvent
  'nd:query-request': QueryRequest
  /** notecore が設定ファイルを書いた (デバイスの store は該当面だけ読み直す, #1133) */
  'nd:settings-file-changed': SettingsChange
  // JS ↔ JS (ウィンドウ間 IPC)
  'deck:move-column': { columnId: string; targetWindowId: string | null }
  'deck:window-closed': { windowId: string }
  'deck:drag-start': { columnId: string; sourceWindowId: string }
  'deck:drag-end': { columnId: string; sourceWindowId: string }
  'deck:profile-updated': { profileId: string }
  'deck:profiles-changed': undefined
  /** settings.json5 が永続化された (テーマ等をウィンドウ間で同期する) */
  'nd:settings-changed': { sourceId: string }
  /** 表示言語が変わった。送り元以外のウィンドウもリロードする (#135) */
  'nd:locale-changed': { sourceId: string }
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
