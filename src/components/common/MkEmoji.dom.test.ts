import { afterEach, describe, expect, it } from 'vitest'
import { type App, createApp } from 'vue'
import MkEmoji from './MkEmoji.vue'

let app: App | null = null
let container: HTMLElement | null = null

function mountEmoji(emoji: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(MkEmoji, { emoji })
  app.mount(container)
}

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
})
