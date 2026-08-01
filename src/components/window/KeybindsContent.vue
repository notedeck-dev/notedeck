<script setup lang="ts">
import { json } from '@codemirror/lang-json'
import { type Diagnostic, linter } from '@codemirror/lint'
import { computed, reactive, ref, watch } from 'vue'
import type { Shortcut } from '@/commands/registry'
import EditorTabs from '@/components/common/EditorTabs.vue'
import CodeEditor from '@/components/deck/widgets/CodeEditor.vue'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useDoubleConfirm } from '@/composables/useDoubleConfirm'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { useWindowExternalFile } from '@/composables/useWindowExternalFile'
import { useKeybindsStore } from '@/stores/keybinds'
import { STORAGE_KEYS, setStorageJson } from '@/utils/storage'

const jsonLang = json()

const jsonLinter = linter(
  (view) => {
    const diagnostics: Diagnostic[] = []
    const code = view.state.doc.toString()
    if (!code.trim()) return diagnostics
    try {
      JSON.parse(code)
    } catch (e) {
      if (e instanceof Error) {
        diagnostics.push({
          from: 0,
          to: code.length,
          severity: 'error',
          message: e.message,
        })
      }
    }
    return diagnostics
  },
  { delay: 500 },
)

const keybindsStore = useKeybindsStore()

const props = defineProps<{
  initialTab?: string
}>()

// ── Tab management ──
const { tab, containerRef: contentRef } = useEditorTabs(
  ['visual', 'code'] as const,
  (props.initialTab as 'visual' | 'code') ?? 'visual',
)

useWindowExternalFile(() =>
  tab.value === 'code' ? { name: 'keybinds.json5' } : null,
)

// ── Visual tab: category-based GUI ──
const commandIds = keybindsStore.getAllCommandIds()

const COMMAND_LABELS: Record<string, string> = {
  'command-palette': 'コマンドパレット',
  search: '検索',
  notifications: '通知',
  compose: 'ノート作成',
  'add-column': 'カラム追加',
  'toggle-sidebar': 'サイドバー切替',
  'boss-key': 'ウィンドウを隠す',
  'account-menu': 'アカウントメニュー',
  'toggle-dark-mode': 'ダークモード切替',
  'note-next': '次のノート',
  'note-prev': '前のノート',
  'note-reply': '返信',
  'note-react': 'リアクション',
  'note-renote': 'リノート / 引用',
  'note-bookmark': 'ブックマーク',
  'note-open': 'ノートを開く',
  'note-cw': 'CW切替',
  'column-next': '次のカラム',
  'column-prev': '前のカラム',
  'pop-out-column': 'カラムを別ウィンドウ',
  'new-window': '新規ウィンドウ',
  'close-all-windows': '全ウィンドウを閉じる',
  'pip-window': 'PiPウィンドウ',
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [
      `column-${i + 1}`,
      `カラム ${i + 1} に移動`,
    ]),
  ),
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [
      `quick-react-${i + 1}`,
      `クイックリアクション ${i + 1}`,
    ]),
  ),
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [
      `profile-${i + 1}`,
      `プロファイル ${i + 1}`,
    ]),
  ),
}

const CATEGORY_ORDER = [
  'general',
  'navigation',
  'account',
  'column',
  'note',
  'window',
  'profile',
] as const

const COMMAND_CATEGORIES: Record<string, string> = {
  'command-palette': 'general',
  search: 'navigation',
  notifications: 'navigation',
  compose: 'general',
  'add-column': 'column',
  'toggle-sidebar': 'navigation',
  'boss-key': 'general',
  'account-menu': 'account',
  'toggle-dark-mode': 'general',
  'note-next': 'note',
  'note-prev': 'note',
  'note-reply': 'note',
  'note-react': 'note',
  'note-renote': 'note',
  'note-bookmark': 'note',
  'note-open': 'note',
  'note-cw': 'note',
  'column-next': 'column',
  'column-prev': 'column',
  'pop-out-column': 'window',
  'new-window': 'window',
  'close-all-windows': 'window',
  'pip-window': 'window',
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [`column-${i + 1}`, 'column']),
  ),
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [`quick-react-${i + 1}`, 'note']),
  ),
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [`profile-${i + 1}`, 'profile']),
  ),
}

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  general: { label: '全般', icon: 'ti-settings' },
  navigation: { label: 'ナビゲーション', icon: 'ti-compass' },
  account: { label: 'アカウント', icon: 'ti-user' },
  column: { label: 'カラム', icon: 'ti-columns' },
  note: { label: 'ノート', icon: 'ti-note' },
  window: { label: 'ウィンドウ', icon: 'ti-app-window' },
  profile: { label: 'プロファイル', icon: 'ti-id-badge-2' },
}

const expandedSections = reactive<Record<string, boolean>>({ general: true })

function toggleSection(key: string) {
  expandedSections[key] = !expandedSections[key]
}

const groupedCommands = computed(() => {
  const groups: {
    category: string
    label: string
    icon: string
    commands: string[]
  }[] = []
  for (const cat of CATEGORY_ORDER) {
    const cmds = commandIds.filter((id) => COMMAND_CATEGORIES[id] === cat)
    if (cmds.length > 0) {
      const meta = CATEGORY_LABELS[cat]
      groups.push({
        category: cat,
        label: meta?.label ?? cat,
        icon: meta?.icon ?? 'ti-folder',
        commands: cmds,
      })
    }
  }
  return groups
})

// Recording state
const recordingCommandId = ref<string | null>(null)
const recordingIndex = ref(-1)

function formatShortcut(s: Shortcut): string {
  const parts: string[] = []
  if (s.ctrl) parts.push('Ctrl')
  if (s.shift) parts.push('Shift')
  if (s.alt) parts.push('Alt')
  parts.push(s.key.length === 1 ? s.key.toUpperCase() : s.key)
  return parts.join(' + ')
}

function startRecording(commandId: string, index: number) {
  recordingCommandId.value = commandId
  recordingIndex.value = index
}

function onKeyDown(e: KeyboardEvent, commandId: string, index: number) {
  if (recordingCommandId.value !== commandId || recordingIndex.value !== index)
    return
  e.preventDefault()
  e.stopPropagation()

  if (e.key === 'Escape') {
    recordingCommandId.value = null
    return
  }

  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return

  const hasModifier = e.ctrlKey || e.metaKey || e.shiftKey || e.altKey
  const scope: Shortcut['scope'] = hasModifier ? 'global' : 'body'

  const newShortcut: Shortcut = {
    key: e.key,
    ...(e.ctrlKey || e.metaKey ? { ctrl: true } : {}),
    ...(e.shiftKey ? { shift: true } : {}),
    ...(e.altKey ? { alt: true } : {}),
    scope,
  }

  const shortcuts = [...keybindsStore.getShortcuts(commandId)]
  if (index < shortcuts.length) {
    shortcuts[index] = newShortcut
  } else {
    shortcuts.push(newShortcut)
  }
  keybindsStore.setShortcuts(commandId, shortcuts)
  recordingCommandId.value = null
}

function removeShortcut(commandId: string, index: number) {
  const shortcuts = [...keybindsStore.getShortcuts(commandId)]
  shortcuts.splice(index, 1)
  keybindsStore.setShortcuts(commandId, shortcuts)
}

function addShortcut(commandId: string) {
  const shortcuts = keybindsStore.getShortcuts(commandId)
  startRecording(commandId, shortcuts.length)
}

function resetCommand(commandId: string) {
  keybindsStore.resetToDefault(commandId)
}

// ── Code tab ──
function overridesToJson(): string {
  const overrides = keybindsStore.overrides
  if (Object.keys(overrides).length === 0) return '{}'
  return JSON.stringify(overrides, null, 2)
}

const jsonCode = ref(overridesToJson())

watch(tab, (t) => {
  if (t === 'code') {
    jsonCode.value = overridesToJson()
    codeError.value = null
  }
})

watch(
  () => keybindsStore.overrides,
  () => {
    if (tab.value === 'code') {
      const storeJson = overridesToJson()
      if (storeJson !== jsonCode.value) {
        jsonCode.value = storeJson
      }
    }
  },
  { deep: true },
)

const codeError = ref<string | null>(null)
let codeApplyTimer: ReturnType<typeof setTimeout> | null = null

watch(jsonCode, (code) => {
  if (tab.value !== 'code') return
  if (codeApplyTimer) clearTimeout(codeApplyTimer)
  codeApplyTimer = setTimeout(() => {
    try {
      JSON.parse(code)
      codeError.value = null
    } catch (e) {
      codeError.value = e instanceof Error ? e.message : 'JSONパースエラー'
    }
  }, 400)
})

function applyFromCode() {
  if (codeApplyTimer) clearTimeout(codeApplyTimer)
  const code = jsonCode.value
  try {
    const parsed = JSON.parse(code)
    codeError.value = null
    keybindsStore.overrides = parsed
    setStorageJson(STORAGE_KEYS.keybinds, parsed)
  } catch (e) {
    codeError.value = e instanceof Error ? e.message : 'JSONパースエラー'
  }
}

// ── Import/Export ──
const {
  copied: copiedMessage,
  imported: importedMessage,
  importError,
  showCopied,
  showImported,
  showImportError,
} = useClipboardFeedback()

function exportKeybinds() {
  navigator.clipboard.writeText(overridesToJson())
  showCopied()
}

async function importKeybinds() {
  try {
    const text = await navigator.clipboard.readText()
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') {
      showImportError()
      return
    }
    keybindsStore.overrides = parsed
    setStorageJson(STORAGE_KEYS.keybinds, parsed)
    jsonCode.value = overridesToJson()
    codeError.value = null
    showImported()
  } catch {
    showImportError()
  }
}

// ── Reset all with confirmation ──
const { confirming: confirmingReset, trigger: triggerReset } =
  useDoubleConfirm()

function handleReset() {
  triggerReset(() => {
    keybindsStore.resetAll()
    jsonCode.value = '{}'
    codeError.value = null
  })
}
</script>

<template>
  <div ref="contentRef" :class="$style.keybindsContent">
    <EditorTabs
      v-model="tab"
      :tabs="[
        { value: 'visual', icon: 'adjustments', label: 'ビジュアル' },
        { value: 'code', icon: 'code', label: 'コード' },
      ]"
    />

    <!-- Visual tab -->
    <div v-show="tab === 'visual'" :class="$style.visualPanel">
      <div v-for="group in groupedCommands" :key="group.category" :class="$style.section">
        <button class="_button" :class="$style.categoryHeader" @click="toggleSection(group.category)">
          <i :class="'ti ' + group.icon" />
          {{ group.label }}
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections[group.category] }]" />
        </button>
        <template v-if="expandedSections[group.category]">
          <div
            v-for="cmdId in group.commands"
            :key="cmdId"
            :class="[$style.keybindRow, { [$style.customized]: keybindsStore.isCustomized(cmdId) }]"
          >
            <div :class="$style.keybindLabel">
              {{ COMMAND_LABELS[cmdId] ?? cmdId }}
            </div>
            <div :class="$style.keybindShortcuts">
              <template v-for="(shortcut, idx) in keybindsStore.getShortcuts(cmdId)" :key="idx">
                <div
                  :class="[$style.shortcutBadge, { [$style.recording]: recordingCommandId === cmdId && recordingIndex === idx }]"
                  tabindex="0"
                  @click="startRecording(cmdId, idx)"
                  @keydown="onKeyDown($event, cmdId, idx)"
                >
                  <template v-if="recordingCommandId === cmdId && recordingIndex === idx">
                    <span :class="$style.recordingText">入力待ち...</span>
                  </template>
                  <template v-else>
                    {{ formatShortcut(shortcut) }}
                    <button class="_button" :class="$style.removeShortcut" @click.stop="removeShortcut(cmdId, idx)">
                      <i class="ti ti-x" />
                    </button>
                  </template>
                </div>
              </template>
              <button
                v-if="recordingCommandId === cmdId && recordingIndex >= keybindsStore.getShortcuts(cmdId).length"
                class="_button"
                :class="[$style.shortcutBadge, $style.recording]"
                tabindex="0"
                @keydown="onKeyDown($event, cmdId, recordingIndex)"
              >
                <span :class="$style.recordingText">入力待ち...</span>
              </button>
              <button class="_button" :class="$style.addShortcutBtn" title="ショートカットを追加" @click="addShortcut(cmdId)">
                <i class="ti ti-plus" />
              </button>
            </div>
            <button
              v-if="keybindsStore.isCustomized(cmdId)"
              class="_button"
              :class="$style.resetBtn"
              title="デフォルトに戻す"
              @click="resetCommand(cmdId)"
            >
              <i class="ti ti-restore" />
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- Code tab -->
    <div v-show="tab === 'code'" :class="$style.codePanel">
      <div :class="$style.codeHint">
        ユーザーカスタマイズの JSON（デフォルトからの差分のみ）
      </div>
      <CodeEditor
        v-model="jsonCode"
        :language="jsonLang"
        :linter="jsonLinter"
        :class="[$style.codeEditorWrap, { [$style.hasError]: codeError }]"
        auto-height
      />
      <div v-if="codeError" :class="$style.errorMessage">
        <i class="ti ti-alert-triangle" />
        {{ codeError }}
      </div>
      <div v-if="!codeError && jsonCode.trim() && jsonCode.trim() !== '{}'" :class="$style.codeSuccess">
        <i class="ti ti-check" />
        適用中
      </div>
      <button
        class="_button"
        :class="$style.codeApplyBtn"
        @click="applyFromCode"
      >
        <i class="ti ti-refresh" />
        ビジュアルに同期
      </button>
    </div>

    <!-- Actions -->
    <div :class="$style.actions">
      <div :class="$style.actionGroup">
        <button
          class="_button"
          :class="[$style.actionBtn, $style.secondary, { [$style.feedback]: importedMessage || importError }]"
          @click="importKeybinds"
        >
          <i class="ti" :class="importError ? 'ti-alert-circle' : 'ti-clipboard-text'" />
          {{ importError ? '無効' : importedMessage ? '読込済み' : 'インポート' }}
        </button>
        <button
          class="_button"
          :class="[$style.actionBtn, $style.secondary, { [$style.feedback]: copiedMessage }]"
          @click="exportKeybinds"
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

.keybindsContent {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.active {
  /* modifier */
}

.hasError {
  /* modifier */
}

.confirming {
  /* modifier */
}

// ── Visual tab ──

.visualPanel {
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
  border-bottom: 1px solid var(--nd-divider);
}

.categoryHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 10px 10px;
  font-size: 0.8em;
  font-weight: bold;
  color: var(--nd-fg);
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

.keybindRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--nd-radius-sm);
  transition: background var(--nd-duration-fast);

  &:hover {
    background: color-mix(in srgb, var(--nd-accent) 8%, transparent);
  }

  &.customized {
    background: color-mix(in srgb, var(--nd-accent) 5%, transparent);
  }
}

.customized {
  /* modifier */
}

.keybindLabel {
  flex: 1;
  font-size: 0.85em;
  color: var(--nd-fg);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.keybindShortcuts {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.shortcutBadge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--nd-buttonBg, rgba(0, 0, 0, 0.1));
  border: 1px solid var(--nd-divider);
  border-radius: 4px;
  font-size: 0.75em;
  font-family: var(--nd-font-mono);
  color: var(--nd-fg);
  cursor: pointer;
  transition: border-color var(--nd-duration-base), background var(--nd-duration-base);
  outline: none;
  min-height: 26px;

  &:hover {
    border-color: var(--nd-accent);
  }

  &:focus {
    border-color: var(--nd-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--nd-accent) 30%, transparent);
  }

  &.recording {
    border-color: var(--nd-accent);
    background: var(--nd-accent-hover);
    animation: pulse 1s infinite;
  }

  &:hover .removeShortcut {
    opacity: 0.6;
  }
}

.recording {
  /* modifier */
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.recordingText {
  font-style: italic;
  font-family: inherit;
  font-size: 1em;
  color: var(--nd-accent);
}

.removeShortcut {
  display: flex;
  align-items: center;
  font-size: 0.9em;
  opacity: 0;
  color: var(--nd-fg);
  transition: opacity var(--nd-duration-base), color var(--nd-duration-base);

  &:hover {
    opacity: 1 !important;
    color: var(--nd-love, #ec4137);
  }
}

.addShortcutBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.4;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.resetBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  font-size: 0.85em;
  color: var(--nd-fg);
  opacity: 0.4;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);
  flex-shrink: 0;

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

// ── Code tab ──

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
  &.hasError {
    box-shadow: 0 0 0 2px var(--nd-love);
    border-radius: var(--nd-radius-sm);
  }
}

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

.codeApplyBtn { @include btn-secondary; }

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
.confirming { /* modifier */ }
</style>
