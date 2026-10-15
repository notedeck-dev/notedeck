// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { extractColumnThemeVars, extractThemeVars } from './themeVars'

// happy-dom の CSSStyleDeclaration は反復できない (ブラウザはできる) ので、
// 反復と getPropertyValue だけ持つ style に差し替えて読む
function withStyle(el: HTMLElement, props: Record<string, string>) {
  const style = {
    *[Symbol.iterator]() {
      yield* Object.keys(props)
    },
    getPropertyValue: (name: string) => props[name] ?? '',
  }
  Object.defineProperty(el, 'style', { value: style })
  return el
}

describe('extractThemeVars', () => {
  it('インラインの --nd-* 変数だけを集め、他のプロパティや変数は拾わない', () => {
    const el = withStyle(document.createElement('div'), {
      '--nd-accent': '#ff0000',
      '--nd-bg': 'white',
      '--other': '1',
      color: 'blue',
      '--ndx': 'no',
    })
    expect(extractThemeVars(el)).toEqual({
      '--nd-accent': '#ff0000',
      '--nd-bg': 'white',
    })
  })

  it('インラインスタイルが無ければ空', () => {
    expect(
      extractThemeVars(withStyle(document.createElement('div'), {})),
    ).toEqual({})
  })
})

describe('extractColumnThemeVars', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function byId(id: string) {
    return document.getElementById(id) as HTMLElement
  }

  it('最寄りの .deck-column 祖先の --nd-* を返す', () => {
    document.body.innerHTML =
      '<div id="outer" class="deck-column"><div id="inner" class="deck-column"><span id="t"></span></div></div>'
    withStyle(byId('outer'), { '--nd-accent': 'red' })
    withStyle(byId('inner'), { '--nd-accent': 'blue' })
    expect(extractColumnThemeVars(byId('t'))).toEqual({ '--nd-accent': 'blue' })
  })

  it('要素自身が .deck-column ならそれ自身から読む', () => {
    document.body.innerHTML = '<div id="c" class="deck-column"></div>'
    const c = withStyle(byId('c'), { '--nd-fg': 'black' })
    expect(extractColumnThemeVars(c)).toEqual({ '--nd-fg': 'black' })
  })

  it('.deck-column の外なら空', () => {
    document.body.innerHTML = '<div id="p"><span id="t"></span></div>'
    withStyle(byId('p'), { '--nd-accent': 'red' })
    expect(extractColumnThemeVars(byId('t'))).toEqual({})
  })
})
