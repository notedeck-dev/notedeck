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

function tauriWindow(label: string): Record<string, unknown> {
  return {
    __TAURI_INTERNALS__: { metadata: { currentWindow: { label } } },
    location: { search: '' },
  }
}

describe('currentWindowLabel は Tauri の window label を読む (#1131)', () => {
  afterEach(() => {
    Object.assign(globalThis, { window: undefined })
  })

  it('Tauri の窓では label を返す', async () => {
    const m = await loadWith(tauriWindow('deck-1700000000000-1'))
    expect(m.currentWindowLabel()).toBe('deck-1700000000000-1')
  })

  it('Tauri 外 (ブラウザの Dev Dashboard) では null', async () => {
    const m = await loadWith({ location: { search: '' } })
    expect(m.currentWindowLabel()).toBeNull()
  })
})
