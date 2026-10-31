import { afterEach, describe, expect, it, vi } from 'vitest'

// isTauri は import 時に window の印で決まるので、ケースごとに window を
// 立て直してからモジュールを読み直す
async function loadWith(
  win: Record<string, unknown> | undefined,
): Promise<typeof import('@/utils/settingsFs')> {
  vi.resetModules()
  // undefined を代入すれば `typeof window === 'undefined'` になる
  Object.assign(globalThis, { window: win })
  return await import('@/utils/settingsFs')
}

function tauriWindow(label: string, search = ''): Record<string, unknown> {
  return {
    __TAURI_INTERNALS__: { metadata: { currentWindow: { label } } },
    location: { search },
  }
}

describe('isMainDeckWindow は Tauri の window label で決める (#1131)', () => {
  afterEach(() => {
    Object.assign(globalThis, { window: undefined })
  })

  it('label が main なら true', async () => {
    const m = await loadWith(tauriWindow('main'))
    expect(m.isMainDeckWindow()).toBe(true)
  })

  it('PiP (query に profile も window も無い) は main ではない', async () => {
    const m = await loadWith(tauriWindow('pip-1700000000000-1'))
    expect(m.isMainDeckWindow()).toBe(false)
  })

  it('ポップアウト / ミラー (deck-*) は main ではない', async () => {
    const m = await loadWith(
      tauriWindow('deck-1700000000000-1', '?profile=p&window=deck-1'),
    )
    expect(m.isMainDeckWindow()).toBe(false)
  })

  it('Tauri 外 (ブラウザの Dev Dashboard) は main 扱い', async () => {
    const m = await loadWith({ location: { search: '' } })
    expect(m.isMainDeckWindow()).toBe(true)
  })

  it('currentWindowLabel は Tauri 外では null', async () => {
    const m = await loadWith({ location: { search: '' } })
    expect(m.currentWindowLabel()).toBeNull()
  })
})
