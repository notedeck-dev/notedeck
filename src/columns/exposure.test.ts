import { describe, expect, it, vi } from 'vitest'

let devMode = false

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    get: (key: string) => (key === 'ui.developerMode' ? devMode : undefined),
  }),
}))

import { exposedColumnTypes, isColumnExposed } from '@/columns/exposure'
import {
  COLUMN_REGISTRY,
  registerColumnType,
  unregisterColumnType,
} from '@/columns/registry'

/**
 * 開発者向けと決めたカラム種別 (#1034)。AI とスキルは一般側に戻した — 接続と
 * 権限の設定が一般に出ている以上 AI の存在は既に露出しており、スキルは他の配布物と
 * 同じく「カラムは一般 / 編集は開発者」に揃えた
 */
const DEVELOPER_COLUMNS = [
  'apiConsole',
  'apiDocs',
  'streamInspector',
  'aiscript',
  'taskRunner',
]

describe('カラムの帰属タグ', () => {
  it('決定した 7 種だけが developer タグを持つ', () => {
    const tagged = Object.entries(COLUMN_REGISTRY)
      .filter(([, spec]) => spec.exposure === 'developer')
      .map(([type]) => type)
    expect(tagged.sort()).toEqual([...DEVELOPER_COLUMNS].sort())
  })

  it('配布物の管理カラムは一般側に残る', () => {
    for (const type of [
      'themeManager',
      'pluginManager',
      'widget',
      'queryManager',
      'memos',
      'skill',
      'ai',
    ]) {
      expect(COLUMN_REGISTRY[type]?.exposure).toBeUndefined()
    }
  })
})

describe('exposedColumnTypes', () => {
  it('開発者モード off では developer タグの種別を除外する', () => {
    devMode = false
    const exposed = exposedColumnTypes()
    for (const type of DEVELOPER_COLUMNS) {
      expect(exposed).not.toContain(type)
    }
    expect(exposed).toContain('timeline')
    expect(exposed).toContain('queryManager')
  })

  it('開発者モード on では全種別を返す', () => {
    devMode = true
    const exposed = exposedColumnTypes()
    for (const type of DEVELOPER_COLUMNS) {
      expect(exposed).toContain(type)
    }
  })

  it('実行時登録された種別はタグ無し = 一般側', () => {
    devMode = false
    registerColumnType('test-plugin-column', {
      label: 'テスト',
      icon: 'puzzle',
      group: 'tool',
      component: () => Promise.resolve({ default: {} }),
    })
    try {
      expect(exposedColumnTypes()).toContain('test-plugin-column')
      expect(isColumnExposed('test-plugin-column')).toBe(true)
    } finally {
      unregisterColumnType('test-plugin-column')
    }
  })
})

describe('isColumnExposed', () => {
  it('off では developer タグの種別が false', () => {
    devMode = false
    expect(isColumnExposed('apiConsole')).toBe(false)
    expect(isColumnExposed('timeline')).toBe(true)
  })

  it('on では両方 true', () => {
    devMode = true
    expect(isColumnExposed('apiConsole')).toBe(true)
    expect(isColumnExposed('timeline')).toBe(true)
  })

  it('未登録の種別は既存カラムの描画を壊さないよう true', () => {
    devMode = false
    expect(isColumnExposed('unknown-type')).toBe(true)
  })
})
