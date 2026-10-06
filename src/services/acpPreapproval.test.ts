import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetPreapprovalsForTest,
  canonicalParams,
  consumePreapproval,
  grantPreapproval,
  PREAPPROVAL_TTL_MS,
} from './acpPreapproval'

describe('acpPreapproval (#1191)', () => {
  beforeEach(() => _resetPreapprovalsForTest())

  it('同じ capability と引数の呼び出しを 1 回だけ通す', () => {
    grantPreapproval('memory.update', {
      action: 'add',
      target: 'user',
      content: 'x',
    })
    expect(
      consumePreapproval('memory.update', {
        content: 'x',
        target: 'user',
        action: 'add',
      }),
    ).toBe(true)
    // 2 回目は無い (別の呼び出しに流用されない)
    expect(
      consumePreapproval('memory.update', {
        action: 'add',
        target: 'user',
        content: 'x',
      }),
    ).toBe(false)
  })

  it('引数や capability が違えば通さない', () => {
    grantPreapproval('memory.update', {
      action: 'add',
      target: 'user',
      content: 'x',
    })
    expect(
      consumePreapproval('memory.update', {
        action: 'add',
        target: 'memory',
        content: 'x',
      }),
    ).toBe(false)
    expect(
      consumePreapproval('soul.propose', {
        action: 'add',
        target: 'user',
        content: 'x',
      }),
    ).toBe(false)
    expect(
      consumePreapproval('memory.update', {
        action: 'add',
        target: 'user',
        content: 'x',
      }),
    ).toBe(true)
  })

  it('期限が切れた記録は消える', () => {
    grantPreapproval('notes.create', { text: 'hi' }, 1000)
    expect(
      consumePreapproval(
        'notes.create',
        { text: 'hi' },
        1000 + PREAPPROVAL_TTL_MS,
      ),
    ).toBe(false)
  })

  it('引数なしは空オブジェクトと同じ鍵', () => {
    grantPreapproval('backup.create', undefined)
    expect(consumePreapproval('backup.create', {})).toBe(true)
    expect(canonicalParams(undefined)).toBe('{}')
  })
})
