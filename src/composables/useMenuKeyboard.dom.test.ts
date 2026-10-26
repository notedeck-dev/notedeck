// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useMenuKeyboard } from './useMenuKeyboard'

function mountMenu(labels: string[]) {
  const el = document.createElement('div')
  for (const label of labels) {
    const b = document.createElement('button')
    b.textContent = label
    el.appendChild(b)
  }
  document.body.appendChild(el)
  // happy-dom は offsetParent を持たないので、表示判定が通るように与える
  for (const b of el.querySelectorAll('button')) {
    Object.defineProperty(b, 'offsetParent', { value: el })
  }
  return el
}

function press(el: HTMLElement, key: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useMenuKeyboard', () => {
  it('activate で先頭に焦点を置き、矢印 / Home / End で移動する', () => {
    const el = mountMenu(['a', 'b', 'c'])
    const { activate } = useMenuKeyboard({
      containerRef: ref(el),
      itemSelector: 'button',
      onClose: vi.fn(),
    })
    activate()
    const text = () => document.activeElement?.textContent
    expect(text()).toBe('a')
    press(el, 'ArrowDown')
    expect(text()).toBe('b')
    press(el, 'End')
    expect(text()).toBe('c')
    press(el, 'ArrowDown')
    expect(text()).toBe('c')
    press(el, 'Home')
    expect(text()).toBe('a')
    press(el, 'ArrowUp')
    expect(text()).toBe('a')
  })

  it('Escape で onClose を呼び、deactivate 後はキーを拾わない', () => {
    const el = mountMenu(['a', 'b'])
    const onClose = vi.fn()
    const { activate, deactivate } = useMenuKeyboard({
      containerRef: ref(el),
      itemSelector: 'button',
      onClose,
    })
    activate()
    press(el, 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
    deactivate()
    press(el, 'ArrowDown')
    expect(document.activeElement?.textContent).toBe('a')
    press(el, 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
