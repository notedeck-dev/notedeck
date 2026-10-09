import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emojilist } from '@/data/emojilist'
import {
  applySkinTone,
  normalizeSkinTone,
  SKIN_TONES,
} from '@/services/emojiSkinTone'
import { char2twemojiUrl } from '@/services/twemoji'

describe('applySkinTone (#1193)', () => {
  it('トーン無しはそのまま', () => {
    expect(applySkinTone('👍', null)).toBe('👍')
  })

  it('単体の絵文字に修飾子を付ける', () => {
    expect(applySkinTone('👍', 3)).toBe('👍🏽')
    expect(applySkinTone('👋', 1)).toBe('👋🏻')
    expect(applySkinTone('👋', 5)).toBe('👋🏿')
  })

  it('異体字セレクタ (FE0F) は修飾子に置き換える', () => {
    expect(applySkinTone('✌️', 3)).toBe('✌🏽')
  })

  it('ZWJ 連結は人の部分に付ける', () => {
    expect(applySkinTone('🧑‍💻', 3)).toBe('🧑🏽‍💻')
    expect(applySkinTone('🏃‍♀️', 3)).toBe('🏃🏽‍♀️')
  })

  it('二人の絵文字は両方に付け、握手の手には付けない', () => {
    expect(applySkinTone('🧑‍🤝‍🧑', 3)).toBe('🧑🏽‍🤝‍🧑🏽')
    expect(applySkinTone('👩‍❤️‍👨', 3)).toBe('👩🏽‍❤️‍👨🏽')
  })

  it('トーン違いが無い絵文字はそのまま', () => {
    expect(applySkinTone('😀', 3)).toBe('😀')
    expect(applySkinTone('👪', 3)).toBe('👪')
    expect(applySkinTone('👨‍👩‍👧', 3)).toBe('👨‍👩‍👧')
    expect(applySkinTone('👯', 3)).toBe('👯')
  })

  it('トーンを付けた絵文字はすべて同梱の Twemoji に画像がある', () => {
    const svgDir = resolve(
      import.meta.dirname,
      '../../node_modules/@discordapp/twemoji/dist/svg',
    )
    const missing: string[] = []
    let toned = 0
    for (const { char } of emojilist) {
      for (const tone of SKIN_TONES) {
        const result = applySkinTone(char, tone)
        if (result === char) continue
        toned++
        const file = char2twemojiUrl(result).replace('/twemoji/', '')
        if (!existsSync(resolve(svgDir, file))) missing.push(result)
      }
    }
    expect(toned).toBeGreaterThan(0)
    expect(missing).toEqual([])
  })
})

describe('normalizeSkinTone', () => {
  it('1〜5 だけを受け、それ以外は null', () => {
    expect(normalizeSkinTone(3)).toBe(3)
    expect(normalizeSkinTone(0)).toBeNull()
    expect(normalizeSkinTone(6)).toBeNull()
    expect(normalizeSkinTone('3')).toBeNull()
    expect(normalizeSkinTone(undefined)).toBeNull()
  })
})
