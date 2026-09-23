import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './useAiChat'
import { defaultConfig } from './useAiConfig'
import {
  _internal,
  applyHeartbeatSuppression,
  createEphemeralAiSession,
  decideCheapCheck,
  HEARTBEAT_EPHEMERAL_SESSION_ID,
  HEARTBEAT_OK_TOKEN,
  isCheapCheckAllowed,
} from './useHeartbeatDaemon'

describe('isCheapCheckAllowed (#1106: 手元側の capability は cheap check に使わない)', () => {
  it('データ系 (notecore 単独で実行できる) は許可', () => {
    for (const id of [
      'notifications.count',
      'notes.search',
      'account.list',
      'time.now',
    ]) {
      expect(isCheapCheckAllowed(id)).toBe(true)
    }
  })

  it('画面・入力設定・端末性能に依存する手元側は不可', () => {
    for (const id of [
      'column.list',
      'column.focusedNote',
      'windows.list',
      'clipboard.read',
      'keybinds.list',
      'performance.list',
      'theme.read',
      'styles.list',
    ]) {
      expect(isCheapCheckAllowed(id)).toBe(false)
    }
  })
})

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

describe('createEphemeralAiSession (#707 / #1133 ターン投影の共有)', () => {
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
