/**
 * この機械の権限の状態 `state/permissions-meta.json5` (#1333 §4)。
 *
 * `permissions.json5` は方針 (`principals`、利用者が設定画面で意図して書く) で、設定
 * として持ち出す単位。「今後確認しない」(`confirmSkips`) は確認ダイアログの結果で、
 * この機械でその時に許した事実なので状態に置く。別の機械で消えても驚かない。
 *
 * `granted` は前回起動時の external / plugin の実効 granted の写し。`git pull` や
 * dotfiles マネージャの apply で `principals` が広がったことに気づけるよう、起動時に
 * 比べて広がった方向なら 1 回だけ知らせる (安い対策)。
 */

import JSON5 from 'json5'
import { stringifyJson5 } from '@/services/json5Document'
import type { PermissionKey } from './keys.generated'
import { type PermissionsFileConfig, resolvePermissions } from './schema'

/** 広がりを見張る principal (外から来るものに権限を配る側) */
export const WATCHED_PRINCIPALS = ['external', 'plugin'] as const
export type WatchedPrincipal = (typeof WATCHED_PRINCIPALS)[number]

export type GrantedSnapshot = Record<WatchedPrincipal, PermissionKey[]>

export interface PermissionsMeta {
  confirmSkips: Record<string, string[]>
  /** 前回起動時の実効 granted。初回は無い */
  granted?: GrantedSnapshot
}

/**
 * confirmSkips (#714) の読み込み時正規化: 有効な scope (`ai.chat` /
 * `plugin:<id>`) のみ保持し、capability id の重複・非文字列を落とす。
 * ai.heartbeat / external / 未知キーは (外部エディタで書かれても) 破棄 —
 * 無人実行と外部アプリの確認スキップは構造的に成立させない。
 */
export function normalizeConfirmSkips(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [scope, ids] of Object.entries(raw as Record<string, unknown>)) {
    if (scope !== 'ai.chat' && !scope.startsWith('plugin:')) continue
    if (!Array.isArray(ids)) continue
    const clean = [
      ...new Set(ids.filter((v): v is string => typeof v === 'string')),
    ]
    if (clean.length > 0) out[scope] = clean
  }
  return out
}

function normalizeSnapshot(raw: unknown): GrantedSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out = {} as GrantedSnapshot
  for (const id of WATCHED_PRINCIPALS) {
    const v = (raw as Record<string, unknown>)[id]
    out[id] = Array.isArray(v)
      ? ([
          ...new Set(v.filter((k): k is string => typeof k === 'string')),
        ].sort() as PermissionKey[])
      : []
  }
  return out
}

/** 本文 → 状態。空 (無い) / 壊れているは「記憶なし」 */
export function parsePermissionsMeta(text: string): PermissionsMeta {
  if (text.trim().length === 0) return { confirmSkips: {} }
  let raw: unknown
  try {
    raw = JSON5.parse(text)
  } catch {
    return { confirmSkips: {} }
  }
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >
  const granted = normalizeSnapshot(obj.granted)
  return {
    confirmSkips: normalizeConfirmSkips(obj.confirmSkips),
    ...(granted ? { granted } : {}),
  }
}

/** 状態 → 本文 (決定的) */
export function serializePermissionsMeta(meta: PermissionsMeta): string {
  return stringifyJson5({
    confirmSkips: meta.confirmSkips,
    ...(meta.granted ? { granted: meta.granted } : {}),
  })
}

/** 方針 → `permissions.json5` の本文 (決定的)。確認の結果は書かない */
export function serializePermissionsFile(file: PermissionsFileConfig): string {
  return stringifyJson5({
    schemaVersion: file.schemaVersion,
    principals: file.principals,
  })
}

/** external / plugin の実効 granted (キー名の昇順) */
export function grantedSnapshot(file: PermissionsFileConfig): GrantedSnapshot {
  const out = {} as GrantedSnapshot
  for (const id of WATCHED_PRINCIPALS) {
    const cfg = file.principals[id]
    const resolved = cfg
      ? resolvePermissions(cfg)
      : ({} as Record<string, boolean>)
    out[id] = (Object.keys(resolved) as PermissionKey[])
      .filter((k) => resolved[k] === true)
      .sort()
  }
  return out
}

/** 前回より広がった権限 (principal ごと)。狭まった分は見ない */
export function widenedKeys(
  prev: GrantedSnapshot,
  next: GrantedSnapshot,
): Partial<Record<WatchedPrincipal, PermissionKey[]>> {
  const out: Partial<Record<WatchedPrincipal, PermissionKey[]>> = {}
  for (const id of WATCHED_PRINCIPALS) {
    const before = new Set(prev[id] ?? [])
    const added = (next[id] ?? []).filter((k) => !before.has(k))
    if (added.length > 0) out[id] = added
  }
  return out
}

export function sameSnapshot(a: GrantedSnapshot, b: GrantedSnapshot): boolean {
  return WATCHED_PRINCIPALS.every(
    (id) => (a[id] ?? []).join(',') === (b[id] ?? []).join(','),
  )
}
