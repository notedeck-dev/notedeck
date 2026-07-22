/**
 * デッキプロファイルのファイル codec とマイグレーション (#782)。
 *
 * deckProfile store が持っていた widget マイグレーション (Mk:save キー保全の
 * 最重要不変条件を含む) とファイル形式変換を純関数として抽出し、直接テスト
 * する。副作用 (widgetsStore への移送・toast 通知・dirty フラグ) は store 側が
 * 戻り値の副産物を見て適用する。
 */

import type { DeckColumn, DeckProfile, DeckWindowLayout } from '@/stores/deck'
import type { WidgetMeta } from '@/stores/widgets'

/** Strip internal-only fields before writing to file. */
export function toFileFormat(profile: DeckProfile): Record<string, unknown> {
  const { id: _id, ...rest } = profile
  return rest
}

export interface WidgetMigrationResult {
  columns: DeckColumn[]
  droppedConsoleCount: number
  extractedWidgets: WidgetMeta[]
  sidebarSeed: string[]
}

/**
 * Widget マイグレーション。
 * - 旧 `type: 'aiscriptConsole'` の widget 行は削除 (コードは失われる)。
 * - 旧 `widgets[]` は本体を抽出してストアに移送、カラムには `widgetIds[]` のみ残す。
 * - 既に `widgetIds[]` 化済みのカラムは触らない (idempotent)。
 * 削除件数と抽出した widget は呼び出し側でストアに登録するため返す。
 */
export function migrateWidgetColumns(
  columns: DeckColumn[],
): WidgetMigrationResult {
  let droppedConsoleCount = 0
  const extractedWidgets: WidgetMeta[] = []
  const sidebarSeed: string[] = []
  const now = Date.now()
  const migrated = columns.map((col) => {
    if (col.type !== 'widget') return col
    if (!col.widgets) return col

    const newIds: string[] = []
    for (const w of col.widgets) {
      const legacyType = (w as { type?: string }).type
      if (legacyType === 'aiscriptConsole') {
        droppedConsoleCount++
        continue
      }
      // 既存 widget.id をそのまま installId に再利用
      // (AiScript の `Mk:save` localStorage キー prefix `nd-aiscript-app-${id}:` を保全する最重要不変条件)
      const installId = w.id
      newIds.push(installId)
      extractedWidgets.push({
        installId,
        name: `Widget ${installId.slice(4, 12)}`,
        src: w.data?.code ?? '',
        autoRun: w.data?.autoRun ?? false,
        storeId: w.data?.storeId,
        createdAt: now,
        updatedAt: now,
      })
    }

    // sidebar widget カラムの並びはストア外 sidebarWidgetIds に引き継ぐ
    if (col.sidebar) sidebarSeed.push(...newIds)

    const { widgets: _w, ...rest } = col
    return { ...rest, widgetIds: newIds } as DeckColumn
  })
  return {
    columns: migrated,
    droppedConsoleCount,
    extractedWidgets,
    sidebarSeed,
  }
}

export interface ParsedProfileFile
  extends Omit<WidgetMigrationResult, 'columns'> {
  profile: DeckProfile
}

/** Parse a profile file and assign an ID based on filename. */
export function parseProfileFile(
  filename: string,
  data: Record<string, unknown>,
): ParsedProfileFile {
  const rawColumns = (data.columns as DeckColumn[]) || []
  const { columns, droppedConsoleCount, extractedWidgets, sidebarSeed } =
    migrateWidgetColumns(rawColumns)
  return {
    profile: {
      id: filename,
      name: (data.name as string) || filename,
      columns,
      layout: (data.layout as string[][]) || [],
      createdAt: (data.createdAt as number) || Date.now(),
      windows: data.windows as DeckWindowLayout[] | undefined,
    },
    droppedConsoleCount,
    extractedWidgets,
    sidebarSeed,
  }
}
