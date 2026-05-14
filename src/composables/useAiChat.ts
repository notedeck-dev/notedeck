import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { onScopeDispose, ref } from 'vue'
import type { AiChatMessage, JsonValue } from '@/bindings'
import { commands, unwrap } from '@/utils/tauriInvoke'

/** Single chat message stored in the conversation. */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  /** AI が呼び出した tool の id (assistant turn) */
  toolUseId?: string
  /** capability id (= tool name) */
  toolUseName?: string
  /** AI が渡した引数 */
  toolUseInput?: Record<string, unknown>
  /** 対応する tool_use の id (user turn = tool_result) */
  toolResultFor?: string
  /**
   * HEARTBEAT (#411) で生成された assistant メッセージか。
   * - UI 上で 💓 prefix / 薄色などの視覚区別を付ける
   * - 次回 user 送信時の wire history からは除外する (AI を混乱させない)
   */
  heartbeat?: boolean
}

export interface AiChatSendOptions {
  /** 使用する Vault 接続の id (#564)。endpoint / 認証 / protocol は Rust 側で解決。 */
  connectionId: string
  model: string
  /** Conversation history (excluding the system prompt). */
  history: ChatMessage[]
  /** Composed system prompt (optional). */
  system?: string
  maxTokens?: number
  /**
   * Provider 形式 (Anthropic or OpenAI) の生 tool definition 配列。
   * 呼び出し側で `toAnthropicTool` / `toOpenAiTool` を使って事前変換する。
   * 空 / 省略時は tool calling 無効 (= 既存挙動)。
   */
  tools?: unknown[]
  /**
   * AI が tool_use を要求したときに呼ばれる。Phase 2 A-3.3 で実装する
   * tool_result 返送ループの起点。本ターンでは呼ばれるだけ何もしない
   * (= AI 応答は途中で止まる) のが正常動作。
   */
  onToolUse?: (event: ToolUseEvent) => void
}

export interface ToolUseEvent {
  /** Anthropic `toolu_...` / OpenAI `call_...` 形式の id */
  toolUseId: string
  /** Capability id (= tool name) */
  name: string
  /** AI が渡した引数。空オブジェクトの可能性あり */
  input: Record<string, unknown>
}

interface AiChatEventPayload {
  stream_id: string
  kind: 'delta' | 'done' | 'error' | 'tool_use'
  text?: string
  error?: string
  tool_use_id?: string
  tool_use_name?: string
  tool_use_input?: Record<string, unknown>
}

const EVENT_NAME = 'nd:ai-chat-event'

function generateStreamId(): string {
  return `ai-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function toWireMessage(m: ChatMessage): AiChatMessage {
  const wire: AiChatMessage = { role: m.role, content: m.content }
  if (m.toolUseId) wire.tool_use_id = m.toolUseId
  if (m.toolUseName) wire.tool_use_name = m.toolUseName
  if (m.toolUseInput) {
    wire.tool_use_input = m.toolUseInput as unknown as JsonValue
  }
  if (m.toolResultFor) wire.tool_result_for = m.toolResultFor
  return wire
}

/**
 * AI が呼び出した tool の応答を history に挿入するためのメッセージ。
 * Phase 2 A-3.3 で `useAiChat.sendMessage` の history パラメータ経由で渡される
 * 想定。本 PR (A-3.3a) では型のみ用意し、実 wiring は次の PR で行う。
 */
export interface ToolUseTurn {
  /** AI からの tool_use 呼び出し */
  toolUseId: string
  name: string
  input: Record<string, unknown>
  /** 呼び出しに添えられた assistant のテキスト (空可) */
  assistantText?: string
}

export interface ToolResultTurn {
  /** 対応する tool_use の id */
  toolUseId: string
  /** 実行結果のテキスト (JSON.stringify 済み) */
  result: string
}

/**
 * 拡張版 wire message を組み立てるヘルパー。Phase 2 A-3.3b 以降で
 * tool_use ループ実装時に使う。今は import されていないが、A-3.3a の
 * wire format 拡張が動作することを test で保証する。
 */
export function toolUseWireMessage(turn: ToolUseTurn): AiChatMessage {
  return {
    role: 'assistant',
    content: turn.assistantText ?? '',
    tool_use_id: turn.toolUseId,
    tool_use_name: turn.name,
    tool_use_input: turn.input as unknown as JsonValue,
  }
}

export function toolResultWireMessage(turn: ToolResultTurn): AiChatMessage {
  return {
    role: 'user',
    content: turn.result,
    tool_result_for: turn.toolUseId,
  }
}

/**
 * Single-shot streaming chat call. The accumulator ref is updated as deltas
 * arrive; the returned promise resolves with the final text on completion.
 *
 * Use `cancel()` to abort an in-flight stream (e.g. when the user switches
 * to a different AI session mid-response).
 */
export function useAiChat() {
  const isStreaming = ref(false)
  const lastError = ref<string | null>(null)
  /** Live-updated assistant text for the current send. */
  const currentText = ref('')

  // Hoisted to composable scope so onScopeDispose can clean it up if the
  // component unmounts while a stream is in flight.
  let activeUnlisten: UnlistenFn | null = null
  let activeStreamId: string | null = null

  function cleanup() {
    if (activeUnlisten) {
      activeUnlisten()
      activeUnlisten = null
    }
    activeStreamId = null
    isStreaming.value = false
  }

  // Auto-cleanup on component unmount: tears down any in-flight listener
  // so we don't leak across columns being added/removed. Also fire-and-forget
  // a server-side cancel so the Rust task doesn't keep streaming bytes
  // (and burning API tokens) for an unmounted component.
  onScopeDispose(() => {
    if (activeStreamId) {
      void commands.aiChatCancel(activeStreamId)
    }
    if (activeUnlisten) {
      activeUnlisten()
      activeUnlisten = null
    }
  })

  /**
   * Cancel any in-flight stream. Resolves immediately; the Rust side aborts
   * the background task and stops emitting events for this stream_id.
   */
  async function cancel(): Promise<void> {
    const id = activeStreamId
    cleanup()
    if (id) {
      try {
        unwrap(await commands.aiChatCancel(id))
      } catch (e) {
        // Cancellation is best-effort. Log but don't throw — the caller has
        // already moved on (e.g. switched session) and doesn't care.
        console.warn('[ai-chat] cancel failed:', e)
      }
    }
  }

  async function sendMessage(opts: AiChatSendOptions): Promise<string> {
    if (isStreaming.value) {
      throw new Error('既に応答生成中です')
    }
    isStreaming.value = true
    lastError.value = null
    currentText.value = ''

    const streamId = generateStreamId()
    activeStreamId = streamId

    return new Promise<string>((resolve, reject) => {
      // Subscribe BEFORE invoking, so we never miss the first delta.
      listen<AiChatEventPayload>(EVENT_NAME, (event) => {
        const p = event.payload
        if (p.stream_id !== streamId) return
        if (p.kind === 'delta' && p.text) {
          currentText.value += p.text
        } else if (p.kind === 'tool_use') {
          if (opts.onToolUse && p.tool_use_id && p.tool_use_name) {
            opts.onToolUse({
              toolUseId: p.tool_use_id,
              name: p.tool_use_name,
              input: p.tool_use_input ?? {},
            })
          }
        } else if (p.kind === 'done') {
          const finalText = currentText.value
          cleanup()
          resolve(finalText)
        } else if (p.kind === 'error') {
          const message = p.error ?? '不明なエラー'
          lastError.value = message
          cleanup()
          reject(new Error(message))
        }
      })
        .then((un) => {
          activeUnlisten = un
          return commands.aiChatSend({
            stream_id: streamId,
            connection_id: opts.connectionId,
            model: opts.model,
            messages: opts.history.map(toWireMessage),
            system: opts.system && opts.system.length > 0 ? opts.system : null,
            max_tokens: opts.maxTokens ?? null,
            tools:
              opts.tools && opts.tools.length > 0
                ? (opts.tools as unknown as JsonValue)
                : null,
          })
        })
        .then((res) => {
          unwrap(res)
        })
        .catch((e) => {
          const message = e instanceof Error ? e.message : String(e)
          lastError.value = message
          cleanup()
          reject(new Error(message))
        })
    })
  }

  return {
    isStreaming,
    lastError,
    currentText,
    sendMessage,
    cancel,
  }
}

/**
 * Composable に依存しない one-shot 版。capability 経由 (`ai.chat`) や非 Vue
 * 環境から呼ぶ用。挙動は `useAiChat.sendMessage` と同等だが、`onScopeDispose`
 * を使わないので component 外でも安全。
 *
 * - tool calling / onToolUse / cancel は未対応 (= 必要なら `useAiChat` を使う)
 * - 1 リクエストにつき 1 listener を作って done/error で必ず解除する
 */
export async function sendAiChatOnce(opts: AiChatSendOptions): Promise<string> {
  const streamId = `ai-once-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let accumulated = ''
  let unlisten: UnlistenFn | null = null

  return new Promise<string>((resolve, reject) => {
    listen<AiChatEventPayload>(EVENT_NAME, (event) => {
      const p = event.payload
      if (p.stream_id !== streamId) return
      if (p.kind === 'delta' && p.text) {
        accumulated += p.text
      } else if (p.kind === 'done') {
        unlisten?.()
        resolve(accumulated)
      } else if (p.kind === 'error') {
        unlisten?.()
        reject(new Error(p.error ?? '不明なエラー'))
      }
      // 'tool_use' は無視 (one-shot では tools を渡さない前提)
    })
      .then((un) => {
        unlisten = un
        return commands.aiChatSend({
          stream_id: streamId,
          connection_id: opts.connectionId,
          model: opts.model,
          messages: opts.history.map(toWireMessage),
          system: opts.system && opts.system.length > 0 ? opts.system : null,
          max_tokens: opts.maxTokens ?? null,
          tools: null,
        })
      })
      .then((res) => {
        unwrap(res)
      })
      .catch((e) => {
        unlisten?.()
        const message = e instanceof Error ? e.message : String(e)
        reject(new Error(message))
      })
  })
}
