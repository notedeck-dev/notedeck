import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type App, createApp, nextTick } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import MkMfm from './MkMfm.vue'

let app: App | null = null
let container: HTMLElement | null = null
let pinia: ReturnType<typeof createPinia>

function mountMfm(text: string, props: Record<string, unknown> = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(MkMfm, { text, ...props })
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

describe('MkMfm アニメーションの speed / delay (#1083)', () => {
  function animatedSpan(text: string): HTMLElement | null {
    mountMfm(text)
    return container?.querySelector(
      'span[style*="animation"]',
    ) as HTMLElement | null
  }

  it('$[spin.delay=1s] は animation-delay を付ける (本家と同じ)', () => {
    const el = animatedSpan('$[spin.delay=1s a]')
    expect(el?.style.animationDelay).toBe('1s')
  })

  it('負の delay は位相をずらす書き方として通す', () => {
    const el = animatedSpan('$[jump.speed=2s,delay=-0.5s a]')
    expect(el?.style.animationDuration).toBe('2s')
    expect(el?.style.animationDelay).toBe('-0.5s')
  })

  it('単位の無い delay / speed は無視する (inline の animation 指定が付かない)', () => {
    expect(animatedSpan('$[bounce.delay=1,speed=abc a]')).toBeNull()
  })
})

describe('MkMfm リンク (#704)', () => {
  it('表示テキスト付きリンクは実 URL を title に出す (本家 MkLink と同じ)', () => {
    mountMfm('[https://safe.example](https://evil.example/x)')
    expect(container?.querySelector('a')?.getAttribute('title')).toBe(
      'https://evil.example/x',
    )
  })
})

describe('MkMfm memo 向け拡張 (markdown)', () => {
  it('heading / list / memo リンクを描画する (#494)', () => {
    mountMfm('# 見出し\n- a\n- b\n[t](memo:20260101000000)', {
      markdown: true,
    })
    expect(container?.querySelector('h1')?.textContent).toBe('見出し')
    expect(container?.querySelectorAll('ul > li')).toHaveLength(2)
    const a = container?.querySelector('a')
    expect(a?.textContent).toBe('t')
    // memo: は外部 URL ではないので href には出さない
    expect(a?.getAttribute('href')).toBe('#')
  })

  it('markdown 無しでは heading にならない', () => {
    mountMfm('# 見出し')
    expect(container?.querySelector('h1')).toBeNull()
  })
})

describe('MkMfm 本家パーサの契約', () => {
  it('***big*** は $[tada] として描画する', () => {
    mountMfm('***big***')
    expect(container?.querySelector('span[class*="mfmTada"]')).toBeTruthy()
  })

  it('入れ子の x2 は本家と同じく縮む (nestLimit の範囲で)', () => {
    mountMfm('$[x2 $[x2 a]]')
    expect(container?.querySelectorAll('span[class*="mfmX2"]')).toHaveLength(2)
  })
})

describe('MkMfm 本家の描画との揃え (段階 2)', () => {
  it('未知の fn は本家と同じく $[name ...] の原文で描画する', () => {
    mountMfm('$[nosuchfn abc]')
    expect(container?.textContent).toBe('$[nosuchfn abc]')
  })

  it('$[font.emoji] / $[font.math] も font-family になる', () => {
    mountMfm('$[font.emoji a]$[font.math b]')
    const spans = Array.from(
      container?.querySelectorAll('span[style*="font-family"]') ?? [],
    ) as HTMLElement[]
    expect(spans.map((s) => s.style.fontFamily)).toEqual(['emoji', 'math'])
  })

  it('$[clickable.ev=foo] はクリックを親に伝えず clickEv を emit する', () => {
    const events: string[] = []
    let outer = 0
    container = document.createElement('div')
    container.addEventListener('click', () => outer++)
    document.body.appendChild(container)
    app = createApp(MkMfm, {
      text: '$[clickable.ev=foo push]',
      onClickEv: (ev: string) => events.push(ev),
    })
    app.use(pinia)
    app.mount(container)
    // 一番内側の span (外側の .mfm も同じ textContent を持つ)
    const target = Array.from(container.querySelectorAll('span'))
      .filter((s) => s.textContent === 'push')
      .at(-1)
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(events).toEqual(['foo'])
    expect(outer).toBe(0)
  })

  it('$[ruby] は複数の子を持てる (最後の text が rt)', () => {
    mountMfm('$[ruby :e: るび]')
    const ruby = container?.querySelector('ruby')
    expect(ruby?.querySelector('rt')?.textContent).toBe('るび')
    expect(ruby?.querySelector('img, .custom-emoji')).toBeTruthy()
  })

  it('$[unixtime] は絶対時刻と相対時刻を出す', () => {
    const ts = Math.floor(Date.now() / 1000) - 3600
    mountMfm(`$[unixtime ${ts}]`)
    const time = container?.querySelector('time')
    expect(time?.getAttribute('datetime')).toBe(
      new Date(ts * 1000).toISOString(),
    )
    // 絶対時刻 (年を含む) と相対時刻 (括弧つき) の両方
    expect(time?.textContent).toMatch(/\d{4}/)
    expect(time?.textContent).toMatch(/\(.+\)/)
  })

  it('$[sparkle] は粒子コンポーネントで包む', () => {
    mountMfm('$[sparkle a]')
    expect(container?.querySelector('span[class*="root"]')).toBeTruthy()
  })
})

describe('MkMfm の設定 (本家の advancedMfm / animatedMfm)', () => {
  it('アニメーションを切ると動く fn は静止し、sparkle は子だけになる', () => {
    useSettingsStore().set('mfm.animated', false)
    mountMfm('$[spin a]$[sparkle b]$[rainbow c]')
    expect(container?.querySelector('span[class*="mfmSpin"]')).toBeNull()
    expect(container?.querySelector('span[class*="root"]')).toBeNull()
    // rainbow は本家と同じく静的なグラデーションに落ちる
    expect(
      container?.querySelector('span[class*="mfmRainbowStatic"]'),
    ).toBeTruthy()
    expect(container?.textContent).toBe('abc')
  })

  it('高度な MFM を切ると拡大 / 位置 / 伸縮が効かず、アニメーションも止まる', () => {
    useSettingsStore().set('mfm.advanced', false)
    mountMfm('$[x2 a]$[position.x=2 b]$[scale.x=2 c]$[spin d]')
    expect(container?.querySelector('span[class*="mfmX2"]')).toBeNull()
    expect(container?.querySelector('span[style*="transform"]')).toBeNull()
    expect(container?.querySelector('span[class*="mfmSpin"]')).toBeNull()
  })

  it('既定では両方とも有効', () => {
    mountMfm('$[x2 a]$[spin b]')
    expect(container?.querySelector('span[class*="mfmX2"]')).toBeTruthy()
    expect(container?.querySelector('span[class*="mfmSpin"]')).toBeTruthy()
  })
})

describe('MkMfm plain (本家の parseSimple)', () => {
  it('plain では装飾を解釈せず、絵文字だけ描画する', () => {
    mountMfm('**b** 😀', { plain: true })
    expect(container?.querySelector('b')).toBeNull()
    expect(container?.querySelector('img, .twemoji')).toBeTruthy()
    expect(container?.textContent).toContain('**b**')
  })
})
