import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { AiChatSendOptions, ChatMessage } from './useAiChat'
import {
  type AiSendLoopDeps,
  MAX_TOOL_ROUNDS,
  useAiSendLoop,
} from './useAiSendLoop'

// ---- fakes ----

function msg(partial: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    role: 'user',
    content: '',
    timestamp: 0,
    ...partial,
  }
}

function makeSessions(initial: Record<string, ChatMessage[]>) {
  const store = new Map<string, { title: string; messages: ChatMessage[] }>()
  for (const [id, messages] of Object.entries(initial)) {
    store.set(id, { title: '', messages })
  }
  return {
    get: (id: string) => store.get(id),
    updateMessages: (id: string, messages: ChatMessage[]) => {
      const cur = store.get(id)
      if (cur) store.set(id, { ...cur, messages })
    },
  }
}

type ChatStep = (opts: AiChatSendOptions) => Promise<string> | string

/**
 * useAiChat の streaming 挙動を再現する fake。script の各要素が 1 回の
 * sendMessage に対応する。step 内で currentText を触れば mid-stream delta、
 * throw すれば mid-stream 切断を模擬できる。
 */
function makeChat(script: ChatStep[]) {
  const isStreaming = ref(false)
  const currentText = ref('')
  const calls: AiChatSendOptions[] = []
  async function sendMessage(opts: AiChatSendOptions): Promise<string> {
    calls.push(opts)
    const step = script.shift()
    if (!step) throw new Error('fake chat: script exhausted')
    isStreaming.value = true
    currentText.value = ''
    try {
      const text = await step(opts)
      currentText.value = text
      return text
    } finally {
      isStreaming.value = false
    }
  }
  return { isStreaming, currentText, sendMessage, calls }
}

const textStep =
  (text: string): ChatStep =>
  () =>
    text

const toolStep =
  (text: string, toolUseId: string, name: string, input = {}): ChatStep =>
  (opts) => {
    opts.onToolUse?.({ toolUseId, name, input })
    return text
  }

function makeDeps(
  script: ChatStep[],
  initial: Record<string, ChatMessage[]> = { s1: [] },
  overrides: Partial<AiSendLoopDeps> = {},
) {
  const chat = makeChat(script)
  const sessions = makeSessions(initial)
  const dispatch = vi.fn(async () => ({ ok: true as const, result: 'ok' }))
  const deps: AiSendLoopDeps = { chat, sessions, dispatch, ...overrides }
  return { chat, sessions, dispatch, deps }
}

function request(
  overrides: Partial<
    Parameters<ReturnType<typeof useAiSendLoop>['runSend']>[0]
  > = {},
) {
  return {
    sessionId: 's1',
    text: 'こんにちは',
    connectionId: 'conn-1',
    model: 'model-1',
    buildSystem: () => 'SYSTEM',
    ...overrides,
  }
}

// ---- tests ----

describe('runSend: 通常応答', () => {
  it('user + placeholder を追加し、最終テキストを placeholder に確定する', async () => {
    const { sessions, dispatch, deps } = makeDeps([textStep('やあ！')])
    const loop = useAiSendLoop(deps)

    const outcome = await loop.runSend(request())

    expect(outcome).toEqual({
      status: 'done',
      finalText: 'やあ！',
      wasFirstRound: true,
    })
    const messages = sessions.get('s1')?.messages ?? []
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'user', content: 'こんにちは' })
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'やあ！' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('assistant 応答が既にあるセッションでは wasFirstRound=false', async () => {
    const { deps } = makeDeps([textStep('二度目')], {
      s1: [
        msg({ id: 'u0', role: 'user', content: 'q' }),
        msg({ id: 'a0', role: 'assistant', content: 'a' }),
      ],
    })
    const loop = useAiSendLoop(deps)

    const outcome = await loop.runSend(request())
    expect(outcome).toMatchObject({ status: 'done', wasFirstRound: false })
  })

  it('セッションが存在しなければ aborted を返し何も送らない', async () => {
    const { chat, deps } = makeDeps([textStep('unused')], {})
    const loop = useAiSendLoop(deps)

    const outcome = await loop.runSend(request({ sessionId: 'missing' }))
    expect(outcome).toEqual({ status: 'aborted' })
    expect(chat.calls).toHaveLength(0)
  })
})

describe('runSend: wire history', () => {
  it('placeholder / system role / heartbeat メッセージを history から除外する', async () => {
    const { chat, deps } = makeDeps([textStep('ok')], {
      s1: [
        msg({ id: 'u0', role: 'user', content: '既存質問' }),
        msg({ id: 'sys', role: 'system', content: '内部' }),
        msg({ id: 'hb', role: 'assistant', content: '💓', heartbeat: true }),
        msg({ id: 'a0', role: 'assistant', content: '既存回答' }),
      ],
    })
    const loop = useAiSendLoop(deps)

    await loop.runSend(request())

    expect(chat.calls).toHaveLength(1)
    const history = chat.calls[0]?.history ?? []
    const ids = history.map((m) => m.id)
    expect(ids).toContain('u0')
    expect(ids).toContain('a0')
    expect(ids).not.toContain('sys')
    expect(ids).not.toContain('hb')
    // 今回の user メッセージは入るが、空 placeholder は入らない
    const roles = history.map((m) => [m.role, m.content])
    expect(roles).toContainEqual(['user', 'こんにちは'])
    expect(roles).not.toContainEqual(['assistant', ''])
  })

  it('buildSystem に round ごとの history を渡し、返り値を system として送る', async () => {
    const buildSystem = vi.fn(
      (history: ChatMessage[]) => `SYS:${history.length}`,
    )
    const { chat, deps } = makeDeps([textStep('ok')])
    const loop = useAiSendLoop(deps)

    await loop.runSend(request({ buildSystem }))

    expect(buildSystem).toHaveBeenCalledTimes(1)
    expect(chat.calls[0]?.system).toBe('SYS:1')
  })
})

describe('runSend: tool round', () => {
  it('tool_use が来たら dispatch し、tool_use / tool_result / 次 placeholder を確定する', async () => {
    const { chat, sessions, dispatch, deps } = makeDeps([
      toolStep('時刻を調べます', 'toolu_1', 'time.now', { tz: 'JST' }),
      textStep('12 時です'),
    ])
    const loop = useAiSendLoop(deps)

    const outcome = await loop.runSend(request())

    expect(dispatch).toHaveBeenCalledExactlyOnceWith('time.now', { tz: 'JST' })
    expect(outcome).toMatchObject({ status: 'done', finalText: '12 時です' })

    const messages = sessions.get('s1')?.messages ?? []
    // user / assistant(tool_use) / user(tool_result) / assistant(final)
    expect(messages).toHaveLength(4)
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: '時刻を調べます',
      toolUseId: 'toolu_1',
      toolUseName: 'time.now',
      toolUseInput: { tz: 'JST' },
    })
    expect(messages[2]).toMatchObject({
      role: 'user',
      content: 'ok',
      toolResultFor: 'toolu_1',
    })
    expect(messages[3]).toMatchObject({
      role: 'assistant',
      content: '12 時です',
    })

    // 2 round 目の history には tool_use / tool_result が入り、新 placeholder は入らない
    const round2 = chat.calls[1]?.history ?? []
    expect(round2.map((m) => m.toolUseId)).toContain('toolu_1')
    expect(round2.map((m) => m.toolResultFor)).toContain('toolu_1')
    expect(round2.some((m) => m.role === 'assistant' && m.content === '')).toBe(
      false,
    )
  })

  it('dispatch 失敗は Error (code): message 形式で tool_result に入る', async () => {
    const dispatch = vi.fn(async () => ({
      ok: false as const,
      code: 'permission_denied' as const,
      error: '権限がありません',
    }))
    const { sessions, deps } = makeDeps(
      [toolStep('', 'toolu_1', 'notes.create'), textStep('了解')],
      { s1: [] },
      { dispatch },
    )
    const loop = useAiSendLoop(deps)

    await loop.runSend(request())

    const messages = sessions.get('s1')?.messages ?? []
    expect(messages[2]).toMatchObject({
      role: 'user',
      content: 'Error (permission_denied): 権限がありません',
      toolResultFor: 'toolu_1',
    })
  })

  it('MAX_TOOL_ROUNDS に達したら警告を添えて打ち切る', async () => {
    // 毎回 tool_use を返す = 無限ループ相当。dispatch はちょうど上限回数。
    const script: ChatStep[] = Array.from(
      { length: MAX_TOOL_ROUNDS + 1 },
      (_, i) => toolStep(`round ${i}`, `toolu_${i}`, 'time.now'),
    )
    const { dispatch, deps } = makeDeps(script)
    const loop = useAiSendLoop(deps)

    const outcome = await loop.runSend(request())

    expect(dispatch).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS)
    expect(outcome.status).toBe('done')
    if (outcome.status === 'done') {
      expect(outcome.finalText).toContain(`round ${MAX_TOOL_ROUNDS}`)
      expect(outcome.finalText).toContain('上限')
    }
  })

  it('reloadConfigs が失敗しても dispatch は続行する', async () => {
    const reloadConfigs = vi.fn(async () => {
      throw new Error('config broken')
    })
    const { dispatch, deps } = makeDeps(
      [toolStep('', 'toolu_1', 'time.now'), textStep('ok')],
      { s1: [] },
      { reloadConfigs },
    )
    const loop = useAiSendLoop(deps)

    const outcome = await loop.runSend(request())
    expect(reloadConfigs).toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(outcome.status).toBe('done')
  })
})

describe('runSend: エラー時の partial 温存 (#508)', () => {
  it('placeholder に反映済みの途中応答を捨てず ⚠️ を末尾に添える', async () => {
    const { sessions, deps } = makeDeps([
      () => {
        // store 側 placeholder には delta watcher 反映済みの partial がある想定
        const cur = sessions.get('s1')
        const last = cur?.messages[cur.messages.length - 1]
        if (cur && last) {
          sessions.updateMessages('s1', [
            ...cur.messages.slice(0, -1),
            { ...last, content: '途中まで書い' },
          ])
        }
        throw new Error('接続が切断されました')
      },
    ])
    const loop = useAiSendLoop(deps)

    const outcome = await loop.runSend(request())

    expect(outcome).toMatchObject({ status: 'error', wasFirstRound: true })
    const messages = sessions.get('s1')?.messages ?? []
    expect(messages[1]?.content).toBe('途中まで書い\n\n⚠️ 接続が切断されました')
  })

  it('currentText の方が store より長ければ currentText を採る', async () => {
    const { chat, sessions, deps } = makeDeps([])
    // script を使わず手動 step: currentText にだけ長い partial を残して throw
    chat.sendMessage = async () => {
      chat.isStreaming.value = true
      chat.currentText.value = '途中まで書いていた長い応答'
      chat.isStreaming.value = false
      throw new Error('boom')
    }
    const loop = useAiSendLoop(deps)

    await loop.runSend(request())

    const messages = sessions.get('s1')?.messages ?? []
    expect(messages[1]?.content).toBe('途中まで書いていた長い応答\n\n⚠️ boom')
  })

  it('partial が無ければ ⚠️ メッセージのみを置く', async () => {
    const { sessions, deps } = makeDeps([
      () => {
        throw new Error('boom')
      },
    ])
    const loop = useAiSendLoop(deps)

    await loop.runSend(request())

    const messages = sessions.get('s1')?.messages ?? []
    expect(messages[1]?.content).toBe('⚠️ boom')
  })
})

describe('retryContext (#646 → #737: write capability 二重実行防止)', () => {
  it('tool 未実行 (toolRound=0) のエラーで mode=resend を記録する', async () => {
    const { deps } = makeDeps([
      () => {
        throw new Error('boom')
      },
    ])
    const loop = useAiSendLoop(deps)

    await loop.runSend(request())

    expect(loop.retryContext.value).toMatchObject({
      sessionId: 's1',
      userText: 'こんにちは',
      mode: 'resend',
    })
  })

  it('tool 実行済みターンのエラーは mode=continue を記録する (#737: 再送でなく継続)', async () => {
    const { dispatch, deps } = makeDeps([
      toolStep('', 'toolu_1', 'notes.create'),
      () => {
        throw new Error('boom after tool')
      },
    ])
    const loop = useAiSendLoop(deps)

    const outcome = await loop.runSend(request())

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(outcome.status).toBe('error')
    expect(loop.retryContext.value).toMatchObject({
      sessionId: 's1',
      userText: 'こんにちは',
      mode: 'continue',
    })
  })

  it('runSend 開始時に前回の retryContext をクリアする', async () => {
    const { deps } = makeDeps([
      () => {
        throw new Error('boom')
      },
      textStep('成功'),
    ])
    const loop = useAiSendLoop(deps)

    await loop.runSend(request())
    expect(loop.retryContext.value).not.toBeNull()

    await loop.runSend(request({ text: '再挑戦' }))
    expect(loop.retryContext.value).toBeNull()
  })
})

describe('prepareRetry', () => {
  it('resend: 失敗した user + assistant ペアを session から除去し userText を返す', async () => {
    const { sessions, deps } = makeDeps(
      [
        () => {
          throw new Error('boom')
        },
      ],
      {
        s1: [
          msg({ id: 'u0', role: 'user', content: '既存' }),
          msg({ id: 'a0', role: 'assistant', content: '既存回答' }),
        ],
      },
    )
    const loop = useAiSendLoop(deps)

    await loop.runSend(request())
    expect(sessions.get('s1')?.messages).toHaveLength(4)

    const retry = loop.prepareRetry('s1')

    expect(retry).toEqual({ mode: 'resend', text: 'こんにちは' })
    expect(loop.retryContext.value).toBeNull()
    // 失敗ペアが消え、既存の会話だけが残る
    expect(sessions.get('s1')?.messages.map((m) => m.id)).toEqual(['u0', 'a0'])
  })

  it('continue: 失敗 placeholder のみ除去し、user と実行済み tool_use / tool_result は残す (#737)', async () => {
    const { sessions, deps } = makeDeps([
      toolStep('検索します', 'toolu_1', 'notes.create'),
      () => {
        throw new Error('boom after tool')
      },
    ])
    const loop = useAiSendLoop(deps)

    await loop.runSend(request())
    // user / assistant(tool_use) / user(tool_result) / placeholder(⚠️)
    expect(sessions.get('s1')?.messages).toHaveLength(4)

    const retry = loop.prepareRetry('s1')

    expect(retry).toEqual({ mode: 'continue', text: 'こんにちは' })
    const remaining = sessions.get('s1')?.messages ?? []
    expect(remaining).toHaveLength(3)
    expect(remaining[0]).toMatchObject({ role: 'user', content: 'こんにちは' })
    expect(remaining[1]).toMatchObject({ toolUseId: 'toolu_1' })
    expect(remaining[2]).toMatchObject({ toolResultFor: 'toolu_1' })
  })

  it('別セッション表示中や streaming 中は何もしない', async () => {
    const { chat, sessions, deps } = makeDeps([
      () => {
        throw new Error('boom')
      },
    ])
    const loop = useAiSendLoop(deps)
    await loop.runSend(request())

    expect(loop.prepareRetry('other-session')).toBeNull()
    expect(loop.retryContext.value).not.toBeNull()

    chat.isStreaming.value = true
    expect(loop.prepareRetry('s1')).toBeNull()
    expect(loop.retryContext.value).not.toBeNull()
    chat.isStreaming.value = false

    expect(sessions.get('s1')?.messages).toHaveLength(2)
  })
})

describe('runSend: continuation (#737 tool 実行ターンの安全な再試行)', () => {
  /** tool 実行済みターンが失敗した直後の session 状態を作る。 */
  async function failAfterTool() {
    const { chat, sessions, dispatch, deps } = makeDeps([
      toolStep('実行します', 'toolu_1', 'notes.create', { text: 'hi' }),
      () => {
        throw new Error('切断')
      },
      textStep('投稿しました'),
    ])
    const loop = useAiSendLoop(deps)
    await loop.runSend(request())
    return { chat, sessions, dispatch, deps, loop }
  }

  it('user メッセージを追加せず、実行済み tool_result を含む履歴で続きを生成する', async () => {
    const { chat, sessions, dispatch, loop } = await failAfterTool()
    const retry = loop.prepareRetry('s1')
    expect(retry?.mode).toBe('continue')

    const outcome = await loop.runSend(
      request({ text: retry?.text ?? '', continuation: true }),
    )

    expect(outcome).toMatchObject({ status: 'done', finalText: '投稿しました' })
    // 継続で dispatch が再実行されていない (= 二重投稿なし)
    expect(dispatch).toHaveBeenCalledTimes(1)

    const messages = sessions.get('s1')?.messages ?? []
    // user / assistant(tool_use) / tool_result / assistant(final) — user は 1 つだけ
    expect(
      messages.filter((m) => m.role === 'user' && !m.toolResultFor),
    ).toHaveLength(1)
    expect(messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: '投稿しました',
    })

    // 継続 round の wire history は tool_result で終わる (placeholder 除外済み)
    const contHistory = chat.calls[2]?.history ?? []
    expect(contHistory.at(-1)?.toolResultFor).toBe('toolu_1')
  })

  it('継続 round の system に切断通知を付与する', async () => {
    const { chat, loop } = await failAfterTool()
    loop.prepareRetry('s1')

    await loop.runSend(request({ continuation: true }))

    expect(chat.calls[2]?.system).toContain('SYSTEM')
    expect(chat.calls[2]?.system).toContain('切断')
  })

  it('継続がさらに失敗しても mode=continue を再記録する (再継続可能)', async () => {
    const { deps } = makeDeps([
      toolStep('', 'toolu_1', 'notes.create'),
      () => {
        throw new Error('切断 1 回目')
      },
      () => {
        throw new Error('切断 2 回目')
      },
    ])
    const loop = useAiSendLoop(deps)
    await loop.runSend(request())
    expect(loop.prepareRetry('s1')?.mode).toBe('continue')

    // 継続 1 round 目 (このターン内では tool 未実行) で再度切断しても、
    // ターン全体としては実行済み tool を含むため resend に落ちてはいけない
    const outcome = await loop.runSend(request({ continuation: true }))
    expect(outcome.status).toBe('error')
    expect(loop.retryContext.value?.mode).toBe('continue')
  })

  it('tool_use assistant しか無い session では wasFirstRound=true (タイトル生成が動く)', async () => {
    const { loop } = await failAfterTool()
    loop.prepareRetry('s1')

    const outcome = await loop.runSend(request({ continuation: true }))
    expect(outcome).toMatchObject({ status: 'done', wasFirstRound: true })
  })
})

describe('delta watcher', () => {
  it('streaming 中の currentText 更新を最後の assistant メッセージへ反映する', async () => {
    let observedMidStream: string | undefined
    const { chat, sessions, deps } = makeDeps([
      async () => {
        chat.currentText.value = '書きかけ'
        await nextTick()
        observedMidStream = sessions.get('s1')?.messages.at(-1)?.content
        return '書きかけの続き'
      },
    ])
    const onUpdate = vi.fn()
    deps.onUpdate = onUpdate
    const loop = useAiSendLoop(deps)

    await loop.runSend(request())

    expect(observedMidStream).toBe('書きかけ')
    expect(onUpdate).toHaveBeenCalled()
    // ストリーム終了後は最終テキストで確定している
    expect(sessions.get('s1')?.messages.at(-1)?.content).toBe('書きかけの続き')
  })

  it('ストリーム外 (isStreaming=false) では store を触らない', async () => {
    const { chat, sessions, deps } = makeDeps([textStep('done')])
    const loop = useAiSendLoop(deps)
    await loop.runSend(request())

    const before = sessions.get('s1')?.messages
    chat.currentText.value = '無関係な delta'
    await nextTick()
    expect(sessions.get('s1')?.messages).toEqual(before)
    void loop
  })
})
