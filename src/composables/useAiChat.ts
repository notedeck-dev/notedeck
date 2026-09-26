import type { UnlistenFn } from '@tauri-apps/api/event'
import { onScopeDispose, ref } from 'vue'
import type { AiChatMessage, JsonValue } from '@/bindings'
import { nativeError } from '@/i18n/native'
import { useAiActivity } from '@/stores/aiActivity'
import { extractErrorMessage } from '@/utils/errors'
import { listenTauri } from '@/utils/tauriEvents'
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
  /**
   * 無人実行 (HEARTBEAT) の書込意図 (#1133)。確認が要る操作は無人では走らせず
   * 受信箱カードとして残し、人がボタンを押して確認を経てから走る。
   */
  intent?: AiIntent
  /**
   * 本文を表示言語で描き直す手がかり (#135)。notecore が書く定型の本文
   * (HEARTBEAT の失敗や受信箱カード) にだけ付き、`content` は英語の正本文。
   * 表示は `localizeNative` を通す
   */
  i18n?: Record<string, unknown>
}

/** 受信箱カード (無人の書込意図) */
export interface AiIntent {
  capabilityId: string
  params: Record<string, unknown>
  /** 他人の内容を読んだ文脈で作られた (確認に一文添える) */
  untrusted: boolean
  /** pending = 未処理 / drafted = 下書きにも保存済み / executed / dismissed */
  status: 'pending' | 'drafted' | 'executed' | 'dismissed'
  draftId?: string | null
  error?: string | null
  source: 'heartbeat'
  createdAt: number
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
  /** 応答待ちのアイドルタイムアウト (秒)。省略時は Rust 側の既定 (120 秒)。 */
  readTimeoutSeconds?: number
  /**
   * Provider 形式 (Anthropic or OpenAI) の生 tool definition 配列。
   * 呼び出し側で `toAnthropicTool` / `toOpenAiTool` を使って事前変換する。
   * 空 / 省略時は tool calling 無効 (= 既存挙動)。
   */
  tools?: unknown[]
}

export interface AiChatEventPayload {
  stream_id: string
  kind: 'delta' | 'done' | 'error' | 'tool_use'
  text?: string
  error?: string
  /** `error` を表示言語で描き直す手がかり (#135) */
  error_i18n?: unknown
  tool_use_id?: string
  tool_use_name?: string
  tool_use_input?: Record<string, unknown>
}

/**
 * ユーザー操作 (停止ボタン / セッション切替 / unmount) によるストリーム中断 (#770)。
 * done / error と並ぶ sendMessage の正規の終端イベント。Rust 側は task を
 * abort するだけでイベントを emit しないため、JS 側で promise をこのエラーで
 * settle しないと呼び出し側が永久 pending になる。呼び出し側は instanceof で
 * エラーと区別する。
 */
export class AiChatCancelledError extends Error {
  constructor() {
    super('応答の生成を中断しました')
    this.name = 'AiChatCancelledError'
  }
}

function generateStreamId(): string {
  return `ai-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 秒指定を wire のミリ秒へ。範囲の検査は Rust 側が持つ。 */
function toReadTimeoutMs(seconds: number | undefined): number | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null
  return Math.round(seconds * 1000)
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
 * Single-shot streaming chat call (1 ラウンド、tool なし)。エージェントの
 * ターン (tool_use の反復) は notecore のターン実行器 (`useAiTurn`) が担う
 * (#1133)。ここは HEARTBEAT のタイトル生成など 1 往復の用途に残る。
 *
 * Use `cancel()` to abort an in-flight stream.
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
  // 進行中 sendMessage の reject。cancel / dispose 時に AiChatCancelledError で
  // settle し、await している送信ループ側の掃除 (placeholder 除去等) を走らせる。
  let activeReject: ((e: Error) => void) | null = null
  // ペット (#1080) 向けの「生成中」報告。cleanup で必ず戻す
  let endActivity: (() => void) | null = null

  function cleanup() {
    endActivity?.()
    endActivity = null
    if (activeUnlisten) {
      activeUnlisten()
      activeUnlisten = null
    }
    activeStreamId = null
    activeReject = null
    isStreaming.value = false
  }

  // Auto-cleanup on component unmount: settles the in-flight promise and
  // tears down the listener so we don't leak across columns being
  // added/removed. cancel() also aborts the Rust task so it doesn't keep
  // streaming bytes (and burning API tokens) for an unmounted component.
  onScopeDispose(() => {
    void cancel()
  })

  /**
   * Cancel any in-flight stream (#770). Settles the pending sendMessage
   * promise with AiChatCancelledError, then asks the Rust side to abort the
   * background task so it stops emitting events for this stream_id.
   */
  async function cancel(): Promise<void> {
    const id = activeStreamId
    const reject = activeReject
    cleanup()
    reject?.(new AiChatCancelledError())
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
    endActivity = useAiActivity().begin('running')

    const streamId = generateStreamId()
    activeStreamId = streamId

    return new Promise<string>((resolve, reject) => {
      activeReject = reject
      // Subscribe BEFORE invoking, so we never miss the first delta.
      listenTauri('nd:ai-chat-event', (p) => {
        if (p.stream_id !== streamId) return
        if (p.kind === 'delta' && p.text) {
          currentText.value += p.text
        } else if (p.kind === 'done') {
          const finalText = currentText.value
          cleanup()
          resolve(finalText)
        } else if (p.kind === 'error') {
          // p.error は型定義上 string だが、Rust 側から非文字列が来た場合の保険
          console.error('[ai-chat] stream error event:', p.error)
          const message =
            p.error == null || typeof p.error === 'string'
              ? nativeError(p)
              : extractErrorMessage(p.error)
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
            read_timeout_ms: toReadTimeoutMs(opts.readTimeoutSeconds),
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
          // 診断: Tauri unwrap で投げられた raw error を console に dump
          console.error('[ai-chat] invoke error raw:', e)
          // Tauri unwrap が raw `{code, message}` を投げてくるので、
          // `String(e)` で `[object Object]` 化しないよう extractor を使う。
          const message = extractErrorMessage(e)
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
 * - tool calling / cancel は未対応 (エージェントのターンは `useAiTurn`)
 * - 1 リクエストにつき 1 listener を作って done/error で必ず解除する
 */
export async function sendAiChatOnce(opts: AiChatSendOptions): Promise<string> {
  const streamId = `ai-once-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  let accumulated = ''
  let unlisten: UnlistenFn | null = null
  // ペット (#1080) 向けの「生成中」報告。解放は settle 時に一箇所で行う
  // (useAiChat の cleanup / taskRunner の finally と同じく漏れない作り)
  const endActivity = useAiActivity().begin('running')

  const run = new Promise<string>((resolve, reject) => {
    listenTauri('nd:ai-chat-event', (p) => {
      if (p.stream_id !== streamId) return
      if (p.kind === 'delta' && p.text) {
        accumulated += p.text
      } else if (p.kind === 'done') {
        unlisten?.()
        resolve(accumulated)
      } else if (p.kind === 'error') {
        unlisten?.()
        reject(new Error(nativeError(p)))
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
          read_timeout_ms: toReadTimeoutMs(opts.readTimeoutSeconds),
          tools: null,
        })
      })
      .then((res) => {
        unwrap(res)
      })
      .catch((e) => {
        console.error('[ai-chat one-shot] invoke error raw:', e)
        unlisten?.()
        const message = extractErrorMessage(e)
        reject(new Error(message))
      })
  })
  return run.finally(endActivity)
}
