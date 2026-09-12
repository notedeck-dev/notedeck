import { describe, expect, it } from 'vitest'
import type { NormalizedNote } from '@/adapters/types'
import { variantKey } from './noteKey'
import { hasGap } from './timelineGap'

function note(id: string, accountId = 'acc-a'): NormalizedNote {
  return { id, _accountId: accountId } as NormalizedNote
}

describe('hasGap', () => {
  it('最新ページが表示中と 1 件も重ならなければ gap', () => {
    const shown = new Set([
      variantKey('acc-a', 'n1'),
      variantKey('acc-a', 'n2'),
    ])
    expect(hasGap([note('n9'), note('n8')], shown, true)).toBe(true)
  })

  it('1 件でも重なれば gap ではない', () => {
    const shown = new Set([variantKey('acc-a', 'n1')])
    expect(hasGap([note('n9'), note('n1')], shown, true)).toBe(false)
  })

  it('初回接続 (表示なし) や空ページは gap にしない', () => {
    expect(hasGap([note('n9')], new Set(), false)).toBe(false)
    expect(hasGap([], new Set([variantKey('acc-a', 'n1')]), true)).toBe(false)
  })

  it('別アカウントの同じ ID は重なりに数えない (行キーで比較)', () => {
    const shown = new Set([variantKey('acc-b', 'n1')])
    expect(hasGap([note('n1', 'acc-a')], shown, true)).toBe(true)
  })
})
