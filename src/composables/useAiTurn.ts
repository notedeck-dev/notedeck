import type { UnlistenFn } from '@tauri-apps/api/event'
import { computed, onScopeDispose, reactive, ref } from 'vue'
import type { AiChatMessage, JsonValue } from '@/bindings'
import {
  CAPABILITY_DECLARATIONS,
  type CapabilityId,
} from '@/capabilities/declarations.generated'
import {
  collectDeviceTools,
  collectRuntimeEnums,
} from '@/capabilities/deviceTools'
import { emitSpotlightFromCapability } from '@/capabilities/dispatcher'
import { listCapabilities } from '@/capabilities/registry'
import type { ChatMessage } from '@/composables/useAiChat'
import { i18n } from '@/i18n'
import { nativeError } from '@/i18n/native'
import { invokeErrorText } from '@/services/aiInvokeError'
import { messageFromWire } from '@/services/aiSessionCodec'
import { useAiActivity } from '@/stores/aiActivity'
import type { ConfirmOptions } from '@/stores/confirm'
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
 * 進行中のターンは画面 (AI カラム) ではなくアプリが持つ (#1371): 状態はセッション
 * 単位でモジュールに置き、カラムを閉じても投影を続ける。止めるのは `cancel` だけ。
 * 開き直した画面は同じセッションの状態をそのまま見る。
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
  /** 送信済みの書込 (作成 / 改名) が notecore に届くまで待つ。無ければ即座に返る */
  settled?(id: string): Promise<void>
  /** メッセージを id で取り除く (notecore にも送る) */
  removeMessages(id: string, messageIds: readonly string[]): void
}

export interface AiTurnDeps {
  sessions: AiTurnSessionPort
  /** この画面が表示しているセッション。省略時は最後に `run` したセッション */
  sessionId?(): string | null
  /** 表示中のセッションが更新されるたびに呼ばれる view hook (scroll 等) */
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
   * デバイスが組んだ文脈に他人の内容 (可視ノート / ラベル付きのメモ) が
   * 含まれる。true ならこのセッションはこのターンから tainted (#1103)。
   * 関数なら buildSystem の後に評価する (文脈を組んで初めて分かるため)。
   * ラベル付きの skill は notemaid が組むときに自分で判定する (#1162)
   */
  contextUntrusted?: boolean | (() => boolean)
  /** セッションに累積した trigger skill の id (本文の注入は notemaid、#1162) */
  triggerSkillIds?: readonly string[]
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
   * wire history からデバイス文脈 (`<notedeck-context>`) を組み立てる。ターン開始時に
   * 1 回だけ呼ぶ (スナップショット)。人格 / 記憶 / skill の本文は notemaid が
   * この前に足す (#1162)。undefined は「文脈なし」。
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
  /** `text` が定型の知らせを含むときの手がかり (#135) */
  text_i18n?: unknown
  error?: string
  /** `error` を表示言語で描き直す手がかり (#135) */
  error_i18n?: unknown
  phase?: 'before_tool' | 'after_tool'
  stop_reason?: 'end' | 'tool_round_limit'
  /** done: ターンの token 使用量 (provider が返さなければ推定) */
  usage?: { inputTokens: number; outputTokens: number; estimated: boolean }
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
  /** この turn / セッションで読んだ他人の内容の経路 (capability id か context)。空なら汚染なし (#1162) */
  taintSources?: string[]
  /** 自分で選んだストアのキャラクター / skill が理由で確認している */
  storeSkill?: boolean
  /** 書こうとした文が他人の本文にそのまま出てくる (注入の疑い) */
  matchesUntrusted?: boolean
}

export class AiTurnCancelledError extends Error {
  constructor() {
    super('response generation was cancelled')
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

interface ActiveTurn {
  turnId: string
  unlisten: UnlistenFn | null
  /** 中断の後始末 (partial を写しに載せて終わらせる) */
  settle: ((partial: ChatMessage | null) => void) | null
  endActivity: (() => void) | null
}

/** 進行中のターン (セッション id → ターン)。画面の生死と独立 */
const activeTurns = reactive(new Map<string, ActiveTurn>())
/**
 * 失敗 / 中断したターンの再試行コンテキスト (セッション id →)。そのセッションの
 * 次のターン / 再試行 / セッションの削除 (`forget`) で消える
 */
const retryContexts = reactive(new Map<string, AiRetryContext>())
/** いま開いている画面の view hook */
const viewHooks = new Set<{ sessionId(): string | null; onUpdate(): void }>()

function notifyUpdate(sessionId: string): void {
  for (const hook of viewHooks) {
    if (hook.sessionId() === sessionId) hook.onUpdate()
  }
}

export function resetAiTurnsForTest(): void {
  activeTurns.clear()
  retryContexts.clear()
  viewHooks.clear()
}

export function useAiTurn(deps: AiTurnDeps) {
  const activity = useAiActivity()
  const lastRunSessionId = ref<string | null>(null)
  const viewSessionId = (): string | null =>
    deps.sessionId ? deps.sessionId() : lastRunSessionId.value

  const isRunning = computed(() => {
    const id = viewSessionId()
    return id !== null && activeTurns.has(id)
  })
  const retryContext = computed<AiRetryContext | null>({
    get: () => {
      const id = viewSessionId()
      return (id !== null && retryContexts.get(id)) || null
    },
    set: (value) => {
      const id = value?.sessionId ?? viewSessionId()
      if (id === null) return
      if (value) retryContexts.set(id, value)
      else retryContexts.delete(id)
    },
  })

  if (deps.onUpdate) {
    const hook = { sessionId: viewSessionId, onUpdate: deps.onUpdate }
    viewHooks.add(hook)
    // 画面を閉じても進行中のターンは止めない (#1371)。外すのは view hook だけ
    onScopeDispose(() => viewHooks.delete(hook), true)
  }

  function cleanup(sessionId: string) {
    const active = activeTurns.get(sessionId)
    active?.endActivity?.()
    active?.unlisten?.()
    activeTurns.delete(sessionId)
  }

  /**
   * 進行中のターンを中断する (#770)。Rust 側の task を止め、このターンのために
   * デバイスが待っている確認を閉じ、session の掃除を走らせる。
   * 対象は指定したセッション (省略時は表示中のセッション)。
   */
  async function cancel(
    sessionId: string | null = viewSessionId(),
  ): Promise<void> {
    const active = sessionId !== null ? activeTurns.get(sessionId) : undefined
    if (!active) return
    const id = active.turnId
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
    active.settle?.(partial)
  }

  async function run(req: AiTurnRunRequest): Promise<AiTurnOutcome> {
    if (activeTurns.has(req.sessionId))
      throw new Error('a response is already being generated')
    lastRunSessionId.value = req.sessionId
    retryContexts.delete(req.sessionId)
    const onUpdate = () => notifyUpdate(req.sessionId)

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
      onUpdate()
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
    onUpdate()

    // wire history: placeholder / system / heartbeat 由来を除く (#411)
    const history = (deps.sessions.get(req.sessionId)?.messages ?? []).filter(
      (m) => m.role !== 'system' && m.id !== placeholder.id && !m.heartbeat,
    )
    const system = await req.buildSystem(history)
    const caps = listCapabilities()

    const active: ActiveTurn = {
      turnId,
      unlisten: null,
      settle: null,
      endActivity: activity.begin('running'),
    }
    activeTurns.set(req.sessionId, active)
    activity.pulse('jumping')
    const isActive = () => activeTurns.get(req.sessionId)?.turnId === turnId

    // 生成中の assistant メッセージ。写しが読み直されて消えても (開き直した画面 /
    // 別経路の書込) ここから戻せるよう、写しとは別に持つ
    let pending: ChatMessage = placeholder
    let toolExecuted = req.continuation === true

    const getSession = () => deps.sessions.get(req.sessionId)
    const replaceLast = (
      patch: (last: ChatMessage) => ChatMessage | null,
    ): void => {
      const cur = getSession()
      if (!cur) return
      const next = patch(pending)
      // 読み直した写しが確定分 (同じ id) を既に持っていれば、それと置き換える
      const stale = (m: ChatMessage) => m.id === pending.id || m.id === next?.id
      const at = cur.messages.findIndex(stale)
      const rest = cur.messages.filter((m) => !stale(m))
      if (next) {
        rest.splice(at < 0 ? rest.length : at, 0, next)
        pending = next
      }
      deps.sessions.setLocalMessages(req.sessionId, rest)
      onUpdate()
    }
    const recordRetry = () => {
      retryContexts.set(req.sessionId, {
        sessionId: req.sessionId,
        userMsgId,
        placeholderId: pending.id,
        userText: req.text,
        mode: toolExecuted ? 'continue' : 'resend',
      })
    }

    return new Promise<AiTurnOutcome>((resolve) => {
      const finish = (outcome: AiTurnOutcome) => {
        cleanup(req.sessionId)
        onUpdate()
        // 確定分は notecore が書いているので、写しを読み直して揃える
        if (req.persist !== false) void deps.sessions.reload(req.sessionId)
        resolve(outcome)
      }
      // ユーザー中断: notecore が書いた partial を写しに載せ、空 placeholder は
      // 残骸として残さない
      active.settle = (partial) => {
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
        if (p.turn_id !== turnId || !isActive()) return
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
            // exec: core の tool は dispatcher を通らないので、AI Spotlight
            // (誰が何をしたかの可視化) はここで出す。デバイス実行の tool は
            // dispatcher が出している (二重に光らせない)
            if (!p.is_error) {
              const use = cur.messages.find(
                (m) => m.toolUseId === p.tool_use_id,
              )
              if (use?.toolUseName) {
                spotlightCoreTool(use, p.text ?? '', req.principal)
              }
            }
            const ts = Date.now()
            const result: ChatMessage = {
              id: p.message_id ?? `${turnId}-r-${ts}`,
              role: 'user',
              content: p.text ?? '',
              timestamp: ts,
              toolResultFor: p.tool_use_id,
            }
            pending = {
              id: `${turnId}-placeholder-${ts}`,
              role: 'assistant',
              content: '',
              timestamp: ts,
            }
            deps.sessions.setLocalMessages(req.sessionId, [
              ...cur.messages.filter((m) => m.id !== result.id),
              result,
              pending,
            ])
            onUpdate()
            return
          }
          case 'done': {
            const finalText = p.text ?? ''
            replaceLast((last) =>
              finalText
                ? {
                    ...last,
                    id: p.message_id ?? last.id,
                    content: finalText,
                    // 定型の知らせ (tool 呼び出しの上限など) は notecore と同じ手がかりを持つ
                    ...(p.text_i18n
                      ? {
                          i18n: { content: p.text_i18n } as Record<
                            string,
                            unknown
                          >,
                        }
                      : {}),
                  }
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
            const message = nativeError(p)
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
        .then(async (un) => {
          if (!isActive()) {
            un()
            return undefined
          }
          active.unlisten = un
          // 作成 / 改名が notecore に届く前にターンが書き始めないよう待つ
          // (別プロセスの notemaid では要求ごとに task が分かれ、順序が保証されない)
          await deps.sessions.settled?.(req.sessionId)
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
            device_context: system && system.length > 0 ? system : null,
            trigger_skill_ids: [...(req.triggerSkillIds ?? [])],
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
          if (res) unwrap(res)
        })
        .catch((e) => {
          if (!isActive()) return // 既に settle 済み (中断など)
          console.error('[ai-turn] invoke error raw:', e)
          // 本文の無い reject (null / {} 等) は「不明なエラー」にする (#1317)
          const message = invokeErrorText(e) ?? i18n.ts._common.unknownError
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
    const r = currentSessionId ? retryContexts.get(currentSessionId) : undefined
    if (!r || activeTurns.has(r.sessionId)) return null
    retryContexts.delete(r.sessionId)
    const cur = deps.sessions.get(r.sessionId)
    if (!cur) return null
    const removeIds = (
      r.mode === 'resend' ? [r.userMsgId, r.placeholderId] : [r.placeholderId]
    ).filter((id): id is string => typeof id === 'string')
    // 失敗ターンの残骸は notecore が書いているので削除操作を送る
    deps.sessions.removeMessages(r.sessionId, removeIds)
    return { mode: r.mode, text: r.userText }
  }

  /** セッションを消すとき: 進行中のターンを止め、再試行コンテキストも捨てる */
  async function forget(sessionId: string): Promise<void> {
    await cancel(sessionId)
    retryContexts.delete(sessionId)
  }

  return { run, cancel, forget, isRunning, retryContext, prepareRetry }
}

/** core で実行された tool の結果を dispatcher と同じ Spotlight hook に渡す */
function spotlightCoreTool(
  use: { toolUseName?: string; toolUseInput?: unknown },
  resultText: string,
  principal: 'ai.chat' | 'ai.heartbeat',
): void {
  const capId = (use.toolUseName ?? '').replace(/_/g, '.')
  if (CAPABILITY_DECLARATIONS[capId as CapabilityId]?.exec !== 'core') return
  let result: unknown = resultText
  try {
    result = JSON.parse(resultText)
  } catch {
    // 文字列のままでよい
  }
  emitSpotlightFromCapability(
    capId,
    (use.toolUseInput ?? undefined) as Record<string, unknown> | undefined,
    result,
    { kind: principal },
  )
}
