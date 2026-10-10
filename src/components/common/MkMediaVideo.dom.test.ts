import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { NormalizedDriveFile } from '@/adapters/types'
import MkMediaVideo from './MkMediaVideo.vue'

function makeVideo(id: string): NormalizedDriveFile {
  return {
    id,
    name: `${id}.mp4`,
    type: 'video/mp4',
    url: `https://example.test/${id}.mp4`,
    thumbnailUrl: `https://example.test/${id}.webp`,
    size: 1,
    isSensitive: false,
    comment: null,
    width: null,
    height: null,
    blurhash: null,
  }
}

describe('MkMediaVideo — ポスター', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('前の動画でポスターの読み込みに失敗しても、別の動画に切り替えると読み直す (#1226)', async () => {
    const wrapper = mount(MkMediaVideo, { props: { file: makeVideo('a') } })
    await wrapper.find('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)

    await wrapper.setProps({ file: makeVideo('b') })
    expect(wrapper.find('img').attributes('src')).toContain(
      encodeURIComponent('https://example.test/b.webp'),
    )
    wrapper.unmount()
  })
})
