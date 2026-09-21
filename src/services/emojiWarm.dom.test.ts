import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerEmoji } from '@/adapters/types'

const warmMedia = vi.fn().mockResolvedValue({ status: 'ok', data: 0 })
vi.mock('@/utils/tauriInvoke', () => ({
  commands: { warmMedia: (...a: unknown[]) => warmMedia(...a) },
  unwrap: <T>(r: { data: T }) => r.data,
}))
vi.mock('@/utils/settingsFs', () => ({ isTauri: true }))

import { EMOJI_VARIANT_HEIGHT, warmEmojiImages } from './emojiWarm'

function emoji(
  name: string,
  url = `https://x.example/${name}.webp`,
): ServerEmoji {
  return { name, url, category: null, aliases: [] }
}

describe('warmEmojiImages', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    warmMedia.mockClear()
  })

  it('https の絵文字 URL を表示と同じ高さ variant でキューに渡す', () => {
    warmEmojiImages([emoji('a'), emoji('b', 'http://x.example/b.png')])
    expect(warmMedia).toHaveBeenCalledTimes(1)
    expect(warmMedia).toHaveBeenCalledWith(
      ['https://x.example/a.webp'],
      EMOJI_VARIANT_HEIGHT,
    )
  })

  it('先読み抑制中 (省電力 / 従量制) は何も投げない', () => {
    warmEmojiImages([emoji('a')], { suppress: true })
    expect(warmMedia).not.toHaveBeenCalled()
  })

  it('URL が 1 件も無ければ呼ばない', () => {
    warmEmojiImages([])
    expect(warmMedia).not.toHaveBeenCalled()
  })
})
