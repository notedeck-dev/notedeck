import type { ColumnType, DeckColumn } from '@/stores/deck'

/** 既定デッキ (deck.json5) の 1 行。id は実行時採番、他は registry の既定で埋める */
export type DefaultDeckColumn = {
  type: ColumnType
  accountId: string | null
} & Partial<Omit<DeckColumn, 'id' | 'type' | 'accountId'>>

/**
 * 既定デッキの行を addColumn に渡せる形 (id なし) に展開する (#1011)。
 * registry の既定 (名前・幅・defaultProps) を敷いた上に、行が持つ値を重ねる。
 */
export function expandDefaultDeckColumns(
  entries: readonly DefaultDeckColumn[],
  buildDefaults: (
    type: ColumnType,
    accountId: string | null,
  ) => Omit<DeckColumn, 'id' | 'type'>,
): Omit<DeckColumn, 'id'>[] {
  return entries.map(({ type, accountId, ...props }) => ({
    type,
    ...buildDefaults(type, accountId),
    ...props,
  }))
}

/** id を採番して 1 カラム 1 列のレイアウトを組む (初回起動のプロファイル用) */
export function buildDefaultDeck(
  columns: readonly Omit<DeckColumn, 'id'>[],
  genId: () => string,
): { columns: DeckColumn[]; layout: string[][] } {
  const withIds = columns.map((c) => ({ ...c, id: genId() }))
  return { columns: withIds, layout: withIds.map((c) => [c.id]) }
}
