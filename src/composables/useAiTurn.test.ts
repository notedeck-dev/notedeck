import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import type { AiTurnRequest } from '@/bindings'
import type { ChatMessage } from './useAiChat'
import {
  type AiTurnEventPayload,
  type AiTurnSessionPort,
  useAiTurn,
} from './useAiTurn'

// --- Tauri mock ---

const listeners: Array<(p: unknown) => void> = []
vi.mock('@/utils/tauriEvents', () => ({
  listenTauri: vi.fn(async (_event: string, cb: (p: unknown) => void) => {
    listeners.push(cb)
    return () => {
      const i = listeners.indexOf(cb)
      if (i >= 0) listeners.splice(i, 1)
    }
  }),
}))

const aiTurnRun = vi.fn(async (_req: AiTurnRequest) => ({
  status: 'ok' as const,
  data: null,
}))
const aiTurnCancel = vi.fn(async (_id: string) => ({
  status: 'ok' as const,
  data: null,
}))
vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      aiTurnRun: (req: AiTurnRequest) => aiTurnRun(req),
      aiTurnCancel: (id: string) => aiTurnCancel(id),
    },
  }
})

// builtins (store 依存) を読み込まない
vi.mock('@/capabilities/registry', () => ({ listCapabilities: () => [] }))

const cancelTurnExecutions = vi.fn()
vi.mock('./aiTurnExecutions', () => ({
  cancelTurnExecutions: (id: string) => cancelTurnExecutions(id),
}))

// --- helpers ---

function memorySessions(initial: ChatMessage[] = []): AiTurnSessionPort & {
  messages(): ChatMessage[]
} {
  let messages = initial
  return {
    get: (id) => (id === 's1' ? { title: '', messages } : undefined),
    updateMessages: (id, next) => {
      if (id === 's1') messages = next
    },
    messages: () => messages,
  }
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function emit(p: Omit<AiTurnEventPayload, 'turn_id'>) {
  const turnId = aiTurnRun.mock.calls[0]?.[0].turn_id
  if (!turnId) throw new Error('aiTurnRun not invoked yet')
  for (const cb of [...listeners]) cb({ ...p, turn_id: turnId })
}

function baseRequest(sessionId = 's1') {
  return {
    sessionId,
    text: 'いま何時?',
    principal: 'ai.chat' as const,
    connectionId: 'conn-1',
    model: 'model-1',
    buildSystem: () => 'SYSTEM',
  }
}

beforeEach(() => {
  listeners.length = 0
  aiTurnRun.mockClear()
  aiTurnCancel.mockClear()
  cancelTurnExecutions.mockClear()
})

describe('useAiTurn (#1133 縦切り 1: ターンの投影)', () => {
  it('履歴と system のスナップショットを notecore に渡し、イベントを session に投影する', async () => {
    const sessions = memorySessions()
    const turn = useAiTurn({ sessions })
    const outcome = turn.run({ ...baseRequest(), generateTitle: true })
    await flush()

    // user + placeholder が先に積まれ、履歴 (placeholder 抜き) が wire で渡る
    expect(sessions.messages().map((m) => m.role)).toEqual([
      'user',
      'assistant',
    ])
    const req = aiTurnRun.mock.calls[0]?.[0]
    expect(req).toMatchObject({
      session_id: 's1',
      principal: 'ai.chat',
      connection_id: 'conn-1',
      model: 'model-1',
      system: 'SYSTEM',
      continuation: false,
      generate_title: true,
      device_tools: [],
    })
    expect(req?.messages).toEqual([{ role: 'user', content: 'いま何時?' }])
    expect(turn.isRunning.value).toBe(true)

    // ラウンド 1: 本文 + tool_use 2 件 (並列) → 各 tool_result
    emit({ kind: 'delta', text: '確認' })
    emit({ kind: 'delta', text: 'します' })
    emit({
      kind: 'tool_use',
      text: '確認します',
      tool_use_id: 'tu1',
      tool_use_name: 'time.now',
      tool_use_input: {},
    })
    emit({ kind: 'tool_result', tool_use_id: 'tu1', text: '12:00' })
    emit({
      kind: 'tool_use',
      text: '',
      tool_use_id: 'tu2',
      tool_use_name: 'account.list',
      tool_use_input: { limit: 1 },
    })
    emit({ kind: 'tool_result', tool_use_id: 'tu2', text: '[]' })
    // ラウンド 2: 最終本文
    emit({ kind: 'delta', text: '12 時です' })
    emit({ kind: 'done', text: '12 時です', stop_reason: 'end' })

    expect(await outcome).toEqual({
      status: 'done',
      finalText: '12 時です',
      wasFirstRound: true,
    })
    const msgs = sessions.messages()
    expect(
      msgs.map((m) => [m.role, m.content, m.toolUseId, m.toolResultFor]),
    ).toEqual([
      ['user', 'いま何時?', undefined, undefined],
      ['assistant', '確認します', 'tu1', undefined],
      ['user', '12:00', undefined, 'tu1'],
      ['assistant', '', 'tu2', undefined],
      ['user', '[]', undefined, 'tu2'],
      ['assistant', '12 時です', undefined, undefined],
    ])
    expect(msgs[3]?.toolUseInput).toEqual({ limit: 1 })
    expect(turn.isRunning.value).toBe(false)
    expect(turn.retryContext.value).toBeNull()
    // listener は解除される
    expect(listeners).toHaveLength(0)
  })

  it('title イベントは onTitle に渡る', async () => {
    const sessions = memorySessions()
    const turn = useAiTurn({ sessions })
    const onTitle = vi.fn()
    const outcome = turn.run({ ...baseRequest(), onTitle })
    await flush()
    emit({ kind: 'done', text: 'x', stop_reason: 'end' })
    // done の後にタイトルが届いても listener は生きている必要は無い —
    // Rust は done → title の順で出すので、done 前に届く設計ではない。
    // ここでは title が done より前に来ても落ちないことだけ確認する
    await outcome
    const turn2 = useAiTurn({ sessions: memorySessions() })
    aiTurnRun.mockClear()
    const o2 = turn2.run({ ...baseRequest(), onTitle })
    await flush()
    emit({ kind: 'title', text: '現在時刻の確認' })
    emit({ kind: 'done', text: 'y', stop_reason: 'end' })
    await o2
    expect(onTitle).toHaveBeenCalledWith('現在時刻の確認')
  })

  it('tool 未実行の失敗は resend、実行済みは continue の再試行コンテキストになる', async () => {
    // before_tool
    let sessions = memorySessions()
    let turn = useAiTurn({ sessions })
    let outcome = turn.run(baseRequest())
    await flush()
    emit({ kind: 'delta', text: '途中まで' })
    emit({ kind: 'error', error: '接続が切断されました', phase: 'before_tool' })
    expect(await outcome).toEqual({
      status: 'error',
      message: '接続が切断されました',
      wasFirstRound: true,
    })
    // partial は温存され ⚠️ が付く
    expect(sessions.messages().at(-1)?.content).toBe(
      '途中まで\n\n⚠️ 接続が切断されました',
    )
    expect(turn.retryContext.value?.mode).toBe('resend')
    // prepareRetry: user + placeholder を取り除く
    const plan = turn.prepareRetry('s1')
    expect(plan).toEqual({ mode: 'resend', text: 'いま何時?' })
    expect(sessions.messages()).toEqual([])

    // after_tool
    aiTurnRun.mockClear()
    sessions = memorySessions()
    turn = useAiTurn({ sessions })
    outcome = turn.run(baseRequest())
    await flush()
    emit({
      kind: 'tool_use',
      text: '',
      tool_use_id: 'tu1',
      tool_use_name: 'time.now',
      tool_use_input: {},
    })
    emit({ kind: 'tool_result', tool_use_id: 'tu1', text: '12:00' })
    emit({ kind: 'error', error: 'timeout', phase: 'after_tool' })
    expect((await outcome).status).toBe('error')
    expect(turn.retryContext.value?.mode).toBe('continue')
    // continue: 失敗 placeholder だけ取り除き、実行済み tool_use / result は残す
    expect(turn.prepareRetry('s1')).toEqual({
      mode: 'continue',
      text: 'いま何時?',
    })
    expect(
      sessions.messages().map((m) => m.toolUseId ?? m.toolResultFor),
    ).toEqual([undefined, 'tu1', 'tu1'])

    // 別セッション表示中は再試行しない
    expect(turn.prepareRetry('other')).toBeNull()
  })

  it('continuation は user を足さず、Rust に continuation=true で渡す', async () => {
    const sessions = memorySessions([
      { id: 'u', role: 'user', content: 'q', timestamp: 0 },
      {
        id: 'a',
        role: 'assistant',
        content: '',
        timestamp: 0,
        toolUseId: 'tu1',
        toolUseName: 'time.now',
        toolUseInput: {},
      },
      {
        id: 'r',
        role: 'user',
        content: '12:00',
        timestamp: 0,
        toolResultFor: 'tu1',
      },
    ])
    const turn = useAiTurn({ sessions })
    const outcome = turn.run({ ...baseRequest(), continuation: true })
    await flush()
    const req = aiTurnRun.mock.calls[0]?.[0]
    expect(req?.continuation).toBe(true)
    expect(req?.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
    ])
    expect(sessions.messages().filter((m) => m.role === 'user')).toHaveLength(2)
    emit({ kind: 'error', error: 'x', phase: 'before_tool' })
    await outcome
    // 継続中の失敗は (tool 未実行でも) continue
    expect(turn.retryContext.value?.mode).toBe('continue')
  })

  it('cancel は Rust を止め、確認待ちを閉じ、partial を確定して空 placeholder を消す', async () => {
    const sessions = memorySessions()
    const turn = useAiTurn({ sessions })
    const outcome = turn.run(baseRequest())
    await flush()
    const turnId = aiTurnRun.mock.calls[0]?.[0].turn_id
    emit({ kind: 'delta', text: '途中' })
    await turn.cancel()
    expect(await outcome).toEqual({ status: 'cancelled', wasFirstRound: true })
    expect(aiTurnCancel).toHaveBeenCalledWith(turnId)
    expect(cancelTurnExecutions).toHaveBeenCalledWith(turnId)
    expect(sessions.messages().at(-1)?.content).toBe('途中')
    expect(turn.retryContext.value?.mode).toBe('resend')

    // partial 無しなら placeholder は残らない
    aiTurnRun.mockClear()
    const sessions2 = memorySessions()
    const turn2 = useAiTurn({ sessions: sessions2 })
    const o2 = turn2.run(baseRequest())
    await flush()
    await turn2.cancel()
    await o2
    expect(sessions2.messages().map((m) => m.role)).toEqual(['user'])
    // 中断後に遅れて届いたイベントは無視される
    expect(() => emit({ kind: 'done', text: 'late' })).not.toThrow()
    expect(sessions2.messages().map((m) => m.role)).toEqual(['user'])
  })

  it('scope dispose でも進行中のターンを中断する', async () => {
    const sessions = memorySessions()
    const scope = effectScope()
    const turn = scope.run(() => useAiTurn({ sessions }))
    if (!turn) throw new Error('scope.run returned undefined')
    const outcome = turn.run(baseRequest())
    await flush()
    scope.stop()
    expect((await outcome).status).toBe('cancelled')
    expect(aiTurnCancel).toHaveBeenCalledOnce()
  })

  it('invoke 自体の失敗 (接続未設定など) はエラーとして placeholder に残る', async () => {
    aiTurnRun.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'invalid_input', message: 'AI 接続が見つかりません' },
    } as never)
    const sessions = memorySessions()
    const turn = useAiTurn({ sessions })
    const outcome = await turn.run(baseRequest())
    expect(outcome).toMatchObject({ status: 'error' })
    expect(sessions.messages().at(-1)?.content).toContain('⚠️')
    expect(turn.isRunning.value).toBe(false)
  })

  it('session が無ければ aborted で何も送らない', async () => {
    const turn = useAiTurn({ sessions: memorySessions() })
    expect(await turn.run(baseRequest('missing'))).toEqual({
      status: 'aborted',
    })
    expect(aiTurnRun).not.toHaveBeenCalled()
  })

  it('heartbeat 由来のメッセージは wire history から除く (#411)', async () => {
    const sessions = memorySessions([
      {
        id: 'h',
        role: 'assistant',
        content: '💓',
        timestamp: 0,
        heartbeat: true,
      },
    ])
    const turn = useAiTurn({ sessions })
    const outcome = turn.run({ ...baseRequest(), principal: 'ai.heartbeat' })
    await flush()
    const req = aiTurnRun.mock.calls[0]?.[0]
    expect(req?.principal).toBe('ai.heartbeat')
    expect(req?.messages).toEqual([{ role: 'user', content: 'いま何時?' }])
    emit({ kind: 'done', text: 'ok', stop_reason: 'end' })
    await outcome
  })
})
