import { describe, expect, it } from 'vitest'
import { buildDefaultDeck, expandDefaultDeckColumns } from './defaultDeck'

const defaults = (type: string, accountId: string | null) => ({
  name: `label:${type}`,
  width: 350,
  accountId,
  active: true,
  tl: 'home' as const,
})

describe('expandDefaultDeckColumns', () => {
  it('registry の既定を敷いた上に行の値を重ねる', () => {
    const cols = expandDefaultDeckColumns(
      [
        { type: 'timeline', accountId: null, tl: 'global' },
        { type: 'mentions', accountId: 'a1' },
      ],
      defaults,
    )
    expect(cols).toEqual([
      {
        type: 'timeline',
        name: 'label:timeline',
        width: 350,
        accountId: null,
        active: true,
        tl: 'global',
      },
      {
        type: 'mentions',
        name: 'label:mentions',
        width: 350,
        accountId: 'a1',
        active: true,
        tl: 'home',
      },
    ])
  })
})

describe('buildDefaultDeck', () => {
  it('id を採番して 1 カラム 1 列に並べる', () => {
    let n = 0
    const { columns, layout } = buildDefaultDeck(
      [
        { type: 'timeline', name: null, width: 350, accountId: null },
        { type: 'mentions', name: null, width: 350, accountId: null },
      ],
      () => `col-${++n}`,
    )
    expect(columns.map((c) => c.id)).toEqual(['col-1', 'col-2'])
    expect(layout).toEqual([['col-1'], ['col-2']])
  })
})
