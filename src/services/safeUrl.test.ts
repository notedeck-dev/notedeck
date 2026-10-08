import { describe, expect, it } from 'vitest'
import { isMemoUrl, isSafeUrl } from './safeUrl'

describe('isSafeUrl', () => {
  it('accepts http and https', () => {
    expect(isSafeUrl('http://example.com')).toBe(true)
    expect(isSafeUrl('https://example.com/path?q=1')).toBe(true)
  })

  it('rejects javascript / data / file / memo:', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeUrl('data:text/html,<script>')).toBe(false)
    expect(isSafeUrl('file:///etc/passwd')).toBe(false)
    // memo: is app-internal, should not pass safety check (handled separately)
    expect(isSafeUrl('memo:20260510120000')).toBe(false)
  })

  it('rejects malformed url', () => {
    expect(isSafeUrl('not a url')).toBe(false)
  })
})

describe('isMemoUrl', () => {
  it('matches valid Zettelkasten id memo:', () => {
    expect(isMemoUrl('memo:20260510120000')).toEqual({ id: '20260510120000' })
    expect(isMemoUrl('memo:00000000000000')).toEqual({ id: '00000000000000' })
  })

  it('rejects http / https', () => {
    expect(isMemoUrl('https://example.com')).toBeNull()
  })

  it('rejects malformed memo: id (wrong digit count / non-numeric)', () => {
    expect(isMemoUrl('memo:1234')).toBeNull()
    expect(isMemoUrl('memo:202605101200000')).toBeNull() // 15 digits
    expect(isMemoUrl('memo:abcdefghijklmn')).toBeNull()
    expect(isMemoUrl('memo:')).toBeNull()
    expect(isMemoUrl('')).toBeNull()
  })

  it('rejects memo: with trailing junk', () => {
    expect(isMemoUrl('memo:20260510120000 ')).toBeNull()
    expect(isMemoUrl('memo:20260510120000?x=1')).toBeNull()
  })
})
