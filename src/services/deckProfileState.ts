/**
 * デッキプロファイルの、この機械の状態 `state/deck/<id>.json5` (#1333 §3)。
 *
 * プロファイル (`profiles/*.ndprofile.json5`) は設定として持ち出す単位。窓の配置
 * (`windows[]`) と、それと対で動かさないとポップアウトカラムが復元不能扱いになる
 * `columns[].windowId`、カラムの一時入力 (`aiCurrentSessionId` / `query` /
 * `mfmText` / `aiscriptCode` / `aiInitialInput`) は、窓を動かすたび・入力ごとに
 * 変わるこの機械の状態なので、別ファイルに分ける。`columns[].width` は別の機械で
 * 消えたら驚くレイアウトなので設定に残す。
 *
 * ファイル内に id を書き、ファイル名は id の slug (衝突時は連番)。
 */

import JSON5 from 'json5'
import type { DeckColumn, DeckProfile, DeckWindowLayout } from '@/stores/deck'
import { stringifyJson5 } from './json5Document'

/** 状態側へ出すカラムのキー */
export const COLUMN_STATE_KEYS = [
  'windowId',
  'aiCurrentSessionId',
  'query',
  'mfmText',
  'aiscriptCode',
  'aiInitialInput',
] as const satisfies readonly (keyof DeckColumn)[]

export type ColumnStateKey = (typeof COLUMN_STATE_KEYS)[number]
export type ColumnState = Pick<DeckColumn, ColumnStateKey>

export interface DeckProfileState {
  /** プロファイルの id (ファイル名ではなくこれで結ぶ) */
  id: string
  windows?: DeckWindowLayout[]
  /** カラム id → 状態。状態の無いカラムは載せない */
  columns: Record<string, ColumnState>
}

export const DECK_STATE_EXT = '.json5'

/** プロファイルを設定側と状態側に分ける。入力は変えない */
export function splitProfile(profile: DeckProfile): {
  config: DeckProfile
  state: DeckProfileState
} {
  const state: DeckProfileState = { id: profile.id, columns: {} }
  const columns = profile.columns.map((col) => {
    const rest: Record<string, unknown> = { ...col }
    const colState: Record<string, unknown> = {}
    for (const key of COLUMN_STATE_KEYS) {
      if (rest[key] !== undefined) {
        colState[key] = rest[key]
        delete rest[key]
      }
    }
    if (Object.keys(colState).length > 0) {
      state.columns[col.id] = colState as ColumnState
    }
    return rest as unknown as DeckColumn
  })
  const { windows, ...configRest } = profile
  if (windows && windows.length > 0) state.windows = windows
  return { config: { ...configRest, columns } as DeckProfile, state }
}

/** 設定側に状態側を重ねる。状態の無いカラムはそのまま */
export function mergeProfileState(
  config: DeckProfile,
  state: DeckProfileState | undefined,
): DeckProfile {
  if (!state) return config
  const columns = config.columns.map((col) => {
    const s = state.columns[col.id]
    return s ? ({ ...col, ...s } as DeckColumn) : col
  })
  const merged: DeckProfile = { ...config, columns }
  if (state.windows && state.windows.length > 0) merged.windows = state.windows
  else delete merged.windows
  return merged
}

export function isEmptyState(state: DeckProfileState): boolean {
  return (
    (!state.windows || state.windows.length === 0) &&
    Object.keys(state.columns).length === 0
  )
}

export function parseDeckProfileState(text: string): DeckProfileState | null {
  if (text.trim().length === 0) return null
  let raw: unknown
  try {
    raw = JSON5.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.id !== 'string' || obj.id.length === 0) return null
  const columns: Record<string, ColumnState> = {}
  if (obj.columns && typeof obj.columns === 'object') {
    for (const [colId, v] of Object.entries(
      obj.columns as Record<string, unknown>,
    )) {
      if (!v || typeof v !== 'object') continue
      const picked: Record<string, unknown> = {}
      for (const key of COLUMN_STATE_KEYS) {
        const value = (v as Record<string, unknown>)[key]
        if (value !== undefined) picked[key] = value
      }
      if (Object.keys(picked).length > 0) columns[colId] = picked as ColumnState
    }
  }
  const windows = Array.isArray(obj.windows)
    ? (obj.windows as DeckWindowLayout[])
    : undefined
  return {
    id: obj.id,
    ...(windows && windows.length > 0 ? { windows } : {}),
    columns,
  }
}

/** 決定的。`id` → `windows` → `columns` (カラム id の昇順) */
export function serializeDeckProfileState(state: DeckProfileState): string {
  const columns: Record<string, ColumnState> = {}
  for (const id of Object.keys(state.columns).sort()) {
    const s = state.columns[id]
    if (s) columns[id] = s
  }
  return stringifyJson5({
    id: state.id,
    ...(state.windows && state.windows.length > 0
      ? { windows: state.windows }
      : {}),
    columns,
  })
}

/** id → ファイル名の基底。ファイルシステムに安全な文字だけ残す */
export function stateFileBase(id: string): string {
  const slug = id.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return (slug.length > 0 ? slug : 'profile').slice(0, 80)
}

/**
 * id に使うファイル名を決める。既にその id のファイルがあればそれ、無ければ slug、
 * slug が別の id に取られていれば連番
 */
export function allocateStateFileName(
  id: string,
  existing: ReadonlyMap<string, string>, // filename → id
): string {
  for (const [filename, owner] of existing) {
    if (owner === id) return filename
  }
  const base = stateFileBase(id)
  let candidate = `${base}${DECK_STATE_EXT}`
  for (let n = 2; existing.has(candidate); n++) {
    candidate = `${base}-${n}${DECK_STATE_EXT}`
  }
  return candidate
}
