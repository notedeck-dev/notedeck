import { describe, expect, it } from 'vitest'
import {
  migrateWidgetColumns,
  parseProfileFile,
  toFileFormat,
} from '@/services/deckProfileCodec'
import type { DeckColumn } from '@/stores/deck'

function legacyWidgetColumn(partial: Partial<DeckColumn> = {}): DeckColumn {
  return {
    id: 'col-1',
    type: 'widget',
    widgets: [
      {
        id: 'wgt-12345678-abc',
        data: { code: 'let x = 1', autoRun: true, storeId: 'clock' },
      },
      { id: 'wgt-legacy-console', type: 'aiscriptConsole', data: {} },
    ],
    ...partial,
  } as unknown as DeckColumn
}

describe('migrateWidgetColumns', () => {
  it('旧 widgets[] を widgetIds[] へ変換し、本体を抽出して返す', () => {
    const { columns, extractedWidgets, droppedConsoleCount } =
      migrateWidgetColumns([legacyWidgetColumn()])

    const col = columns[0] as unknown as {
      widgetIds?: string[]
      widgets?: unknown
    }
    expect(col.widgetIds).toEqual(['wgt-12345678-abc'])
    expect(col.widgets).toBeUndefined()
    expect(droppedConsoleCount).toBe(1)
    expect(extractedWidgets).toHaveLength(1)
    expect(extractedWidgets[0]?.src).toBe('let x = 1')
    expect(extractedWidgets[0]?.autoRun).toBe(true)
    expect(extractedWidgets[0]?.storeId).toBe('clock')
  })

  it('既存 widget.id を installId として保全する (Mk:save キー prefix の最重要不変条件)', () => {
    const { extractedWidgets } = migrateWidgetColumns([legacyWidgetColumn()])
    expect(extractedWidgets[0]?.installId).toBe('wgt-12345678-abc')
  })

  it('sidebar カラムの widget は sidebarSeed に並び順を引き継ぐ', () => {
    const { sidebarSeed } = migrateWidgetColumns([
      legacyWidgetColumn({ sidebar: true } as Partial<DeckColumn>),
    ])
    expect(sidebarSeed).toEqual(['wgt-12345678-abc'])

    const { sidebarSeed: nonSidebar } = migrateWidgetColumns([
      legacyWidgetColumn(),
    ])
    expect(nonSidebar).toEqual([])
  })

  it('widgetIds 化済みのカラムと widget 以外のカラムには触らない (冪等)', () => {
    const alreadyMigrated = {
      id: 'col-2',
      type: 'widget',
      widgetIds: ['wgt-a'],
    } as unknown as DeckColumn
    const timeline = { id: 'col-3', type: 'home' } as unknown as DeckColumn

    const { columns, extractedWidgets, droppedConsoleCount } =
      migrateWidgetColumns([alreadyMigrated, timeline])
    expect(columns[0]).toBe(alreadyMigrated)
    expect(columns[1]).toBe(timeline)
    expect(extractedWidgets).toEqual([])
    expect(droppedConsoleCount).toBe(0)
  })
})

describe('parseProfileFile', () => {
  it('ファイル名を id に割り当て、欠損フィールドをデフォルト補完する', () => {
    const { profile } = parseProfileFile('main.json5', {})
    expect(profile.id).toBe('main.json5')
    expect(profile.name).toBe('main.json5')
    expect(profile.columns).toEqual([])
    expect(profile.layout).toEqual([])
    expect(profile.createdAt).toBeGreaterThan(0)
  })

  it('columns にマイグレーションを適用し、副産物を返す', () => {
    const { profile, droppedConsoleCount, extractedWidgets } = parseProfileFile(
      'main.json5',
      { name: 'メイン', columns: [legacyWidgetColumn()] },
    )
    expect(profile.name).toBe('メイン')
    expect(
      (profile.columns[0] as unknown as { widgetIds?: string[] }).widgetIds,
    ).toEqual(['wgt-12345678-abc'])
    expect(droppedConsoleCount).toBe(1)
    expect(extractedWidgets).toHaveLength(1)
  })
})

describe('toFileFormat', () => {
  it('内部フィールド id をファイルに書かない', () => {
    const out = toFileFormat({
      id: 'main.json5',
      name: 'メイン',
      columns: [],
      layout: [],
      createdAt: 1,
    })
    expect(out).not.toHaveProperty('id')
    expect(out.name).toBe('メイン')
  })
})
