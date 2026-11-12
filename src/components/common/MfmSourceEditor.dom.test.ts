// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { type App, createApp, h, nextTick, ref } from 'vue'
import MfmSourceEditor from './MfmSourceEditor.vue'

let app: App | null = null
let container: HTMLElement | null = null

function mount(initial: string) {
  const value = ref(initial)
  const emitted: string[] = []
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    render: () =>
      h(MfmSourceEditor, {
        modelValue: value.value,
        placeholder: 'MFM...',
        ariaLabel: 'MFM source',
        'onUpdate:modelValue': (v: string) => {
          emitted.push(v)
          value.value = v
        },
      }),
  })
  app.mount(container)
  return { value, emitted }
}

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

/** そのクラスが付いた部分の文字列 */
function textsOf(selector: string): string[] {
  return [...(container?.querySelectorAll(selector) ?? [])].map(
    (el) => el.textContent ?? '',
  )
}

describe('MfmSourceEditor (#1392)', () => {
  it('関数の括弧に、入れ子の深さごとの色のクラスを付ける', async () => {
    mount('$[x2 $[spin.speed=1s a] :b:]')
    await nextTick()
    expect(textsOf('.cm-mfm-fn.cm-mfm-d0')).toEqual(['$[x2', ']'])
    expect(textsOf('.cm-mfm-fn.cm-mfm-d1')).toEqual(['$[spin', ']'])
    expect(textsOf('.cm-mfm-fnArgs')).toEqual(['.speed=1s'])
    expect(textsOf('.cm-mfm-emoji')).toEqual([':b:'])
  })

  it('色を付けても、ソースの文字は変えない', async () => {
    const source = '$[x2 **a**\n  $[spin b]] ] https://x.example'
    const { emitted } = mount(source)
    await nextTick()
    expect(container?.querySelector('.cm-content')?.textContent).toBe(
      source.replace('\n', ''),
    )
    // 開いただけでは書き換えを通知しない
    expect(emitted).toEqual([])
  })

  it('外から値が変わったら追従し、その変更を自分の入力として通知し返さない', async () => {
    const { value, emitted } = mount('a')
    await nextTick()
    value.value = '$[x2 b]'
    await nextTick()
    expect(textsOf('.cm-mfm-fn')).toEqual(['$[x2', ']'])
    expect(emitted).toEqual([])
  })

  it('入力欄に説明のラベルを付ける', async () => {
    mount('')
    await nextTick()
    expect(
      container?.querySelector('.cm-content')?.getAttribute('aria-label'),
    ).toBe('MFM source')
  })
})
