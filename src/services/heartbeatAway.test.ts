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

function notice(at: number, sessionId: string | null = 'hb') {
  return { at, sessionId }
}

describe('summarizeHeartbeatAway', () => {
  it('最後に見た時刻より後の「通知して」の報告と確認待ちを数え、最新の報告先を返す', () => {
    const out = summarizeHeartbeatAway(
      [{ id: 'hb', messages: [intent('i', 160)] }],
      [notice(50), notice(150), notice(200, 'other')],
      100,
    )
    expect(out).toEqual({ reports: 2, pending: 1, sessionId: 'other' })
  })

  it('「通知して」でない報告はセッションにあっても数えない (開いている間と同じ基準)', () => {
    const out = summarizeHeartbeatAway(
      [{ id: 'hb', messages: [report('a', 150), report('b', 160)] }],
      [],
      100,
    )
    expect(out).toBeNull()
  })

  it('報告先が「なし」の知らせも数え、開く先は null', () => {
    const out = summarizeHeartbeatAway([], [notice(150, null)], 100)
    expect(out).toEqual({ reports: 1, pending: 0, sessionId: null })
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
      [],
      100,
    )
    expect(out).toEqual({ reports: 0, pending: 1, sessionId: 'hb' })
  })

  it('閉じている間に何も無ければ null', () => {
    expect(
      summarizeHeartbeatAway(
        [{ id: 'hb', messages: [intent('a', 100)] }],
        [notice(100)],
        100,
      ),
    ).toBeNull()
    expect(summarizeHeartbeatAway([], [], 0)).toBeNull()
  })
})
