/**
 * 権限語彙とプロファイル構造 (#712)。
 *
 * PermissionKey の語彙は crates/notecore/capabilities.json5 の `permissions` 節が正本で、
 * keys.generated.ts に生成される (#1133、capability レイヤー = Single Source of Truth #408)。
 * このファイルは語彙を再公開し、プロファイル構造と解決規則を持つ。保存は principal 別の
 * `permissions.json5` (store.ts)。旧 `ai.json5` 内の 3 プロファイルは PR 1b で
 * ここへ移行した。
 */

import type { ProfiledPrincipalId } from './principal'

export type PresetKey = 'readonly' | 'safe' | 'full' | 'custom'

export const PRESET_KEYS: readonly PresetKey[] = [
  'readonly',
  'safe',
  'full',
  'custom',
]

export type { PermissionKey } from './keys.generated'
// 語彙と preset / floor / deny の集合は生成物 (正本は crates/notecore/capabilities.json5
// の permissions 節、`pnpm gen:capabilities`)。意味は以下のとおり (#712):
//
// - HIGH_RISK_PERMISSION_KEYS: UI に warning アイコンを出す。skills.write / ai.persona.write は
//   AI の指示ストリームへの書込 (§3.7)、memos.write は dataSources 自動注入との組合せで injection
//   の実効性が高い、tasks.run はユーザー定義 action の代理実行 (§3.8、endpoint は per-key 検査 #1099)
// - AI_INSTRUCTION_KEYS: AI への指示チャネル (§3.7)。第三者 principal に許可すると confused deputy
//   になるので plugin / external には保存値に関わらず恒久 deny
// - THIRD_PARTY_DENY_KEYS: 第三者 principal (plugin / external) への恒久 deny floor (§3.7 / §3.8)。
//   resolveFor が保存値に関わらず OFF に clamp する (full preset でも拒否)
// - EXTERNAL_READ_FLOOR: external の Misskey コンテンツ read 下限 (§5.3)。「トークンを発行して渡す
//   行為そのものが read への同意」。resolveFor が常時 ON に clamp する
// - LOCAL_READ_KEYS: NoteDeck ローカル私的データの read (§4.4)。external の既定はこれらを落とす
export {
  AI_INSTRUCTION_KEYS,
  EXTERNAL_READ_FLOOR,
  HIGH_RISK_PERMISSION_KEYS,
  LOCAL_READ_KEYS,
  PERMISSION_KEYS,
  PERMISSION_PRESETS,
  THIRD_PARTY_DENY_KEYS,
} from './keys.generated'

import type { PermissionKey } from './keys.generated'
import {
  LOCAL_READ_KEYS,
  PERMISSION_KEYS,
  PERMISSION_PRESETS,
} from './keys.generated'

export interface PermissionsConfig {
  preset: PresetKey
  custom: Record<PermissionKey, boolean>
}

/**
 * Resolve permission map for a config (custom returns its own custom map).
 * Used at consumption time (UI / dispatcher / system prompt builder).
 */
export function resolvePermissions(
  cfg: PermissionsConfig,
): Record<PermissionKey, boolean> {
  if (cfg.preset === 'custom') return { ...cfg.custom }
  return { ...PERMISSION_PRESETS[cfg.preset] }
}

/**
 * Switch preset. When switching to 'custom', pre-fill the custom map with
 * the previously resolved values so the user starts from where they were
 * (instead of from an empty / all-false state).
 */
export function setPermissionPreset(
  cfg: PermissionsConfig,
  next: PresetKey,
): PermissionsConfig {
  if (next === 'custom') {
    return { preset: 'custom', custom: resolvePermissions(cfg) }
  }
  return { preset: next, custom: { ...PERMISSION_PRESETS[next] } }
}

/**
 * external principal の正準縮小デフォルト (#712 §4.4)。readonly preset から
 * LOCAL_READ_KEYS を全て false にした custom。UI の chip 導出表示名
 * (「標準 — Misskey read のみ」) の比較対象になる定数。
 */
export const EXTERNAL_DEFAULT_PROFILE: PermissionsConfig = (() => {
  const custom = { ...PERMISSION_PRESETS.readonly }
  for (const key of LOCAL_READ_KEYS) custom[key] = false
  return { preset: 'custom' as const, custom }
})()

/**
 * plugin principal の正準デフォルト: safe + `network.external`。外部 API 連携
 * (天気・RSS 等) は AiScript ウィジェット / プラグインの主要ユースケースなので
 * 初期状態で `Nd:http` が permission_denied にならないようにする。無確認開放
 * ではない — http.fetch は requiresConfirmation + plugin 個体単位の
 * 「今後確認しない」(#714) で都度ゲートされる。
 */
export const PLUGIN_DEFAULT_PROFILE: PermissionsConfig = {
  preset: 'custom',
  custom: { ...PERMISSION_PRESETS.safe, 'network.external': true },
}

// --- permissions.json5 のファイル構造 ---

export const PERMISSIONS_SCHEMA_VERSION = 1

export const PROFILED_PRINCIPAL_IDS: readonly ProfiledPrincipalId[] = [
  'ai.chat',
  'ai.heartbeat',
  'plugin',
  'external',
  'scratchpad',
]

/**
 * `<config dir>/notedeck/permissions.json5` の構造。
 *
 * `principals` は Record<string, ...> として読む — 固定キー (PROFILED_PRINCIPAL_IDS) は規約で、
 * 未知キーは無視して保持する (将来の per-plugin scope `plugin:<id>` 拡張を
 * 塞がない #712 §3.6。ただし dynamic キーへの書き込みは grant のライフサイクル
 * 束縛が実装されるまで解禁しない)。
 */
export interface PermissionsFileConfig {
  schemaVersion: number
  principals: Record<string, PermissionsConfig>
  /**
   * 「今後確認しない」の記憶 (#714): scope → 確認をスキップする capability id
   * 一覧。scope は `ai.chat` か `plugin:<pluginId>` (個体単位) のみ —
   * ai.heartbeat (無人実行) と external は同意すり替え防止のため対象外。
   */
  confirmSkips: Record<string, string[]>
}

/**
 * custom map の欠損キー backfill 値 (#712 §4.4)。キーを追加するときは
 * principal ごとの backfill 値をここで宣言する。
 *
 * - `deck.read`: ai.chat / ai.heartbeat / plugin = true (現在 ungated な
 *   column 系の挙動保存)、external = false (第 5 の穴を閉じる意図した縮小)
 * - `deck.write`: ai.chat / plugin = true (従来 ungated だった column /
 *   windows 系の挙動保存)、ai.heartbeat / external = false (無人実行と外部
 *   トークンにデッキを組み替えさせない意図した縮小 #1098)
 * - その他の欠損キー: false (checkPermissions は欠損を拒否扱いするので同値)
 */
export function backfillValue(
  key: PermissionKey,
  principalId: ProfiledPrincipalId,
): boolean {
  if (key === 'deck.read') return principalId !== 'external'
  if (key === 'deck.write')
    return principalId === 'ai.chat' || principalId === 'plugin'
  return false
}

/**
 * PermissionsConfig の読み込み時正規化: preset:'custom' で保存された map の
 * 欠損キーを backfill 値で補完する。preset が custom 以外なら custom map は
 * 使われないので preset 定義で埋め直すだけ。
 *
 * 一度きりの移行専用コードではなく恒久の正規化 — 将来のキー追加でも同じ経路で
 * backfill される (#712 §4.4)。
 */
export function normalizeProfile(
  cfg: PermissionsConfig,
  principalId: ProfiledPrincipalId,
): PermissionsConfig {
  const preset: PresetKey = PRESET_KEYS.includes(cfg?.preset)
    ? cfg.preset
    : 'readonly'
  if (preset !== 'custom') {
    return { preset, custom: { ...PERMISSION_PRESETS[preset] } }
  }
  const custom = {} as Record<PermissionKey, boolean>
  for (const key of PERMISSION_KEYS) {
    const saved = cfg.custom?.[key]
    custom[key] =
      typeof saved === 'boolean' ? saved : backfillValue(key, principalId)
  }
  return { preset: 'custom', custom }
}

/**
 * granted map が既存 preset のいずれかと一致すればその preset に正規化して
 * 返す (heartbeat の AND 初期化結果の表示を「custom」にしないため #712 §4.4)。
 */
export function presetFromMap(
  map: Record<PermissionKey, boolean>,
): PermissionsConfig {
  for (const preset of ['readonly', 'safe', 'full'] as const) {
    const def = PERMISSION_PRESETS[preset]
    if (PERMISSION_KEYS.every((k) => def[k] === map[k])) {
      return { preset, custom: { ...def } }
    }
  }
  return { preset: 'custom', custom: { ...map } }
}
