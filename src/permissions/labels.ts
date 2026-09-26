/**
 * 権限 UI の表示メタデータ (#712 §8.1)。
 *
 * PermissionKey のラベル / アイコン / カテゴリ見出し / preset ピッカー選択肢 /
 * chip 導出表示名。権限ウィンドウ (PermissionsContent) と AI 設定の
 * データソースピッカーが共有する。
 */

import { i18n } from '@/i18n'
import {
  EXTERNAL_DEFAULT_PROFILE,
  PERMISSION_KEYS,
  type PermissionKey,
  type PermissionsConfig,
  PLUGIN_DEFAULT_PROFILE,
  type PresetKey,
  resolvePermissions,
} from './schema'

export interface PresetOption {
  value: PresetKey
  label: string
  icon: string
}

export const PRESET_OPTIONS: readonly PresetOption[] = [
  {
    value: 'readonly',
    get label() {
      return i18n.ts._labels.presets.readonly
    },
    icon: 'ti-eye',
  },
  {
    value: 'safe',
    get label() {
      return i18n.ts._labels.presets.safe
    },
    icon: 'ti-shield-check',
  },
  {
    value: 'full',
    get label() {
      return i18n.ts._labels.presets.full
    },
    icon: 'ti-bolt',
  },
  {
    value: 'custom',
    get label() {
      return i18n.ts._labels.presets.custom
    },
    icon: 'ti-adjustments',
  },
]

export const FALLBACK_PRESET_OPTION: PresetOption = {
  value: 'readonly',
  get label() {
    return i18n.ts._labels.presets.readonly
  },
  icon: 'ti-eye',
}

export interface PermissionLabel {
  label: string
  icon: string
}

export const PERMISSION_LABELS: Record<PermissionKey, PermissionLabel> = {
  'notes.read': {
    get label() {
      return i18n.ts._labels.permissions.notesRead
    },
    icon: 'ti-eye',
  },
  'notes.readArchive': {
    get label() {
      return i18n.ts._labels.permissions.notesReadArchive
    },
    icon: 'ti-archive',
  },
  'notes.write': {
    get label() {
      return i18n.ts._labels.permissions.notesWrite
    },
    icon: 'ti-pencil',
  },
  'notes.react': {
    get label() {
      return i18n.ts._labels.permissions.notesReact
    },
    icon: 'ti-heart',
  },
  'account.read': {
    get label() {
      return i18n.ts._labels.permissions.accountRead
    },
    icon: 'ti-user',
  },
  'account.write': {
    get label() {
      return i18n.ts._labels.permissions.accountWrite
    },
    icon: 'ti-user-plus',
  },
  'account.actAs': {
    get label() {
      return i18n.ts._labels.permissions.accountActAs
    },
    icon: 'ti-users',
  },
  'drive.read': {
    get label() {
      return i18n.ts._labels.permissions.driveRead
    },
    icon: 'ti-folder',
  },
  'drive.write': {
    get label() {
      return i18n.ts._labels.permissions.driveWrite
    },
    icon: 'ti-folder-plus',
  },
  'memos.read': {
    get label() {
      return i18n.ts._labels.permissions.memosRead
    },
    icon: 'ti-eye',
  },
  'memos.write': {
    get label() {
      return i18n.ts._labels.permissions.memosWrite
    },
    icon: 'ti-notes',
  },
  'clips.read': {
    get label() {
      return i18n.ts._labels.permissions.clipsRead
    },
    icon: 'ti-paperclip',
  },
  'clips.write': {
    get label() {
      return i18n.ts._labels.permissions.clipsWrite
    },
    icon: 'ti-paperclip',
  },
  'drafts.read': {
    get label() {
      return i18n.ts._labels.permissions.draftsRead
    },
    icon: 'ti-note',
  },
  'drafts.write': {
    get label() {
      return i18n.ts._labels.permissions.draftsWrite
    },
    icon: 'ti-edit',
  },
  'network.external': {
    get label() {
      return i18n.ts._labels.permissions.networkExternal
    },
    icon: 'ti-world',
  },
  'files.export': {
    get label() {
      return i18n.ts._labels.permissions.filesExport
    },
    icon: 'ti-download',
  },
  'backup.create': {
    get label() {
      return i18n.ts._labels.permissions.backupCreate
    },
    icon: 'ti-database-export',
  },
  clipboard: {
    get label() {
      return i18n.ts._labels.permissions.clipboard
    },
    icon: 'ti-clipboard',
  },
  notifications: {
    get label() {
      return i18n.ts._labels.permissions.notifications
    },
    icon: 'ti-bell',
  },
  'tasks.run': {
    get label() {
      return i18n.ts._labels.permissions.tasksRun
    },
    icon: 'ti-player-play',
  },
  'ai.invoke': {
    get label() {
      return i18n.ts._labels.permissions.aiInvoke
    },
    icon: 'ti-sparkles',
  },
  'ai.persona.write': {
    get label() {
      return i18n.ts._labels.permissions.aiPersonaWrite
    },
    icon: 'ti-user-circle',
  },
  'skills.read': {
    get label() {
      return i18n.ts._labels.permissions.skillsRead
    },
    icon: 'ti-book',
  },
  'skills.write': {
    get label() {
      return i18n.ts._labels.permissions.skillsWrite
    },
    icon: 'ti-edit',
  },
  'theme.write': {
    get label() {
      return i18n.ts._labels.permissions.themeWrite
    },
    icon: 'ti-palette',
  },
  'styles.write': {
    get label() {
      return i18n.ts._labels.permissions.stylesWrite
    },
    icon: 'ti-brush',
  },
  'navbar.write': {
    get label() {
      return i18n.ts._labels.permissions.navbarWrite
    },
    icon: 'ti-layout-sidebar',
  },
  'keybinds.write': {
    get label() {
      return i18n.ts._labels.permissions.keybindsWrite
    },
    icon: 'ti-keyboard',
  },
  'performance.write': {
    get label() {
      return i18n.ts._labels.permissions.performanceWrite
    },
    icon: 'ti-gauge',
  },
  'widgets.read': {
    get label() {
      return i18n.ts._labels.permissions.widgetsRead
    },
    icon: 'ti-layout-grid',
  },
  'widgets.write': {
    get label() {
      return i18n.ts._labels.permissions.widgetsWrite
    },
    icon: 'ti-code',
  },
  'plugins.read': {
    get label() {
      return i18n.ts._labels.permissions.pluginsRead
    },
    icon: 'ti-puzzle',
  },
  'queries.read': {
    get label() {
      return i18n.ts._labels.permissions.queriesRead
    },
    icon: 'ti-filter',
  },
  'queries.write': {
    get label() {
      return i18n.ts._labels.permissions.queriesWrite
    },
    icon: 'ti-arrow-back-up',
  },
  'plugins.write': {
    get label() {
      return i18n.ts._labels.permissions.pluginsWrite
    },
    icon: 'ti-puzzle',
  },
  'ai.sessions.read': {
    get label() {
      return i18n.ts._labels.permissions.aiSessionsRead
    },
    icon: 'ti-messages',
  },
  'logs.read': {
    get label() {
      return i18n.ts._labels.permissions.logsRead
    },
    icon: 'ti-bug',
  },
  'vault.use': {
    get label() {
      return i18n.ts._labels.permissions.vaultUse
    },
    icon: 'ti-plug-connected',
  },
  'deck.read': {
    get label() {
      return i18n.ts._labels.permissions.deckRead
    },
    icon: 'ti-columns',
  },
  'deck.write': {
    get label() {
      return i18n.ts._labels.permissions.deckWrite
    },
    icon: 'ti-layout-columns',
  },
}

/**
 * トグル一覧のカテゴリ見出し (#712 §8.1)。external 行で「このトークンは
 * ローカルの何を読めるのか」が 34 トグルの精査なしに一目把握できるための区分。
 */
export const PERMISSION_CATEGORIES: readonly {
  label: string
  keys: readonly PermissionKey[]
}[] = [
  {
    get label() {
      return i18n.ts._labels.categories.misskey
    },
    keys: [
      'notes.read',
      'notes.write',
      'notes.react',
      'account.read',
      'account.write',
      'account.actAs',
      'drive.read',
      'drive.write',
      'clips.read',
      'clips.write',
      'notifications',
    ],
  },
  {
    get label() {
      return i18n.ts._labels.categories.local
    },
    keys: [
      'notes.readArchive',
      'memos.read',
      'memos.write',
      'drafts.read',
      'drafts.write',
      'deck.read',
      'deck.write',
      'ai.sessions.read',
      'logs.read',
      'skills.read',
      'widgets.read',
      'plugins.read',
      'queries.read',
      'files.export',
      'backup.create',
    ],
  },
  {
    label: 'AI',
    keys: [
      'ai.invoke',
      'ai.persona.write',
      'skills.write',
      'vault.use',
      'tasks.run',
    ],
  },
  {
    get label() {
      return i18n.ts._labels.categories.uiApp
    },
    keys: [
      'theme.write',
      'styles.write',
      'navbar.write',
      'keybinds.write',
      'performance.write',
      'widgets.write',
      'plugins.write',
      'queries.write',
      'clipboard',
      'network.external',
    ],
  },
]

/**
 * preset chip の導出表示名 (#712 §8.1)。「custom」を無情報ラベルとして出さない:
 * - EXTERNAL_DEFAULT_PROFILE と一致する custom → 「標準 — Misskey read のみ」
 * - PLUGIN_DEFAULT_PROFILE と一致する custom → 「標準 — 安全 + 外部ネットワーク」
 * - その他の custom → 「カスタム — 許可 N / 総キー数」 (付与量の一目把握)
 * - preset は選択肢のラベルそのまま
 */
export function presetChipLabel(profile: PermissionsConfig): string {
  if (profile.preset !== 'custom') {
    return (
      PRESET_OPTIONS.find((p) => p.value === profile.preset)?.label ??
      FALLBACK_PRESET_OPTION.label
    )
  }
  const resolved = resolvePermissions(profile)
  const isStandardExternal = PERMISSION_KEYS.every(
    (k) => resolved[k] === EXTERNAL_DEFAULT_PROFILE.custom[k],
  )
  if (isStandardExternal) return i18n.ts._labels.standardExternal
  const isStandardPlugin = PERMISSION_KEYS.every(
    (k) => resolved[k] === PLUGIN_DEFAULT_PROFILE.custom[k],
  )
  if (isStandardPlugin) return i18n.ts._labels.standardPlugin
  const granted = PERMISSION_KEYS.filter((k) => resolved[k]).length
  return i18n.tsx._labels.customGranted({
    granted,
    total: PERMISSION_KEYS.length,
  })
}
