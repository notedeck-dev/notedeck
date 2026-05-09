<script setup lang="ts">
import { json } from '@codemirror/lang-json'
import { type Diagnostic, linter } from '@codemirror/lint'
import JSON5 from 'json5'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import EditorTabs from '@/components/common/EditorTabs.vue'
import CodeEditor from '@/components/deck/widgets/CodeEditor.vue'
import {
  type AiConfig,
  DATA_SOURCE_KEYS,
  type DataSourceKey,
  defaultConfig,
  deleteApiKey,
  getApiKeyStatus,
  HEARTBEAT_DAILY_MAX_AI_RUNS_MAX,
  HEARTBEAT_DAILY_MAX_AI_RUNS_MIN,
  HEARTBEAT_INTERVAL_DEFAULT_MINUTES,
  HEARTBEAT_INTERVAL_MAX_MINUTES,
  HEARTBEAT_INTERVAL_MIN_MINUTES,
  HEARTBEAT_MAX_SKIP_HOURS_MAX,
  HEARTBEAT_MAX_SKIP_HOURS_MIN,
  HIGH_RISK_PERMISSION_KEYS,
  PERMISSION_KEYS,
  type PermissionKey,
  PROVIDER_KEYS,
  type PresetKey,
  type ProviderKey,
  type ProviderSettings,
  resolveDataSources,
  resolvePermissions,
  setApiKey,
  setDataSourcePreset,
  setPermissionPreset,
  useAiConfig,
} from '@/composables/useAiConfig'
import { useClickOutside } from '@/composables/useClickOutside'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useDoubleConfirm } from '@/composables/useDoubleConfirm'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { useWindowExternalFile } from '@/composables/useWindowExternalFile'
import { useAccountsStore } from '@/stores/accounts'
import { commands, unwrap } from '@/utils/tauriInvoke'

const jsonLang = json()

const json5Linter = linter(
  (view) => {
    const diagnostics: Diagnostic[] = []
    const src = view.state.doc.toString()
    if (!src.trim()) return diagnostics
    try {
      JSON5.parse(src)
    } catch (e) {
      diagnostics.push({
        from: 0,
        to: src.length,
        severity: 'error',
        message: e instanceof Error ? e.message : 'JSON5 パースエラー',
      })
    }
    return diagnostics
  },
  { delay: 400 },
)

const props = defineProps<{
  initialTab?: string
}>()

const { tab, containerRef: editorRef } = useEditorTabs(
  ['api', 'json'] as const,
  (props.initialTab as 'api' | 'json') ?? 'api',
)

useWindowExternalFile(() => ({ name: 'ai.json5' }))

// --- Provider schema (data-driven UI) ---

interface ProviderOption {
  value: ProviderKey
  label: string
  icon: string
  /** URL path appended to endpoint for connection test */
  testPath: string
  /** Whether this provider requires an API key for normal operation */
  needsApiKey: boolean
}

interface FieldDef {
  key: keyof ProviderSettings
  label: string
  icon: string
  placeholder: string
}

const PROVIDERS: ProviderOption[] = [
  {
    value: 'anthropic',
    label: 'Anthropic Claude',
    icon: 'ti-sparkles',
    testPath: '/v1/models',
    needsApiKey: true,
  },
  {
    value: 'openai',
    label: 'OpenAI ChatGPT',
    icon: 'ti-brand-openai',
    testPath: '/models',
    needsApiKey: true,
  },
  {
    value: 'custom',
    label: 'カスタム (OpenAI互換)',
    icon: 'ti-plug',
    testPath: '/models',
    needsApiKey: true,
  },
]

const PROVIDER_FIELDS: Record<ProviderKey, FieldDef[]> = {
  anthropic: [
    {
      key: 'endpoint',
      label: 'エンドポイント',
      icon: 'ti-link',
      placeholder: 'https://api.anthropic.com',
    },
    {
      key: 'model',
      label: 'モデル',
      icon: 'ti-cube',
      placeholder: 'claude-opus-4-7, claude-sonnet-4-6, etc.',
    },
  ],
  openai: [
    {
      key: 'endpoint',
      label: 'エンドポイント',
      icon: 'ti-link',
      placeholder: 'https://api.openai.com/v1',
    },
    {
      key: 'model',
      label: 'モデル',
      icon: 'ti-cube',
      placeholder: 'gpt-4o, gpt-4o-mini, etc.',
    },
  ],
  custom: [
    {
      key: 'endpoint',
      label: 'エンドポイント',
      icon: 'ti-link',
      placeholder: 'https://openrouter.ai/api/v1 など (OpenAI 互換)',
    },
    {
      key: 'model',
      label: 'モデル',
      icon: 'ti-cube',
      placeholder: 'anthropic/claude-sonnet-4 など',
    },
  ],
}

// --- Permissions / DataSources schema (data-driven UI) ---

interface PresetOption {
  value: PresetKey
  label: string
  icon: string
}

const PRESET_OPTIONS: readonly PresetOption[] = [
  { value: 'readonly', label: '読取のみ (デフォルト)', icon: 'ti-eye' },
  { value: 'safe', label: '安全 (リアクション可)', icon: 'ti-shield-check' },
  { value: 'full', label: 'フル (全許可)', icon: 'ti-bolt' },
  { value: 'custom', label: 'カスタム', icon: 'ti-adjustments' },
]

const FALLBACK_PRESET_OPTION: PresetOption = {
  value: 'readonly',
  label: '読取のみ (デフォルト)',
  icon: 'ti-eye',
}

interface PermissionLabel {
  label: string
  icon: string
}

const PERMISSION_LABELS: Record<PermissionKey, PermissionLabel> = {
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
  'network.external': { label: '外部ネットワークアクセス', icon: 'ti-world' },
  clipboard: { label: 'クリップボード', icon: 'ti-clipboard' },
  notifications: { label: 'デスクトップ通知', icon: 'ti-bell' },
  'tasks.run': {
    label: 'ユーザー定義タスクの実行',
    icon: 'ti-player-play',
  },
}

interface DataSourceLabel {
  label: string
  icon: string
  description: string
}

const DATA_SOURCE_LABELS: Record<DataSourceKey, DataSourceLabel> = {
  currentAccount: {
    label: '現在のアカウント',
    icon: 'ti-user',
    description: 'ログイン中のアカウント情報を AI に渡す (トークン等は除外)',
  },
  currentColumn: {
    label: '現在のカラム',
    icon: 'ti-columns',
    description: 'フォーカス中のカラムの種別と設定を渡す',
  },
  visibleNotes: {
    label: '可視アイテム (上限 10 件)',
    icon: 'ti-list',
    description:
      '画面に表示中のアイテム (ノート / 通知 / ドライブファイル等) を context に含める',
  },
  recentConversation: {
    label: 'AI 会話履歴 (上限 20 ターン)',
    icon: 'ti-messages',
    description: '直近の会話を context に含める',
  },
  memos: {
    label: 'ローカルメモ (上限 20 件)',
    icon: 'ti-notes',
    description:
      'Zettelkasten 形式のローカルメモを context に含める (現在のアカウントのみ)',
  },
}

const HIGH_RISK_SET = new Set<PermissionKey>(HIGH_RISK_PERMISSION_KEYS)

// --- Config (delegated to composable) ---

const { config, save: saveConfig, mergeConfig } = useAiConfig()

const expandedSections = reactive<Record<string, boolean>>({ provider: true })

function toggleSection(key: string) {
  expandedSections[key] = !expandedSections[key]
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
watch(
  config,
  () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveConfig()
      // form 経由保存後、JSON タブの表示も最新化する
      rawJson.value = formatRaw(config.value)
    }, 300)
  },
  { deep: true },
)

// --- JSON5 raw editor (ai.json5) ---

const rawJson = ref<string>('')
const rawError = ref<string | null>(null)
const rawSaved = ref(false)
let rawSyncing = false

function formatRaw(c: AiConfig): string {
  return `${JSON5.stringify(c, null, 2)}\n`
}

// 初期化: config が読み込まれたら raw も初期化
watch(
  () => config.value,
  (c) => {
    if (rawSyncing) return
    rawJson.value = formatRaw(c)
  },
  { immediate: true },
)

let rawSaveTimer: ReturnType<typeof setTimeout> | null = null
watch(rawJson, (v) => {
  if (tab.value !== 'json') return
  if (rawSaveTimer) clearTimeout(rawSaveTimer)
  rawSaveTimer = setTimeout(() => {
    try {
      const parsed = JSON5.parse(v) as Partial<AiConfig>
      rawSyncing = true
      config.value = mergeConfig(defaultConfig(), parsed)
      rawSyncing = false
      rawError.value = null
      rawSaved.value = true
      setTimeout(() => {
        rawSaved.value = false
      }, 1500)
    } catch (e) {
      rawError.value = e instanceof Error ? e.message : '不正な JSON5'
    }
  }, 500)
})

// --- Computed helpers ---

const currentProvider = computed(
  () =>
    // biome-ignore lint: PROVIDERS is a non-empty constant array
    PROVIDERS.find((p) => p.value === config.value.provider) ?? PROVIDERS[0]!,
)

const currentFields = computed(() => PROVIDER_FIELDS[config.value.provider])

const currentSettings = computed(() => config.value[config.value.provider])

const customEndpointInsecure = computed(() => {
  if (config.value.provider !== 'custom') return false
  const ep = config.value.custom.endpoint?.trim() ?? ''
  return ep.length > 0 && /^http:\/\//i.test(ep)
})

// --- Provider dropdown ---

const showProviderDropdown = ref(false)
const providerDropdownRef = ref<HTMLElement | null>(null)

function selectProvider(value: ProviderKey) {
  config.value.provider = value
  showProviderDropdown.value = false
}

useClickOutside(providerDropdownRef, () => {
  showProviderDropdown.value = false
})

// --- Permissions / DataSources preset dropdowns ---

const showPermissionsPresetDropdown = ref(false)
const permissionsPresetRef = ref<HTMLElement | null>(null)
const showDataSourcesPresetDropdown = ref(false)
const dataSourcesPresetRef = ref<HTMLElement | null>(null)

const currentPermissionPreset = computed(
  () =>
    PRESET_OPTIONS.find((p) => p.value === config.value.permissions.preset) ??
    FALLBACK_PRESET_OPTION,
)

const currentDataSourcePreset = computed(
  () =>
    PRESET_OPTIONS.find((p) => p.value === config.value.dataSources.preset) ??
    FALLBACK_PRESET_OPTION,
)

const resolvedPermissions = computed(() =>
  resolvePermissions(config.value.permissions),
)

const resolvedDataSources = computed(() =>
  resolveDataSources(config.value.dataSources),
)

function selectPermissionPreset(preset: PresetKey) {
  config.value.permissions = setPermissionPreset(
    config.value.permissions,
    preset,
  )
  showPermissionsPresetDropdown.value = false
}

function togglePermissionCustom(key: PermissionKey) {
  config.value.permissions.custom[key] = !config.value.permissions.custom[key]
}

function selectDataSourcePreset(preset: PresetKey) {
  config.value.dataSources = setDataSourcePreset(
    config.value.dataSources,
    preset,
  )
  showDataSourcesPresetDropdown.value = false
}

function toggleDataSourceCustom(key: DataSourceKey) {
  config.value.dataSources.custom[key] = !config.value.dataSources.custom[key]
}

useClickOutside(permissionsPresetRef, () => {
  showPermissionsPresetDropdown.value = false
})
useClickOutside(dataSourcesPresetRef, () => {
  showDataSourcesPresetDropdown.value = false
})

// --- Heartbeat (#411 Phase 6) ---

// どの skill を heartbeat 対象にするかは skill 側の frontmatter
// (`mode: heartbeat`) で持つので、AI 設定では skill 一覧を扱わない。
// (skill 数表示は冗長だったため UI から撤去)

// HEARTBEAT 用 permissions (chat 用とは独立)。preset / custom toggle は
// 既存の Permissions セクションと同じヘルパを再利用する。
const resolvedHeartbeatPermissions = computed(() =>
  resolvePermissions(config.value.heartbeat.permissions),
)

function selectHeartbeatPermissionPreset(next: PresetKey): void {
  config.value.heartbeat.permissions = setPermissionPreset(
    config.value.heartbeat.permissions,
    next,
  )
  showHeartbeatPermPresetDropdown.value = false
}

function toggleHeartbeatPermissionCustom(key: PermissionKey): void {
  if (config.value.heartbeat.permissions.preset !== 'custom') return
  config.value.heartbeat.permissions = {
    preset: 'custom',
    custom: {
      ...config.value.heartbeat.permissions.custom,
      [key]: !config.value.heartbeat.permissions.custom[key],
    },
  }
}

const currentHeartbeatPermissionPreset = computed(
  () =>
    PRESET_OPTIONS.find(
      (p) => p.value === config.value.heartbeat.permissions.preset,
    ) ?? FALLBACK_PRESET_OPTION,
)

const showHeartbeatPermPresetDropdown = ref(false)
const heartbeatPermPresetRef = ref<HTMLElement | null>(null)
useClickOutside(heartbeatPermPresetRef, () => {
  showHeartbeatPermPresetDropdown.value = false
})

// --- API key (keychain) ---

const apiKeyStatus = reactive<Record<ProviderKey, boolean>>({
  anthropic: false,
  openai: false,
  custom: false,
})
const editingKey = ref<ProviderKey | null>(null)
const draftKey = ref('')
const showDraftKey = ref(false)

async function refreshApiKeyStatus(provider: ProviderKey) {
  try {
    apiKeyStatus[provider] = await getApiKeyStatus(provider)
  } catch (e) {
    console.warn(
      `[ai-settings] failed to read keychain status for ${provider}:`,
      e,
    )
    apiKeyStatus[provider] = false
  }
}

async function refreshAllStatuses() {
  await Promise.all(PROVIDER_KEYS.map(refreshApiKeyStatus))
}

onMounted(refreshAllStatuses)

// プロバイダー切替時に編集モードをリセット
watch(
  () => config.value.provider,
  () => {
    editingKey.value = null
    draftKey.value = ''
    showDraftKey.value = false
  },
)

function startEdit(provider: ProviderKey) {
  editingKey.value = provider
  draftKey.value = ''
  showDraftKey.value = false
  expandedSections.apiKey = true
}

function cancelEdit() {
  editingKey.value = null
  draftKey.value = ''
  showDraftKey.value = false
}

async function saveDraftKey(provider: ProviderKey) {
  if (!draftKey.value) {
    cancelEdit()
    return
  }
  await setApiKey(provider, draftKey.value)
  draftKey.value = ''
  editingKey.value = null
  showDraftKey.value = false
  await refreshApiKeyStatus(provider)
}

async function clearKey(provider: ProviderKey) {
  await deleteApiKey(provider)
  await refreshApiKeyStatus(provider)
}

// --- Connection test ---

const testStatus = ref<'idle' | 'testing' | 'ok' | 'error'>('idle')
const testMessage = ref('')

async function testConnection() {
  testStatus.value = 'testing'
  testMessage.value = ''

  try {
    const provider = currentProvider.value
    const settings = currentSettings.value
    const url = `${settings.endpoint}${provider.testPath}`

    // For test purposes, prefer the draft key (currently being entered) over
    // the stored one — the keychain key body is intentionally not exposed.
    // Tests with no draft key run unauthenticated; this fails for providers
    // requiring auth, which surfaces "set a key first" naturally.
    const testKey = editingKey.value === provider.value ? draftKey.value : ''

    const result = unwrap(
      await commands.checkEndpointHealth(url, testKey || null),
    ) as unknown as {
      ok: boolean
      status: number
      message: string
    }
    if (result.ok) {
      testStatus.value = 'ok'
      testMessage.value = result.message
    } else {
      testStatus.value = 'error'
      testMessage.value = result.message
    }
  } catch (e) {
    testStatus.value = 'error'
    testMessage.value = e instanceof Error ? e.message : '接続失敗'
  }

  setTimeout(() => {
    if (testStatus.value !== 'testing') testStatus.value = 'idle'
  }, 3000)
}

// --- Import/Export ---

const {
  copied: copiedMessage,
  imported: importedMessage,
  importError,
  showCopied,
  showImported,
  showImportError,
} = useClipboardFeedback()

function exportConfig() {
  navigator.clipboard.writeText(JSON.stringify(config.value, null, 2))
  showCopied()
}

async function importConfig() {
  try {
    const text = await navigator.clipboard.readText()
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') {
      showImportError()
      return
    }
    config.value = mergeConfig(defaultConfig(), parsed as Partial<AiConfig>)
    saveConfig()
    showImported()
  } catch {
    showImportError()
  }
}

// --- Reset ---

const { confirming: confirmingReset, trigger: triggerReset } =
  useDoubleConfirm()

function handleReset() {
  triggerReset(() => {
    config.value = defaultConfig()
    saveConfig()
  })
}
</script>

<template>
  <div ref="editorRef" :class="$style.content">
    <EditorTabs
      v-model="tab"
      :tabs="[
        { value: 'api', icon: 'plug-connected', label: 'API' },
        { value: 'json', icon: 'braces', label: 'ai.json5' },
      ]"
    />

    <!-- API Settings Tab -->
    <div v-show="tab === 'api'" :class="$style.panel">
      <!-- Provider -->
      <div :class="$style.section">
        <button class="_button" :class="$style.sectionLabel" @click="toggleSection('provider')">
          <i class="ti ti-cloud" />
          プロバイダー
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.provider }]" />
        </button>
        <template v-if="expandedSections.provider">
          <div ref="providerDropdownRef" :class="$style.dropdown">
            <button
              class="_button"
              :class="$style.dropdownTrigger"
              @click="showProviderDropdown = !showProviderDropdown"
            >
              <i :class="'ti ' + currentProvider.icon" />
              <span>{{ currentProvider.label }}</span>
              <i class="ti ti-chevron-down" :class="$style.dropdownChevron" />
            </button>
            <div v-if="showProviderDropdown" :class="$style.dropdownPanel">
              <button
                v-for="opt in PROVIDERS"
                :key="opt.value"
                class="_button"
                :class="[$style.dropdownItem, { [$style.selected]: config.provider === opt.value }]"
                @click="selectProvider(opt.value)"
              >
                <i :class="'ti ' + opt.icon" />
                <span>{{ opt.label }}</span>
                <i v-if="config.provider === opt.value" class="ti ti-check" :class="$style.checkIcon" />
              </button>
            </div>
          </div>
        </template>
      </div>

      <!-- Custom provider safety notice -->
      <div v-if="config.provider === 'custom'" :class="[$style.section, $style.noticeSection]">
        <div :class="$style.notice">
          <i class="ti ti-shield-lock" />
          <div>
            <strong>信頼できるエンドポイントのみ使用してください。</strong><br />
            Custom は任意 URL を許可します (OpenRouter / Groq / 自前 LLM ゲートウェイ等)。プロンプト内容と API キーがそのままエンドポイントに送信されます。
          </div>
        </div>
        <div v-if="customEndpointInsecure" :class="$style.warning">
          <i class="ti ti-alert-triangle" />
          <div>
            <strong>HTTP 接続は推奨されません。</strong>
            通信が暗号化されないため、API キーやプロンプトが平文で漏洩する可能性があります。HTTPS を使用してください。
          </div>
        </div>
      </div>

      <!-- Provider-specific fields (data-driven, plain text only) -->
      <div v-for="field in currentFields" :key="field.key" :class="$style.section">
        <button class="_button" :class="$style.sectionLabel" @click="toggleSection(field.key)">
          <i :class="'ti ' + field.icon" />
          {{ field.label }}
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections[field.key] }]" />
        </button>
        <template v-if="expandedSections[field.key]">
          <input
            v-model="currentSettings[field.key]"
            :class="$style.input"
            type="text"
            :placeholder="field.placeholder"
          />
        </template>
      </div>

      <!-- API Key (keychain — body never exposed to frontend) -->
      <div v-if="currentProvider.needsApiKey" :class="$style.section">
        <button class="_button" :class="$style.sectionLabel" @click="toggleSection('apiKey')">
          <i class="ti ti-key" />
          APIキー
          <span :class="$style.statusBadge">
            <i v-if="apiKeyStatus[currentProvider.value]" class="ti ti-shield-check" :class="$style.badgeOk" />
            <i v-else class="ti ti-shield-off" :class="$style.badgeNone" />
            {{ apiKeyStatus[currentProvider.value] ? '設定済み' : '未設定' }}
          </span>
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.apiKey }]" />
        </button>
        <template v-if="expandedSections.apiKey">
          <div :class="$style.keyHint">
            <i class="ti ti-lock" />
            キーは OS のキーチェーンに保管されます (DevTools / ファイルから取得不可)
          </div>
          <!-- Edit mode -->
          <template v-if="editingKey === currentProvider.value">
            <div :class="$style.inputRow">
              <input
                v-model="draftKey"
                :class="$style.input"
                :type="showDraftKey ? 'text' : 'password'"
                placeholder="新しい API キーを入力"
                @keydown.enter="saveDraftKey(currentProvider.value)"
                @keydown.esc="cancelEdit"
              />
              <button
                class="_button"
                :class="$style.visibilityBtn"
                @click="showDraftKey = !showDraftKey"
              >
                <i :class="showDraftKey ? 'ti ti-eye-off' : 'ti ti-eye'" />
              </button>
            </div>
            <div :class="$style.keyActions">
              <button
                class="_button"
                :class="[$style.keyBtn, $style.primary]"
                :disabled="!draftKey"
                @click="saveDraftKey(currentProvider.value)"
              >
                <i class="ti ti-check" />
                保存
              </button>
              <button class="_button" :class="$style.keyBtn" @click="cancelEdit">
                <i class="ti ti-x" />
                キャンセル
              </button>
            </div>
          </template>
          <!-- Status mode: show "クリア" if set, otherwise "キーを入力" -->
          <template v-else>
            <div :class="$style.keyActions">
              <button
                v-if="apiKeyStatus[currentProvider.value]"
                class="_button"
                :class="[$style.keyBtn, $style.danger]"
                @click="clearKey(currentProvider.value)"
              >
                <i class="ti ti-trash" />
                クリア
              </button>
              <button
                v-else
                class="_button"
                :class="$style.keyBtn"
                @click="startEdit(currentProvider.value)"
              >
                <i class="ti ti-pencil" />
                キーを入力
              </button>
            </div>
          </template>
        </template>
      </div>

      <!-- Permissions -->
      <div :class="$style.section">
        <button class="_button" :class="$style.sectionLabel" @click="toggleSection('permissions')">
          <i class="ti ti-shield-lock" />
          権限
          <span :class="$style.statusBadge">
            <i class="ti ti-info-circle" :class="$style.badgeNone" />
            {{ currentPermissionPreset.label }}
          </span>
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.permissions }]" />
        </button>
        <template v-if="expandedSections.permissions">
          <div ref="permissionsPresetRef" :class="$style.dropdown">
            <button
              class="_button"
              :class="$style.dropdownTrigger"
              @click="showPermissionsPresetDropdown = !showPermissionsPresetDropdown"
            >
              <i :class="'ti ' + currentPermissionPreset.icon" />
              <span>{{ currentPermissionPreset.label }}</span>
              <i class="ti ti-chevron-down" :class="$style.dropdownChevron" />
            </button>
            <div v-if="showPermissionsPresetDropdown" :class="$style.dropdownPanel">
              <button
                v-for="opt in PRESET_OPTIONS"
                :key="opt.value"
                class="_button"
                :class="[$style.dropdownItem, { [$style.selected]: config.permissions.preset === opt.value }]"
                @click="selectPermissionPreset(opt.value)"
              >
                <i :class="'ti ' + opt.icon" />
                <span>{{ opt.label }}</span>
                <i v-if="config.permissions.preset === opt.value" class="ti ti-check" :class="$style.checkIcon" />
              </button>
            </div>
          </div>

          <div :class="$style.toggleList">
            <div
              v-for="key in PERMISSION_KEYS"
              :key="key"
              :class="[
                $style.switchRow,
                { [$style.switchRowDisabled]: config.permissions.preset !== 'custom' },
              ]"
              @click="config.permissions.preset === 'custom' && togglePermissionCustom(key)"
            >
              <i :class="['ti ' + PERMISSION_LABELS[key].icon, $style.switchRowIcon]" />
              <span :class="$style.switchRowLabel">{{ PERMISSION_LABELS[key].label }}</span>
              <i
                v-if="HIGH_RISK_SET.has(key)"
                class="ti ti-alert-triangle"
                :class="$style.warningIcon"
                title="高リスク操作"
              />
              <button
                class="nd-toggle-switch"
                :class="{ on: resolvedPermissions[key] }"
                :aria-checked="resolvedPermissions[key]"
                :disabled="config.permissions.preset !== 'custom'"
                role="switch"
              >
                <span class="nd-toggle-switch-knob" />
              </button>
            </div>
          </div>
        </template>
      </div>

      <!-- Data Sources -->
      <div :class="$style.section">
        <button class="_button" :class="$style.sectionLabel" @click="toggleSection('dataSources')">
          <i class="ti ti-database-export" />
          データソース
          <span :class="$style.statusBadge">
            <i class="ti ti-info-circle" :class="$style.badgeNone" />
            {{ currentDataSourcePreset.label }}
          </span>
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.dataSources }]" />
        </button>
        <template v-if="expandedSections.dataSources">
          <div ref="dataSourcesPresetRef" :class="$style.dropdown">
            <button
              class="_button"
              :class="$style.dropdownTrigger"
              @click="showDataSourcesPresetDropdown = !showDataSourcesPresetDropdown"
            >
              <i :class="'ti ' + currentDataSourcePreset.icon" />
              <span>{{ currentDataSourcePreset.label }}</span>
              <i class="ti ti-chevron-down" :class="$style.dropdownChevron" />
            </button>
            <div v-if="showDataSourcesPresetDropdown" :class="$style.dropdownPanel">
              <button
                v-for="opt in PRESET_OPTIONS"
                :key="opt.value"
                class="_button"
                :class="[$style.dropdownItem, { [$style.selected]: config.dataSources.preset === opt.value }]"
                @click="selectDataSourcePreset(opt.value)"
              >
                <i :class="'ti ' + opt.icon" />
                <span>{{ opt.label }}</span>
                <i v-if="config.dataSources.preset === opt.value" class="ti ti-check" :class="$style.checkIcon" />
              </button>
            </div>
          </div>

          <div :class="$style.toggleList">
            <div
              v-for="key in DATA_SOURCE_KEYS"
              :key="key"
              :class="[
                $style.switchRow,
                { [$style.switchRowDisabled]: config.dataSources.preset !== 'custom' },
              ]"
              @click="config.dataSources.preset === 'custom' && toggleDataSourceCustom(key)"
            >
              <i :class="['ti ' + DATA_SOURCE_LABELS[key].icon, $style.switchRowIcon]" />
              <div :class="$style.switchRowLabelStack">
                <span :class="$style.switchRowLabel">{{ DATA_SOURCE_LABELS[key].label }}</span>
                <span :class="$style.switchRowSubLabel">{{ DATA_SOURCE_LABELS[key].description }}</span>
              </div>
              <button
                class="nd-toggle-switch"
                :class="{ on: resolvedDataSources[key] }"
                :aria-checked="resolvedDataSources[key]"
                :disabled="config.dataSources.preset !== 'custom'"
                role="switch"
              >
                <span class="nd-toggle-switch-knob" />
              </button>
            </div>
          </div>
        </template>
      </div>

      <!-- Heartbeat (#411 Phase 6) -->
      <div :class="$style.section">
        <button class="_button" :class="$style.sectionLabel" @click="toggleSection('heartbeat')">
          <i class="ti ti-activity-heartbeat" />
          HEARTBEAT
          <span :class="$style.statusBadge">
            <i class="ti ti-info-circle" :class="$style.badgeNone" />
            {{ config.heartbeat.enabled ? `有効・${config.heartbeat.intervalMinutes} 分` : '無効' }}
          </span>
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.heartbeat }]" />
        </button>
        <template v-if="expandedSections.heartbeat">
          <!-- Basic: 有効化 (TL フィルターと同じトグル) + interval + notice -->
          <div
            :class="$style.switchRow"
            @click="config.heartbeat.enabled = !config.heartbeat.enabled"
          >
            <span :class="$style.switchRowLabel">HEARTBEAT を有効化</span>
            <button
              class="nd-toggle-switch"
              :class="{ on: config.heartbeat.enabled }"
              :aria-checked="config.heartbeat.enabled"
              role="switch"
            >
              <span class="nd-toggle-switch-knob" />
            </button>
          </div>

          <!-- tick 間隔: 数値入力 (PerformanceEditor 風 1 行レイアウト) -->
          <div v-if="config.heartbeat.enabled" :class="$style.field">
            <div :class="$style.fieldHeader">
              <span :class="$style.fieldLabel">tick 間隔</span>
              <div :class="$style.fieldValue">
                <input
                  v-model.number="config.heartbeat.intervalMinutes"
                  type="number"
                  :min="HEARTBEAT_INTERVAL_MIN_MINUTES"
                  :max="HEARTBEAT_INTERVAL_MAX_MINUTES"
                  :class="$style.numberInput"
                />
                <span :class="$style.fieldUnit">分</span>
              </div>
            </div>
          </div>

          <!-- デスクトップ通知 (#411 0.19.0): 重要発見を即気付ける。
               アプリにフォーカスがあるときは自動抑制。 -->
          <div
            v-if="config.heartbeat.enabled"
            :class="$style.switchRow"
            @click="config.heartbeat.desktopNotification = !config.heartbeat.desktopNotification"
          >
            <div :class="$style.switchRowLabelStack">
              <span :class="$style.switchRowLabel">デスクトップ通知</span>
              <span :class="$style.switchRowSubLabel">
                重要発見 (HEARTBEAT_OK 以外) を OS 通知で表示。アプリに
                フォーカスがあれば自動抑制
              </span>
            </div>
            <button
              class="nd-toggle-switch"
              :class="{ on: config.heartbeat.desktopNotification }"
              :aria-checked="config.heartbeat.desktopNotification"
              role="switch"
            >
              <span class="nd-toggle-switch-knob" />
            </button>
          </div>

          <!-- Cheap Check First (#411): skill 側で cheapCheckCapabilities 宣言した
               heartbeat skill に対して、tick 開始時に「変化検知」用の軽量 capability
               を呼び、前回値と一致すれば AI 起動を skip する。
               opt-out 可能 (= 常に AI を叩きたい場合は OFF にする)。 -->
          <template v-if="config.heartbeat.enabled">
            <div
              :class="$style.switchRow"
              @click="config.heartbeat.cheapCheck.enabled = !config.heartbeat.cheapCheck.enabled"
            >
              <div :class="$style.switchRowLabelStack">
                <span :class="$style.switchRowLabel">Cheap Check First</span>
                <span :class="$style.switchRowSubLabel">
                  変化なしなら AI を起動せず HEARTBEAT_OK 扱い (skill 側で
                  cheapCheckCapabilities の宣言が必要)
                </span>
              </div>
              <button
                class="nd-toggle-switch"
                :class="{ on: config.heartbeat.cheapCheck.enabled }"
                :aria-checked="config.heartbeat.cheapCheck.enabled"
                role="switch"
              >
                <span class="nd-toggle-switch-knob" />
              </button>
            </div>

            <div v-if="config.heartbeat.cheapCheck.enabled" :class="$style.field">
              <div :class="$style.fieldHeader">
                <span :class="$style.fieldLabel">最大連続 skip 時間</span>
                <div :class="$style.fieldValue">
                  <input
                    v-model.number="config.heartbeat.cheapCheck.maxSkipHours"
                    type="number"
                    :min="HEARTBEAT_MAX_SKIP_HOURS_MIN"
                    :max="HEARTBEAT_MAX_SKIP_HOURS_MAX"
                    :class="$style.numberInput"
                  />
                  <span :class="$style.fieldUnit">時間</span>
                </div>
              </div>
            </div>
          </template>

          <!-- 安全装置 (#411): 1 日の AI 起動上限 + 上限到達時の動作 -->
          <template v-if="config.heartbeat.enabled">
            <div :class="$style.field">
              <div :class="$style.fieldHeader">
                <span :class="$style.fieldLabel">1 日の AI 起動上限</span>
                <div :class="$style.fieldValue">
                  <input
                    v-model.number="config.heartbeat.dailyMaxAiRuns"
                    type="number"
                    :min="HEARTBEAT_DAILY_MAX_AI_RUNS_MIN"
                    :max="HEARTBEAT_DAILY_MAX_AI_RUNS_MAX"
                    :class="$style.numberInput"
                  />
                  <span :class="$style.fieldUnit">回 / 日</span>
                </div>
              </div>
            </div>

            <div
              :class="$style.switchRow"
              @click="config.heartbeat.onDailyLimit = config.heartbeat.onDailyLimit === 'disable' ? 'warn' : 'disable'"
            >
              <div :class="$style.switchRowLabelStack">
                <span :class="$style.switchRowLabel">上限到達時に自動停止</span>
                <span :class="$style.switchRowSubLabel">
                  OFF = 警告のみで継続 / ON = HEARTBEAT を自動 disable
                </span>
              </div>
              <button
                class="nd-toggle-switch"
                :class="{ on: config.heartbeat.onDailyLimit === 'disable' }"
                :aria-checked="config.heartbeat.onDailyLimit === 'disable'"
                role="switch"
              >
                <span class="nd-toggle-switch-knob" />
              </button>
            </div>
          </template>

          <!-- HEARTBEAT 用権限 (chat 用とは独立。default readonly 推奨) -->
          <template v-if="config.heartbeat.enabled">
            <div :class="$style.field">
              <label :class="$style.fieldLabel">
                <span>HEARTBEAT 中の権限</span>
              </label>
              <div ref="heartbeatPermPresetRef" :class="$style.dropdown">
                <button
                  class="_button"
                  :class="$style.dropdownTrigger"
                  @click="showHeartbeatPermPresetDropdown = !showHeartbeatPermPresetDropdown"
                >
                  <i :class="'ti ' + currentHeartbeatPermissionPreset.icon" />
                  <span>{{ currentHeartbeatPermissionPreset.label }}</span>
                  <i class="ti ti-chevron-down" :class="$style.dropdownChevron" />
                </button>
                <div v-if="showHeartbeatPermPresetDropdown" :class="$style.dropdownPanel">
                  <button
                    v-for="opt in PRESET_OPTIONS"
                    :key="opt.value"
                    class="_button"
                    :class="[$style.dropdownItem, { [$style.selected]: config.heartbeat.permissions.preset === opt.value }]"
                    @click="selectHeartbeatPermissionPreset(opt.value)"
                  >
                    <i :class="'ti ' + opt.icon" />
                    <span>{{ opt.label }}</span>
                    <i v-if="config.heartbeat.permissions.preset === opt.value" class="ti ti-check" :class="$style.checkIcon" />
                  </button>
                </div>
              </div>

              <div :class="$style.toggleList">
                <div
                  v-for="key in PERMISSION_KEYS"
                  :key="key"
                  :class="[
                    $style.switchRow,
                    { [$style.switchRowDisabled]: config.heartbeat.permissions.preset !== 'custom' },
                  ]"
                  @click="toggleHeartbeatPermissionCustom(key)"
                >
                  <i :class="['ti ' + PERMISSION_LABELS[key].icon, $style.switchRowIcon]" />
                  <span :class="$style.switchRowLabel">{{ PERMISSION_LABELS[key].label }}</span>
                  <i
                    v-if="HIGH_RISK_SET.has(key)"
                    class="ti ti-alert-triangle"
                    :class="$style.warningIcon"
                    title="高リスク操作"
                  />
                  <button
                    class="nd-toggle-switch"
                    :class="{ on: resolvedHeartbeatPermissions[key] }"
                    :aria-checked="resolvedHeartbeatPermissions[key]"
                    :disabled="config.heartbeat.permissions.preset !== 'custom'"
                    role="switch"
                  >
                    <span class="nd-toggle-switch-knob" />
                  </button>
                </div>
              </div>
            </div>
          </template>
        </template>
      </div>

      <!-- Connection Test -->
      <div :class="$style.section">
        <button class="_button" :class="$style.sectionLabel" @click="toggleSection('test')">
          <i class="ti ti-plug-connected" />
          接続テスト
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.test }]" />
        </button>
        <template v-if="expandedSections.test">
          <button
            class="_button"
            :class="[$style.testBtn, { [$style.testing]: testStatus === 'testing' }]"
            :disabled="testStatus === 'testing'"
            @click="testConnection"
          >
            <i :class="testStatus === 'testing' ? 'ti ti-loader-2' : 'ti ti-plug-connected'" />
            {{ testStatus === 'testing' ? '接続テスト中...' : '接続テスト' }}
          </button>
          <div v-if="testStatus === 'ok'" :class="$style.codeSuccess">
            <i class="ti ti-check" />
            {{ testMessage }}
          </div>
          <div v-if="testStatus === 'error'" :class="$style.errorMessage">
            <i class="ti ti-alert-triangle" />
            {{ testMessage }}
          </div>
        </template>
      </div>
    </div>

    <!-- ai.json5 raw editor tab -->
    <div v-show="tab === 'json'" :class="$style.codePanel">
      <div :class="$style.codeHint">
        ai.json5 を直接編集できます。API キーはキーチェーン管理のため raw には現れません。
      </div>
      <CodeEditor
        v-model="rawJson"
        :language="jsonLang"
        :linter="json5Linter"
        :class="$style.codeEditorWrap"
        auto-height
      />
      <div :class="$style.promptStatus">
        <div v-if="rawError" :class="$style.errorMessage">
          <i class="ti ti-alert-triangle" />
          {{ rawError }}
        </div>
        <div v-else-if="rawSaved" :class="$style.codeSuccess">
          <i class="ti ti-check" />
          保存しました
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div :class="$style.actions">
      <div :class="$style.actionGroup">
        <button
          class="_button"
          :class="[$style.actionBtn, $style.secondary, { [$style.feedback]: importedMessage || importError }]"
          @click="importConfig"
        >
          <i class="ti" :class="importError ? 'ti-alert-circle' : 'ti-clipboard-text'" />
          {{ importError ? '無効' : importedMessage ? '読込済み' : 'インポート' }}
        </button>
        <button
          class="_button"
          :class="[$style.actionBtn, $style.secondary, { [$style.feedback]: copiedMessage }]"
          @click="exportConfig"
        >
          <i class="ti ti-clipboard-copy" />
          {{ copiedMessage ? 'コピー済み' : 'エクスポート' }}
        </button>
      </div>
      <button
        class="_button"
        :class="[$style.actionBtn, $style.danger, { [$style.confirming]: confirmingReset }]"
        @click="handleReset"
      >
        <i class="ti ti-trash" />
        {{ confirmingReset ? '本当にリセット？' : 'すべてリセット' }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.selected { /* modifier */ }
.confirming { /* modifier */ }

.panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 10px;
  border-bottom: 1px solid var(--nd-divider);
}

.sectionLabel {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  font-size: 0.8em;
  font-weight: bold;
  opacity: 0.7;
  cursor: pointer;
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 1;
  }
}

.chevron {
  margin-left: auto;
  font-size: 0.9em;
  transition: transform var(--nd-duration-base);
  transform: rotate(-90deg);
}

.chevronOpen {
  transform: rotate(0deg);
}

.statusBadge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 6px;
  padding: 2px 6px;
  border-radius: var(--nd-radius-sm);
  background: color-mix(in srgb, var(--nd-fg) 8%, transparent);
  font-size: 0.85em;
  font-weight: normal;
  opacity: 0.9;
}

.badgeOk { color: var(--nd-accent); }
.badgeNone { color: var(--nd-fg); opacity: 0.5; }

.input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.8em;
  font-family: inherit;
  outline: none;
  transition: border-color var(--nd-duration-base);

  &:focus {
    border-color: var(--nd-accent);
  }

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.35;
  }
}

.inputRow {
  display: flex;
  gap: 4px;
  align-items: center;

  .input {
    flex: 1;
    min-width: 0;
  }
}

.visibilityBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--nd-radius-sm);
  opacity: 0.5;
  flex-shrink: 0;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }
}

.keyHint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7em;
  opacity: 0.5;
}

.noticeSection {
  gap: 6px;
}

.notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--nd-radius-sm);
  background: color-mix(in srgb, var(--nd-fg) 5%, transparent);
  border-left: 3px solid var(--nd-accent);
  font-size: 0.75em;
  line-height: 1.5;

  i {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--nd-accent);
  }
}

.warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--nd-radius-sm);
  background: color-mix(in srgb, var(--nd-love) 10%, transparent);
  border-left: 3px solid var(--nd-love);
  color: var(--nd-love);
  font-size: 0.75em;
  line-height: 1.5;

  i {
    flex-shrink: 0;
    margin-top: 2px;
  }
}

.keyActions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.keyBtn {
  @include btn-secondary;

  &.primary { @include btn-primary; }
  &.danger { @include btn-danger-ghost; }
}

.primary { /* modifier */ }

// Dropdown (reuse CssEditorContent pattern)
.dropdown {
  position: relative;
  width: 100%;
}

.dropdownTrigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.8em;
  text-align: left;
  transition: border-color var(--nd-duration-base), background var(--nd-duration-base);

  &:hover { background: var(--nd-buttonHoverBg); }
}

.dropdownChevron {
  margin-left: auto;
  opacity: 0.4;
  font-size: 0.85em;
}

.dropdownPanel {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 100;
  max-height: 240px;
  overflow-y: auto;
  margin-top: 2px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-panel);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.dropdownItem {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  font-size: 0.8em;
  color: var(--nd-fg);
  text-align: left;
  cursor: pointer;
  transition: background var(--nd-duration-base);

  &:hover { background: var(--nd-buttonHoverBg); }
  &.selected { color: var(--nd-accent); }
  & + & { border-top: 1px solid color-mix(in srgb, var(--nd-divider) 50%, transparent); }
}

.checkIcon { margin-left: auto; opacity: 0.7; flex-shrink: 0; }

// Permission / DataSource toggle list
.toggleList {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  overflow: hidden;
}

.toggleItem {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.78em;
  text-align: left;
  cursor: pointer;
  transition: background var(--nd-duration-base), opacity var(--nd-duration-base);

  &:hover { background: var(--nd-buttonHoverBg); }
  &:disabled {
    cursor: default;
    &:hover { background: var(--nd-bg); }
  }
  & + & { border-top: 1px solid color-mix(in srgb, var(--nd-divider) 40%, transparent); }

  > i:first-child {
    flex-shrink: 0;
    width: 16px;
    text-align: center;
    opacity: 0.6;
  }
}

.toggleItemOn {
  > i:first-child { opacity: 1; color: var(--nd-accent); }
}

.toggleItemDisabled {
  opacity: 0.55;
}

.toggleLabel {
  flex: 1;
  min-width: 0;
}

.toggleLabelStack {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggleSubLabel {
  font-size: 0.85em;
  opacity: 0.55;
  line-height: 1.3;
}

.toggleCheck {
  flex-shrink: 0;
  font-size: 0.95em;
  width: 16px;
  text-align: center;

  .toggleItemOn & {
    color: var(--nd-accent);
  }
}

.warningIcon {
  flex-shrink: 0;
  color: var(--nd-love);
  opacity: 0.85;
  font-size: 0.9em;
}

// Connection test
.testBtn {
  @include btn-secondary;

  &.testing {
    opacity: 0.6;

    i { animation: nd-spin 0.8s linear infinite; }
  }
}

.testing { /* modifier */ }

// ── Code tab (prompt) ──

.codePanel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.codeHint {
  font-size: 0.75em;
  opacity: 0.4;
}

.codeEditorWrap {
}

.promptStatus {
  display: flex;
  align-items: center;
  gap: 8px;
}

.codeApplyBtn { @include btn-secondary; }

.errorMessage {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: var(--nd-radius-sm);
  background: color-mix(in srgb, var(--nd-love) 10%, var(--nd-bg));
  color: var(--nd-love);
  font-size: 0.75em;
  word-break: break-all;
}

.codeSuccess {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75em;
  color: var(--nd-accent);
  opacity: 0.7;
}

// ── Actions ──

.actions { @include action-bar; }
.actionGroup { @include action-group; }

.actionBtn {
  &.secondary { @include btn-action; }
  &.danger { @include btn-danger-ghost; }
}

.secondary { /* modifier */ }
.feedback { /* modifier */ }
.danger { /* modifier */ }

// nd-toggle-switch を右端に置く共通行レイアウト (左 icon / 中 label stack / 右 toggle)
.switchRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.1s;

  &:not(.switchRowDisabled):hover {
    background: var(--nd-buttonHoverBg);
  }
}

.switchRowDisabled {
  opacity: 0.5;
  cursor: default;
}

.switchRowIcon {
  font-size: 16px;
  color: var(--nd-fg);
  flex-shrink: 0;
}

.switchRowLabel {
  flex: 1;
  font-size: 13px;
  color: var(--nd-fg);
}

.switchRowLabelStack {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.switchRowSubLabel {
  font-size: 11px;
  color: var(--nd-fg);
  opacity: 0.6;
  line-height: 1.3;
}

// 設定項目の数値入力レイアウト (PerformanceEditor の field/fieldHeader 等と
// 揃える: label 左 / [input] [単位] 右の 1 行)
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
}

.fieldHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.fieldValue {
  display: flex;
  align-items: center;
  gap: 4px;
}

.numberInput {
  width: 64px;
  padding: 2px 4px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.85em;
  text-align: right;
  outline: none;
  transition: border-color var(--nd-duration-base);

  &:focus {
    border-color: var(--nd-accent);
  }

  // spinner 矢印は隠す (input on hover でも醜くならないように)
  &::-webkit-inner-spin-button,
  &::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  -moz-appearance: textfield;
}

.fieldUnit {
  font-size: 0.8em;
  opacity: 0.55;
  min-width: 18px;
}

</style>
