import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type App, createApp } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import MkEmoji from './MkEmoji.vue'

let app: App | null = null
let container: HTMLElement | null = null
let pinia: ReturnType<typeof createPinia>

function mountEmoji(emoji: string, ignoreMuted?: boolean) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(MkEmoji, { emoji, ignoreMuted })
  app.use(pinia)
  app.mount(container)
}

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

describe('MkEmoji', () => {
  it('Unicode 絵文字を渡すと twemoji URL の img を描画する', () => {
    mountEmoji('❤')
    const img = container?.querySelector('img')
    expect(img).toBeTruthy()
    expect(img?.getAttribute('src')).toContain('2764.svg')
  })

  // ビルド環境によって "/emoji-unknown.svg" のままか data URI にインライン化されるかが変わる
  const unknownSvg = /^(\/emoji-unknown\.svg$|data:image\/svg\+xml)/

  it(':name@host: 形式の未解決カスタム絵文字は twemoji URL に変換しない', () => {
    mountEmoji(':chin@fedibird.com:')
    const img = container?.querySelector('img')
    expect(img).toBeTruthy()
    expect(img?.getAttribute('src')).not.toContain('twemoji')
    expect(img?.getAttribute('src')).toMatch(unknownSvg)
    // ショートコードは tooltip で確認できる
    expect(img?.getAttribute('title')).toBe(':chin@fedibird.com:')
  })

  it(':name: 形式（ローカルカスタム絵文字の未解決）も emoji-unknown にフォールバックする', () => {
    mountEmoji(':petthex:')
    const img = container?.querySelector('img')
    expect(img?.getAttribute('src')).toMatch(unknownSvg)
  })

  it('ミュートした絵文字はプレースホルダー表示になる (#612)', () => {
    useSettingsStore().set('mute.emojis', ['❤'])
    mountEmoji('❤')
    const placeholder = container?.querySelector('span._emojiMuted')
    expect(placeholder).toBeTruthy()
    expect(placeholder?.getAttribute('title')).toContain('ミュート中')
    expect(container?.querySelector('img')).toBeNull()
  })

  it('ignoreMuted 指定時はミュートを無視して実体を表示する (#612)', () => {
    useSettingsStore().set('mute.emojis', ['❤'])
    mountEmoji('❤', true)
    const img = container?.querySelector('img')
    expect(img?.getAttribute('src')).toContain('2764.svg')
  })
})
