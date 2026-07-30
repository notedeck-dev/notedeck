import { describe, expect, it } from 'vitest'
import { normalizeEmojiMuteKey } from '@/utils/emojiMute'

describe('normalizeEmojiMuteKey (#612)', () => {
  it('keeps Unicode emoji as-is', () => {
    expect(normalizeEmojiMuteKey('❤')).toBe('❤')
    expect(normalizeEmojiMuteKey('👍')).toBe('👍')
  })

  it('normalizes local custom emoji to :name:', () => {
    expect(normalizeEmojiMuteKey(':blobcat:')).toBe(':blobcat:')
  })

  it('strips local host marker "@." (Misskey reactions map key)', () => {
    expect(normalizeEmojiMuteKey(':blobcat@.:')).toBe(':blobcat:')
  })

  it('keeps remote host in :name@host: form', () => {
    expect(normalizeEmojiMuteKey(':petthex@mk.puzzlesskey.com:')).toBe(
      ':petthex@mk.puzzlesskey.com:',
    )
  })

  it('normalizes bare shortcode (MFM token form) to key form', () => {
    expect(normalizeEmojiMuteKey('blobcat')).toBe(':blobcat:')
    expect(normalizeEmojiMuteKey('blobcat@.')).toBe(':blobcat:')
    expect(normalizeEmojiMuteKey('petthex@mk.puzzlesskey.com')).toBe(
      ':petthex@mk.puzzlesskey.com:',
    )
  })
})
