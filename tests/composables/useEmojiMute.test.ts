import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useEmojiMute } from '@/composables/useEmojiMute'
import { useSettingsStore } from '@/stores/settings'

describe('useEmojiMute (#612)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('mutes an emoji, hides it, and restores on unmute', () => {
    const { isEmojiMuted, muteEmoji, unmuteEmoji } = useEmojiMute()
    expect(isEmojiMuted(':blobcat:')).toBe(false)
    muteEmoji(':blobcat:')
    expect(isEmojiMuted(':blobcat:')).toBe(true)
    unmuteEmoji(':blobcat:')
    expect(isEmojiMuted(':blobcat:')).toBe(false)
  })

  it('matches across key form variations (@., bare shortcode)', () => {
    const { isEmojiMuted, muteEmoji } = useEmojiMute()
    muteEmoji(':blobcat@.:')
    expect(isEmojiMuted(':blobcat:')).toBe(true)
    expect(isEmojiMuted('blobcat')).toBe(true)
    expect(isEmojiMuted('blobcat@.')).toBe(true)
    expect(isEmojiMuted(':blobcat@example.com:')).toBe(false)
  })

  it('mutes remote emoji per host', () => {
    const { isEmojiMuted, muteEmoji } = useEmojiMute()
    muteEmoji(':petthex@mk.puzzlesskey.com:')
    expect(isEmojiMuted(':petthex@mk.puzzlesskey.com:')).toBe(true)
    expect(isEmojiMuted(':petthex:')).toBe(false)
  })

  it('mutes Unicode emoji as raw character', () => {
    const { isEmojiMuted, muteEmoji } = useEmojiMute()
    muteEmoji('❤')
    expect(isEmojiMuted('❤')).toBe(true)
    expect(isEmojiMuted('👍')).toBe(false)
  })

  it('stores normalized keys in settings and dedupes', () => {
    const settings = useSettingsStore()
    const { muteEmoji } = useEmojiMute()
    muteEmoji('blobcat@.')
    muteEmoji(':blobcat:')
    expect(settings.get('mute.emojis')).toEqual([':blobcat:'])
  })

  it('snapshots url on mute and clears it on unmute', () => {
    const { muteEmoji, unmuteEmoji, getMutedEmojiUrl } = useEmojiMute()
    muteEmoji(':petthex@mk.puzzlesskey.com:', 'https://example.com/petthex.gif')
    expect(getMutedEmojiUrl(':petthex@mk.puzzlesskey.com:')).toBe(
      'https://example.com/petthex.gif',
    )
    unmuteEmoji(':petthex@mk.puzzlesskey.com:')
    expect(getMutedEmojiUrl(':petthex@mk.puzzlesskey.com:')).toBeNull()
  })
})
