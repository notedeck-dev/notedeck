<script setup lang="ts">
import { json } from '@codemirror/lang-json'
import { type Diagnostic, linter } from '@codemirror/lint'
import JSON5 from 'json5'
import { computed, onMounted, ref, watch } from 'vue'
import type { ApiTokenMeta } from '@/bindings'
import { getCapability } from '@/capabilities/registry'
import EditorTabs from '@/components/common/EditorTabs.vue'
import CodeEditor from '@/components/deck/widgets/CodeEditor.vue'
import PermissionProfileEditor from '@/components/window/PermissionProfileEditor.vue'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useDoubleConfirm } from '@/composables/useDoubleConfirm'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { useVault } from '@/composables/useVault'
import { useWindowExternalFile } from '@/composables/useWindowExternalFile'
import { presetChipLabel } from '@/permissions/labels'
import {
  type ProfiledPrincipalId,
  principalActorLabel,
} from '@/permissions/principal'
import {
  AI_INSTRUCTION_KEYS,
  EXTERNAL_READ_FLOOR,
  type PermissionsConfig,
  type PermissionsFileConfig,
} from '@/permissions/schema'
import {
  defaultPermissionsFile,
  normalizePermissionsFile,
  removeConfirmSkip,
  resolveForProfiled,
  usePermissionsConfig,
} from '@/permissions/store'
import { usePluginsStore } from '@/stores/plugins'
import { useWidgetsStore } from '@/stores/widgets'
import { useWindowsStore } from '@/stores/windows'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * 権限ウィンドウ (#712 §8.1)。principal-first — 「誰に」が行、「何を」が
 * 行の中身。ユーザーは説明を読まなくても「行 = 相手」と分かる。
 * 権限の保存先は permissions.json5 (capability から書き換え不能な独立ファイル)。
 */

const props = defineProps<{
  initialTab?: string
}>()

const { file: permissionsFile, save: savePermissions } = usePermissionsConfig()
const vault = useVault()
const windowsStore = useWindowsStore()
const widgetsStore = useWidgetsStore()
const pluginsStore = usePluginsStore()

// タブ (ビジュアル / permissions.json5 raw) — 他の設定ウィンドウと同じ形
const { tab, containerRef: editorRef } = useEditorTabs(
  ['visual', 'json'] as const,
  (props.initialTab as 'visual' | 'json') ?? 'visual',
)

// ヘッダーの「OS 既定エディタで開く」ボタン対象 (DeckWindow が表示する)
useWindowExternalFile(() => ({ name: 'permissions.json5' }))

onMounted(() => {
  void vault.refresh()
})

// 編集は PermissionProfileEditor が permissionsFile を直接書くので、
// ここで debounce 保存する (AI 設定と同じパターン)
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => savePermissions(), 300)
}

// --- permissions.json5 raw editor ---

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

const rawJson = ref<string>('')
const rawError = ref<string | null>(null)
const rawSaved = ref(false)
let rawSyncing = false

function formatRaw(file: PermissionsFileConfig): string {
  return `${JSON5.stringify(file, null, 2)}\n`
}

// ビジュアル編集 → raw に反映 (循環は rawSyncing で防ぐ)
watch(
  permissionsFile,
  (file) => {
    if (rawSyncing) return
    rawJson.value = formatRaw(file)
  },
  { immediate: true, deep: true },
)

let rawSaveTimer: ReturnType<typeof setTimeout> | null = null
watch(rawJson, (v) => {
  if (tab.value !== 'json') return
  if (rawSaveTimer) clearTimeout(rawSaveTimer)
  rawSaveTimer = setTimeout(() => {
    try {
      const parsed = JSON5.parse(v) as Partial<PermissionsFileConfig>
      rawSyncing = true
      permissionsFile.value = normalizePermissionsFile(parsed)
      rawSyncing = false
      rawError.value = null
      rawSaved.value = true
      savePermissions()
      setTimeout(() => {
        rawSaved.value = false
      }, 1500)
    } catch (e) {
      rawError.value = e instanceof Error ? e.message : '不正な JSON5'
    }
  }, 500)
})

const expanded = ref<ProfiledPrincipalId | null>(null)
function toggleRow(id: ProfiledPrincipalId) {
  expanded.value = expanded.value === id ? null : id
}

function chipFor(id: ProfiledPrincipalId): string {
  const profile: PermissionsConfig = permissionsFile.value.principals[id] ?? {
    preset: 'readonly',
    custom: {} as never,
  }
  return presetChipLabel(profile)
}

// --- 固定キー (変更できない下限 / 上限) の宣言 (#712 §3.7 / §3.8 / §5.3 / §6.1) ---

const INSTRUCTION_RULE = {
  keys: AI_INSTRUCTION_KEYS,
  reason: 'AI への指示チャネルは第三者には開放できません',
  fixedValue: false,
} as const
const TASKS_RULE = {
  keys: ['tasks.run'],
  reason: 'タスクは本人と AI のみが実行できます',
  fixedValue: false,
} as const
const EXTERNAL_FLOOR_RULE = {
  keys: EXTERNAL_READ_FLOOR,
  reason:
    '共有プロファイルでは Misskey の read は常に許可 — 遮断するにはトークンを失効',
  fixedValue: true,
} as const

const PLUGIN_DISABLED = [INSTRUCTION_RULE, TASKS_RULE]
const EXTERNAL_DISABLED = [INSTRUCTION_RULE, TASKS_RULE, EXTERNAL_FLOOR_RULE]

// --- 状態依存 chip: vault.use 実効 ON かつ開示接続 0 件 (#712 §6.3) ---

const aiVaultChip = computed(() => {
  void permissionsFile.value
  const vaultUse =
    resolveForProfiled('ai.chat')['vault.use'] ||
    resolveForProfiled('ai.heartbeat')['vault.use']
  if (!vaultUse) return false
  return !vault.connections.value.some((c) => c.exposedTo?.includes('ai'))
})
const pluginVaultChip = computed(() => {
  void permissionsFile.value
  if (!resolveForProfiled('plugin')['vault.use']) return false
  return !vault.connections.value.some((c) => c.exposedTo?.includes('plugin'))
})
const externalVaultChip = computed(() => {
  void permissionsFile.value
  if (!resolveForProfiled('external')['vault.use']) return false
  return !vault.connections.value.some((c) => c.exposedTo?.includes('external'))
})

function openConnections() {
  windowsStore.open('connections')
}

// --- 永続 API トークン (#709 — 外部アプリ行に併設 #712 §8.1) ---
// トークン (= 誰) と権限 (= 何を) が同じ場所にあることが principal 概念を
// 「触ればわかる」にする要。「read を遮断したい」の正解 (トークン失効) が
// chip の指す先すぐ下にある。

const apiTokens = ref<ApiTokenMeta[]>([])
const newTokenName = ref('')
const createdToken = ref<{ name: string; token: string } | null>(null)
const tokenError = ref('')
const copied = ref(false)

async function refreshApiTokens(): Promise<void> {
  try {
    apiTokens.value = await commands.listApiTokens()
  } catch {
    // 非 Tauri (ブラウザ dev) では invoke 不可 — 空のまま
  }
}

async function createToken(): Promise<void> {
  const name = newTokenName.value.trim()
  if (!name) return
  tokenError.value = ''
  try {
    const created = unwrap(await commands.createApiToken(name))
    createdToken.value = { name: created.meta.name, token: created.token }
    newTokenName.value = ''
    await refreshApiTokens()
  } catch (e) {
    tokenError.value = e instanceof Error ? e.message : String(e)
  }
}

async function revokeToken(id: string): Promise<void> {
  tokenError.value = ''
  try {
    unwrap(await commands.revokeApiToken(id))
    await refreshApiTokens()
  } catch (e) {
    tokenError.value = e instanceof Error ? e.message : String(e)
  }
}

function copyCreatedToken(): void {
  if (!createdToken.value) return
  navigator.clipboard.writeText(createdToken.value.token)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 1500)
}

function formatTokenDate(t: ApiTokenMeta): string {
  return new Date(t.createdAtMs).toLocaleDateString()
}

onMounted(refreshApiTokens)

const ROWS: readonly {
  id: ProfiledPrincipalId
  icon: string
  label: string
  hint: string
}[] = [
  {
    id: 'ai.chat',
    icon: 'ti-robot',
    label: 'AI チャット',
    hint: 'AI の tool calling (チャット / コマンド / タスク) に許可する操作',
  },
  {
    id: 'ai.heartbeat',
    icon: 'ti-activity',
    label: 'HEARTBEAT',
    hint: '無人で定期実行される AI daemon に許可する操作 (チャットとは独立)',
  },
  {
    id: 'plugin',
    icon: 'ti-puzzle',
    label: 'AiScript',
    hint: 'AiScript プラグイン / ウィジェット / Play に許可する操作',
  },
  {
    id: 'external',
    icon: 'ti-plug-connected',
    label: '外部アプリ',
    hint: 'HTTP API (永続トークン) 経由の外部アプリに許可する操作',
  },
]

function disabledFor(id: ProfiledPrincipalId) {
  if (id === 'plugin') return PLUGIN_DISABLED
  if (id === 'external') return EXTERNAL_DISABLED
  return undefined
}

// --- 「今後確認しない」の一覧・取り消し (#714) ---
// 記憶は dispatcher が confirmSkips に書く。ここは袋小路にしないための導線 —
// scope (ai.chat / plugin 個体) ごとの記憶を該当 principal 行に出して外せる。

interface ConfirmSkipEntry {
  scope: string
  capabilityId: string
  label: string
  /** plugin 行のみ: どの個体 (プラグイン / ウィジェット) の記憶か */
  owner: string | null
}

function confirmSkipEntriesFor(id: ProfiledPrincipalId): ConfirmSkipEntry[] {
  const skips = permissionsFile.value.confirmSkips
  const scopes =
    id === 'ai.chat'
      ? ['ai.chat']
      : id === 'plugin'
        ? Object.keys(skips).filter((s) => s.startsWith('plugin:'))
        : []
  return scopes.flatMap((scope) =>
    (skips[scope] ?? []).map((capabilityId) => ({
      scope,
      capabilityId,
      label: getCapability(capabilityId)?.label ?? capabilityId,
      owner:
        id === 'plugin'
          ? pluginOwnerLabel(scope.slice('plugin:'.length))
          : null,
    })),
  )
}

/** plugin scope の個体表示名。installId ではなく配布名 (AtCoder 等) を出す。 */
function pluginOwnerLabel(pluginId: string): string | null {
  const name = pluginId.startsWith('widget:')
    ? widgetsStore.widgets.find(
        (w) => w.installId === pluginId.slice('widget:'.length),
      )?.name
    : pluginsStore.plugins.find((p) => p.installId === pluginId)?.name
  return principalActorLabel({ kind: 'plugin', pluginId, name })
}

// --- Actions (footer — 他の設定ウィンドウと同じ import / export / reset) ---

const {
  copied: copiedMessage,
  importFeedback: importedMessage,
  importError,
  copyToClipboard,
  readFromClipboard,
  showImported,
  showImportError,
} = useClipboardFeedback()

async function exportConfig() {
  await copyToClipboard(formatRaw(permissionsFile.value))
}

async function importConfig() {
  const text = await readFromClipboard()
  if (!text) {
    showImportError()
    return
  }
  try {
    const parsed = JSON5.parse(text) as Partial<PermissionsFileConfig>
    permissionsFile.value = normalizePermissionsFile(parsed)
    savePermissions()
    showImported()
  } catch {
    showImportError()
  }
}

const { confirming: confirmingReset, trigger: triggerReset } =
  useDoubleConfirm()
function handleReset() {
  triggerReset(() => {
    permissionsFile.value = defaultPermissionsFile()
    savePermissions()
  })
}
</script>

<template>
  <div ref="editorRef" :class="$style.wrap">
    <EditorTabs
      v-model="tab"
      :tabs="[
        { value: 'visual', icon: 'adjustments', label: '権限' },
        { value: 'json', icon: 'braces', label: 'permissions.json5' },
      ]"
    />

    <!-- ビジュアルタブ -->
    <div
      v-show="tab === 'visual'"
      :class="$style.content"
      @change="scheduleSave"
      @click="scheduleSave"
    >
      <div v-for="row in ROWS" :key="row.id" :class="$style.principalRow">
      <button class="_button" :class="$style.rowHeader" @click="toggleRow(row.id)">
        <i :class="'ti ' + row.icon" />
        <span :class="$style.rowLabel">{{ row.label }}</span>
        <span :class="$style.chip">{{ chipFor(row.id) }}</span>
        <i
          class="ti ti-chevron-down"
          :class="[$style.chevron, { [$style.chevronOpen]: expanded === row.id }]"
        />
      </button>
      <div v-if="expanded === row.id" :class="$style.rowBody">
        <p :class="$style.hint">{{ row.hint }}</p>

        <div
          v-if="(row.id === 'ai.chat' && aiVaultChip) || (row.id === 'plugin' && pluginVaultChip) || (row.id === 'external' && externalVaultChip)"
          :class="$style.stateChip"
        >
          <i class="ti ti-info-circle" />
          <span>開示された接続がまだありません —</span>
          <button class="_button" :class="$style.chipAction" @click="openConnections">
            接続一覧を開く
          </button>
        </div>

        <PermissionProfileEditor
          :principal-id="row.id"
          :disabled-keys="disabledFor(row.id)"
        />

        <!-- 「今後確認しない」で記憶した操作の一覧・取り消し (#714) -->
        <div
          v-if="confirmSkipEntriesFor(row.id).length > 0"
          :class="$style.tokenSection"
        >
          <div :class="$style.tokenSectionLabel">確認なしで実行できる操作</div>
          <div :class="$style.hint">
            確認ダイアログで「今後この操作を確認しない」を選んだ操作。取り消すと次回から再び確認されます。
          </div>
          <div :class="$style.tokenList">
            <div
              v-for="entry in confirmSkipEntriesFor(row.id)"
              :key="entry.scope + '/' + entry.capabilityId"
              :class="$style.tokenRow"
            >
              <i class="ti ti-shield-check" :class="$style.tokenIcon" />
              <span :class="$style.tokenName">{{ entry.label }}</span>
              <span v-if="entry.owner" :class="$style.skipOwner">{{ entry.owner }}</span>
              <button
                class="_button"
                :class="$style.tokenRevoke"
                title="取り消す"
                @click="removeConfirmSkip(entry.scope, entry.capabilityId)"
              >
                <i class="ti ti-x" />
              </button>
            </div>
          </div>
        </div>

        <!-- 外部アプリ行: 永続 API トークン管理を併設 (#712 §8.1) -->
        <div v-if="row.id === 'external'" :class="$style.tokenSection">
          <div :class="$style.tokenSectionLabel">永続 API トークン</div>
          <div :class="$style.hint">
            再起動を跨いで使える名前付きトークン。本体はハッシュのみ保存され、発行時に一度だけ表示されます。
          </div>
          <div v-if="apiTokens.length > 0" :class="$style.tokenList">
            <div v-for="t in apiTokens" :key="t.id" :class="$style.tokenRow">
              <i class="ti ti-key" :class="$style.tokenIcon" />
              <span :class="$style.tokenName">{{ t.name }}</span>
              <span :class="$style.tokenDate">{{ formatTokenDate(t) }}</span>
              <button
                class="_button"
                :class="$style.tokenRevoke"
                title="失効"
                @click="revokeToken(t.id)"
              >
                <i class="ti ti-trash" />
              </button>
            </div>
          </div>
          <div :class="$style.tokenCreateRow">
            <input
              v-model="newTokenName"
              :class="$style.input"
              type="text"
              placeholder="トークン名 (例: Raycast, Claude Cowork)"
              @keydown.enter="createToken"
            />
            <button
              class="_button"
              :class="$style.tokenCreateButton"
              :disabled="!newTokenName.trim()"
              @click="createToken"
            >
              発行
            </button>
          </div>
          <div v-if="createdToken" :class="$style.tokenCreated">
            <div :class="$style.hint">
              <i class="ti ti-alert-triangle" />
              「{{ createdToken.name }}」のトークン — この表示を閉じると再表示できません
            </div>
            <div :class="$style.tokenValueRow">
              <code :class="$style.tokenValue">{{ createdToken.token }}</code>
              <button class="_button" :class="$style.tokenCreateButton" @click="copyCreatedToken">
                <i class="ti ti-copy" />
                {{ copied ? 'コピーしました' : 'コピー' }}
              </button>
            </div>
          </div>
          <div v-if="tokenError" :class="$style.errorMessage">
            <i class="ti ti-alert-triangle" />
            {{ tokenError }}
          </div>
        </div>
      </div>
      </div>
    </div>

    <!-- permissions.json5 raw editor tab -->
    <div v-show="tab === 'json'" :class="$style.codePanel">
      <div :class="$style.codeHint">
        permissions.json5 を直接編集できます。principal (ai.chat / ai.heartbeat /
        plugin / external) ごとの preset と custom マップを持ちます。
      </div>
      <CodeEditor
        v-model="rawJson"
        :language="jsonLang"
        :linter="json5Linter"
        :class="$style.codeEditorWrap"
        auto-height
      />
      <div :class="$style.codeStatus">
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

    <!-- Actions (footer) -->
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

<style module lang="scss">
@use '@/styles/buttons' as *;

.wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.codePanel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.codeHint {
  font-size: 0.75em;
  color: var(--nd-fg);
  opacity: 0.6;
  line-height: 1.4;
}

.codeEditorWrap {
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  flex-shrink: 0; // .principalRow と同じ理由 (overflow: hidden との組合せ)
  overflow: hidden;
}

.codeStatus {
  min-height: 1.2em;
}

.codeSuccess {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--nd-success, var(--nd-link));
  font-size: 0.78em;
}

.principalRow {
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  // overflow: hidden は flex item の自動最小サイズを 0 にするため、.content が
  // 窓の max-height に達すると行が圧縮されて中身がクリップされる (スクロールも
  // 発火しない)。shrink を止めて超過分を .content の overflow-y に流す
  flex-shrink: 0;
  overflow: hidden;
}

.rowHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  color: var(--nd-fg);
  font-size: 0.85em;
  text-align: left;

  &:hover { background: var(--nd-buttonHoverBg); }

  > i:first-child { font-size: 16px; flex-shrink: 0; }
}

.rowLabel {
  font-weight: bold;
}

.chip {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--nd-accentedBg);
  color: var(--nd-accent);
  font-size: 0.8em;
  white-space: nowrap;
}

.chevron {
  margin-left: auto;
  opacity: 0.4;
  transition: transform var(--nd-duration-base);
}

.chevronOpen {
  transform: rotate(180deg);
}

.rowBody {
  padding: 4px 12px 12px;
  border-top: 1px solid color-mix(in srgb, var(--nd-divider) 50%, transparent);
}

.hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 8px;
  font-size: 0.75em;
  color: var(--nd-fg);
  opacity: 0.65;
  line-height: 1.4;
}

.stateChip {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
  font-size: 0.78em;
  color: var(--nd-fg);
  opacity: 0.8;
}

.chipAction {
  color: var(--nd-link);
  font-size: 1em;
  text-decoration: underline;
}

.tokenSection {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--nd-divider) 50%, transparent);
}

.tokenSectionLabel {
  font-size: 0.8em;
  font-weight: bold;
  color: var(--nd-fg);
  margin-bottom: 4px;
}

.tokenList {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.tokenRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  font-size: 0.8em;
}

.tokenIcon {
  opacity: 0.6;
}

.tokenName {
  flex: 1;
  color: var(--nd-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tokenDate {
  color: var(--nd-fg);
  opacity: 0.5;
  font-size: 0.9em;
}

.skipOwner {
  color: var(--nd-fg);
  opacity: 0.5;
  font-size: 0.9em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40%;
}

.tokenRevoke {
  color: var(--nd-love);
  padding: 2px 4px;

  &:hover { opacity: 0.8; }
}

.tokenCreateRow {
  display: flex;
  gap: 6px;
}

.input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.8em;
}

.tokenCreateButton {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  font-size: 0.8em;

  &:hover:not(:disabled) { background: var(--nd-buttonHoverBg); }
  &:disabled { opacity: 0.5; }
}

.tokenCreated {
  margin-top: 8px;
}

.tokenValueRow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.tokenValue {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  font-size: 0.75em;
  overflow-x: auto;
  white-space: nowrap;
}

.errorMessage {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  color: var(--nd-love);
  font-size: 0.78em;
}

// --- Actions (footer) ---

.actions { @include action-bar; }
.actionGroup { @include action-group; }

.actionBtn {
  &.secondary { @include btn-action; }
  &.danger { @include btn-danger-ghost; }
}

.secondary { /* modifier */ }
.feedback { /* modifier */ }
.danger { /* modifier */ }
.confirming { /* modifier */ }
</style>
