import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Shortcut } from '@/commands/registry'

// 書式の規則は src/services/shortcutFormat.test.ts。ここは navigator による mac 判定だけ。
// 判定は import 時に 1 回だけ行うので、UA ごとに読み込み直す
async function load(userAgent: string | undefined) {
  vi.resetModules()
  if (userAgent !== undefined) vi.stubGlobal('navigator', { userAgent })
  else vi.stubGlobal('navigator', undefined)
  return (await import('./shortcutLabel')).shortcutLabel
}

const ctrlShiftK: Shortcut = {
  key: 'k',
  ctrl: true,
  shift: true,
  scope: 'global',
}

describe('shortcutLabel', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    'Mozilla/5.0 (iPad; CPU OS 17_0)',
  ])('Apple 系 UA (%s) では記号を連結する', async (ua) => {
    const shortcutLabel = await load(ua)
    expect(shortcutLabel(ctrlShiftK)).toBe('⌘⇧K')
  })

  it('それ以外の UA では Ctrl+Shift+K 形式', async () => {
    const shortcutLabel = await load(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    )
    expect(shortcutLabel(ctrlShiftK)).toBe('Ctrl+Shift+K')
  })

  it('navigator が無い環境では mac 扱いしない', async () => {
    const shortcutLabel = await load(undefined)
    expect(shortcutLabel(ctrlShiftK)).toBe('Ctrl+Shift+K')
  })
})
