import { afterEach, describe, expect, it } from 'vitest'
import { type App, createApp, h } from 'vue'
import I18n from './I18n.vue'

let app: App | null = null
let container: HTMLElement | null = null

function mount(src: string, slots: Record<string, () => unknown>) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render: () => h(I18n, { src }, slots) })
  app.mount(container)
  return container
}

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

describe('I18n', () => {
  it('param の位置に同名の slot を差し込む', () => {
    const el = mount('{name} さんが {target} を追加しました', {
      name: () => h('b', 'Ai'),
      target: () => h('code', 'x'),
    })
    expect(el.innerHTML).toBe(
      '<span>' +
        '<b>Ai</b>' +
        ' さんが ' +
        '<code>x</code>' +
        ' を追加しました</span>',
    )
  })

  it('文言そのものは HTML として解釈しない', () => {
    const el = mount('<img src=x onerror=alert(1)> {name}', {
      name: () => 'Ai',
    })
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toBe('<img src=x onerror=alert(1)> Ai')
  })

  it('param の無い文言はそのまま出す', () => {
    const el = mount('こんにちは', {})
    expect(el.textContent).toBe('こんにちは')
  })
})
