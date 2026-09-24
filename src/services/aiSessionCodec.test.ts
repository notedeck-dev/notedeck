import { describe, expect, it } from 'vitest'
import type { AiSession as WireSession } from '@/bindings'
import {
  buildLastMessagePreview,
  messageFromWire,
  messageToWire,
  sessionFromWire,
} from '@/services/aiSessionCodec'

// ファイル形式の正本と round-trip の検査は Rust 側 (crates/notecore/src/ai_sessions.rs)。
// ここは notecore の wire とフロントの ChatMessage の変換だけ。

function wire(overrides: Partial<WireSession> = {}): WireSession {
  return {
    schemaVersion: 1,
    id: 's1',
    kind: 'chat',
    title: 't',
    model: 'm',
    connectionId: 'c',
    createdAt: 1,
    updatedAt: 2,
    messages: [],
    personaSkillId: null,
    triggeredSkillIds: [],
    messageCount: 0,
    lastMessagePreview: '',
    ...overrides,
  }
}

describe('sessionFromWire', () => {
  it('空の optional は undefined に落とし、未知の kind は chat に倒す', () => {
    const s = sessionFromWire(wire({ kind: 'weird', triggeredSkillIds: [] }))
    expect(s.kind).toBe('chat')
    expect(s.personaSkillId).toBeUndefined()
    expect(s.triggeredSkillIds).toBeUndefined()
    const t = sessionFromWire(
      wire({ personaSkillId: 'p', triggeredSkillIds: ['a'] }),
    )
    expect(t.personaSkillId).toBe('p')
    expect(t.triggeredSkillIds).toEqual(['a'])
  })

  it('tool 系フィールドは存在するときだけ載せる', () => {
    const s = sessionFromWire(
      wire({
        messages: [
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            timestamp: 3,
            toolUseId: 'tu1',
            toolUseName: 'time.now',
            toolUseInput: { x: 1 },
            toolResultFor: null,
            heartbeat: null,
          },
          {
            id: 'r1',
            role: 'user',
            content: '12:00',
            timestamp: 4,
            toolUseId: null,
            toolUseName: null,
            toolUseInput: null,
            toolResultFor: 'tu1',
            heartbeat: true,
          },
        ],
      }),
    )
    expect(s.messages[0]).toEqual({
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: 3,
      toolUseId: 'tu1',
      toolUseName: 'time.now',
      toolUseInput: { x: 1 },
    })
    expect(s.messages[1]).toEqual({
      id: 'r1',
      role: 'user',
      content: '12:00',
      timestamp: 4,
      toolResultFor: 'tu1',
      heartbeat: true,
    })
  })
})

describe('messageToWire / messageFromWire', () => {
  it('round-trip で同じ ChatMessage に戻る', () => {
    const m = {
      id: 'x',
      role: 'assistant' as const,
      content: 'c',
      timestamp: 10,
      toolUseId: 'tu',
      toolUseName: 'n',
      toolUseInput: { a: 'b' },
    }
    expect(messageFromWire(messageToWire(m))).toEqual(m)
    expect(messageToWire(m).heartbeat).toBeNull()
  })
})

describe('buildLastMessagePreview', () => {
  it('tool 行を飛ばし、空白を潰し、上限で切る', () => {
    expect(
      buildLastMessagePreview([
        { id: 'a', role: 'assistant', content: '  a\n b ', timestamp: 0 },
        {
          id: 'r',
          role: 'user',
          content: 'tool',
          timestamp: 0,
          toolResultFor: 't',
        },
      ]),
    ).toBe('a b')
    const long = buildLastMessagePreview([
      { id: 'a', role: 'assistant', content: 'あ'.repeat(130), timestamp: 0 },
    ])
    expect([...long].length).toBe(121)
    expect(long.endsWith('…')).toBe(true)
    expect(buildLastMessagePreview([])).toBe('')
  })
})
