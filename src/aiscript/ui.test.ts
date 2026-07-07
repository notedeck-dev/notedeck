import { Interpreter, Parser } from '@syuilo/aiscript'
import { describe, expect, it } from 'vitest'
import { createAiScriptUiLib, type UiComponent } from './ui'

// Note: 本テストは Ui:render → valueToUiComponent の props 変換
// （特にイベントハンドラ VFn の温存）を検証する。描画自体は
// AiScriptUiRenderer.vue の責務なので実機で確認する。

async function renderScript(src: string): Promise<UiComponent[]> {
  let rendered: UiComponent[] = []
  const ui = createAiScriptUiLib({
    onRender: (components) => {
      rendered = components
    },
  })
  const interp = new Interpreter(ui, {})
  await interp.exec(new Parser().parse(src))
  return rendered
}

describe('Ui:render props conversion', () => {
  it('preserves a top-level fn prop (Ui:C:button onClick)', async () => {
    const comps = await renderScript(`
      Ui:render([
        Ui:C:button({
          text: "go"
          onClick: @() { 1 }
        })
      ])
    `)
    expect(comps).toHaveLength(1)
    const onClick = comps[0]?.props.onClick as { type?: string }
    expect(onClick?.type).toBe('fn')
  })

  it('preserves fn nested in the buttons array (Ui:C:buttons onClick)', async () => {
    const comps = await renderScript(`
      Ui:render([
        Ui:C:buttons({
          buttons: [{
            text: "a"
            disabled: false
            onClick: @() { 1 }
          }, {
            text: "b"
            primary: true
            onClick: @() { 2 }
          }]
        })
      ])
    `)
    expect(comps).toHaveLength(1)
    const btns = comps[0]?.props.buttons as {
      text: string
      disabled?: boolean
      primary?: boolean
      onClick?: { type?: string }
    }[]
    expect(btns).toHaveLength(2)
    expect(btns[0]?.text).toBe('a')
    expect(btns[0]?.disabled).toBe(false)
    expect(btns[0]?.onClick?.type).toBe('fn')
    expect(btns[1]?.primary).toBe(true)
    expect(btns[1]?.onClick?.type).toBe('fn')
  })

  it('still converts plain values with valToJs', async () => {
    const comps = await renderScript(`
      Ui:render([
        Ui:C:select({
          items: [{ text: "x", value: "1" }]
          label: "sel"
        })
      ])
    `)
    const items = comps[0]?.props.items as { text: string; value: string }[]
    expect(items[0]).toEqual({ text: 'x', value: '1' })
    expect(comps[0]?.props.label).toBe('sel')
  })
})
