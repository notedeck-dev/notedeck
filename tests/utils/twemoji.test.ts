import { describe, expect, it } from 'vitest'
import { char2twemojiUrl, splitTextWithEmoji } from '@/utils/twemoji'

// 同梱 Twemoji (@discordapp/twemoji) のパス。CDN 個別取得はピッカー初回表示で
// 数千リクエストをメディアプロキシに浴びせる要因だった (#855)。ここで固定する
// ファイル名規約 (fe0f の扱い) は同梱アセットの実ファイル名と一致している
const BASE = '/twemoji'

describe('char2twemojiUrl', () => {
  it('converts simple emoji', () => {
    // 😀 = U+1F600
    expect(char2twemojiUrl('😀')).toBe(`${BASE}/1f600.svg`)
  })

  it('CDN を参照しない (ローカル同梱)', () => {
    expect(char2twemojiUrl('😀')).not.toContain('https://')
  })

  it('strips variation selector when no ZWJ', () => {
    // ❤️ = U+2764 U+FE0F → should become 2764
    expect(char2twemojiUrl('❤️')).toBe(`${BASE}/2764.svg`)
  })

  it('keeps variation selector in ZWJ sequences', () => {
    // ❤️‍🔥 = U+2764 U+FE0F U+200D U+1F525
    expect(char2twemojiUrl('❤️‍🔥')).toBe(`${BASE}/2764-fe0f-200d-1f525.svg`)
  })

  it('handles flag emoji (regional indicators)', () => {
    // 🇯🇵 = U+1F1EF U+1F1F5
    expect(char2twemojiUrl('🇯🇵')).toBe(`${BASE}/1f1ef-1f1f5.svg`)
  })

  it('handles ZWJ family emoji', () => {
    // 👨‍👩‍👧 = U+1F468 U+200D U+1F469 U+200D U+1F467
    expect(char2twemojiUrl('👨‍👩‍👧')).toBe(
      `${BASE}/1f468-200d-1f469-200d-1f467.svg`,
    )
  })

  it('handles keycap emoji', () => {
    // #️⃣ = U+0023 U+FE0F U+20E3
    expect(char2twemojiUrl('#️⃣')).toBe(`${BASE}/23-20e3.svg`)
  })
})

describe('splitTextWithEmoji', () => {
  it('returns text-only for plain text', () => {
    expect(splitTextWithEmoji('hello world')).toEqual([
      { type: 'text', value: 'hello world' },
    ])
  })

  it('splits emoji from text', () => {
    const result = splitTextWithEmoji('hello 😀 world')
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ type: 'text', value: 'hello ' })
    expect(result[1]).toEqual({
      type: 'emoji',
      value: '😀',
      url: `${BASE}/1f600.svg`,
    })
    expect(result[2]).toEqual({ type: 'text', value: ' world' })
  })

  it('handles consecutive emoji', () => {
    const result = splitTextWithEmoji('👍👎')
    expect(result).toHaveLength(2)
    expect(result[0]?.type).toBe('emoji')
    expect(result[1]?.type).toBe('emoji')
  })

  it('handles emoji at start and end', () => {
    const result = splitTextWithEmoji('🎉hello🎉')
    expect(result).toHaveLength(3)
    expect(result[0]?.type).toBe('emoji')
    expect(result[1]).toEqual({ type: 'text', value: 'hello' })
    expect(result[2]?.type).toBe('emoji')
  })

  it('returns empty array for empty string', () => {
    expect(splitTextWithEmoji('')).toEqual([])
  })
})
