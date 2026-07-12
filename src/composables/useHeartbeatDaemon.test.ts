import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { AiChatSendOptions, ChatMessage } from './useAiChat'
import { defaultConfig } from './useAiConfig'
import { useAiSendLoop } from './useAiSendLoop'
import {
  _internal,
  applyHeartbeatSuppression,
  createEphemeralAiSession,
  decideCheapCheck,
  HEARTBEAT_EPHEMERAL_SESSION_ID,
  HEARTBEAT_OK_TOKEN,
} from './useHeartbeatDaemon'

// Note: useHeartbeatDaemon 自体は Pinia store / Tauri event listen / SkillStore
// を必要とするため統合的にユニットテストしない。本テストは OpenClaw 流の
// suppression 純関数 / 定数 / instruction 文言の shape のみ検証する。

describe('applyHeartbeatSuppression (OpenClaw 流)', () => {
  it('returns null for the exact token', () => {
    expect(applyHeartbeatSuppression('HEARTBEAT_OK')).toBeNull()
  })

  it('returns null when surrounded by whitespace', () => {
    expect(applyHeartbeatSuppression('  HEARTBEAT_OK  ')).toBeNull()
    expect(applyHeartbeatSuppression('\n\nHEARTBEAT_OK\n')).toBeNull()
  })

  it('returns null for empty / whitespace-only / null / undefined', () => {
    expect(applyHeartbeatSuppression('')).toBeNull()
    expect(applyHeartbeatSuppression('   \n')).toBeNull()
    expect(applyHeartbeatSuppression(null)).toBeNull()
    expect(applyHeartbeatSuppression(undefined)).toBeNull()
  })

  it('strips leading HEARTBEAT_OK then drops if remainder is short ack', () => {
    // 先頭 HEARTBEAT_OK + 短い ack → 全体 drop
    expect(applyHeartbeatSuppression('HEARTBEAT_OK\nnothing urgent')).toBeNull()
  })

  it('strips trailing HEARTBEAT_OK then drops if remainder is short ack', () => {
    expect(applyHeartbeatSuppression('all clear\nHEARTBEAT_OK')).toBeNull()
  })

  it('preserves long alert text even when wrapped with HEARTBEAT_OK', () => {
    // 長いアラート (300 文字超) は drop しない
    const longAlert = 'これは大事なメンションです。'.repeat(30)
    expect(longAlert.length).toBeGreaterThan(300)
    const wrapped = `HEARTBEAT_OK\n\n${longAlert}\n\nHEARTBEAT_OK`
    const result = applyHeartbeatSuppression(wrapped)
    expect(result).not.toBeNull()
    expect(result).toContain(longAlert.trim())
    // 先頭 / 末尾の token は剥がされている
    expect(result?.startsWith(HEARTBEAT_OK_TOKEN)).toBe(false)
    expect(result?.endsWith(HEARTBEAT_OK_TOKEN)).toBe(false)
  })

  it('does NOT touch HEARTBEAT_OK in the middle (= alert containing the literal)', () => {
    const middle =
      '注意: AI が HEARTBEAT_OK を返さなかった理由を確認してください。'
    expect(applyHeartbeatSuppression(middle)).toBe(middle)
  })

  it('returns the trimmed body when alert > ackMaxChars threshold', () => {
    const alert = 'X'.repeat(400)
    expect(applyHeartbeatSuppression(alert)).toBe(alert)
  })

  it('respects custom ackMaxChars threshold', () => {
    // threshold 1000 で長いアラートも ack 扱いになるケース
    const medium = 'short alert text'
    expect(applyHeartbeatSuppression(medium, 1000)).toBeNull()
    // threshold 5 なら drop されない
    expect(applyHeartbeatSuppression(medium, 5)).toBe(medium)
  })

  it('keeps non-ack alerts at the threshold boundary', () => {
    // ちょうど ackMaxChars = 300 のテキスト → ack 扱い (drop)
    const exactly300 = 'a'.repeat(300)
    expect(applyHeartbeatSuppression(exactly300)).toBeNull()
    // 301 文字 → 表示
    const just301 = 'a'.repeat(301)
    expect(applyHeartbeatSuppression(just301)).toBe(just301)
  })
})

describe('HEARTBEAT_OK_TOKEN', () => {
  it('matches the constant used in instruction prompt', () => {
    expect(HEARTBEAT_OK_TOKEN).toBe('HEARTBEAT_OK')
    expect(_internal.HEARTBEAT_INSTRUCTION).toContain(HEARTBEAT_OK_TOKEN)
  })
})

describe('HEARTBEAT_INSTRUCTION', () => {
  it('mentions HEARTBEAT skill (= OpenClaw style "follow strictly")', () => {
    expect(_internal.HEARTBEAT_INSTRUCTION).toContain('HEARTBEAT')
    expect(_internal.HEARTBEAT_INSTRUCTION).toContain('過去の会話')
  })
})

describe('createEphemeralAiSession (#707 send ループ共有)', () => {
  it('専用 id 以外の get は undefined を返す', () => {
    const ephemeral = createEphemeralAiSession()
    expect(ephemeral.port.get('other-session')).toBeUndefined()
    expect(
      ephemeral.port.get(HEARTBEAT_EPHEMERAL_SESSION_ID)?.messages,
    ).toEqual([])
  })

  it('updateMessages / reset で履歴を差し替え・破棄できる', () => {
    const ephemeral = createEphemeralAiSession()
    const m: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'x',
      timestamp: 0,
    }
    ephemeral.port.updateMessages(HEARTBEAT_EPHEMERAL_SESSION_ID, [m])
    expect(
      ephemeral.port.get(HEARTBEAT_EPHEMERAL_SESSION_ID)?.messages,
    ).toEqual([m])
    // 専用 id 以外への書込は無視
    ephemeral.port.updateMessages('other-session', [])
    expect(
      ephemeral.port.get(HEARTBEAT_EPHEMERAL_SESSION_ID)?.messages,
    ).toEqual([m])
    ephemeral.reset()
    expect(
      ephemeral.port.get(HEARTBEAT_EPHEMERAL_SESSION_ID)?.messages,
    ).toEqual([])
  })

  it('useAiSendLoop と組み合わせ、tool round を経た finalText を得る (旧 runAiInference と同じ wire 形状)', async () => {
    const ephemeral = createEphemeralAiSession()
    const calls: AiChatSendOptions[] = []
    const isStreaming = ref(false)
    const currentText = ref('')
    const script: Array<(opts: AiChatSendOptions) => string> = [
      (opts) => {
        opts.onToolUse?.({
          toolUseId: 'toolu_1',
          name: 'server.pulse',
          input: {},
        })
        return ''
      },
      () => '重要な発見があります',
    ]
    const chat = {
      isStreaming,
      currentText,
      sendMessage: async (opts: AiChatSendOptions) => {
        calls.push(opts)
        const step = script.shift()
        if (!step) throw new Error('script exhausted')
        return step(opts)
      },
    }
    const dispatch = vi.fn(async () => ({ ok: true as const, result: 'pong' }))
    const loop = useAiSendLoop({ chat, sessions: ephemeral.port, dispatch })

    ephemeral.reset()
    const outcome = await loop.runSend({
      sessionId: HEARTBEAT_EPHEMERAL_SESSION_ID,
      text: 'Heartbeat tick at 2026-07-12T00:00:00.000Z',
      connectionId: 'conn-1',
      model: 'model-1',
      tools: [{ name: 'server.pulse' }],
      buildSystem: () => 'HEARTBEAT SYSTEM',
    })

    expect(outcome).toMatchObject({
      status: 'done',
      finalText: '重要な発見があります',
    })
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('server.pulse', {})
    // system は round ごとに同一の定数が渡る (旧実装: 一度だけ組み立てて使い回し)
    expect(calls.every((c) => c.system === 'HEARTBEAT SYSTEM')).toBe(true)
    // round 2 の wire history に tool_use / tool_result のペアが入る
    const round2 = calls[1]?.history ?? []
    expect(round2.map((m) => m.toolUseId)).toContain('toolu_1')
    expect(round2.map((m) => m.toolResultFor)).toContain('toolu_1')
  })

  it('ストリーム失敗は outcome status=error になる (daemon 側で throw に変換され連続失敗カウントに乗る)', async () => {
    const ephemeral = createEphemeralAiSession()
    const chat = {
      isStreaming: ref(false),
      currentText: ref(''),
      sendMessage: async () => {
        throw new Error('接続が切断されました')
      },
    }
    const loop = useAiSendLoop({
      chat,
      sessions: ephemeral.port,
      dispatch: vi.fn(async () => ({ ok: true as const, result: 'ok' })),
    })

    ephemeral.reset()
    const outcome = await loop.runSend({
      sessionId: HEARTBEAT_EPHEMERAL_SESSION_ID,
      text: 'Heartbeat tick at 2026-07-12T00:00:00.000Z',
      connectionId: 'conn-1',
      model: 'model-1',
      buildSystem: () => undefined,
    })

    expect(outcome).toMatchObject({
      status: 'error',
      message: '接続が切断されました',
    })
  })
})

describe('decideCheapCheck (#411 Cheap Check First)', () => {
  const NOW = 1_700_000_000_000

  function configWithCheapCheck(overrides?: {
    enabled?: boolean
    maxSkipHours?: number
  }) {
    const cfg = defaultConfig()
    if (overrides?.enabled !== undefined) {
      cfg.heartbeat.cheapCheck.enabled = overrides.enabled
    }
    if (overrides?.maxSkipHours !== undefined) {
      cfg.heartbeat.cheapCheck.maxSkipHours = overrides.maxSkipHours
    }
    return cfg
  }

  const emptyState = { lastResultsHash: {}, lastAiRunAt: {} }

  it('global disabled → 常に AI 起動 (reason: cheap-check-disabled)', () => {
    const out = decideCheapCheck(
      { s1: 'hash-A' },
      { lastResultsHash: { s1: 'hash-A' }, lastAiRunAt: { s1: NOW } },
      configWithCheapCheck({ enabled: false }),
      NOW,
    )
    expect(out.shouldRunAi).toBe(true)
    expect(out.reason).toBe('cheap-check-disabled')
  })

  it('newHashes 空 (= どの skill も宣言なし) → 常に AI 起動', () => {
    const out = decideCheapCheck({}, emptyState, configWithCheapCheck(), NOW)
    expect(out.shouldRunAi).toBe(true)
    expect(out.reason).toBe('no-cheap-check-declared')
  })

  it('1 つでも hash 変化があれば AI 起動 (reason: changed:<id>)', () => {
    const out = decideCheapCheck(
      { s1: 'hash-A', s2: 'hash-B-NEW' },
      {
        lastResultsHash: { s1: 'hash-A', s2: 'hash-B' },
        lastAiRunAt: { s1: NOW, s2: NOW },
      },
      configWithCheapCheck(),
      NOW,
    )
    expect(out.shouldRunAi).toBe(true)
    expect(out.reason).toMatch(/^changed:s\d$/)
  })

  it('全一致 + maxSkipHours 内 → skip (HEARTBEAT_OK 扱い)', () => {
    const out = decideCheapCheck(
      { s1: 'hash-A' },
      { lastResultsHash: { s1: 'hash-A' }, lastAiRunAt: { s1: NOW } },
      configWithCheapCheck({ maxSkipHours: 24 }),
      NOW + 1000, // 1 秒後 (= skip window 内)
    )
    expect(out.shouldRunAi).toBe(false)
    expect(out.reason).toBe('no-change-within-skip-window')
  })

  it('全一致だが maxSkipHours 経過 → 強制 AI 起動', () => {
    const out = decideCheapCheck(
      { s1: 'hash-A' },
      { lastResultsHash: { s1: 'hash-A' }, lastAiRunAt: { s1: NOW } },
      configWithCheapCheck({ maxSkipHours: 1 }),
      NOW + 2 * 60 * 60 * 1000, // 2 時間後
    )
    expect(out.shouldRunAi).toBe(true)
    expect(out.reason).toBe('max-skip-hours-elapsed')
  })

  it('lastAiRunAt が prev に存在しない (初回 tick) → 強制 AI 起動', () => {
    // hash は一致 (= 何らかの理由で前回 hash だけ書かれて lastAiRunAt が
    // 未記録) のとき、無限 skip を避けるため AI 起動する
    const out = decideCheapCheck(
      { s1: 'hash-A' },
      { lastResultsHash: { s1: 'hash-A' }, lastAiRunAt: {} },
      configWithCheapCheck(),
      NOW,
    )
    expect(out.shouldRunAi).toBe(true)
    expect(out.reason).toBe('max-skip-hours-elapsed')
  })

  it('newHashes をそのまま反映する (state 更新用)', () => {
    const newHashes = { s1: 'hash-NEW' }
    const out = decideCheapCheck(
      newHashes,
      emptyState,
      configWithCheapCheck(),
      NOW,
    )
    expect(out.newHashes).toEqual(newHashes)
  })
})
