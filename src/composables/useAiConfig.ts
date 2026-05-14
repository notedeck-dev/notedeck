import JSON5 from 'json5'
import { type Ref, ref } from 'vue'
import type { Connection, ConnectionProtocol } from '@/bindings'
import defaultAiJson5 from '@/defaults/ai.json5?raw'
import { isTauri, readAiSettings, writeAiSettings } from '@/utils/settingsFs'
import { getStorageJson, removeStorage, STORAGE_KEYS } from '@/utils/storage'
import { commands, unwrap } from '@/utils/tauriInvoke'

// --- Type definitions ---

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
] as const
export type PermissionKey = (typeof PERMISSION_KEYS)[number]

/**
 * 高リスク権限。Phase 1 では UI に warning アイコンを出すだけ。
 * Phase 5 で確認ダイアログによる enforcement を導入する。
 */
export const HIGH_RISK_PERMISSION_KEYS: readonly PermissionKey[] = [
  'notes.write',
  'account.write',
  'drive.write',
  'network.external',
  'vault.use',
]

export const DATA_SOURCE_KEYS = [
  'currentAccount',
  'currentColumn',
  'visibleNotes',
  'recentConversation',
  'memos',
] as const
export type DataSourceKey = (typeof DATA_SOURCE_KEYS)[number]

export interface PermissionsConfig {
  preset: PresetKey
  custom: Record<PermissionKey, boolean>
}

export interface DataSourcesConfig {
  preset: PresetKey
  custom: Record<DataSourceKey, boolean>
  /**
   * memos データソースの追加詳細設定 (#492)。`custom.memos: false` で
   * 無効化された場合は本設定は無視される (= enabled は cap layer)。
   * - `excludeTags`: AI への注入から除外する tag (= 「AI に見せたくない
   *   private メモ」をユーザーが任意の tag 名で指定可能)。
   *   default `[]` (= 何も除外しない)。
   * - `expandLinks`: メモ本文の `[name](memo:<id>)` link 先メモを 1 階層
   *   AI context に展開する (#494)。default `true`。 token を抑えたい場合
   *   off にすると link 先メモは AI には見えなくなる (= AI が
   *   `memos.backlinks` を呼ぶか手動で参照する必要)。
   * - `includeBacklinks`: 各メモに `referencedBy: [memoKey, ...]` を opt-in
   *   添付して AI に渡す (#494)。default `true`。
   *
   * 値は free string (NoteDeck は enumerate しない)。skill body 等で
   * 「私のところでは hidden tag を AI に見せない」のようにユーザーが
   * 各自のポリシーを書ける。
   */
  memosConfig?: {
    excludeTags: string[]
    expandLinks?: boolean
    includeBacklinks?: boolean
  }
}

// --- Heartbeat (Phase 6, #411) ---

/** tick 間隔の最小 / 最大 / デフォルト (分単位)。 */
// 1 分まで下げると API コスト増大に注意 (= デバッグ / アクティブ監視用想定)。
export const HEARTBEAT_INTERVAL_MIN_MINUTES = 1
export const HEARTBEAT_INTERVAL_MAX_MINUTES = 24 * 60
export const HEARTBEAT_INTERVAL_DEFAULT_MINUTES = 30

/**
 * HEARTBEAT_OK 抑制で残りテキストがこの長さ以下なら全体を drop する。
 * OpenClaw の `ackMaxChars` (default 300) と揃える。
 */
export const HEARTBEAT_ACK_MAX_CHARS = 300

/** Cheap Check First (#411) のセーフティ用最小 / 最大 / デフォルト値。 */
export const HEARTBEAT_MAX_SKIP_HOURS_MIN = 1
export const HEARTBEAT_MAX_SKIP_HOURS_MAX = 24 * 7 // 1 週間
export const HEARTBEAT_MAX_SKIP_HOURS_DEFAULT = 24

export const HEARTBEAT_DAILY_MAX_AI_RUNS_MIN = 1
export const HEARTBEAT_DAILY_MAX_AI_RUNS_MAX = 1000
/**
 * 1 日あたりの AI 起動上限のデフォルト。30 分 interval で毎回 AI を
 * 叩いた場合の最大値 (48 = 24h / 0.5h)。Cheap Check で skip された tick
 * はこのカウントには含めない。
 */
export const HEARTBEAT_DAILY_MAX_AI_RUNS_DEFAULT = 48

/** 上限到達時の動作。 */
export type HeartbeatDailyLimitAction = 'warn' | 'disable'

/**
 * 出力先 AI session の routing。OpenClaw HEARTBEAT の `target` と同概念。
 * - `'auto'`: kind='heartbeat' の専用 session を auto-create + 永続使用 (default)
 * - `'none'`: session に append しない (= silent log only)
 * - 任意の文字列 (= session id): 既存 session に明示 pin
 */
export type HeartbeatTarget = 'auto' | 'none' | string

/**
 * Cheap Check First (#411) — tick 開始時に「変化検知」専用の軽量 capability
 * (= cheap=true マーク済み) を呼び、前回値と一致すれば AI 起動を skip して
 * HEARTBEAT_OK 扱いにする機構。
 *
 * Skill 側で `cheapCheckCapabilities: string[]` を frontmatter で宣言した
 * skill にだけ発動する (= opt-in)。宣言なしの skill は従来通り毎回 AI を
 * 叩く。さらに global で `enabled: false` にすれば全 skill で機構を完全停止。
 */
export interface CheapCheckConfig {
  /** false で機構自体を停止 (= 全 skill で常に AI を叩く)。default: true */
  enabled: boolean
  /**
   * 「変化なし」と判定し続けた場合でも、N 時間に 1 回は強制 AI 起動する
   * セーフティ。cheap check が壊れていても定期的に AI が動くことを保証。
   * default: 24 時間 (= 1 日 1 回は最低でも AI 起動)。
   */
  maxSkipHours: number
}

export interface HeartbeatConfig {
  /** false なら daemon は何もしない (default) */
  enabled: boolean
  /** tick 間隔 (分)。MIN <= x <= MAX に clamp */
  intervalMinutes: number
  /**
   * Tick 結果の出力先 AI session。詳細は {@link HeartbeatTarget}。
   * default: `'auto'` (= 専用 Heartbeat session を自動管理)
   */
  target: HeartbeatTarget
  /**
   * HEARTBEAT 中の AI に許可する権限。チャットセッションの権限
   * (`AiConfig.permissions`) とは独立に管理し、AI が暴走しないよう
   * default は `readonly` preset (write 系 / external network 全部 deny)。
   *
   * runner 側で `resolvePermissions()` してから capability の
   * `permissions[]` (required) と照合し、満たさないものを tool 一覧から除外。
   */
  permissions: PermissionsConfig
  /** Cheap Check First の global 設定。詳細は {@link CheapCheckConfig}。 */
  cheapCheck: CheapCheckConfig
  /**
   * 1 日あたりの AI 起動上限。Cheap Check で skip された tick は除外。
   * default: 48 (= 30 分 interval で毎回叩いた場合の最大値)。
   */
  dailyMaxAiRuns: number
  /**
   * 上限到達時の動作:
   * - `'warn'`: toast 出して **継続** (= AI を呼んで進める)
   * - `'disable'`: toast + `heartbeat.enabled = false` で daemon 自動停止
   */
  onDailyLimit: HeartbeatDailyLimitAction
  /**
   * HEARTBEAT が「重要発見」と判定した内容 (= suppression を通過したテキスト) を
   * OS デスクトップ通知として表示するか。
   *
   * - target='none' のとき (= silent log) は通知も出さない
   * - アプリにフォーカスがあるとき (`document.hasFocus()`) は通知抑制
   *   (sendDesktopNotification 内で判定)
   * - default: true (= 重要発見があれば即気付ける = HEARTBEAT 本来の意義)
   */
  desktopNotification: boolean
}

/**
 * どの skill を heartbeat 対象として実行するかは `SkillMeta.heartbeat` に記録
 * される (= skill 側の責務、ai.json5 では持たない)。MisStore 配布側で
 * frontmatter に `heartbeat: true` を含めて配布できる + ユーザーは
 * スキルカラムから個別に on/off できる。
 */

export interface AiConfig {
  /**
   * 使用する Vault 接続の id (#564)。AI プロバイダーの endpoint / API キー /
   * protocol はこの接続から解決する。空文字 = 未選択 (AI 設定で要選択)。
   */
  activeConnectionId: string
  /**
   * 接続ごとのモデル名。`{ [connectionId]: model }`。Connection 自体は
   * endpoint + secret + protocol のみを持ち、モデル選択は AI 設定の関心。
   */
  models: Record<string, string>
  permissions: PermissionsConfig
  dataSources: DataSourcesConfig
  heartbeat: HeartbeatConfig
  /**
   * このアプリで AI が振る舞う persona (#491)。skill で `isPersona: true`
   * を設定したものから 1 つ選択する。空文字 / 未指定 = 通常の汎用 AI として
   * 動作 (chat / heartbeat / command / task すべて persona なし)。
   *
   * persona は session ごとに切り替えるものではなく、「この AI は誰か」と
   * いう同一性設定として扱う (= AI 設定全体の一部)。
   */
  personaSkillId?: string
}

/**
 * AI 設定から解決した「使用する接続 + モデル + protocol」。
 * チャット送信 / ツール整形に必要な情報をまとめたもの。
 */
export interface ResolvedAiConnection {
  connection: Connection
  model: string
  protocol: ConnectionProtocol
}

/**
 * `activeConnectionId` から実際の接続を解決する。接続が存在しない /
 * protocol 未設定 (= AI プロバイダーでない) 場合は `null`。
 */
export function resolveAiConnection(
  cfg: AiConfig,
  connections: readonly Connection[],
): ResolvedAiConnection | null {
  const connection = connections.find((c) => c.id === cfg.activeConnectionId)
  if (!connection || !connection.protocol) return null
  return {
    connection,
    model: cfg.models[connection.id] ?? '',
    protocol: connection.protocol,
  }
}

// --- Preset definitions ---

type ResolvedPreset = Exclude<PresetKey, 'custom'>

const PERMISSION_PRESETS: Record<
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
  },
}

const DATA_SOURCE_PRESETS: Record<
  ResolvedPreset,
  Record<DataSourceKey, boolean>
> = {
  readonly: {
    currentAccount: true,
    currentColumn: true,
    visibleNotes: false,
    recentConversation: false,
    memos: true,
  },
  safe: {
    currentAccount: true,
    currentColumn: true,
    visibleNotes: true,
    recentConversation: true,
    memos: true,
  },
  full: {
    currentAccount: true,
    currentColumn: true,
    visibleNotes: true,
    recentConversation: true,
    memos: true,
  },
}

/**
 * Resolve permission map for a config (custom returns its own custom map).
 * Used at consumption time (UI / system prompt builder).
 */
export function resolvePermissions(
  cfg: PermissionsConfig,
): Record<PermissionKey, boolean> {
  if (cfg.preset === 'custom') return { ...cfg.custom }
  return { ...PERMISSION_PRESETS[cfg.preset] }
}

export function resolveDataSources(
  cfg: DataSourcesConfig,
): Record<DataSourceKey, boolean> {
  if (cfg.preset === 'custom') return { ...cfg.custom }
  return { ...DATA_SOURCE_PRESETS[cfg.preset] }
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

export function setDataSourcePreset(
  cfg: DataSourcesConfig,
  next: PresetKey,
): DataSourcesConfig {
  if (next === 'custom') {
    return { preset: 'custom', custom: resolveDataSources(cfg) }
  }
  return { preset: next, custom: { ...DATA_SOURCE_PRESETS[next] } }
}

// --- Defaults (loaded from src/defaults/ai.json5) ---

const defaultFileConfig: AiConfig = JSON5.parse(defaultAiJson5)

export function defaultConfig(): AiConfig {
  return {
    activeConnectionId: defaultFileConfig.activeConnectionId ?? '',
    models: { ...(defaultFileConfig.models ?? {}) },
    permissions: {
      preset: defaultFileConfig.permissions.preset,
      custom: { ...defaultFileConfig.permissions.custom },
    },
    dataSources: {
      preset: defaultFileConfig.dataSources.preset,
      custom: { ...defaultFileConfig.dataSources.custom },
    },
    heartbeat: {
      enabled: defaultFileConfig.heartbeat.enabled,
      intervalMinutes: defaultFileConfig.heartbeat.intervalMinutes,
      target: defaultFileConfig.heartbeat.target,
      permissions: {
        preset: defaultFileConfig.heartbeat.permissions.preset,
        custom: { ...defaultFileConfig.heartbeat.permissions.custom },
      },
      cheapCheck: {
        enabled: defaultFileConfig.heartbeat.cheapCheck.enabled,
        maxSkipHours: defaultFileConfig.heartbeat.cheapCheck.maxSkipHours,
      },
      dailyMaxAiRuns: defaultFileConfig.heartbeat.dailyMaxAiRuns,
      onDailyLimit: defaultFileConfig.heartbeat.onDailyLimit,
      desktopNotification: defaultFileConfig.heartbeat.desktopNotification,
    },
  }
}

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : NaN
  if (Number.isNaN(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

/**
 * 設定値の sanity 補正。
 * - intervalMinutes / cheapCheck.maxSkipHours / dailyMaxAiRuns を MIN〜MAX に clamp
 * - target は文字列なら何でも受け取る (空 / null は 'auto' にフォールバック)
 * - onDailyLimit は 'warn' / 'disable' 以外なら 'warn' にフォールバック
 */
export function normalizeHeartbeatConfig(
  cfg: HeartbeatConfig,
): HeartbeatConfig {
  const interval = clampInt(
    cfg.intervalMinutes,
    HEARTBEAT_INTERVAL_MIN_MINUTES,
    HEARTBEAT_INTERVAL_MAX_MINUTES,
    HEARTBEAT_INTERVAL_DEFAULT_MINUTES,
  )
  const target: HeartbeatTarget =
    typeof cfg.target === 'string' && cfg.target.length > 0
      ? cfg.target
      : 'auto'
  const cheapCheck: CheapCheckConfig = {
    enabled: cfg.cheapCheck?.enabled !== false, // default true
    maxSkipHours: clampInt(
      cfg.cheapCheck?.maxSkipHours,
      HEARTBEAT_MAX_SKIP_HOURS_MIN,
      HEARTBEAT_MAX_SKIP_HOURS_MAX,
      HEARTBEAT_MAX_SKIP_HOURS_DEFAULT,
    ),
  }
  const dailyMaxAiRuns = clampInt(
    cfg.dailyMaxAiRuns,
    HEARTBEAT_DAILY_MAX_AI_RUNS_MIN,
    HEARTBEAT_DAILY_MAX_AI_RUNS_MAX,
    HEARTBEAT_DAILY_MAX_AI_RUNS_DEFAULT,
  )
  const onDailyLimit: HeartbeatDailyLimitAction =
    cfg.onDailyLimit === 'disable' ? 'disable' : 'warn'
  return {
    enabled: !!cfg.enabled,
    intervalMinutes: interval,
    target,
    permissions: cfg.permissions,
    cheapCheck,
    dailyMaxAiRuns,
    onDailyLimit,
    desktopNotification: cfg.desktopNotification !== false, // default true
  }
}

// --- Merge ---

function mergePermissions(
  base: PermissionsConfig,
  partial: Partial<PermissionsConfig> | undefined,
): PermissionsConfig {
  return {
    preset: partial?.preset ?? base.preset,
    custom: { ...base.custom, ...(partial?.custom ?? {}) },
  }
}

function mergeDataSources(
  base: DataSourcesConfig,
  partial: Partial<DataSourcesConfig> | undefined,
): DataSourcesConfig {
  return {
    preset: partial?.preset ?? base.preset,
    custom: { ...base.custom, ...(partial?.custom ?? {}) },
  }
}

function mergeHeartbeat(
  base: HeartbeatConfig,
  partial: Partial<HeartbeatConfig> | undefined,
): HeartbeatConfig {
  return normalizeHeartbeatConfig({
    enabled: partial?.enabled ?? base.enabled,
    intervalMinutes: partial?.intervalMinutes ?? base.intervalMinutes,
    target: partial?.target ?? base.target,
    permissions: mergePermissions(base.permissions, partial?.permissions),
    cheapCheck: {
      enabled: partial?.cheapCheck?.enabled ?? base.cheapCheck.enabled,
      maxSkipHours:
        partial?.cheapCheck?.maxSkipHours ?? base.cheapCheck.maxSkipHours,
    },
    dailyMaxAiRuns: partial?.dailyMaxAiRuns ?? base.dailyMaxAiRuns,
    onDailyLimit: partial?.onDailyLimit ?? base.onDailyLimit,
    desktopNotification:
      partial?.desktopNotification ?? base.desktopNotification,
  })
}

/** Deep-merge partial config into defaults. */
function mergeConfig(base: AiConfig, partial: Partial<AiConfig>): AiConfig {
  const result = { ...base, ...partial }
  result.activeConnectionId =
    partial.activeConnectionId ?? base.activeConnectionId
  result.models = { ...base.models, ...(partial.models ?? {}) }
  result.permissions = mergePermissions(base.permissions, partial.permissions)
  result.dataSources = mergeDataSources(base.dataSources, partial.dataSources)
  result.heartbeat = mergeHeartbeat(base.heartbeat, partial.heartbeat)
  return result
}

// --- Migration: legacy ai.<provider> keychain → Vault connections (#564) ---
//
// 旧来 AI API キーは OS キーチェーンに `ai.<provider>` で格納し、ai.json5 に
// provider / endpoint / model を持っていた。#564 後続でこれを Vault 接続に
// 統合する: 起動時に `ai.<provider>` を検出し、Vault 接続 (origin=external,
// externalSource=ai-provider) へ移し替え、ai.json5 は activeConnectionId +
// models だけを持つ形に移行する。

/** 旧 ai.json5 が持っていた provider 系フィールド (移行読込専用)。 */
interface LegacyAiProviderFields {
  provider?: 'anthropic' | 'openai' | 'custom'
  anthropic?: { endpoint?: string; model?: string }
  openai?: { endpoint?: string; model?: string }
  custom?: { endpoint?: string; model?: string }
}

/** 旧 localStorage AI 設定 (さらに前の世代)。 */
interface LegacyLocalStorageAiConfig {
  anthropic?: { apiKey?: string }
  openai?: { apiKey?: string }
  custom?: { apiKey?: string }
}

/**
 * さらに前の世代の localStorage AI 設定を消す。localStorage には API キーを
 * 平文で持っていた時期があった (現在は keychain → Vault)。値の移行はもう
 * 行わず、残骸を削除するだけ。
 */
function dropLegacyLocalStorageAiConfig(): void {
  const legacy = getStorageJson<LegacyLocalStorageAiConfig | null>(
    STORAGE_KEYS.aiSettings,
    null,
  )
  if (legacy) removeStorage(STORAGE_KEYS.aiSettings)
}

const LEGACY_PROVIDER_META: Record<
  'anthropic' | 'openai' | 'custom',
  { name: string; protocol: ConnectionProtocol; fallbackBaseUrl: string }
> = {
  anthropic: {
    name: 'Anthropic',
    protocol: 'anthropic',
    fallbackBaseUrl: 'https://api.anthropic.com',
  },
  openai: {
    name: 'OpenAI',
    protocol: 'openai-compat',
    fallbackBaseUrl: 'https://api.openai.com/v1',
  },
  custom: {
    name: 'Custom (OpenAI 互換)',
    protocol: 'openai-compat',
    fallbackBaseUrl: '',
  },
}

/**
 * 旧 `ai.<provider>` キーチェーンエントリーを Vault 接続へ移行する。
 *
 * 移行できた接続について `models[connId]` と `activeConnectionId` を埋めて
 * 返す。移行対象が無ければ `null`。Rust 側 `ai_migrate_provider_to_vault` が
 * キーチェーンエントリー不在なら `null` を返すため、キー未設定の provider は
 * 自然にスキップされる。
 */
async function migrateProvidersToVault(
  legacy: LegacyAiProviderFields,
): Promise<{ activeConnectionId: string; models: Record<string, string> }> {
  const models: Record<string, string> = {}
  let activeConnectionId = ''

  for (const key of ['anthropic', 'openai', 'custom'] as const) {
    const meta = LEGACY_PROVIDER_META[key]
    const settings = legacy[key]
    const baseUrl = settings?.endpoint?.trim() || meta.fallbackBaseUrl
    if (!baseUrl) continue // custom で endpoint 未設定なら移行しようがない
    try {
      const migrated = unwrap(
        await commands.aiMigrateProviderToVault(
          key,
          meta.name,
          baseUrl,
          meta.protocol,
        ),
      )
      if (!migrated) continue // キーチェーンに該当エントリー無し
      models[migrated.id] = settings?.model?.trim() ?? ''
      if (legacy.provider === key) activeConnectionId = migrated.id
    } catch (e) {
      console.warn(`[ai-settings] vault migration failed for ${key}:`, e)
    }
  }

  return { activeConnectionId, models }
}

// --- Exposed for tests ---

export const _internal = {
  mergeConfig,
  PERMISSION_PRESETS,
  DATA_SOURCE_PRESETS,
}

// --- Composable (singleton) ---
//
// 全コンポーネントで **同じ** config ref を共有する。pinia store にするほど
// ではないが、composable インスタンスごとに ref を作ると AI 設定 UI で
// permission を変えても DeckAiColumn 側の ref に反映されないバグになる
// (= 再起動しないと反映されない)。モジュールスコープで singleton 化する。

const _config: Ref<AiConfig> = ref(defaultConfig())
const _initialized: Ref<boolean> = ref(false)
let _initStarted = false

async function _initFileStorage(): Promise<void> {
  dropLegacyLocalStorageAiConfig()
  const aiContent = await readAiSettings()
  if (aiContent) {
    try {
      const parsed = JSON5.parse(aiContent) as Partial<AiConfig> &
        LegacyAiProviderFields
      _config.value = mergeConfig(defaultConfig(), parsed)
      // 旧 provider 系フィールドが残っていれば Vault 接続へ一度だけ移行する。
      const hasLegacyFields =
        'provider' in parsed ||
        'anthropic' in parsed ||
        'openai' in parsed ||
        'custom' in parsed
      if (hasLegacyFields) {
        const { activeConnectionId, models } =
          await migrateProvidersToVault(parsed)
        _config.value = {
          ..._config.value,
          activeConnectionId:
            _config.value.activeConnectionId || activeConnectionId,
          models: { ...models, ..._config.value.models },
        }
        // 移行後の形 (provider 系フィールドを含まない) で書き戻し、
        // 次回起動以降は移行をスキップする。
        try {
          await writeAiSettings(`${JSON5.stringify(_config.value, null, 2)}\n`)
        } catch (e) {
          console.warn('[ai-settings] failed to persist migrated config:', e)
        }
      }
    } catch (e) {
      console.warn('[ai-settings] failed to parse ai.json5:', e)
      _config.value = defaultConfig()
    }
  } else {
    _config.value = defaultConfig()
  }
  _initialized.value = true
}

/**
 * ai.json5 を再読込して singleton config に反映する。外部エディタで
 * 設定ファイルを変更した場合に、AI tool 呼出し直前に呼ぶと最新が反映される。
 */
export async function reloadAiConfig(): Promise<void> {
  await _initFileStorage()
}

export function useAiConfig() {
  if (!_initStarted) {
    _initStarted = true
    if (isTauri) {
      _initFileStorage()
    }
  }

  function save(): void {
    writeAiSettings(`${JSON5.stringify(_config.value, null, 2)}\n`).catch((e) =>
      console.warn('[ai-settings] failed to write ai.json5:', e),
    )
  }

  return {
    config: _config,
    save,
    mergeConfig,
    initialized: _initialized,
  }
}

/** @internal テスト用。state を初期化する。 */
export function _resetAiConfigForTest(): void {
  _config.value = defaultConfig()
  _initialized.value = false
  _initStarted = false
}
