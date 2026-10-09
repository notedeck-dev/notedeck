import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type App, createApp, nextTick } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import MkReactionPicker from './MkReactionPicker.vue'

let app: App | null = null
let container: HTMLElement | null = null
let picked: string[] = []

function mountPicker() {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(MkReactionPicker, {
    serverHost: 'example.com',
    accountId: 'a1',
    onPick: (r: string) => picked.push(r),
  })
  app.use(createPinia())
  app.mount(container)
}

async function flush() {
  await nextTick()
  await nextTick()
}

function navButton(label: string): HTMLButtonElement {
  const btn = container?.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  )
  if (!btn) throw new Error(`no button: ${label}`)
  return btn
}

function hasTwemoji(file: string): boolean {
  return [...(container?.querySelectorAll('img') ?? [])].some((img) =>
    img.getAttribute('src')?.endsWith(`/${file}.svg`),
  )
}

beforeEach(() => {
  setActivePinia(createPinia())
  picked = []
})

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

describe('MkReactionPicker (#1193)', () => {
  it('カテゴリのボタンで閉じていたセクションを開いてアクティブにする', async () => {
    mountPicker()
    await flush()
    // 🇯🇵 (旗) は閉じたセクションの中なので最初は描かれない
    expect(hasTwemoji('1f1ef-1f1f5')).toBe(false)
    const flags = navButton('旗')
    flags.click()
    await flush()
    expect(hasTwemoji('1f1ef-1f1f5')).toBe(true)
    expect(flags.getAttribute('aria-current')).toBe('true')
  })

  it('Unicode 絵文字を英名で検索できる', async () => {
    mountPicker()
    const input = container?.querySelector('input')
    if (!input) throw new Error('no input')
    input.value = 'cat'
    input.dispatchEvent(new Event('input'))
    await flush()
    expect(hasTwemoji('1f431')).toBe(true)
  })

  it('選んだスキントーンを設定に残し、選ぶ絵文字に付ける', async () => {
    mountPicker()
    await flush()
    navButton('肌の色').click()
    await flush()
    navButton('中間の肌色').click()
    await flush()
    expect(useSettingsStore().get('emoji.skinTone')).toBe(3)

    navButton('人と体').click()
    await flush()
    const thumbs = [
      ...(container?.querySelectorAll<HTMLImageElement>('img') ?? []),
    ].find((img) => img.getAttribute('src')?.endsWith('/1f44d-1f3fd.svg'))
    expect(thumbs).toBeTruthy()
    thumbs?.closest('button')?.click()
    expect(picked).toContain('👍🏽')
  })
})
