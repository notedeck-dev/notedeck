import { describe, expect, it, vi } from 'vitest'

let devMode = false

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    get: (key: string) => (key === 'ui.developerMode' ? devMode : undefined),
  }),
}))

import { isWindowExposed } from '@/windows/exposure'
import { WINDOW_REGISTRY } from '@/windows/registry'

/** #1034 決定録 1 で「隠す」と決めたウィンドウ */
const DEVELOPER_WINDOWS = [
  'note-inspector',
  'notification-inspector',
  'column-query-editor',
  'widget-edit',
  'skill-edit',
  'tasksEditor',
  'snippetsEditor',
]

describe('ウィンドウの帰属タグ', () => {
  it('決定したウィンドウだけが developer タグを持つ', () => {
    const tagged = Object.entries(WINDOW_REGISTRY)
      .filter(([, spec]) => spec.exposure === 'developer')
      .map(([type]) => type)
    expect(tagged.sort()).toEqual([...DEVELOPER_WINDOWS].sort())
  })

  it('一般に残す設定ウィンドウはタグを持たない', () => {
    for (const type of [
      'aiSettings',
      'permissions',
      'connections',
      'cssEditor',
      'keybinds',
      'backup',
      'appearanceEditor',
      'tutorialEditor',
    ] as const) {
      expect(WINDOW_REGISTRY[type].exposure).toBeUndefined()
    }
  })
})

describe('isWindowExposed', () => {
  it('off では developer タグのウィンドウが false', () => {
    devMode = false
    expect(isWindowExposed('note-inspector')).toBe(false)
    expect(isWindowExposed('note-detail')).toBe(true)
    expect(isWindowExposed('aiSettings')).toBe(true)
    expect(isWindowExposed('permissions')).toBe(true)
  })

  it('on では全部 true', () => {
    devMode = true
    expect(isWindowExposed('note-inspector')).toBe(true)
    expect(isWindowExposed('note-detail')).toBe(true)
  })
})
