import { describe, expect, it } from 'vitest'
import { getNoteSummary } from './noteSummary'

const base = { text: null, cw: null, files: [] }

describe('getNoteSummary (#1210)', () => {
  it('returns empty for a missing note', () => {
    expect(getNoteSummary(null)).toBe('')
    expect(getNoteSummary(undefined)).toBe('')
  })

  it('uses the text, or the CW instead of the text', () => {
    expect(getNoteSummary({ ...base, text: ' hello ' })).toBe('hello')
    expect(getNoteSummary({ ...base, text: 'secret', cw: 'spoiler' })).toBe(
      'spoiler',
    )
  })

  it('appends files and poll markers', () => {
    const s = getNoteSummary({
      ...base,
      text: 'pic',
      files: [{}, {}] as never,
      poll: {} as never,
    })
    expect(s).toMatch(/^pic \(.*2.*\) \(.+\)$/)
  })

  it('hides the body of a note the server hid', () => {
    const s = getNoteSummary({ ...base, text: 'x', contentHidden: true })
    expect(s).not.toContain('x')
    expect(s).toMatch(/^\(.+\)$/)
  })

  it('follows reply and renote, with ... when not embedded', () => {
    expect(
      getNoteSummary({
        ...base,
        text: 'a',
        replyId: 'r',
        reply: { ...base, text: 'b' },
      }),
    ).toBe('a\n\nRE: b')
    expect(getNoteSummary({ ...base, renoteId: 'n' })).toBe('RN: ...')
  })
})
