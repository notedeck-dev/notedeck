import { describe, expect, it } from 'vitest'
import { expandTemplate } from '../expand'

const ctx = {
  inputs: { body: 'hello world', v: 'public' },
  account: { id: 'acc-1', host: 'misskey.example' },
}

describe('expandTemplate', () => {
  it('expands input tokens in strings', () => {
    expect(expandTemplate(`hi \${input:body}`, ctx)).toBe('hi hello world')
  })

  it('expands account tokens', () => {
    expect(expandTemplate(`\${account.host}/\${account.id}`, ctx)).toBe(
      'misskey.example/acc-1',
    )
  })

  it('expands nested objects and arrays', () => {
    expect(
      expandTemplate(
        { text: `\${input:body}`, tags: [`\${input:v}`, 'raw'] },
        ctx,
      ),
    ).toEqual({ text: 'hello world', tags: ['public', 'raw'] })
  })

  it('leaves unknown tokens empty', () => {
    expect(expandTemplate(`\${input:missing}`, ctx)).toBe('')
  })

  it('preserves non-string primitives', () => {
    expect(expandTemplate({ n: 42, b: true, nl: null }, ctx)).toEqual({
      n: 42,
      b: true,
      nl: null,
    })
  })
})
