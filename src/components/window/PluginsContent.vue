<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  abortPlugin,
  getPluginLogs,
  launchPlugin,
  parsePluginMeta,
} from '@/aiscript/plugin-api'
import EditorTabs from '@/components/common/EditorTabs.vue'
import AiScriptEditor from '@/components/deck/widgets/AiScriptEditor.vue'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useDoubleConfirm } from '@/composables/useDoubleConfirm'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { useWindowExternalFile } from '@/composables/useWindowExternalFile'
import { type PluginMeta, usePluginsStore } from '@/stores/plugins'
import { pluginSrcFilename } from '@/utils/settingsFs'

const props = defineProps<{
  initialPluginId?: string
  initialTab?: string
  /** プラグインカラム経由で開いた場合の紐付け対象 account id 一覧。
   *  - per-account カラム: [accountId]
   *  - 全アカウントカラム: 全 logged-in account の id
   *  保存時 installedFor に追加される。 */
  initialAccountIds?: string[]
}>()

const pluginsStore = usePluginsStore()

// 編集中プラグイン
const editingPluginId = ref(props.initialPluginId ?? null)

const plugin = computed(() =>
  editingPluginId.value
    ? pluginsStore.getPlugin(editingPluginId.value)
    : undefined,
)

const pluginLogs = computed(() =>
  editingPluginId.value ? getPluginLogs(editingPluginId.value) : [],
)

// 新規インストールモード
const isNewInstall = computed(() => !plugin.value)

// --- Tabs ---
const tabOptions = computed<readonly ('config' | 'code' | 'logs')[]>(() => {
  if (isNewInstall.value) {
    return ['code']
  }
  const tabs: ('config' | 'code' | 'logs')[] = ['code']
  if (plugin.value?.config && Object.keys(plugin.value.config).length > 0) {
    tabs.unshift('config')
  }
  if (pluginLogs.value.length > 0) {
    tabs.push('logs')
  }
  return tabs
})

const defaultTab = computed(() => {
  if (isNewInstall.value) return 'code'
  if (props.initialTab === 'code') return 'code'
  if (plugin.value?.config && Object.keys(plugin.value.config).length > 0)
    return 'config'
  return 'code'
})

const { tab, containerRef: editorRef } = useEditorTabs(
  tabOptions,
  (defaultTab.value as 'config' | 'code' | 'logs') ?? 'code',
)

useWindowExternalFile(() => {
  if (tab.value !== 'code' || isNewInstall.value) return null
  const p = plugin.value
  if (!p) return null
  return {
    name: pluginSrcFilename(p.name || p.installId),
    subdir: 'plugins',
  }
})

const tabDefs = computed(() => {
  const defs: { value: string; icon: string; label: string }[] = []
  for (const t of tabOptions.value) {
    if (t === 'config')
      defs.push({ value: 'config', icon: 'settings', label: '設定' })
    if (t === 'code')
      defs.push({ value: 'code', icon: 'code', label: 'コード' })
    if (t === 'logs')
      defs.push({
        value: 'logs',
        icon: 'list',
        label: `ログ (${pluginLogs.value.length})`,
      })
  }
  return defs
})

// --- Code editing ---
const editingCode = ref('')
const codeModified = ref(false)

function initCode() {
  if (plugin.value) {
    editingCode.value = plugin.value.src
  } else {
    editingCode.value = ''
  }
  codeModified.value = false
}
initCode()

watch(editingCode, (val) => {
  if (plugin.value) {
    codeModified.value = val !== plugin.value.src
  }
})

watch(tab, (t) => {
  if (t === 'code' && plugin.value) {
    editingCode.value = plugin.value.src
    codeModified.value = false
  }
})

async function saveCode() {
  if (!plugin.value) return
  pluginsStore.updateSrc(plugin.value.installId, editingCode.value)
  codeModified.value = false

  if (plugin.value.active) {
    abortPlugin(plugin.value.installId)
    await launchPlugin({ ...plugin.value, src: editingCode.value })
  }
}

// --- Install ---
const installError = ref<string | null>(null)

async function doInstall() {
  installError.value = null
  const code = editingCode.value.trim()
  if (!code) {
    installError.value = 'コードを入力してください'
    return
  }

  const meta = parsePluginMeta(code)
  if (!meta) {
    installError.value =
      'メタデータが見つかりません。### { name: "...", version: "..." } ヘッダーが必要です'
    return
  }

  if (pluginsStore.isDuplicate(meta.name)) {
    installError.value = `"${meta.name}" は既にインストールされています`
    return
  }

  const configData: Record<string, unknown> = {}
  if (meta.config) {
    for (const [key, def] of Object.entries(meta.config)) {
      configData[key] = def.default
    }
  }

  const ids = props.initialAccountIds ?? []
  const newPlugin: PluginMeta = {
    installId: `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: meta.name,
    version: meta.version,
    author: meta.author,
    description: meta.description,
    permissions: meta.permissions,
    config: meta.config,
    configData,
    src: code,
    active: true,
    ...(ids.length > 0 ? { installedFor: ids } : {}),
  }

  pluginsStore.addPlugin(newPlugin)
  await launchPlugin(newPlugin)

  editingPluginId.value = newPlugin.installId
  tab.value = 'config'
}

// --- Rename ---
const isRenaming = ref(false)
const renamingValue = ref('')

function startRename() {
  if (!plugin.value) return
  renamingValue.value = plugin.value.name
  isRenaming.value = true
}

function commitRename() {
  if (!plugin.value) return
  const newName = renamingValue.value.trim()
  if (newName && newName !== plugin.value.name) {
    pluginsStore.renamePlugin(plugin.value.installId, newName)
  }
  isRenaming.value = false
}

function cancelRename() {
  isRenaming.value = false
}

// --- Config ---
function updateConfig(key: string, value: unknown) {
  if (!plugin.value) return
  const newData = { ...plugin.value.configData, [key]: value }
  pluginsStore.updateConfigData(plugin.value.installId, newData)
}

function resetConfig(key: string) {
  if (!plugin.value?.config?.[key]) return
  updateConfig(key, plugin.value.config[key].default)
}

function isConfigCustomized(key: string): boolean {
  if (!plugin.value?.config?.[key]) return false
  return plugin.value.configData[key] !== plugin.value.config[key].default
}

const { confirming: confirmingResetConfig, trigger: triggerResetConfig } =
  useDoubleConfirm()

function handleResetAllConfig() {
  if (!plugin.value?.config) return
  triggerResetConfig(() => {
    if (!plugin.value?.config) return
    const defaults: Record<string, unknown> = {}
    for (const [key, def] of Object.entries(plugin.value.config)) {
      defaults[key] = def.default
    }
    pluginsStore.updateConfigData(plugin.value.installId, defaults)
  })
}

const hasCustomConfig = computed(() => {
  if (!plugin.value?.config) return false
  return Object.keys(plugin.value.config).some((key) => isConfigCustomized(key))
})

// --- Clipboard ---
const {
  copied: copiedMessage,
  imported: importedMessage,
  importError: importClipError,
  copyToClipboard,
  readFromClipboard,
  showImported,
  showImportError,
} = useClipboardFeedback()

async function exportPlugin() {
  if (!plugin.value) return
  await copyToClipboard(plugin.value.src)
}

async function importPlugin() {
  const text = await readFromClipboard()
  if (!text?.trim()) {
    showImportError()
    return
  }
  editingCode.value = text
  tab.value = 'code'
  showImported()
}
</script>

<template>
  <div ref="editorRef" :class="$style.pluginsContent">
    <!-- Header: plugin meta (existing plugin only) -->
    <div v-if="plugin" :class="$style.header">
      <div :class="$style.headerIcon">
        <i class="ti ti-puzzle" />
      </div>
      <div :class="$style.headerMeta">
        <div v-if="isRenaming" :class="$style.renameRow">
          <input
            v-model="renamingValue"
            :class="$style.renameInput"
            type="text"
            @keydown.enter="commitRename"
            @keydown.escape="cancelRename"
            @blur="commitRename"
          />
        </div>
        <div v-else :class="$style.nameRow">
          <span :class="$style.headerName">{{ plugin.name }}</span>
          <button class="_button" :class="$style.renameBtn" title="名前を変更" @click="startRename">
            <i class="ti ti-pencil" />
          </button>
        </div>
        <div :class="$style.headerSub">
          v{{ plugin.version }}
          <template v-if="plugin.author"> · {{ plugin.author }}</template>
          <span v-if="plugin.active" :class="$style.statusBadge">有効</span>
          <span v-else :class="[$style.statusBadge, $style.statusBadgeInactive]">無効</span>
        </div>
        <div v-if="plugin.description" :class="$style.headerDesc">{{ plugin.description }}</div>
      </div>
    </div>

    <!-- Tabs -->
    <EditorTabs
      v-if="!isNewInstall"
      v-model="tab"
      :tabs="tabDefs"
    />

    <!-- Config tab -->
    <div v-if="!isNewInstall && tab === 'config' && plugin?.config" :class="$style.configPanel">
      <div :class="$style.configList">
        <div
          v-for="(def, key) in plugin.config"
          :key="key"
          :class="[$style.configItem, { [$style.configItemCustomized]: isConfigCustomized(key as string) }]"
        >
          <div :class="$style.configHeader">
            <label :class="$style.configLabel">{{ def.label }}</label>
            <button
              v-if="isConfigCustomized(key as string)"
              class="_button"
              :class="$style.configResetBtn"
              title="デフォルトに戻す"
              @click="resetConfig(key as string)"
            >
              <i class="ti ti-rotate" />
            </button>
          </div>
          <p v-if="def.description" :class="$style.configDesc">{{ def.description }}</p>
          <template v-if="def.type === 'boolean'">
            <button
              class="nd-toggle-switch"
              :class="{ on: !!plugin.configData[key] }"
              role="switch"
              :aria-checked="!!plugin.configData[key]"
              @click="updateConfig(key as string, !plugin.configData[key])"
            >
              <span class="nd-toggle-switch-knob" />
            </button>
          </template>
          <template v-else-if="def.type === 'string'">
            <input
              :class="$style.configInput"
              type="text"
              :value="plugin.configData[key] as string"
              :placeholder="String(def.default ?? '')"
              @change="updateConfig(key as string, ($event.target as HTMLInputElement).value)"
            />
          </template>
          <template v-else-if="def.type === 'number'">
            <input
              :class="$style.configInput"
              type="number"
              :value="plugin.configData[key] as number"
              :placeholder="String(def.default ?? '')"
              @change="updateConfig(key as string, Number(($event.target as HTMLInputElement).value))"
            />
          </template>
        </div>
      </div>
      <button
        v-if="hasCustomConfig"
        class="_button"
        :class="[$style.resetAllBtn, { [$style.confirming]: confirmingResetConfig }]"
        @click="handleResetAllConfig"
      >
        <i class="ti ti-rotate" />
        {{ confirmingResetConfig ? '本当にリセット？' : 'すべてデフォルトに戻す' }}
      </button>
    </div>

    <!-- Code tab -->
    <div v-show="isNewInstall || tab === 'code'" :class="$style.codePanel">
      <p v-if="isNewInstall" :class="$style.codeHint">
        AiScript プラグインコードを貼り付けてインストール
      </p>
      <p v-else :class="$style.codeHint">
        プラグインの AiScript ソースコード — 編集後「保存して再起動」で反映
      </p>
      <AiScriptEditor
        v-model="editingCode"
        :placeholder="isNewInstall ? '### { name: &quot;my-plugin&quot;, version: &quot;1.0&quot; } ...' : ''"
        auto-height
      />
      <div v-if="installError" :class="$style.errorMessage">
        <i class="ti ti-alert-circle" />
        {{ installError }}
      </div>
    </div>

    <!-- Logs tab -->
    <div v-if="!isNewInstall && tab === 'logs'" :class="$style.logsPanel">
      <div v-if="pluginLogs.length > 0" :class="$style.logsList">
        <div
          v-for="(log, i) in pluginLogs"
          :key="i"
          :class="[$style.logLine, { [$style.logError]: log.isError }]"
        >
          {{ log.text }}
        </div>
      </div>
      <div v-else :class="$style.logsEmpty">
        ログはありません
      </div>
    </div>

    <!-- Actions -->
    <div :class="$style.actions">
      <template v-if="plugin">
        <div :class="$style.actionGroup">
          <button
            class="_button"
            :class="[$style.actionBtn, $style.secondary, { [$style.feedback]: importedMessage || importClipError }]"
            @click="importPlugin"
          >
            <i class="ti" :class="importClipError ? 'ti-alert-circle' : 'ti-clipboard-text'" />
            {{ importClipError ? '無効' : importedMessage ? '読込済み' : 'インポート' }}
          </button>
          <button
            class="_button"
            :class="[$style.actionBtn, $style.secondary, { [$style.feedback]: copiedMessage }]"
            @click="exportPlugin"
          >
            <i class="ti ti-clipboard-copy" />
            {{ copiedMessage ? 'コピー済み' : 'エクスポート' }}
          </button>
        </div>
        <button
          v-if="codeModified"
          class="_button"
          :class="[$style.actionBtn, $style.primary]"
          @click="saveCode"
        >
          <i class="ti ti-device-floppy" />
          保存して再起動
        </button>
      </template>
      <template v-else>
        <button
          class="_button"
          :class="[$style.actionBtn, $style.primary, $style.full]"
          @click="doInstall"
        >
          <i class="ti ti-download" />
          インストール
        </button>
      </template>
    </div>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.pluginsContent {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

// --- Header ---
.header {
  display: flex;
  gap: 12px;
  padding: 14px 12px;
  border-bottom: 1px solid var(--nd-divider);
  flex-shrink: 0;
}

.headerIcon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border-radius: 6px;
  background: color-mix(in srgb, var(--nd-accent) 12%, transparent);
  color: var(--nd-accent);
  font-size: 24px;
}

.headerMeta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nameRow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.headerName {
  font-size: 1.05em;
  font-weight: 700;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.renameBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0;
  font-size: 0.85em;
  transition:
    opacity var(--nd-duration-fast),
    background var(--nd-duration-fast);

  .nameRow:hover & {
    opacity: 0.5;
  }

  &:hover {
    opacity: 1 !important;
    background: var(--nd-buttonHoverBg);
  }
}

.renameRow {
  display: flex;
}

.renameInput {
  flex: 1;
  padding: 2px 6px;
  border: 1px solid var(--nd-accent);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-inputBg, var(--nd-bg));
  color: var(--nd-fgHighlighted);
  font-size: 1.05em;
  font-weight: 700;

  &:focus {
    outline: none;
  }
}

.headerSub {
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.6;
  display: flex;
  align-items: center;
  gap: 6px;
}

.statusBadge {
  font-size: 0.85em;
  padding: 0 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--nd-success, #4caf50) 15%, transparent);
  color: var(--nd-success, #4caf50);
  line-height: 1.6;
}

.statusBadgeInactive {
  background: color-mix(in srgb, var(--nd-fg) 10%, transparent);
  color: var(--nd-fg);
  opacity: 0.5;
}

.headerDesc {
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.45;
  margin-top: 2px;
}

// --- Config tab ---
.configPanel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
  padding: 8px 10px;
  gap: 8px;
}

.configList {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.configItem {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: var(--nd-radius-sm);
  transition: background var(--nd-duration-fast);
}

.configItemCustomized {
  background: color-mix(in srgb, var(--nd-accent) 6%, transparent);
}

.configHeader {
  display: flex;
  align-items: center;
  gap: 4px;
}

.configLabel {
  font-size: 0.85em;
  font-weight: bold;
  color: var(--nd-fgHighlighted);
}

.configResetBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.4;
  font-size: 0.8em;
  transition:
    opacity var(--nd-duration-fast),
    background var(--nd-duration-fast);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
    color: var(--nd-accent);
  }
}

.configDesc {
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.6;
  margin: 0;
}

.configInput {
  padding: 6px 10px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-inputBg, var(--nd-bg));
  color: var(--nd-fg);
  font-size: 0.85em;

  &::placeholder {
    opacity: 0.35;
  }

  &:focus {
    outline: none;
    border-color: var(--nd-accent);
  }
}

.resetAllBtn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 0.78em;
  color: var(--nd-fg);
  opacity: 0.5;
  border-radius: var(--nd-radius-sm);
  transition:
    opacity var(--nd-duration-fast),
    background var(--nd-duration-fast),
    color var(--nd-duration-fast);

  &:hover {
    opacity: 0.8;
    background: var(--nd-buttonHoverBg);
  }

  &.confirming {
    color: var(--nd-love);
    opacity: 1;
  }
}

// --- Code tab ---
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
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.4;
  margin: 0;
}

.errorMessage {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: var(--nd-radius-sm);
  background: color-mix(in srgb, var(--nd-love) 10%, transparent);
  color: var(--nd-love);
  font-size: 0.85em;
}

// --- Logs tab ---
.logsPanel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.logsList {
  background: var(--nd-codeEditorBg, #1e1e1e);
  font-family: monospace;
  font-size: 0.8em;
  min-height: 100%;
}

.logLine {
  color: var(--nd-fg);
  padding: 2px 8px;
  white-space: pre-wrap;
  word-break: break-all;

  &.logError {
    color: var(--nd-love);
  }
}

.logsEmpty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: var(--nd-fg);
  opacity: 0.4;
  font-size: 0.85em;
}

// --- Actions ---
.actions { @include action-bar; }
.actionGroup { @include action-group; }

.actionBtn {
  &.secondary { @include btn-action; }
  &.primary { @include btn-primary; }
  &.full { width: 100%; }
}

/* Empty placeholder classes for dynamic binding */
.secondary {}
.feedback {}
.confirming {}
.primary {}
.full {}
</style>
