/**
 * デッキプロファイルのファイル codec とマイグレーション (#782)。
 *
 * deckProfile store が持っていた widget マイグレーション (Mk:save キー保全の
 * 最重要不変条件を含む) とファイル形式変換を純関数として抽出し、直接テスト
 * する。副作用 (widgetsStore への移送・toast 通知・dirty フラグ) は store 側が
 * 戻り値の副産物を見て適用する。
 */

import { COLUMN_LABELS_BY_TYPE } from '@/i18n/locale.generated'
import type { WidgetItem } from '@/services/distributableCodecs/widgetCodec'
import { migrateSearchColumns } from '@/services/searchFilter'
import {
  placementsFromIds,
  type WidgetPlacement,
} from '@/services/widgetPlacement'
import type { DeckColumn, DeckProfile } from '@/stores/deck'

/**
 * ファイルへ書く形にする (#913: id はファイルに書く。参照はファイル内 ID)。
 * runtime-only の fileBase (ID → ファイル名対応表) だけを strip し、
 * 未知フィールドはそのまま書き戻す (ダウングレード往復での剥がれ防止)。
 */
export function toFileFormat(profile: DeckProfile): Record<string, unknown> {
  const { fileBase: _fileBase, ...rest } = profile
  return rest
}

export interface WidgetMigrationResult {
  columns: DeckColumn[]
  droppedConsoleCount: number
  extractedWidgets: WidgetItem[]
  sidebarSeed: WidgetPlacement[]
  /** 旧 `widgetIds[]` を配置 (`widgetRefs[]`) に移したカラム数。0 でなければ書き戻す */
  migratedWidgetRefs: number
}

/**
 * Widget マイグレーション。
 * - 旧 `type: 'aiscriptConsole'` の widget 行は削除 (コードは失われる)。
 * - 旧 `widgets[]` は本体を抽出してストアに移送、カラムには配置のみ残す。
 * - 旧 `widgetIds[]` (installId だけ) は配置 `widgetRefs[]` に移す (#1202 決定 (g))。
 *   実行アカウントは widgets store の移行が後から足す
 * - 既に `widgetRefs[]` 化済みのカラムは触らない (idempotent)。
 * 削除件数と抽出した widget は呼び出し側でストアに登録するため返す。
 */
export function migrateWidgetColumns(
  columns: DeckColumn[],
): WidgetMigrationResult {
  let droppedConsoleCount = 0
  let migratedWidgetRefs = 0
  const extractedWidgets: WidgetItem[] = []
  const sidebarSeed: WidgetPlacement[] = []
  const now = Date.now()
  const migrated = columns.map((col) => {
    if (col.type !== 'widget') return col
    const legacyIds = (col as { widgetIds?: string[] }).widgetIds
    if (!col.widgets && legacyIds) {
      migratedWidgetRefs++
      const { widgetIds: _ids, ...rest } = col as DeckColumn & {
        widgetIds?: string[]
      }
      return {
        ...rest,
        widgetRefs: [
          ...(col.widgetRefs ?? []),
          ...placementsFromIds(legacyIds),
        ],
      } as DeckColumn
    }
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
        id: installId,
        name: `Widget ${installId.slice(4, 12)}`,
        content: w.data?.code ?? '',
        ...(w.data?.storeId ? { store: { id: w.data.storeId } } : {}),
        // 当時のウィジェットはどのカラムでも使えた = 全体スコープ
        scope: { kind: 'shared', global: true, installedFor: [] },
        extra: { autoRun: w.data?.autoRun ?? false },
        createdAt: now,
        updatedAt: now,
      })
    }

    const refs = placementsFromIds(newIds)
    // sidebar widget カラムの並びはストア外 sidebarPlacements に引き継ぐ
    if (col.sidebar) sidebarSeed.push(...refs)

    const { widgets: _w, ...rest } = col
    return { ...rest, widgetRefs: refs } as DeckColumn
  })
  return {
    columns: migrated,
    droppedConsoleCount,
    extractedWidgets,
    sidebarSeed,
    migratedWidgetRefs,
  }
}

/**
 * 既定の表示名を保存していたカラムを「名前なし」に戻す (#135)。
 * カラムの既定値 (buildColumnDefaults) が組込種別にも表示名を name に入れて
 * いたので、作った時点の言語の表示名が保存されていた。name があるとヘッダーは
 * name を出すので、表示言語を切り替えても変わらない。どれかの言語の既定表示名と
 * 一致する name だけを消す (利用者が付けた名前は残す)。
 */
export function clearDefaultColumnNames(columns: DeckColumn[]): DeckColumn[] {
  return columns.map((col) =>
    col.name != null && COLUMN_LABELS_BY_TYPE[col.type]?.includes(col.name)
      ? { ...col, name: null }
      : col,
  )
}

export interface ParsedProfileFile
  extends Omit<WidgetMigrationResult, 'columns'> {
  profile: DeckProfile
  /** 検索カラムの絞り込みを旧属性から移した数 (#1180)。0 でなければ書き戻す */
  migratedSearchColumns: number
}

/**
 * プロファイルファイルのパース結果をアイテム化する (#913: id はファイル内が正。
 * 欠損時の凍結は singleFileCollection が済ませてから渡す)。
 * パース済み raw オブジェクトを土台に既知フィールドを上書きする方式で、
 * 未知フィールドを保持する (createdAt の Date.now() 補完等の揮発デフォルトは
 * 通常保存経路のみに現れ、凍結・copy-adopt の書込内容には混入しない)。
 */
export function parseProfileFile(
  data: Record<string, unknown>,
  id: string,
  filename: string,
): ParsedProfileFile {
  const rawColumns = (data.columns as DeckColumn[]) || []
  const {
    columns: widgetMigrated,
    droppedConsoleCount,
    extractedWidgets,
    sidebarSeed,
    migratedWidgetRefs,
  } = migrateWidgetColumns(rawColumns)
  const { columns, migrated: migratedSearchColumns } =
    migrateSearchColumns(widgetMigrated)
  const profile = {
    ...data,
    id,
    name: (data.name as string) || filename,
    columns: clearDefaultColumnNames(columns),
    layout: (data.layout as string[][]) || [],
    createdAt: (data.createdAt as number) || Date.now(),
  } as DeckProfile
  return {
    profile,
    droppedConsoleCount,
    extractedWidgets,
    sidebarSeed,
    migratedWidgetRefs,
    migratedSearchColumns,
  }
}
