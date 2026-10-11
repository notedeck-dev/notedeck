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
  it('旧 widgets[] を配置 (widgetRefs[]) へ変換し、本体を抽出して返す', () => {
    const { columns, extractedWidgets, droppedConsoleCount } =
      migrateWidgetColumns([legacyWidgetColumn()])

    const col = columns[0] as unknown as {
      widgetRefs?: unknown[]
      widgets?: unknown
    }
    expect(col.widgetRefs).toEqual([{ id: 'wgt-12345678-abc' }])
    expect(col.widgets).toBeUndefined()
    expect(droppedConsoleCount).toBe(1)
    expect(extractedWidgets).toHaveLength(1)
    expect(extractedWidgets[0]?.content).toBe('let x = 1')
    expect(extractedWidgets[0]?.extra.autoRun).toBe(true)
    expect(extractedWidgets[0]?.store?.id).toBe('clock')
    // 当時はどのカラムでも使えた = 全体スコープ
    expect(extractedWidgets[0]?.scope).toMatchObject({ global: true })
  })

  it('既存 widget.id を installId として保全する (Mk:save キー prefix の最重要不変条件)', () => {
    const { extractedWidgets } = migrateWidgetColumns([legacyWidgetColumn()])
    expect(extractedWidgets[0]?.id).toBe('wgt-12345678-abc')
  })

  it('sidebar カラムの widget は sidebarSeed に並び順を引き継ぐ', () => {
    const { sidebarSeed } = migrateWidgetColumns([
      legacyWidgetColumn({ sidebar: true } as Partial<DeckColumn>),
    ])
    expect(sidebarSeed).toEqual([{ id: 'wgt-12345678-abc' }])

    const { sidebarSeed: nonSidebar } = migrateWidgetColumns([
      legacyWidgetColumn(),
    ])
    expect(nonSidebar).toEqual([])
  })

  it('旧 widgetIds[] (installId だけ) は配置へ移し、件数を返す (#1202 決定 (g))', () => {
    const legacy = {
      id: 'col-2',
      type: 'widget',
      widgetIds: ['wgt-a', 'wgt-b'],
    } as unknown as DeckColumn
    const { columns, migratedWidgetRefs } = migrateWidgetColumns([legacy])
    expect(columns[0]).toEqual({
      id: 'col-2',
      type: 'widget',
      widgetRefs: [{ id: 'wgt-a' }, { id: 'wgt-b' }],
    })
    expect(migratedWidgetRefs).toBe(1)
  })

  it('widgetRefs 化済みのカラムと widget 以外のカラムには触らない (冪等)', () => {
    const alreadyMigrated = {
      id: 'col-2',
      type: 'widget',
      widgetRefs: [{ id: 'wgt-a' }],
    } as unknown as DeckColumn
    const timeline = { id: 'col-3', type: 'home' } as unknown as DeckColumn

    const {
      columns,
      extractedWidgets,
      droppedConsoleCount,
      migratedWidgetRefs,
    } = migrateWidgetColumns([alreadyMigrated, timeline])
    expect(columns[0]).toBe(alreadyMigrated)
    expect(columns[1]).toBe(timeline)
    expect(extractedWidgets).toEqual([])
    expect(droppedConsoleCount).toBe(0)
    expect(migratedWidgetRefs).toBe(0)
  })
})

describe('parseProfileFile', () => {
  it('確定済み ID を採用し、欠損フィールドをデフォルト補完する', () => {
    const { profile } = parseProfileFile({}, 'my-id', 'main.ndprofile.json5')
    expect(profile.id).toBe('my-id')
    expect(profile.name).toBe('main.ndprofile.json5')
    expect(profile.columns).toEqual([])
    expect(profile.layout).toEqual([])
    expect(profile.createdAt).toBeGreaterThan(0)
  })

  it('未知フィールドを保持する (ダウングレード往復でフィールドが剥がれない)', () => {
    const { profile } = parseProfileFile(
      { name: 'メイン', futureField: 'keep' },
      'my-id',
      'main.ndprofile.json5',
    )
    expect((profile as unknown as { futureField?: string }).futureField).toBe(
      'keep',
    )
  })

  it('columns にマイグレーションを適用し、副産物を返す', () => {
    const { profile, droppedConsoleCount, extractedWidgets } = parseProfileFile(
      { name: 'メイン', columns: [legacyWidgetColumn()] },
      'my-id',
      'main.ndprofile.json5',
    )
    expect(profile.name).toBe('メイン')
    expect(profile.columns[0]?.widgetRefs).toEqual([{ id: 'wgt-12345678-abc' }])
    expect(droppedConsoleCount).toBe(1)
    expect(extractedWidgets).toHaveLength(1)
  })
})

describe('parseProfileFile — 検索カラムの絞り込みの移行 (#1180)', () => {
  it('旧 clientSearchFilter と search の userId を searchFilter へ移し、件数を返す', () => {
    const { profile, migratedSearchColumns } = parseProfileFile(
      {
        columns: [
          {
            id: 'c1',
            type: 'clientSearch',
            clientSearchFilter: { author: 'alice', ascending: true },
          },
          { id: 's1', type: 'search', accountId: 'a1', userId: 'u1' },
          { id: 't1', type: 'timeline', accountId: 'a1' },
        ],
      },
      'my-id',
      'main.ndprofile.json5',
    )
    expect(migratedSearchColumns).toBe(2)
    expect(profile.columns[0]).toMatchObject({
      searchFilter: { author: 'alice', ascending: true },
    })
    expect(profile.columns[0]).not.toHaveProperty('clientSearchFilter')
    expect(profile.columns[1]).toMatchObject({
      searchFilter: { authorIds: { a1: { id: 'u1', acct: '' } } },
    })
    expect(profile.columns[1]).not.toHaveProperty('userId')
    expect(profile.columns[2]).toEqual({
      id: 't1',
      type: 'timeline',
      accountId: 'a1',
    })
  })
})

describe('parseProfileFile — 既定の表示名を保存していたカラム (#135)', () => {
  const columns = [
    { id: 'a', type: 'mentions', name: 'メンション' },
    { id: 'b', type: 'pluginManager', name: 'プラグイン' },
    { id: 'c', type: 'notifications', name: '自分で付けた名前' },
    { id: 'd', type: 'mentions', name: '通知' },
    { id: 'e', type: 'timeline', name: null },
    // 英語 UI で作ったカラム
    { id: 'f', type: 'mentions', name: 'Mentions' },
  ] as unknown as DeckColumn[]

  it('種別の既定表示名 (どの言語でも) と同じ name は、名前なしとして読む', () => {
    const { profile } = parseProfileFile({ columns }, 'id', 'p.json5')
    expect(profile.columns.map((c) => c.name)).toEqual([
      null,
      null,
      '自分で付けた名前',
      // 別の種別の既定表示名は、利用者が付けた名前として残す
      '通知',
      null,
      null,
    ])
  })
})

describe('toFileFormat', () => {
  it('id をファイルに書き、runtime-only の fileBase は書かない', () => {
    const out = toFileFormat({
      id: 'my-id',
      name: 'メイン',
      columns: [],
      layout: [],
      createdAt: 1,
      fileBase: 'main',
    })
    expect(out.id).toBe('my-id')
    expect(out).not.toHaveProperty('fileBase')
    expect(out.name).toBe('メイン')
  })

  it('未知フィールドを往復で保持する', () => {
    const { profile } = parseProfileFile(
      { name: 'メイン', futureField: 'keep' },
      'my-id',
      'main.ndprofile.json5',
    )
    profile.fileBase = 'main'
    const out = toFileFormat(profile)
    expect(out.futureField).toBe('keep')
    expect(out).not.toHaveProperty('fileBase')
  })
})
