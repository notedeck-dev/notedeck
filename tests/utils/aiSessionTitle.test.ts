import { describe, expect, it } from 'vitest'
import {
  generateSessionTitle,
  isTimestampTitle,
  timestampTitle,
} from '@/utils/aiSessionTitle'

const FROZEN = new Date(2026, 3, 30, 15, 30, 12) // 2026-04-30 local

describe('timestampTitle', () => {
  it('formats local datetime to "<YYYY-MM-DD HH:mm> のチャット"', () => {
    expect(timestampTitle(FROZEN)).toBe('2026-04-30 15:30 のチャット')
  })

  it('zero-pads single-digit components', () => {
    const d = new Date(2026, 0, 5, 3, 7, 0)
    expect(timestampTitle(d)).toBe('2026-01-05 03:07 のチャット')
  })
})

describe('generateSessionTitle', () => {
  it('returns the message as-is when short and clean', () => {
    expect(
      generateSessionTitle('Tauri の起動エラーについて教えて', FROZEN),
    ).toBe('Tauri の起動エラーについて教えて')
  })

  it('truncates to 40 chars when too long', () => {
    const long = 'あ'.repeat(50)
    expect(generateSessionTitle(long, FROZEN)).toBe('あ'.repeat(40))
  })

  it('strips fenced code blocks', () => {
    const msg = 'これを直して\n```ts\nconst x = 1\n```\nお願いします'
    const title = generateSessionTitle(msg, FROZEN)
    expect(title).not.toContain('```')
    expect(title).toContain('これを直して')
    expect(title).toContain('お願いします')
  })

  it('strips inline code', () => {
    expect(generateSessionTitle('`foo` を確認したい', FROZEN)).toBe(
      'を確認したい',
    )
  })

  it('strips URLs', () => {
    expect(
      generateSessionTitle(
        'https://example.com を見て分析してください',
        FROZEN,
      ),
    ).toBe('を見て分析してください')
  })

  it('collapses whitespace and newlines into single space', () => {
    expect(generateSessionTitle('foo\n\n   bar\n\n\nbaz', FROZEN)).toBe(
      'foo bar baz',
    )
  })

  it('falls back to date title when too short after trim', () => {
    expect(generateSessionTitle('hi', FROZEN)).toBe(
      '2026-04-30 15:30 のチャット',
    )
  })

  it('falls back to date title for empty string', () => {
    expect(generateSessionTitle('', FROZEN)).toBe('2026-04-30 15:30 のチャット')
  })

  it('falls back to date title when only code blocks', () => {
    expect(generateSessionTitle('```ts\nconsole.log(1)\n```', FROZEN)).toBe(
      '2026-04-30 15:30 のチャット',
    )
  })
})

describe('isTimestampTitle', () => {
  it('returns true for the default のチャット suffix', () => {
    expect(isTimestampTitle('2026-05-15 17:52 のチャット')).toBe(true)
  })

  it('returns true for the HEARTBEAT suffix', () => {
    expect(isTimestampTitle('2026-05-15 17:52 のHEARTBEAT')).toBe(true)
  })

  it('returns false for an AI-generated title', () => {
    expect(isTimestampTitle('通知カラムの追加リクエスト')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isTimestampTitle('')).toBe(false)
  })

  it('returns false when a suffix is missing', () => {
    expect(isTimestampTitle('2026-05-15 17:52')).toBe(false)
    expect(isTimestampTitle('2026-05-15')).toBe(false)
  })
})
