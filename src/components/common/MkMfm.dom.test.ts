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

describe('MkMfm 値域 (本家 mfm-renderer と同じ、#1083)', () => {
  function transformOf(text: string): string | undefined {
    mountMfm(text)
    return (container?.querySelector('span[style*="transform"]') as HTMLElement)
      ?.style.transform
  }

  it('$[scale] は本家と同じく 5 倍で頭打ちにする', () => {
    expect(transformOf('$[scale.x=100,y=3 a]')).toBe('scale(5,3)')
  })

  it('$[scale] の負の値は本家と同じく反転としてそのまま通す (MFM アートが使う)', () => {
    expect(transformOf('$[scale.x=-12,y=-8 a]')).toBe('scale(-12,-8)')
  })

  it('$[position] は本家と同じく上限を置かない (軌道を作る MFM アートが使う)', () => {
    expect(transformOf('$[position.x=1000,y=-1000 a]')).toBe(
      'translate(1000em,-1000em)',
    )
  })

  it('値域内の値はそのまま', () => {
    expect(transformOf('$[position.x=1.5,y=-2 a]')).toBe(
      'translate(1.5em,-2em)',
    )
  })

  it('$[rotate] は本家と同じく中心を軸にする', () => {
    mountMfm('$[rotate.deg=30 a]')
    const el = container?.querySelector(
      'span[style*="transform"]',
    ) as HTMLElement
    expect(el.style.transform).toBe('rotate(30deg)')
    expect(el.style.transformOrigin).toBe('center center')
  })

  it('style を持つ fn は本家と同じくすべて inline-block (fg / bg / font も)', () => {
    mountMfm('$[fg.color=f00 a]$[bg.color=0f0 b]$[font.serif c]')
    const spans = Array.from(
      container?.querySelectorAll('span[style]') ?? [],
    ) as HTMLElement[]
    expect(spans.map((s) => s.style.display)).toEqual([
      'inline-block',
      'inline-block',
      'inline-block',
    ])
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

describe('MkMfm 本家の既定値との揃え (段階 2 の残り)', () => {
  it('$[tada] はアニメーションの有無に関わらず文字が 150% になる', () => {
    mountMfm('$[tada a]')
    expect(container?.querySelector('span[class*="mfmTada"]')).toBeTruthy()
    app?.unmount()
    useSettingsStore().set('mfm.animated', false)
    mountMfm('$[tada b]')
    expect(
      container?.querySelector('span[class*="mfmTadaStatic"]'),
    ).toBeTruthy()
  })

  it('italic は本家と同じく oblique のクラスを持つ', () => {
    mountMfm('*a*')
    expect(container?.querySelector('i[class*="mfmItalic"]')).toBeTruthy()
  })

  it('$[fg] / $[bg] は色が無効なら本家と同じく赤になる', () => {
    mountMfm('$[fg a]$[bg.color=zzz b]')
    const spans = Array.from(
      container?.querySelectorAll('span[style]') ?? [],
    ) as HTMLElement[]
    const red = ['#f00', 'rgb(255, 0, 0)']
    expect(red).toContain(spans[0]?.style.color)
    expect(red).toContain(spans[1]?.style.backgroundColor)
  })

  it('2.5 倍以上に拡大された中のカスタム絵文字は縮小版でなく原寸を使う', () => {
    const emojis = { e: 'https://example.com/e.png' }
    mountMfm(':e:', { emojis })
    expect(container?.querySelector('img')?.getAttribute('src')).toContain(
      'h=128',
    )
    app?.unmount()
    mountMfm('$[x3 :e:]', { emojis })
    expect(container?.querySelector('img')?.getAttribute('src')).not.toContain(
      'h=128',
    )
    app?.unmount()
    mountMfm('$[x2 $[x2 :e:]]', { emojis })
    expect(container?.querySelector('img')?.getAttribute('src')).not.toContain(
      'h=128',
    )
    app?.unmount()
    mountMfm('$[scale.x=3 :e:]', { emojis })
    expect(container?.querySelector('img')?.getAttribute('src')).not.toContain(
      'h=128',
    )
  })
})

describe('MkMfm $[unixtime] の値域 (Release PR #1274 のレビュー指摘)', () => {
  it('Date で表せない大きな値でも描画が落ちず ? を出す', () => {
    mountMfm('前 $[unixtime 99999999999999] 後')
    expect(container?.textContent).toBe('前 ? 後')
    expect(container?.querySelector('time')?.getAttribute('datetime')).toBe('')
  })

  it('0 (1970-01-01) は有効な時刻として描画する', () => {
    mountMfm('$[unixtime 0]')
    expect(container?.querySelector('time')?.getAttribute('datetime')).toBe(
      '1970-01-01T00:00:00.000Z',
    )
    expect(container?.textContent).toMatch(/1970/)
  })
})

/**
 * 通知の要約 1 行 (#1210) でも MFM を描画する (#1279)。nowrap は根に 1 行のクラスを
 * 付けるだけで、構文は通常どおり解釈する (本家の通知は plain で構文が生のまま出る)
 */
describe('MkMfm nowrap (#1279)', () => {
  it('1 行の要約でも MFM を描画し、根に 1 行のクラスを付ける', async () => {
    mountMfm('<center>$[fg.color=f00 **私が作りました**]</center>', {
      nowrap: true,
    })
    await nextTick()
    expect(container?.querySelector('span[class*="mfmNowrap"]')).toBeTruthy()
    expect(container?.querySelector('b')?.textContent).toBe('私が作りました')
    expect(container?.textContent).not.toContain('**')
    expect(container?.textContent).not.toContain('$[')
  })

  it('nowrap でなければ 1 行のクラスを付けない', async () => {
    mountMfm('**a**')
    await nextTick()
    expect(container?.querySelector('span[class*="mfmNowrap"]')).toBeNull()
  })
})
