import { describe, expect, it } from 'vitest'
import {
  classifyHeartbeatOutcome,
  heartbeatInputLooksTruncated,
  heartbeatSkipReason,
} from './heartbeatStatus'

describe('HEARTBEAT の最後の巡回の表示 (#1321)', () => {
  it('outcome は prefix で表示の種別に落ちる (開集合)', () => {
    expect(classifyHeartbeatOutcome(null)).toBe('never')
    expect(classifyHeartbeatOutcome('')).toBe('never')
    expect(classifyHeartbeatOutcome('reported')).toBe('reported')
    expect(classifyHeartbeatOutcome('suppressed')).toBe('suppressed')
    expect(classifyHeartbeatOutcome('queued')).toBe('queued')
    expect(classifyHeartbeatOutcome('error')).toBe('error')
    expect(classifyHeartbeatOutcome('skip:no-provider')).toBe(
      'waiting-no-provider',
    )
    expect(classifyHeartbeatOutcome('skip:unreachable')).toBe(
      'waiting-unreachable',
    )
    expect(classifyHeartbeatOutcome('skip:cheap-check:changed:x')).toBe(
      'skipped',
    )
    // 知らない文字列も「飛ばした」に落ちて壊れない
    expect(classifyHeartbeatOutcome('skip:something-new')).toBe('skipped')
  })

  it('飛ばした理由は既知のものだけ名前が付く', () => {
    expect(
      heartbeatSkipReason('skip:cheap-check:no-change-within-skip-window'),
    ).toBe('no-change')
    expect(heartbeatSkipReason('skip:no-account')).toBe('no-account')
    expect(heartbeatSkipReason('skip:no-skills')).toBe('no-skills')
    expect(heartbeatSkipReason('skip:disabled')).toBe('disabled')
    expect(heartbeatSkipReason('skip:daily-limit-disable')).toBe('daily-limit')
    expect(heartbeatSkipReason('skip:already-running')).toBe('already-running')
    expect(heartbeatSkipReason('skip:new')).toBe('other')
  })

  it('切り詰めの注記はローカル接続で入力が推定を大きく下回るときだけ', () => {
    const low = { inputTokens: 1000, estimatedInputTokens: 4000 }
    expect(heartbeatInputLooksTruncated(low, true)).toBe(true)
    // クラウドは prompt caching で誤検知するので出さない
    expect(heartbeatInputLooksTruncated(low, false)).toBe(false)
    expect(
      heartbeatInputLooksTruncated(
        { inputTokens: 3000, estimatedInputTokens: 4000 },
        true,
      ),
    ).toBe(false)
    expect(heartbeatInputLooksTruncated(null, true)).toBe(false)
    expect(
      heartbeatInputLooksTruncated(
        { inputTokens: 1, estimatedInputTokens: 0 },
        true,
      ),
    ).toBe(false)
  })
})
