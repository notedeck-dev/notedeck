import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import type { AiTurnRequest } from '@/bindings'
import type { ChatMessage } from './useAiChat'
import {
  type AiTurnEventPayload,
  type AiTurnSessionPort,
  isAiTurnRunning,
  resetAiTurnsForTest,
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
  data: null as null | Record<string, unknown>,
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

const presentConfirmRequest = vi.fn(async (_p: unknown) => undefined)
const closeConfirmRequest = vi.fn()
const closeConfirmRequestsForTurn = vi.fn()
vi.mock('./aiConfirmRequests', () => ({
  presentConfirmRequest: (p: unknown) => presentConfirmRequest(p as never),
  closeConfirmRequest: (id: string) => closeConfirmRequest(id),
  closeConfirmRequestsForTurn: (id: string) => closeConfirmRequestsForTurn(id),
}))

// --- helpers ---

function memorySessions(initial: ChatMessage[] = []): AiTurnSessionPort & {
  messages(): ChatMessage[]
  removed: string[][]
  reloads: number
} {
  let messages = initial
  const port = {
    removed: [] as string[][],
    reloads: 0,
    get: (id: string) => (id === 's1' ? { title: '', messages } : undefined),
    setLocalMessages: (id: string, next: ChatMessage[]) => {
      if (id === 's1') messages = next
    },
    reload: async () => {
      port.reloads++
    },
    removeMessages: (id: string, ids: readonly string[]) => {
      if (id !== 's1') return
      port.removed.push([...ids])
      messages = messages.filter((m) => !ids.includes(m.id))
    },
    messages: () => messages,
  }
  return port
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
  resetAiTurnsForTest()
  listeners.length = 0
  aiTurnRun.mockClear()
  aiTurnCancel.mockClear()
  cancelTurnExecutions.mockClear()
  presentConfirmRequest.mockClear()
  closeConfirmRequest.mockClear()
  closeConfirmRequestsForTurn.mockClear()
})

describe('useAiTurn (#1133 縦切り 1: ターンの投影)', () => {
  it('履歴とデバイス文脈のスナップショットを notecore に渡し、イベントを session に投影する', async () => {
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
      context_untrusted: false,
      principal: 'ai.chat',
      connection_id: 'conn-1',
      model: 'model-1',
      device_context: 'SYSTEM',
      trigger_skill_ids: [],
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
      message_id: 'm-a0-0',
    })
    emit({
      kind: 'tool_result',
      tool_use_id: 'tu1',
      text: '12:00',
      message_id: 'm-r0-0',
    })
    emit({
      kind: 'tool_use',
      text: '',
      tool_use_id: 'tu2',
      tool_use_name: 'account.list',
      tool_use_input: { limit: 1 },
      message_id: 'm-a0-1',
    })
    emit({
      kind: 'tool_result',
      tool_use_id: 'tu2',
      text: '[]',
      message_id: 'm-r0-1',
    })
    // ラウンド 2: 最終本文
    emit({ kind: 'delta', text: '12 時です' })
    emit({
      kind: 'done',
      text: '12 時です',
      stop_reason: 'end',
      message_id: 'm-a1',
    })

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
    // 写しの id は notecore が書いたもの (ユーザー入力は `<turn>-u` の規則)
    const turnId = aiTurnRun.mock.calls[0]?.[0].turn_id
    expect(msgs.map((m) => m.id)).toEqual([
      `${turnId}-u`,
      'm-a0-0',
      'm-r0-0',
      'm-a0-1',
      'm-r0-1',
      'm-a1',
    ])
    expect(turn.isRunning.value).toBe(false)
    expect(turn.retryContext.value).toBeNull()
    // ターンの終わりに確定分を読み直す
    expect(sessions.reloads).toBe(1)
    // listener は解除される
    expect(listeners).toHaveLength(0)
  })

  it('セッションへの書込が届くまで notecore にターンを投げない (#1106)', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => {
      release = r
    })
    const sessions = Object.assign(memorySessions(), {
      settled: async (id: string) => {
        if (id === 's1') await gate
      },
    })
    const turn = useAiTurn({ sessions })
    const outcome = turn.run(baseRequest())
    await flush()
    expect(aiTurnRun).not.toHaveBeenCalled()
    release()
    await flush()
    expect(aiTurnRun).toHaveBeenCalledTimes(1)
    emit({ kind: 'done', text: 'ok', stop_reason: 'end' })
    await outcome
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
    emit({
      kind: 'error',
      error: '接続が切断されました',
      phase: 'before_tool',
      message_id: 'm-err',
    })
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
    // prepareRetry: user + 失敗した assistant を取り除く (notecore にも送る)
    const plan = turn.prepareRetry('s1')
    expect(plan).toEqual({ mode: 'resend', text: 'いま何時?' })
    expect(sessions.messages()).toEqual([])
    const turnId1 = aiTurnRun.mock.calls[0]?.[0].turn_id
    expect(sessions.removed).toEqual([[`${turnId1}-u`, 'm-err']])

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
    // notecore は途中までの本文をセッションに書いてそのメッセージを返す
    aiTurnCancel.mockResolvedValueOnce({
      status: 'ok',
      data: {
        id: 'm-partial',
        role: 'assistant',
        content: '途中',
        timestamp: 5,
        toolUseId: null,
        toolUseName: null,
        toolUseInput: null,
        toolResultFor: null,
        heartbeat: null,
      },
    })
    await turn.cancel()
    expect(await outcome).toEqual({ status: 'cancelled', wasFirstRound: true })
    expect(aiTurnCancel).toHaveBeenCalledWith(turnId)
    expect(cancelTurnExecutions).toHaveBeenCalledWith(turnId)
    expect(sessions.messages().at(-1)).toMatchObject({
      id: 'm-partial',
      content: '途中',
    })
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

  it('scope dispose (カラムを閉じる) では中断せず、投影を続ける (#1371)', async () => {
    const sessions = memorySessions()
    const scope = effectScope()
    const turn = scope.run(() => useAiTurn({ sessions }))
    if (!turn) throw new Error('scope.run returned undefined')
    const outcome = turn.run(baseRequest())
    await flush()
    emit({ kind: 'delta', text: 'こん' })
    scope.stop()
    expect(aiTurnCancel).not.toHaveBeenCalled()

    emit({ kind: 'delta', text: 'にちは' })
    expect(sessions.messages().at(-1)?.content).toBe('こんにちは')
    emit({ kind: 'done', text: 'こんにちは', message_id: 'm-final' })
    expect((await outcome).status).toBe('done')
    expect(sessions.reloads).toBe(1)
  })

  it('開き直した画面 (別の instance) から、進行中のターンが見えて止められる (#1371)', async () => {
    const sessions = memorySessions()
    const first = effectScope()
    const turn = first.run(() => useAiTurn({ sessions, sessionId: () => 's1' }))
    if (!turn) throw new Error('scope.run returned undefined')
    const outcome = turn.run(baseRequest())
    await flush()
    first.stop()

    const onUpdate = vi.fn()
    const reopened = useAiTurn({ sessions, sessionId: () => 's1', onUpdate })
    const other = useAiTurn({ sessions, sessionId: () => 's2' })
    expect(reopened.isRunning.value).toBe(true)
    expect(other.isRunning.value).toBe(false)
    // 追従 (スクロール) は今そのセッションを表示している画面に届く
    emit({ kind: 'delta', text: 'a' })
    expect(onUpdate).toHaveBeenCalled()

    await reopened.cancel()
    expect((await outcome).status).toBe('cancelled')
    expect(aiTurnCancel).toHaveBeenCalledOnce()
    expect(reopened.isRunning.value).toBe(false)
    expect(reopened.retryContext.value?.mode).toBe('resend')

    // セッションを消すときは再試行コンテキストも捨てる
    await reopened.forget('s1')
    expect(reopened.retryContext.value).toBeNull()
  })

  it('別のセッションのターンは並行して走る (セッションを切り替えても止めない)', async () => {
    const sessions = memorySessions()
    const turn = useAiTurn({ sessions })
    void turn.run(baseRequest())
    await flush()
    await expect(turn.run(baseRequest())).rejects.toThrow()
    // s2 は port に無いので aborted だが、s1 が走っていることでは弾かれない
    expect(await turn.run(baseRequest('s2'))).toEqual({ status: 'aborted' })
  })

  it('写しが読み直されて placeholder が消えても、確定分と重複させずに投影を続ける', async () => {
    const sessions = memorySessions()
    const turn = useAiTurn({ sessions })
    const outcome = turn.run(baseRequest())
    await flush()
    emit({ kind: 'delta', text: '調べ' })
    // 読み直し: notecore が持つ確定分 (user) だけになる
    sessions.setLocalMessages(
      's1',
      sessions.messages().filter((m) => m.role === 'user'),
    )
    emit({ kind: 'delta', text: 'ます' })
    expect(sessions.messages().at(-1)).toMatchObject({
      role: 'assistant',
      content: '調べます',
    })

    // 読み直した写しが、確定済みの tool_use を既に持っている場合
    const confirmed: ChatMessage = {
      id: 'm-use',
      role: 'assistant',
      content: '調べます',
      timestamp: 1,
      toolUseId: 'tu1',
      toolUseName: 'time_now',
      toolUseInput: {},
    }
    sessions.setLocalMessages('s1', [
      ...sessions.messages().filter((m) => m.role === 'user'),
      confirmed,
    ])
    emit({
      kind: 'tool_use',
      text: '調べます',
      tool_use_id: 'tu1',
      tool_use_name: 'time_now',
      tool_use_input: {},
      message_id: 'm-use',
    })
    expect(sessions.messages().filter((m) => m.id === 'm-use')).toHaveLength(1)

    emit({ kind: 'done', text: '' })
    await outcome
  })

  it('文脈を組んでいる間 (buildSystem) も、そのセッションは応答中として見える', async () => {
    const sessions = memorySessions()
    const turn = useAiTurn({ sessions })
    let release: (v: string) => void = () => undefined
    const outcome = turn.run({
      ...baseRequest(),
      buildSystem: () => new Promise<string>((r) => (release = r)),
    })
    expect(isAiTurnRunning('s1')).toBe(true)
    expect(isAiTurnRunning('s2')).toBe(false)
    release('SYSTEM')
    await flush()
    emit({ kind: 'done', text: 'ok' })
    await outcome
    expect(isAiTurnRunning('s1')).toBe(false)
  })

  it('文脈を組んでいる間に止めたら、何も送らずに終わる', async () => {
    const sessions = memorySessions()
    const turn = useAiTurn({ sessions })
    let release: (v: string) => void = () => undefined
    const outcome = turn.run({
      ...baseRequest(),
      buildSystem: () => new Promise<string>((r) => (release = r)),
    })
    await turn.cancel()
    release('SYSTEM')
    expect((await outcome).status).toBe('cancelled')
    expect(aiTurnRun).not.toHaveBeenCalled()
    expect(aiTurnCancel).not.toHaveBeenCalled()
    expect(sessions.messages()).toEqual([])
    expect(isAiTurnRunning('s1')).toBe(false)
  })

  it('buildSystem が失敗したら応答中のまま残さない', async () => {
    const turn = useAiTurn({ sessions: memorySessions() })
    await expect(
      turn.run({
        ...baseRequest(),
        buildSystem: () => Promise.reject(new Error('boom')),
      }),
    ).rejects.toThrow('boom')
    expect(isAiTurnRunning('s1')).toBe(false)
  })

  it('誰もそのセッションを見ていないときに終わったら onFinishUnseen で知らせる (#1371)', async () => {
    const sessions = memorySessions()
    const onFinishUnseen = vi.fn()

    // 見ている画面がある: 知らせない
    const scope = effectScope()
    const turn = scope.run(() =>
      useAiTurn({ sessions, sessionId: () => 's1', onUpdate: () => undefined }),
    )
    if (!turn) throw new Error('scope.run returned undefined')
    let outcome = turn.run({ ...baseRequest(), onFinishUnseen })
    await flush()
    emit({ kind: 'done', text: 'ok' })
    await outcome
    expect(onFinishUnseen).not.toHaveBeenCalled()

    // 画面を閉じてから終わった: 知らせる
    aiTurnRun.mockClear()
    outcome = turn.run({ ...baseRequest(), onFinishUnseen })
    await flush()
    scope.stop()
    emit({ kind: 'done', text: 'ok' })
    await outcome
    expect(onFinishUnseen).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'done' }),
    )

    // 自分で止めたものは知らせない
    onFinishUnseen.mockClear()
    aiTurnRun.mockClear()
    const turn2 = useAiTurn({ sessions })
    outcome = turn2.run({ ...baseRequest(), onFinishUnseen })
    await flush()
    await turn2.cancel()
    await outcome
    expect(onFinishUnseen).not.toHaveBeenCalled()
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
    expect(req?.session_id).toBe('s1')
    expect(req?.messages).toEqual([{ role: 'user', content: 'いま何時?' }])
    emit({ kind: 'done', text: 'ok', stop_reason: 'end' })
    await outcome
  })

  it('confirm_request は表示モジュールへ渡し、confirm_closed / 中断で畳む (#1133 縦切り 2)', async () => {
    const sessions = memorySessions()
    const turn = useAiTurn({ sessions })
    const outcome = turn.run({ ...baseRequest(), accountId: 'acc-1' })
    await flush()
    const turnId = aiTurnRun.mock.calls[0]?.[0].turn_id
    emit({ kind: 'delta', text: '投稿します' })
    const items = [
      {
        toolUseId: 'tu1',
        capabilityId: 'notes.create',
        params: { text: 'hi' },
        preview: { title: '投稿しますか?', message: 'hi' },
        allowRemember: true,
      },
    ]
    emit({
      kind: 'confirm_request',
      confirm_request_id: 'req-1',
      confirm_items: items,
      expires_at_ms: 1,
    })
    expect(presentConfirmRequest).toHaveBeenCalledWith({
      requestId: 'req-1',
      turnId,
      principal: 'ai.chat',
      accountId: 'acc-1',
      items,
    })
    // 要求中も placeholder の本文はそのまま (実行結果は再開後に届く)
    expect(sessions.messages().at(-1)?.content).toBe('投稿します')

    emit({
      kind: 'confirm_closed',
      confirm_request_id: 'req-1',
      reason: 'decided',
    })
    expect(closeConfirmRequest).toHaveBeenCalledWith('req-1')

    await turn.cancel()
    expect(closeConfirmRequestsForTurn).toHaveBeenCalledWith(turnId)
    expect((await outcome).status).toBe('cancelled')
  })

  it('persist: false のターンは notecore にセッションを書かせない (session_id は null)', async () => {
    const sessions = memorySessions()
    const turn = useAiTurn({ sessions })
    const outcome = turn.run({ ...baseRequest(), persist: false })
    await flush()
    expect(aiTurnRun.mock.calls[0]?.[0].session_id).toBeNull()
    emit({ kind: 'done', text: 'ok', stop_reason: 'end' })
    await outcome
    expect(sessions.reloads).toBe(0)
  })
})
