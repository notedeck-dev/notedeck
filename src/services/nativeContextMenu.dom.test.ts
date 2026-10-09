import { describe, expect, it } from 'vitest'
import { allowsNativeContextMenu } from './nativeContextMenu'

function el(html: string, selector: string): Element {
  const root = document.createElement('div')
  root.innerHTML = html
  const found = root.querySelector(selector)
  if (!found) throw new Error(`no ${selector}`)
  return found
}

const base = { hasSelection: false, developerMode: false }

describe('allowsNativeContextMenu', () => {
  it('余白では出さない', () => {
    expect(
      allowsNativeContextMenu(el('<div><span>x</span></div>', 'span'), base),
    ).toBe(false)
  })

  it('入力欄・編集可能領域では出す', () => {
    expect(allowsNativeContextMenu(el('<input>', 'input'), base)).toBe(true)
    expect(
      allowsNativeContextMenu(el('<textarea></textarea>', 'textarea'), base),
    ).toBe(true)
    expect(
      allowsNativeContextMenu(
        el('<div contenteditable="true"><p>a</p></div>', 'p'),
        base,
      ),
    ).toBe(true)
  })

  it('contenteditable="false" は編集可能扱いしない', () => {
    expect(
      allowsNativeContextMenu(
        el('<div contenteditable="false"><p>a</p></div>', 'p'),
        base,
      ),
    ).toBe(false)
  })

  it('リンク (の子孫) とメディアでは出す', () => {
    expect(
      allowsNativeContextMenu(
        el('<a href="https://x"><b>a</b></a>', 'b'),
        base,
      ),
    ).toBe(true)
    expect(allowsNativeContextMenu(el('<img src="a.png">', 'img'), base)).toBe(
      true,
    )
  })

  it('href の無い a は出さない', () => {
    expect(allowsNativeContextMenu(el('<a><b>a</b></a>', 'b'), base)).toBe(
      false,
    )
  })

  it('選択テキストの上では出す', () => {
    expect(
      allowsNativeContextMenu(el('<span>x</span>', 'span'), {
        ...base,
        hasSelection: true,
      }),
    ).toBe(true)
  })

  it('開発者モードでは常に出す (要素の検証のため)', () => {
    expect(
      allowsNativeContextMenu(el('<span>x</span>', 'span'), {
        ...base,
        developerMode: true,
      }),
    ).toBe(true)
  })

  it('target が要素でなければ出さない', () => {
    expect(allowsNativeContextMenu(null, base)).toBe(false)
  })
})
