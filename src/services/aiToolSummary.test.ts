import { describe, expect, it } from 'vitest'
import { describeToolUse } from './aiToolSummary'

describe('describeToolUse (#1162)', () => {
  it('renders memory.update as a one-line human diff per target', () => {
    expect(
      describeToolUse('memory.update', {
        action: 'add',
        target: 'user',
        content: 'Always call them たか',
      }),
    ).toMatch(/: \+ Always call them たか$/)
    expect(
      describeToolUse('memory_update', {
        action: 'replace',
        target: 'memory',
        old_text: 'misskey.io',
        content: 'misskey.io と nijimiss',
      }),
    ).toMatch(/: misskey\.io → misskey\.io と nijimiss$/)
    expect(
      describeToolUse('memory.update', {
        action: 'remove',
        target: 'memory',
        old_text: 'old fact',
      }),
    ).toMatch(/: − old fact$/)
    // user と memory で見出しが違う
    const user = describeToolUse('memory.update', {
      action: 'add',
      target: 'user',
      content: 'x',
    })
    const memory = describeToolUse('memory.update', {
      action: 'add',
      target: 'memory',
      content: 'x',
    })
    expect(user).not.toEqual(memory)
  })

  it('renders soul.propose with its reason and leaves other tools alone', () => {
    expect(
      describeToolUse('soul.propose', { reason: 'decided a name' }),
    ).toContain('decided a name')
    expect(describeToolUse('soul.propose', {})).toBeTruthy()
    expect(describeToolUse('notes.create', { text: 'hi' })).toBeNull()
    expect(describeToolUse(undefined, undefined)).toBeNull()
    expect(describeToolUse('memory.update', { action: 'bogus' })).toBeNull()
  })
})
