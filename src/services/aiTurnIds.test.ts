import { describe, expect, it } from 'vitest'
import { turnIdOf } from './aiTurnIds'

const TURN = 'ai-turn-1730000000000-k3j9x2'

describe('turnIdOf', () => {
  it('ユーザー入力 (<turn>-u)', () => {
    expect(turnIdOf(`${TURN}-u`)).toBe(TURN)
  })

  it('assistant 本文 (<turn>-a<round>)', () => {
    expect(turnIdOf(`${TURN}-a0`)).toBe(TURN)
    expect(turnIdOf(`${TURN}-a12`)).toBe(TURN)
  })

  it('tool_use / tool_result (<turn>-a<round>-<i> / <turn>-r<round>-<i>)', () => {
    expect(turnIdOf(`${TURN}-a0-1`)).toBe(TURN)
    expect(turnIdOf(`${TURN}-r3-0`)).toBe(TURN)
  })

  it('フロントの仮置き id', () => {
    expect(turnIdOf(`${TURN}-placeholder`)).toBe(TURN)
    expect(turnIdOf(`${TURN}-placeholder-1730000000123`)).toBe(TURN)
    expect(turnIdOf(`${TURN}-r-1730000000123`)).toBe(TURN)
  })

  it('HEARTBEAT のターン id (hb-<ts>-<stamp>) でも切れる', () => {
    expect(turnIdOf('hb-1730000000-120000-a0')).toBe('hb-1730000000-120000')
  })

  it('乱数部が接尾辞と同じ綴りでも最長一致で残す', () => {
    expect(turnIdOf('ai-turn-1-u-u')).toBe('ai-turn-1-u')
    expect(turnIdOf('ai-turn-1-a0-a0')).toBe('ai-turn-1-a0')
  })

  it('既知の接尾辞が無ければ null', () => {
    expect(turnIdOf('msg-uuid-like')).toBeNull()
    expect(turnIdOf(TURN)).toBeNull()
    expect(turnIdOf('')).toBeNull()
  })
})
