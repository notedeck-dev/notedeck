import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { WINDOW_REGISTRY } from '@/windows/registry'
import { SETTINGS_SECTIONS } from './sections'

describe('設定セクションのレジストリ (#794 W7)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('全セクションが実在するウィンドウ種別を指す', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(WINDOW_REGISTRY[section.window], section.window).toBeDefined()
    }
  })

  it('同じウィンドウを開くセクションが重複しない', () => {
    const windows = SETTINGS_SECTIONS.map((s) => s.window)
    expect(new Set(windows).size).toBe(windows.length)
  })

  it('ラベルとアイコンはウィンドウレジストリから引く (二重定義を作らない)', () => {
    for (const section of SETTINGS_SECTIONS) {
      const spec = WINDOW_REGISTRY[section.window]
      expect(spec?.label).toBeTruthy()
      expect(spec?.icon).toBeTruthy()
    }
  })

  it('変更検知を持つセクションは既定状態で false を返す', () => {
    for (const section of SETTINGS_SECTIONS) {
      if (!section.hasOverride) continue
      expect(section.hasOverride(), section.window).toBe(false)
    }
  })
})
