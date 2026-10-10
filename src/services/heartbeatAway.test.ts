import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@/composables/useAiChat'
import { summarizeHeartbeatAway } from './heartbeatAway'

function report(id: string, timestamp: number): ChatMessage {
  return { id, role: 'assistant', content: id, timestamp, heartbeat: true }
}

function intent(
  id: string,
  timestamp: number,
  status: 'pending' | 'drafted' | 'executed' | 'dismissed' = 'pending',
): ChatMessage {
  return {
    ...report(id, timestamp),
    intent: {
      capabilityId: 'notes.create',
      params: {},
      untrusted: false,
      status,
      source: 'heartbeat',
      createdAt: timestamp,
    },
  }
}

function failure(id: string, timestamp: number): ChatMessage {
  return {
    ...report(id, timestamp),
    i18n: { content: { key: '_native.heartbeat.failedMessage', params: {} } },
  }
}

describe('summarizeHeartbeatAway', () => {
  it('最後に見た時刻より後の報告と確認待ちを数え、最新の報告先を返す', () => {
    const out = summarizeHeartbeatAway(
      [
        {
          id: 'hb',
          messages: [report('old', 50), report('a', 150), intent('i', 160)],
        },
        { id: 'other', messages: [report('b', 200)] },
      ],
      100,
    )
    expect(out).toEqual({ reports: 2, pending: 1, sessionId: 'other' })
  })

  it('下書きに落ちた確認待ちも数え、処理済みのものは数えない', () => {
    const out = summarizeHeartbeatAway(
      [
        {
          id: 'hb',
          messages: [
            intent('d', 150, 'drafted'),
            intent('x', 160, 'executed'),
            intent('y', 170, 'dismissed'),
          ],
        },
      ],
      100,
    )
    expect(out).toEqual({ reports: 0, pending: 1, sessionId: 'hb' })
  })

  it('HEARTBEAT 以外のメッセージと失敗の記録は数えない', () => {
    const out = summarizeHeartbeatAway(
      [
        {
          id: 'chat',
          messages: [
            { id: 'u', role: 'user', content: 'hi', timestamp: 150 },
            { id: 'r', role: 'assistant', content: 'yo', timestamp: 151 },
            failure('f', 152),
          ],
        },
      ],
      100,
    )
    expect(out).toBeNull()
  })

  it('閉じている間に何も無ければ null', () => {
    expect(
      summarizeHeartbeatAway([{ id: 'hb', messages: [report('a', 100)] }], 100),
    ).toBeNull()
    expect(summarizeHeartbeatAway([], 0)).toBeNull()
  })
})
