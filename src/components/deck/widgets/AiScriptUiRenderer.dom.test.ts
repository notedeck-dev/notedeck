import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type App, createApp } from 'vue'
import type { UiComponent } from '@/aiscript/ui'
import AiScriptUiRenderer from './AiScriptUiRenderer.vue'

let app: App | null = null
let container: HTMLElement | null = null

function mount(components: UiComponent[]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(AiScriptUiRenderer, { components, interpreter: null })
  app.use(createPinia())
  app.mount(container)
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

function mfmBlock(): HTMLElement {
  const el = container?.querySelector<HTMLElement>('[class*="aisMfm"]')
  if (!el) throw new Error('mfm block not rendered')
  return el
}

// #1249: 本家 MkAsUi の text / mfm は font prop (serif / sans-serif / monospace)
// を持つ。misstore のウィジェットが等幅に使っているので無視しない
describe('AiScriptUiRenderer font prop (#1249)', () => {
  it('applies monospace to Ui:C:mfm', () => {
    mount([{ id: 'a', type: 'mfm', props: { text: 'x', font: 'monospace' } }])
    expect(mfmBlock().style.fontFamily).toContain('--nd-font-mono')
  })

  it('applies serif to Ui:C:text', () => {
    mount([{ id: 'a', type: 'text', props: { text: 'x', font: 'serif' } }])
    expect(mfmBlock().style.fontFamily).toBe('serif')
  })

  it('leaves the font alone without the prop or with an unknown value', () => {
    mount([
      { id: 'a', type: 'mfm', props: { text: 'x' } },
      { id: 'b', type: 'mfm', props: { text: 'y', font: 'comic' } },
    ])
    const blocks = container?.querySelectorAll<HTMLElement>('[class*="aisMfm"]')
    expect(blocks?.length).toBe(2)
    for (const b of blocks ?? []) expect(b.style.fontFamily).toBe('')
  })
})
