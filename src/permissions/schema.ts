/**
 * 権限語彙とプロファイル構造 (#712)。
 *
 * PermissionKey の語彙は capability の `permissions[]` 宣言が定義する
 * (capability レイヤー = Single Source of Truth #408)。保存は principal 別の
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

export const PERMISSION_KEYS = [
  'notes.read',
  'notes.write',
  'notes.react',
  'account.read',
  'account.write',
  'drive.read',
  'drive.write',
  'memos.read',
  'memos.write',
  'clips.read',
  'clips.write',
  'drafts.read',
  'drafts.write',
  'network.external',
  'clipboard',
  'notifications',
  'tasks.run',
  'ai.invoke',
  'ai.persona.write',
  'skills.read',
  'skills.write',
  'theme.write',
  'styles.write',
  'navbar.write',
  'keybinds.write',
  'performance.write',
  'widgets.read',
  'widgets.write',
  'plugins.read',
  'plugins.write',
  'ai.sessions.read',
  'logs.read',
  'vault.use',
  // デッキ構成 (カラム一覧 = 検索クエリ / アンテナ名 / アカウント紐付け等の
  // ローカル私的データ) の read (#712 §5.3 の第 5 の穴)。全 preset で true —
  // column 系 capability は従来 ungated (permissions: []) だったので、既存
  // principal の挙動は変わらない。external のみデフォルト OFF (backfill 規則)。
  'deck.read',
] as const
export type PermissionKey = (typeof PERMISSION_KEYS)[number]

/**
 * 高リスク権限。UI に warning アイコンを出す。
 *
 * skills.write / ai.persona.write は AI の指示ストリームへの書込 (#712 §3.7)、
 * memos.write は dataSources 自動注入との組合せで injection の実効性が高い
 * データ書込、tasks.run は任意 method の raw API 代理実行 (#712 §3.8)。
 */
export const HIGH_RISK_PERMISSION_KEYS: readonly PermissionKey[] = [
  'notes.write',
  'account.write',
  'drive.write',
  'network.external',
  'vault.use',
  'skills.write',
  'ai.persona.write',
  'memos.write',
  'tasks.run',
]

/**
 * AI への指示チャネル (#712 §3.7)。skill / persona 本文は ai.chat /
 * ai.heartbeat の system prompt に注入されるため、第三者 principal に許可する
 * ことは「AI の実効能力を第三者が操縦できる」cross-principal grant になる
 * (confused deputy)。plugin / external には保存値に関わらず恒久 deny。
 */
export const AI_INSTRUCTION_KEYS: readonly PermissionKey[] = [
  'skills.write',
  'ai.persona.write',
]

/**
 * 第三者 principal (plugin / external) への恒久 deny floor (#712 §3.7 / §3.8)。
 * resolveFor が保存値に関わらず OFF に clamp する — full preset でも拒否
 * (「同意しても成立させない」構造的禁止)。
 *
 * tasks.run はユーザー定義 action を任意 method・アカウント権限のまま代理実行
 * する per-key gate の迂回路 — task の起動同意は本人と AI class までに留める。
 */
export const THIRD_PARTY_DENY_KEYS: readonly PermissionKey[] = [
  ...AI_INSTRUCTION_KEYS,
  'tasks.run',
]

/**
 * external principal の Misskey コンテンツ read 下限 (#712 §5.3)。
 * 「HTTP API トークンを発行して渡す行為そのものが Misskey コンテンツ read への
 * 同意」という共有プロファイル時代の暫定規則 — resolveFor が常時 ON に clamp
 * する。read まで遮断したい場合の正しい操作はトークンの失効。per-token scope
 * (将来) には持ち込まない。
 */
export const EXTERNAL_READ_FLOOR: readonly PermissionKey[] = [
  'notes.read',
  'account.read',
  'drive.read',
  'clips.read',
]

export interface PermissionsConfig {
  preset: PresetKey
  custom: Record<PermissionKey, boolean>
}

type ResolvedPreset = Exclude<PresetKey, 'custom'>

export const PERMISSION_PRESETS: Record<
  ResolvedPreset,
  Record<PermissionKey, boolean>
> = {
  readonly: {
    'notes.read': true,
    'notes.write': false,
    'notes.react': false,
    'account.read': true,
    'account.write': false,
    'drive.read': true,
    'drive.write': false,
    'memos.read': true,
    'memos.write': false,
    'clips.read': true,
    'clips.write': false,
    'drafts.read': true,
    'drafts.write': false,
    'network.external': false,
    clipboard: false,
    notifications: false,
    'tasks.run': false,
    'ai.invoke': false,
    'ai.persona.write': false,
    'skills.read': true,
    'skills.write': false,
    'theme.write': false,
    'styles.write': false,
    'navbar.write': false,
    'keybinds.write': false,
    'performance.write': false,
    'widgets.read': true,
    'widgets.write': false,
    'plugins.read': true,
    'plugins.write': false,
    'ai.sessions.read': true,
    'logs.read': true,
    'vault.use': false,
    'deck.read': true,
  },
  safe: {
    'notes.read': true,
    'notes.write': false,
    'notes.react': true,
    'account.read': true,
    'account.write': false,
    'drive.read': true,
    'drive.write': false,
    'memos.read': true,
    'memos.write': true,
    'clips.read': true,
    'clips.write': true,
    'drafts.read': true,
    'drafts.write': true,
    'network.external': false,
    clipboard: true,
    notifications: true,
    'tasks.run': true,
    'ai.invoke': true,
    'ai.persona.write': false,
    'skills.read': true,
    'skills.write': true,
    'theme.write': false,
    'styles.write': false,
    'navbar.write': false,
    'keybinds.write': false,
    'performance.write': false,
    'widgets.read': true,
    'widgets.write': true,
    'plugins.read': true,
    'plugins.write': true,
    'ai.sessions.read': true,
    'logs.read': true,
    'vault.use': false,
    'deck.read': true,
  },
  full: {
    'notes.read': true,
    'notes.write': true,
    'notes.react': true,
    'account.read': true,
    'account.write': true,
    'drive.read': true,
    'drive.write': true,
    'memos.read': true,
    'memos.write': true,
    'clips.read': true,
    'clips.write': true,
    'drafts.read': true,
    'drafts.write': true,
    'network.external': true,
    clipboard: true,
    notifications: true,
    'tasks.run': true,
    'ai.invoke': true,
    'ai.persona.write': true,
    'skills.read': true,
    'skills.write': true,
    'theme.write': true,
    'styles.write': true,
    'navbar.write': true,
    'keybinds.write': true,
    'performance.write': true,
    'widgets.read': true,
    'widgets.write': true,
    'plugins.read': true,
    'plugins.write': true,
    'ai.sessions.read': true,
    'logs.read': true,
    'vault.use': true,
    'deck.read': true,
  },
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
 * NoteDeck ローカル私的データの read キー (#712 §4.4)。external のデフォルトは
 * これらを落とした縮小 custom — 「トークン発行 = Misskey read の同意」であって
 * PKM メモ全文・未投稿下書き・AI 会話履歴の read への同意ではない。
 */
export const LOCAL_READ_KEYS: readonly PermissionKey[] = [
  'memos.read',
  'drafts.read',
  'skills.read',
  'widgets.read',
  'plugins.read',
  'ai.sessions.read',
  'logs.read',
  'deck.read',
]

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

// --- permissions.json5 のファイル構造 ---

export const PERMISSIONS_SCHEMA_VERSION = 1

export const PROFILED_PRINCIPAL_IDS: readonly ProfiledPrincipalId[] = [
  'ai.chat',
  'ai.heartbeat',
  'plugin',
  'external',
]

/**
 * `<config dir>/notedeck/permissions.json5` の構造。
 *
 * `principals` は Record<string, ...> として読む — 固定 4 キーは規約で、
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
 * - その他の欠損キー: false (checkPermissions は欠損を拒否扱いするので同値)
 */
export function backfillValue(
  key: PermissionKey,
  principalId: ProfiledPrincipalId,
): boolean {
  if (key === 'deck.read') return principalId !== 'external'
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
