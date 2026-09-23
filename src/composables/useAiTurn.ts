import type { UnlistenFn } from '@tauri-apps/api/event'
import { onScopeDispose, ref } from 'vue'
import type { AiChatMessage, JsonValue } from '@/bindings'
import {
  collectDeviceTools,
  collectRuntimeEnums,
} from '@/capabilities/deviceTools'
import { listCapabilities } from '@/capabilities/registry'
import type { ChatMessage } from '@/composables/useAiChat'
import { useAiActivity } from '@/stores/aiActivity'
import { extractErrorMessage } from '@/utils/errors'
import { listenTauri } from '@/utils/tauriEvents'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { cancelTurnExecutions } from './aiTurnExecutions'

/**
 * AI ターンのデバイス側 (#1133 縦切り 1)。
 *
 * ループ本体 (ラウンドの反復 / tool_use の実行 / 認可 / 上限 / タイトル生成)
 * は notecore のターン実行器にある。ここに残るのは:
 *
 * - ターンの開始 (履歴と system prompt のスナップショットを渡す)
 * - `nd:ai-turn-event` をセッション store へ投影する (placeholder の管理)
 * - 中断と、失敗ターンの再試行コンテキスト (#508 / #646 / #737)
 *
 * tool の実行要求は apiBridge の `ai/execute-capability` が受けて既存の
 * dispatcher (確認 UI 込み) を走らせる。
 */

/** session store の必要最小面 (useAiSessionsStore の部分型) */
export interface AiTurnSessionPort {
  get(id: string): { title: string; messages: ChatMessage[] } | undefined
  updateMessages(id: string, messages: ChatMessage[]): void
}

export interface AiTurnDeps {
  sessions: AiTurnSessionPort
  /** session 更新のたびに呼ばれる view hook (scroll 等) */
  onUpdate?(): void
}

export interface AiTurnRunRequest {
  sessionId: string
  /**
   * ユーザー入力テキスト (user メッセージとして追加される)。
   * continuation では追加されない (元ターンの user メッセージが履歴に残っている)。
   */
  text: string
  principal: 'ai.chat' | 'ai.heartbeat'
  /** 呼び出し文脈のアカウント (per-account の AI カラム) */
  accountId?: string | null
  connectionId: string
  model: string
  generation?: {
    maxTokens?: number
    maxToolRounds?: number
    readTimeoutSeconds?: number
    titleMaxTokens?: number
  }
  /** 切断ターンの継続モード (#737) */
  continuation?: boolean
  /**
   * wire history から system prompt を組み立てる。ターン開始時に 1 回だけ呼ぶ
   * (デバイス文脈のスナップショット)。undefined は「system prompt なし」。
   */
  buildSystem(
    history: ChatMessage[],
  ): Promise<string | undefined> | string | undefined
  /** 初回応答のセッションならタイトルを生成させ、届いたら onTitle に渡す */
  generateTitle?: boolean
  onTitle?(title: string): void
}

export type AiTurnOutcome =
  | { status: 'done'; finalText: string; wasFirstRound: boolean }
  | { status: 'error'; message: string; wasFirstRound: boolean }
  /** ユーザー中断 (#770)。partial は温存済み、空 placeholder は除去済み */
  | { status: 'cancelled'; wasFirstRound: boolean }
  /** session 消失等で何も送らなかった */
  | { status: 'aborted' }

/**
 * ストリーム切断 (#508) で失敗したターンの再試行用コンテキスト。
 *
 * - `resend` — tool 未実行のターン。user + placeholder を取り除き、同じ
 *   text で通常送信を再走行する (#646 §C)
 * - `continue` — tool 実行済みのターン (#737)。実行済み tool_use / tool_result
 *   は届いた時点で session に記録済みなので、失敗 placeholder だけ取り除き、
 *   続きを生成すれば write capability を再実行する経路は構造的に無い
 */
export interface AiRetryContext {
  sessionId: string
  userMsgId?: string
  placeholderId: string
  userText: string
  mode: 'resend' | 'continue'
}

export interface AiRetryPlan {
  mode: 'resend' | 'continue'
  text: string
}

export interface AiTurnEventPayload {
  turn_id: string
  kind: 'delta' | 'tool_use' | 'tool_result' | 'done' | 'error' | 'title'
  text?: string
  error?: string
  phase?: 'before_tool' | 'after_tool'
  stop_reason?: 'end' | 'tool_round_limit'
  tool_use_id?: string
  tool_use_name?: string
  tool_use_input?: Record<string, unknown>
  is_error?: boolean
}

export class AiTurnCancelledError extends Error {
  constructor() {
    super('応答の生成を中断しました')
    this.name = 'AiTurnCancelledError'
  }
}

function generateTurnId(): string {
  return `ai-turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function toReadTimeoutMs(seconds: number | undefined): number | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null
  return Math.round(seconds * 1000)
}

export function toWireMessage(m: ChatMessage): AiChatMessage {
  const wire: AiChatMessage = { role: m.role, content: m.content }
  if (m.toolUseId) wire.tool_use_id = m.toolUseId
  if (m.toolUseName) wire.tool_use_name = m.toolUseName
  if (m.toolUseInput) {
    wire.tool_use_input = m.toolUseInput as unknown as JsonValue
  }
  if (m.toolResultFor) wire.tool_result_for = m.toolResultFor
  return wire
}

export function useAiTurn(deps: AiTurnDeps) {
  const isRunning = ref(false)
  const retryContext = ref<AiRetryContext | null>(null)
  const activity = useAiActivity()

  let activeTurnId: string | null = null
  let activeUnlisten: UnlistenFn | null = null
  let activeCancel: (() => void) | null = null
  let endActivity: (() => void) | null = null

  function cleanup() {
    endActivity?.()
    endActivity = null
    activeUnlisten?.()
    activeUnlisten = null
    activeTurnId = null
    activeCancel = null
    isRunning.value = false
  }

  onScopeDispose(() => {
    void cancel()
  })

  /**
   * 進行中のターンを中断する (#770)。Rust 側の task を止め、このターンのために
   * デバイスが待っている確認を閉じ、session の掃除を走らせる。
   */
  async function cancel(): Promise<void> {
    const id = activeTurnId
    const settle = activeCancel
    if (!id) return
    cancelTurnExecutions(id)
    settle?.()
    try {
      unwrap(await commands.aiTurnCancel(id))
    } catch (e) {
      console.warn('[ai-turn] cancel failed:', e)
    }
  }

  async function run(req: AiTurnRunRequest): Promise<AiTurnOutcome> {
    if (isRunning.value) throw new Error('既に応答生成中です')
    retryContext.value = null

    const now = Date.now()
    const before = deps.sessions.get(req.sessionId)
    if (!before) return { status: 'aborted' }

    let userMsgId: string | undefined
    if (!req.continuation) {
      const userMsg: ChatMessage = {
        id: `msg-${now}-u`,
        role: 'user',
        content: req.text,
        timestamp: now,
      }
      userMsgId = userMsg.id
      deps.sessions.updateMessages(req.sessionId, [...before.messages, userMsg])
      deps.onUpdate?.()
    }

    // このターンが assistant 応答のない初回かどうか (AI 生成タイトル用)。
    // 失敗ターンの残骸 (tool_use 付き assistant) は「完了した応答」ではない
    const wasFirstRound = !before.messages.some(
      (m) => m.role === 'assistant' && !m.toolUseId,
    )

    const placeholder: ChatMessage = {
      id: `msg-${now}-a`,
      role: 'assistant',
      content: '',
      timestamp: now,
    }
    const afterUser = deps.sessions.get(req.sessionId)
    if (!afterUser) return { status: 'aborted' }
    deps.sessions.updateMessages(req.sessionId, [
      ...afterUser.messages,
      placeholder,
    ])
    deps.onUpdate?.()

    // wire history: placeholder / system / heartbeat 由来を除く (#411)
    const history = (deps.sessions.get(req.sessionId)?.messages ?? []).filter(
      (m) => m.role !== 'system' && m.id !== placeholder.id && !m.heartbeat,
    )
    const system = await req.buildSystem(history)
    const caps = listCapabilities()

    isRunning.value = true
    endActivity = activity.begin('running')
    activity.pulse('jumping')

    const turnId = generateTurnId()
    activeTurnId = turnId
    let placeholderId = placeholder.id
    let toolExecuted = req.continuation === true
    let roundIndex = 0

    const getSession = () => deps.sessions.get(req.sessionId)
    const replaceLast = (
      patch: (last: ChatMessage) => ChatMessage | null,
    ): void => {
      const cur = getSession()
      if (!cur) return
      const last = cur.messages[cur.messages.length - 1]
      if (last?.role !== 'assistant' || last.id !== placeholderId) return
      const next = patch(last)
      deps.sessions.updateMessages(
        req.sessionId,
        next ? [...cur.messages.slice(0, -1), next] : cur.messages.slice(0, -1),
      )
      deps.onUpdate?.()
    }
    const recordRetry = () => {
      retryContext.value = {
        sessionId: req.sessionId,
        userMsgId,
        placeholderId,
        userText: req.text,
        mode: toolExecuted ? 'continue' : 'resend',
      }
    }

    return new Promise<AiTurnOutcome>((resolve) => {
      const finish = (outcome: AiTurnOutcome) => {
        cleanup()
        deps.onUpdate?.()
        resolve(outcome)
      }
      // ユーザー中断: partial をそのまま確定、空 placeholder は残骸として残さない
      activeCancel = () => {
        replaceLast((last) => (last.content ? last : null))
        recordRetry()
        finish({ status: 'cancelled', wasFirstRound })
      }

      const onEvent = (p: AiTurnEventPayload) => {
        if (p.turn_id !== turnId) return
        switch (p.kind) {
          case 'delta': {
            if (!p.text) return
            replaceLast((last) => ({ ...last, content: last.content + p.text }))
            return
          }
          case 'tool_use': {
            // placeholder を「本文 + tool_use」として確定する
            if (!p.tool_use_id || !p.tool_use_name) return
            replaceLast((last) => ({
              ...last,
              content: p.text ?? last.content,
              timestamp: Date.now(),
              toolUseId: p.tool_use_id,
              toolUseName: p.tool_use_name,
              toolUseInput: p.tool_use_input ?? {},
            }))
            return
          }
          case 'tool_result': {
            // tool_result + 次の placeholder を追加する
            if (!p.tool_use_id) return
            toolExecuted = true
            roundIndex++
            const cur = getSession()
            if (!cur) return
            const ts = Date.now()
            const nextPlaceholderId = `msg-${ts}-a${roundIndex}`
            deps.sessions.updateMessages(req.sessionId, [
              ...cur.messages,
              {
                id: `msg-${ts}-r${roundIndex}`,
                role: 'user',
                content: p.text ?? '',
                timestamp: ts,
                toolResultFor: p.tool_use_id,
              },
              {
                id: nextPlaceholderId,
                role: 'assistant',
                content: '',
                timestamp: ts,
              },
            ])
            placeholderId = nextPlaceholderId
            deps.onUpdate?.()
            return
          }
          case 'done': {
            const finalText = p.text ?? ''
            replaceLast((last) =>
              last.content === finalText
                ? last
                : { ...last, content: finalText },
            )
            activity.pulse('waving')
            finish({ status: 'done', finalText, wasFirstRound })
            return
          }
          case 'error': {
            activity.pulse('failed')
            console.error('[ai-turn] error event:', p.error)
            const message = p.error ?? '不明なエラー'
            // mid-stream 切断 (#508): placeholder に途中までの応答が入っていれば温存
            replaceLast((last) => ({
              ...last,
              content: last.content
                ? `${last.content}\n\n⚠️ ${message}`
                : `⚠️ ${message}`,
            }))
            if (p.phase === 'after_tool') toolExecuted = true
            recordRetry()
            finish({ status: 'error', message, wasFirstRound })
            return
          }
          case 'title': {
            if (p.text) req.onTitle?.(p.text)
            return
          }
        }
      }

      // Subscribe BEFORE invoking, so we never miss the first delta.
      listenTauri('nd:ai-turn-event', onEvent)
        .then((un) => {
          activeUnlisten = un
          return commands.aiTurnRun({
            turn_id: turnId,
            session_id: req.sessionId,
            principal: req.principal,
            account_id: req.accountId ?? null,
            connection_id: req.connectionId,
            model: req.model,
            system: system && system.length > 0 ? system : null,
            messages: history.map(toWireMessage),
            // 0 は「プロバイダー既定に任せる」なので送らない
            max_tokens: req.generation?.maxTokens || null,
            read_timeout_ms: toReadTimeoutMs(
              req.generation?.readTimeoutSeconds,
            ),
            max_tool_rounds: req.generation?.maxToolRounds ?? null,
            continuation: req.continuation === true,
            generate_title: req.generateTitle === true && wasFirstRound,
            title_max_tokens: req.generation?.titleMaxTokens ?? null,
            tool_param_enums: collectRuntimeEnums(caps) as JsonValue | null,
            device_tools: collectDeviceTools(caps),
          })
        })
        .then((res) => {
          unwrap(res)
        })
        .catch((e) => {
          if (!activeTurnId) return // 既に settle 済み (中断など)
          console.error('[ai-turn] invoke error raw:', e)
          const message = extractErrorMessage(e)
          activity.pulse('failed')
          replaceLast((last) => ({ ...last, content: `⚠️ ${message}` }))
          recordRetry()
          finish({ status: 'error', message, wasFirstRound })
        })
    })
  }

  /**
   * 再試行の準備。実行できない状況 (別セッション表示中 / 実行中 /
   * コンテキスト無し) では null を返し、状態を変えない。
   */
  function prepareRetry(currentSessionId: string | null): AiRetryPlan | null {
    const r = retryContext.value
    if (!r || isRunning.value) return null
    if (r.sessionId !== currentSessionId) return null
    retryContext.value = null
    const cur = deps.sessions.get(r.sessionId)
    if (!cur) return null
    const removeIds =
      r.mode === 'resend' ? [r.userMsgId, r.placeholderId] : [r.placeholderId]
    deps.sessions.updateMessages(
      r.sessionId,
      cur.messages.filter((m) => !removeIds.includes(m.id)),
    )
    return { mode: r.mode, text: r.userText }
  }

  return { run, cancel, isRunning, retryContext, prepareRetry }
}
