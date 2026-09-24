import type { UnlistenFn } from '@tauri-apps/api/event'
import { onScopeDispose, ref } from 'vue'
import type { AiChatMessage, JsonValue } from '@/bindings'
import {
  collectDeviceTools,
  collectRuntimeEnums,
} from '@/capabilities/deviceTools'
import { listCapabilities } from '@/capabilities/registry'
import type { ChatMessage } from '@/composables/useAiChat'
import { messageFromWire } from '@/services/aiSessionCodec'
import { useAiActivity } from '@/stores/aiActivity'
import type { ConfirmOptions } from '@/stores/confirm'
import { extractErrorMessage } from '@/utils/errors'
import { listenTauri } from '@/utils/tauriEvents'
import { commands, unwrap } from '@/utils/tauriInvoke'
import {
  closeConfirmRequest,
  closeConfirmRequestsForTurn,
  presentConfirmRequest,
} from './aiConfirmRequests'
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

/**
 * session store の必要最小面 (useAiSessionsStore の部分型)。
 *
 * 確定したメッセージは notecore が書く (#1133 縦切り 3)。ここが触るのは
 * 表示用の写しだけ (`setLocalMessages`) で、ターンの終わりに `reload` で
 * notecore の内容に揃える。失敗ターンの再試行だけは削除操作を送る。
 */
export interface AiTurnSessionPort {
  get(id: string): { title: string; messages: ChatMessage[] } | undefined
  /** 写しだけを差し替える (notecore には書かない) */
  setLocalMessages(id: string, messages: ChatMessage[]): void
  /** 確定分を notecore から読み直して写しを揃える */
  reload(id: string): Promise<void>
  /** メッセージを id で取り除く (notecore にも送る) */
  removeMessages(id: string, messageIds: readonly string[]): void
}

export interface AiTurnDeps {
  sessions: AiTurnSessionPort
  /** session 更新のたびに呼ばれる view hook (scroll 等) */
  onUpdate?(): void
}

export interface AiTurnRunRequest {
  sessionId: string
  /**
   * false なら notecore はセッションに書かない (HEARTBEAT の使い捨て履歴)。
   * 省略時 true。
   */
  persist?: boolean
  /**
   * デバイスが組んだ文脈に他人の内容 (可視ノート / ラベル付きのメモ・skill) が
   * 含まれる。true ならこのセッションはこのターンから tainted (#1103)。
   * 関数なら buildSystem の後に評価する (文脈を組んで初めて分かるため)
   */
  contextUntrusted?: boolean | (() => boolean)
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
  kind:
    | 'delta'
    | 'tool_use'
    | 'tool_result'
    | 'done'
    | 'error'
    | 'title'
    | 'confirm_request'
    | 'confirm_closed'
  text?: string
  error?: string
  phase?: 'before_tool' | 'after_tool'
  stop_reason?: 'end' | 'tool_round_limit'
  tool_use_id?: string
  tool_use_name?: string
  tool_use_input?: Record<string, unknown>
  is_error?: boolean
  confirm_request_id?: string
  confirm_items?: AiConfirmItem[]
  expires_at_ms?: number
  reason?: 'decided' | 'cancelled' | 'expired_absolute' | 'expired_display'
  /** notecore がセッションに書いたメッセージの id (写しの id をこれに揃える) */
  message_id?: string
}

/** notecore の確認要求 1 項目 (`confirm_items` の要素) */
export interface AiConfirmItem {
  toolUseId: string
  capabilityId: string
  params: Record<string, unknown>
  preview: ConfirmOptions
  allowRemember: boolean
  /** 宛先が AI の読んだ他人の内容に由来する (プレビューに一文が添えてある) */
  destinationUntrusted?: boolean
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

/** ユーザー入力のメッセージ id。notecore と同じ規則 (`<turn>-u`) */
export function userMessageId(turnId: string): string {
  return `${turnId}-u`
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
  let activeCancel: ((partial: ChatMessage | null) => void) | null = null
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
    closeConfirmRequestsForTurn(id)
    // notecore が途中までの応答をセッションに書いて返す。それを写しに反映して
    // から settle する (返る前に settle すると placeholder が消えた後に届く)
    let partial: ChatMessage | null = null
    try {
      const written = unwrap(await commands.aiTurnCancel(id))
      if (written) partial = messageFromWire(written)
    } catch (e) {
      console.warn('[ai-turn] cancel failed:', e)
    }
    settle?.(partial)
  }

  async function run(req: AiTurnRunRequest): Promise<AiTurnOutcome> {
    if (isRunning.value) throw new Error('既に応答生成中です')
    retryContext.value = null

    const now = Date.now()
    const before = deps.sessions.get(req.sessionId)
    if (!before) return { status: 'aborted' }
    const turnId = generateTurnId()

    // ユーザー入力は notecore が書く (id は両側で同じ規則)。写しには先に出す
    let userMsgId: string | undefined
    if (!req.continuation) {
      const userMsg: ChatMessage = {
        id: userMessageId(turnId),
        role: 'user',
        content: req.text,
        timestamp: now,
      }
      userMsgId = userMsg.id
      deps.sessions.setLocalMessages(req.sessionId, [
        ...before.messages,
        userMsg,
      ])
      deps.onUpdate?.()
    }

    // このターンが assistant 応答のない初回かどうか (AI 生成タイトル用)。
    // 失敗ターンの残骸 (tool_use 付き assistant) は「完了した応答」ではない
    const wasFirstRound = !before.messages.some(
      (m) => m.role === 'assistant' && !m.toolUseId,
    )

    const placeholder: ChatMessage = {
      id: `${turnId}-placeholder`,
      role: 'assistant',
      content: '',
      timestamp: now,
    }
    const afterUser = deps.sessions.get(req.sessionId)
    if (!afterUser) return { status: 'aborted' }
    deps.sessions.setLocalMessages(req.sessionId, [
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

    activeTurnId = turnId
    let placeholderId = placeholder.id
    let toolExecuted = req.continuation === true

    const getSession = () => deps.sessions.get(req.sessionId)
    const replaceLast = (
      patch: (last: ChatMessage) => ChatMessage | null,
    ): void => {
      const cur = getSession()
      if (!cur) return
      const last = cur.messages[cur.messages.length - 1]
      if (last?.role !== 'assistant' || last.id !== placeholderId) return
      const next = patch(last)
      if (next) placeholderId = next.id
      deps.sessions.setLocalMessages(
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
        // 確定分は notecore が書いているので、写しを読み直して揃える
        if (req.persist !== false) void deps.sessions.reload(req.sessionId)
        resolve(outcome)
      }
      // ユーザー中断: notecore が書いた partial を写しに載せ、空 placeholder は
      // 残骸として残さない
      activeCancel = (partial) => {
        replaceLast((last) =>
          partial
            ? { ...last, id: partial.id, content: partial.content }
            : last.content
              ? last
              : null,
        )
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
            // placeholder を「本文 + tool_use」として確定する (id は notecore の)
            if (!p.tool_use_id || !p.tool_use_name) return
            replaceLast((last) => ({
              ...last,
              id: p.message_id ?? last.id,
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
            const cur = getSession()
            if (!cur) return
            const ts = Date.now()
            const nextPlaceholderId = `${turnId}-placeholder-${ts}`
            deps.sessions.setLocalMessages(req.sessionId, [
              ...cur.messages,
              {
                id: p.message_id ?? `${turnId}-r-${ts}`,
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
              finalText
                ? { ...last, id: p.message_id ?? last.id, content: finalText }
                : // 本文なし (tool だけで完結) は notecore も書かない
                  null,
            )
            activity.pulse('waving')
            finish({ status: 'done', finalText, wasFirstRound })
            return
          }
          case 'error': {
            activity.pulse('failed')
            console.error('[ai-turn] error event:', p.error)
            const message = p.error ?? '不明なエラー'
            // mid-stream 切断 (#508): 途中までの応答は温存 (notecore も同じ本文を書く)
            replaceLast((last) => ({
              ...last,
              id: p.message_id ?? last.id,
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
          case 'confirm_request': {
            // notecore 発の確認要求 (#1133 縦切り 2)。表示と応答は別モジュール。
            // turn はチェックポイントに退避していて、応答で再開する
            if (!p.confirm_request_id || !p.confirm_items) return
            void presentConfirmRequest({
              requestId: p.confirm_request_id,
              turnId,
              principal: req.principal,
              accountId: req.accountId ?? undefined,
              items: p.confirm_items,
            })
            return
          }
          case 'confirm_closed': {
            // 期限切れ / 中断 / 別デバイスの応答で閉じた。表示中なら畳む
            if (p.confirm_request_id) closeConfirmRequest(p.confirm_request_id)
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
            session_id: req.persist === false ? null : req.sessionId,
            context_untrusted:
              typeof req.contextUntrusted === 'function'
                ? req.contextUntrusted()
                : req.contextUntrusted === true,
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
    const removeIds = (
      r.mode === 'resend' ? [r.userMsgId, r.placeholderId] : [r.placeholderId]
    ).filter((id): id is string => typeof id === 'string')
    // 失敗ターンの残骸は notecore が書いているので削除操作を送る
    deps.sessions.removeMessages(r.sessionId, removeIds)
    return { mode: r.mode, text: r.userText }
  }

  return { run, cancel, isRunning, retryContext, prepareRetry }
}
