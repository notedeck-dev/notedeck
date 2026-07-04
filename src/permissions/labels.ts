/**
 * 権限 UI の表示メタデータ (#712 §8.1)。
 *
 * PermissionKey のラベル / アイコン / カテゴリ見出し / preset ピッカー選択肢 /
 * chip 導出表示名。権限ウィンドウ (PermissionsContent) と AI 設定の
 * データソースピッカーが共有する。
 */

import {
  EXTERNAL_DEFAULT_PROFILE,
  PERMISSION_KEYS,
  type PermissionKey,
  type PermissionsConfig,
  type PresetKey,
  resolvePermissions,
} from './schema'

export interface PresetOption {
  value: PresetKey
  label: string
  icon: string
}

export const PRESET_OPTIONS: readonly PresetOption[] = [
  { value: 'readonly', label: '読取のみ (デフォルト)', icon: 'ti-eye' },
  { value: 'safe', label: '安全 (リアクション可)', icon: 'ti-shield-check' },
  { value: 'full', label: 'フル (全許可)', icon: 'ti-bolt' },
  { value: 'custom', label: 'カスタム', icon: 'ti-adjustments' },
]

export const FALLBACK_PRESET_OPTION: PresetOption = {
  value: 'readonly',
  label: '読取のみ (デフォルト)',
  icon: 'ti-eye',
}

export interface PermissionLabel {
  label: string
  icon: string
}

export const PERMISSION_LABELS: Record<PermissionKey, PermissionLabel> = {
  'notes.read': { label: 'ノートの読取', icon: 'ti-eye' },
  'notes.write': { label: 'ノートの投稿/編集/削除', icon: 'ti-pencil' },
  'notes.react': { label: 'リアクション/お気に入り', icon: 'ti-heart' },
  'account.read': { label: 'アカウント情報の読取', icon: 'ti-user' },
  'account.write': {
    label: 'フォロー/ブロック/ミュート',
    icon: 'ti-user-plus',
  },
  'drive.read': { label: 'ドライブの読取', icon: 'ti-folder' },
  'drive.write': { label: 'ドライブの書込/削除', icon: 'ti-folder-plus' },
  'memos.read': { label: 'ローカルメモの読取/検索', icon: 'ti-eye' },
  'memos.write': { label: 'ローカルメモの作成/編集/削除', icon: 'ti-notes' },
  'clips.read': { label: 'クリップの読取', icon: 'ti-paperclip' },
  'clips.write': {
    label: 'クリップの作成/ノート追加・削除',
    icon: 'ti-paperclip',
  },
  'drafts.read': { label: '下書きの読取', icon: 'ti-note' },
  'drafts.write': { label: '下書きの作成/編集/削除', icon: 'ti-edit' },
  'network.external': { label: '外部ネットワークアクセス', icon: 'ti-world' },
  clipboard: { label: 'クリップボード', icon: 'ti-clipboard' },
  notifications: { label: 'デスクトップ通知', icon: 'ti-bell' },
  'tasks.run': {
    label: 'ユーザー定義タスクの実行',
    icon: 'ti-player-play',
  },
  'ai.invoke': {
    label: 'AI 呼び出し (プラグイン / 外部経路から)',
    icon: 'ti-sparkles',
  },
  'ai.persona.write': {
    label: 'AI persona の切替',
    icon: 'ti-user-circle',
  },
  'skills.read': {
    label: 'スキルの読取',
    icon: 'ti-book',
  },
  'skills.write': {
    label: 'スキルの追記/編集',
    icon: 'ti-edit',
  },
  'theme.write': {
    label: 'テーマの作成/編集',
    icon: 'ti-palette',
  },
  'styles.write': {
    label: 'カスタム CSS の編集',
    icon: 'ti-brush',
  },
  'navbar.write': {
    label: 'ナビバー構成の編集',
    icon: 'ti-layout-sidebar',
  },
  'keybinds.write': {
    label: 'キーバインドの編集',
    icon: 'ti-keyboard',
  },
  'performance.write': {
    label: 'パフォーマンス設定の編集',
    icon: 'ti-gauge',
  },
  'widgets.read': {
    label: 'ウィジェットの読取',
    icon: 'ti-layout-grid',
  },
  'widgets.write': {
    label: 'ウィジェットの作成/編集 (AiScript)',
    icon: 'ti-code',
  },
  'plugins.read': {
    label: 'プラグインの読取',
    icon: 'ti-puzzle',
  },
  'plugins.write': {
    label: 'プラグインの作成/編集 (AiScript) — AI 直接呼出しは不可',
    icon: 'ti-puzzle',
  },
  'ai.sessions.read': {
    label: 'AI セッション履歴の読取',
    icon: 'ti-messages',
  },
  'logs.read': {
    label: 'アプリログの読取 (warn/error)',
    icon: 'ti-bug',
  },
  'vault.use': {
    label: '外部サービス接続の利用 (Secret Vault)',
    icon: 'ti-plug-connected',
  },
  'deck.read': {
    label: 'デッキ構成の読取 (カラム一覧 / 検索クエリ等)',
    icon: 'ti-columns',
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
    label: 'Misskey (サーバー側)',
    keys: [
      'notes.read',
      'notes.write',
      'notes.react',
      'account.read',
      'account.write',
      'drive.read',
      'drive.write',
      'clips.read',
      'clips.write',
      'notifications',
    ],
  },
  {
    label: 'ローカルデータ',
    keys: [
      'memos.read',
      'memos.write',
      'drafts.read',
      'drafts.write',
      'deck.read',
      'ai.sessions.read',
      'logs.read',
      'skills.read',
      'widgets.read',
      'plugins.read',
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
    label: 'UI / アプリ',
    keys: [
      'theme.write',
      'styles.write',
      'navbar.write',
      'keybinds.write',
      'performance.write',
      'widgets.write',
      'plugins.write',
      'clipboard',
      'network.external',
    ],
  },
]

/**
 * preset chip の導出表示名 (#712 §8.1)。「custom」を無情報ラベルとして出さない:
 * - EXTERNAL_DEFAULT_PROFILE と一致する custom → 「標準 — Misskey read のみ」
 * - その他の custom → 「カスタム — 許可 N / 34」 (付与量の一目把握)
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
  if (isStandardExternal) return '標準 — Misskey read のみ'
  const granted = PERMISSION_KEYS.filter((k) => resolved[k]).length
  return `カスタム — 許可 ${granted} / ${PERMISSION_KEYS.length}`
}
