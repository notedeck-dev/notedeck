import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type App, createApp, nextTick } from 'vue'
import MkMfm from './MkMfm.vue'

let app: App | null = null
let container: HTMLElement | null = null
let pinia: ReturnType<typeof createPinia>

function mountMfm(text: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(MkMfm, { text })
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

/**
 * KaTeX は動的 import なので、読み込み完了で再レンダリングされるまで待つ。
 * 再レンダリングされなければタイムアウトして未描画のままになる。
 */
async function waitFor(selector: string) {
  for (let i = 0; i < 50; i++) {
    await nextTick()
    if (container?.querySelector(selector)) return
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('MkMfm math', () => {
  it('インライン数式は KaTeX 読み込み後に描画される', async () => {
    mountMfm('\\(x^2\\)')
    await waitFor('math')
    const math = container?.querySelector('math')
    expect(math).toBeTruthy()
    expect(math?.getAttribute('display')).toBeNull()
  })

  it('ブロック数式は KaTeX 読み込み後に display=block で描画される', async () => {
    mountMfm('\\[x^2\\]')
    await waitFor('math')
    expect(container?.querySelector('math')?.getAttribute('display')).toBe(
      'block',
    )
  })
})

describe('MkMfm 値域の clamp (#704)', () => {
  function transformOf(text: string): string | undefined {
    mountMfm(text)
    return (container?.querySelector('span[style*="transform"]') as HTMLElement)
      ?.style.transform
  }

  it('$[scale] は本家と同じく 5 倍で頭打ちにする', () => {
    expect(transformOf('$[scale.x=100,y=3 a]')).toBe('scale(5,3)')
  })

  it('$[scale] の負の値も絶対値 5 で止める', () => {
    expect(transformOf('$[scale.x=-100 a]')).toBe('scale(-5,1)')
  })

  it('$[position] は ±10em に収める', () => {
    expect(transformOf('$[position.x=1000,y=-1000 a]')).toBe(
      'translate(10em,-10em)',
    )
  })

  it('値域内の値はそのまま', () => {
    expect(transformOf('$[position.x=1.5,y=-2 a]')).toBe(
      'translate(1.5em,-2em)',
    )
  })
})
