<script setup lang="ts">
import { json } from '@codemirror/lang-json'
import JSON5 from 'json5'
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  useCssModule,
  watch,
} from 'vue'
import EditorTabs from '@/components/common/EditorTabs.vue'
import CodeEditor from '@/components/deck/widgets/CodeEditor.vue'
import ThemePreview from '@/components/ThemePreview.vue'
import type { EditorAction } from '@/components/window/EditorActionBar.vue'
import EditorActionBar from '@/components/window/EditorActionBar.vue'
import EditorItemHeader from '@/components/window/EditorItemHeader.vue'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { useWindowExternalFile } from '@/composables/useWindowExternalFile'
import { isExposed } from '@/settings/exposure'
import { useConfirm } from '@/stores/confirm'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import { DARK_BASE, LIGHT_BASE } from '@/theme/builtinThemes'
import { parseColor } from '@/theme/colorUtils'
import { compileMisskeyTheme } from '@/theme/compiler'
import type { MisskeyTheme } from '@/theme/types'
import { createJson5Linter } from '@/utils/json5Linter'
import { themeFilename } from '@/utils/settingsFs'

const jsonLang = json()
const jsonLinter = createJson5Linter()

const props = defineProps<{
  initialThemeId?: string
  initialTab?: string
  /** テーマカラム経由で開いた場合の紐付け対象 account id 一覧。
   *  - per-account カラム: [accountId]
   *  - 全アカウントカラム: 全 logged-in account の id
   *  保存時 installedFor に追加 + 各 account の per-column 適用が走る。 */
  initialAccountIds?: string[]
}>()

const themeStore = useThemeStore()
const { confirm } = useConfirm()

// 生ファイルを直接編集する code タブは開発者向けの面 (#1034)。この窓が
// 自分で opt-in する — タブ機構側で一律に外すと、カスタム CSS や Play 編集の
// ように code タブが唯一の編集面になっている窓を巻き添えで壊す
const editorTabs = computed(() =>
  isExposed('developer')
    ? (['visual', 'code'] as const)
    : (['visual'] as const),
)

const { tab, containerRef: editorRef } = useEditorTabs<'visual' | 'code'>(
  editorTabs,
  props.initialTab === 'code' && !isExposed('developer')
    ? 'visual'
    : ((props.initialTab as 'visual' | 'code') ?? 'visual'),
)

const themeName = ref('My Theme')
const baseMode = ref<'dark' | 'light'>('dark')
// Track the ID of the theme being edited (null = new theme)
const editingThemeId = ref<string | null>(null)

// 外部エディタ起動用: 既存テーマのみ対象（未保存は disabled）
useWindowExternalFile(() =>
  tab.value === 'code'
    ? {
        name: themeFilename(themeName.value),
        subdir: 'themes',
        disabled: !editingThemeId.value,
      }
    : null,
)

// Primary color props that users typically want to edit directly
const PRIMARY_PROPS: { key: string; label: string }[] = [
  { key: 'accent', label: 'アクセント' },
  { key: 'bg', label: '背景' },
  { key: 'fg', label: '文字色' },
  { key: 'panel', label: 'パネル' },
  { key: 'navBg', label: 'ナビバー背景' },
  { key: 'love', label: 'いいね' },
  { key: 'link', label: 'リンク' },
  { key: 'hashtag', label: 'ハッシュタグ' },
  { key: 'mention', label: 'メンション' },
  { key: 'renote', label: 'リノート' },
  { key: 'divider', label: '区切り線' },
  { key: 'success', label: '成功' },
  { key: 'error', label: 'エラー' },
  { key: 'warn', label: '警告' },
]

// Working props: only user overrides (not base theme defaults)
const overrides = ref<Record<string, string>>({})

// Snapshot for reset
let savedOverrides: Record<string, string> = {}
let savedName = 'My Theme'
let savedBaseMode: 'dark' | 'light' = 'dark'

function saveSnapshot() {
  savedOverrides = { ...overrides.value }
  savedName = themeName.value
  savedBaseMode = baseMode.value
}

function resetToSnapshot() {
  overrides.value = { ...savedOverrides }
  themeName.value = savedName
  baseMode.value = savedBaseMode
}

const hasChangesFromSnapshot = computed(() => {
  if (themeName.value !== savedName) return true
  if (baseMode.value !== savedBaseMode) return true
  const keys = new Set([
    ...Object.keys(overrides.value),
    ...Object.keys(savedOverrides),
  ])
  for (const k of keys) {
    if (overrides.value[k] !== savedOverrides[k]) return true
  }
  return false
})

const baseTheme = computed(() =>
  baseMode.value === 'dark' ? DARK_BASE : LIGHT_BASE,
)

// Compiled preview of current theme
const previewTheme = computed<MisskeyTheme>(() => ({
  id: `editor-${Date.now()}`,
  name: themeName.value,
  base: baseMode.value,
  props: { ...overrides.value },
}))

// Resolved color values for color picker display
const resolvedColors = computed(() => {
  const compiled = compileMisskeyTheme(previewTheme.value, baseTheme.value)
  return compiled
})

// Code editor content
const codeContent = ref('')
const codeError = ref<string | null>(null)

function syncCodeFromVisual() {
  const theme: MisskeyTheme = {
    id: `custom-${Date.now()}`,
    name: themeName.value,
    base: baseMode.value,
    props: { ...baseTheme.value.props, ...overrides.value },
  }
  codeContent.value = JSON.stringify(theme, null, 2)
  codeError.value = null
}

function syncVisualFromCode() {
  try {
    const parsed = JSON5.parse(codeContent.value)
    if (!parsed || typeof parsed !== 'object' || !parsed.props) {
      codeError.value = 'テーマオブジェクトに props がありません'
      return
    }
    themeName.value = parsed.name || 'Untitled'
    baseMode.value = parsed.base === 'light' ? 'light' : 'dark'
    // Filter out props that match the base theme defaults
    const base = parsed.base === 'light' ? LIGHT_BASE : DARK_BASE
    const filtered: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed.props)) {
      if (base.props[key] !== value) {
        filtered[key] = value as string
      }
    }
    overrides.value = filtered
    codeError.value = null
  } catch (e) {
    codeError.value = e instanceof Error ? e.message : 'JSONパースエラー'
  }
}

// Suppress preview during tab-switch syncs
let suppressPreview = false

// Sync between tabs when switching (immediate: populate code tab if opened directly)
watch(
  tab,
  (newTab) => {
    suppressPreview = true
    if (newTab === 'code') syncCodeFromVisual()
    if (newTab === 'visual' && codeContent.value.trim()) syncVisualFromCode()
    nextTick(() => {
      suppressPreview = false
    })
  },
  { immediate: true },
)

// Convert resolved color to hex for input[type=color]
function toHex(value: string): string {
  const rgba = parseColor(value)
  if (!rgba) return '#000000'
  const r = Math.round(rgba[0]).toString(16).padStart(2, '0')
  const g = Math.round(rgba[1]).toString(16).padStart(2, '0')
  const b = Math.round(rgba[2]).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

function resolvedHex(key: string): string {
  return toHex(resolvedColors.value[key] ?? '')
}

function resolvedDisplay(key: string): string {
  const value = resolvedColors.value[key] ?? ''
  const rgba = parseColor(value)
  if (!rgba) return '#000000'
  const hex = toHex(value)
  if (rgba[3] < 1) {
    return `${hex} (${Math.round(rgba[3] * 100)}%)`
  }
  return hex
}

function hasAlpha(key: string): boolean {
  const rgba = parseColor(resolvedColors.value[key] ?? '')
  return rgba !== null && rgba[3] < 1
}

function updateColor(key: string, hex: string) {
  overrides.value = { ...overrides.value, [key]: hex }
}

function resetProp(key: string) {
  const next = { ...overrides.value }
  delete next[key]
  overrides.value = next
}

function isOverridden(key: string): boolean {
  return key in overrides.value
}

// Get display value: override expression or base default
function displayValue(key: string): string {
  if (key in overrides.value) return overrides.value[key] ?? ''
  return baseTheme.value.props[key] ?? ''
}

// Is this prop a reference/expression (starts with @ or :)?
function isExpression(value: string): boolean {
  const v = value.trim()
  return v.startsWith('@') || v.startsWith(':') || v.startsWith('"')
}

// Apply theme to app in real-time
function applyPreview() {
  themeStore.applySource({
    kind: baseMode.value === 'dark' ? 'custom-dark' : 'custom-light',
    theme: previewTheme.value,
  })
}

// Watch overrides for live preview (50ms for responsive drag feel)
let previewTimer: ReturnType<typeof setTimeout> | null = null
watch(
  [overrides, baseMode],
  () => {
    if (suppressPreview) return
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = setTimeout(applyPreview, 50)
  },
  { deep: true },
)

// Install feedback
const installedMessage = ref(false)

function buildCurrentTheme(): MisskeyTheme {
  const id = editingThemeId.value ?? `custom-${Date.now()}`
  return {
    id,
    name: themeName.value,
    base: baseMode.value,
    props: { ...baseTheme.value.props, ...overrides.value },
  }
}

// Install as a permanent theme.
// テーマカラム経由 (initialAccountIds 指定) なら全 ids を installedFor に追加し
// 各 account の per-column theme として即時適用。設定経由など ids 無指定なら
// 従来通りグローバル選択 (selectedDarkThemeId) を更新する。
async function installTheme() {
  if (tab.value === 'code') syncVisualFromCode()
  if (codeError.value) return
  const theme = buildCurrentTheme()
  const ids = props.initialAccountIds ?? []
  await themeStore.installTheme(JSON.stringify(theme), ids)
  if (ids.length > 0) {
    for (const id of ids) {
      themeStore.applyAccountTheme(theme, baseMode.value, id)
    }
  } else {
    themeStore.selectTheme(theme.id, baseMode.value)
  }
  editingThemeId.value = theme.id
  saveSnapshot()
  installedMessage.value = true
  setTimeout(() => {
    installedMessage.value = false
  }, 2000)
}

// Export / Import
const {
  copied: copiedMessage,
  imported: importedMessage,
  importError,
  showCopied,
  showImported,
  showImportError,
} = useClipboardFeedback()

// --- 下部アクションバー (全編集ウィンドウ共通の並び) ---
const barActions = computed<EditorAction[]>(() => {
  const list: EditorAction[] = [
    {
      key: 'import',
      label: importError.value
        ? '無効'
        : importedMessage.value
          ? '読込済み'
          : 'インポート',
      icon: importError.value ? 'alert-circle' : 'clipboard-text',
    },
    {
      key: 'export',
      label: copiedMessage.value ? 'コピー済み' : 'エクスポート',
      icon: 'clipboard-copy',
    },
  ]
  if (hasChangesFromSnapshot.value) {
    list.push({ key: 'reset', icon: 'arrow-back-up', title: '元に戻す' })
  }
  return list
})

const barPrimary = computed<EditorAction>(() => ({
  key: 'install',
  label: installedMessage.value
    ? '保存しました'
    : editingThemeId.value
      ? '上書き保存'
      : 'インストール',
  icon: installedMessage.value ? 'check' : 'device-floppy',
}))

function onBarAction(key: string) {
  if (key === 'install') installTheme()
  else if (key === 'import') importTheme()
  else if (key === 'export') exportTheme()
  else if (key === 'reset') resetToSnapshot()
}

function exportTheme() {
  if (tab.value === 'code') syncVisualFromCode()
  const theme: MisskeyTheme = {
    id: `custom-${Date.now()}`,
    name: themeName.value,
    base: baseMode.value,
    props: { ...baseTheme.value.props, ...overrides.value },
  }
  const json = JSON.stringify(theme, null, 2)
  navigator.clipboard.writeText(json)
  showCopied()
}

async function importTheme() {
  try {
    const text = await navigator.clipboard.readText()
    const parsed = JSON5.parse(text)
    if (!parsed || typeof parsed !== 'object' || !parsed.props) {
      showImportError()
      return
    }
    themeName.value = parsed.name || 'Untitled'
    baseMode.value = parsed.base === 'light' ? 'light' : 'dark'
    overrides.value = { ...parsed.props }
    editingThemeId.value = null
    codeError.value = null
    saveSnapshot()
    showImported()
  } catch {
    showImportError()
  }
}

// Load existing theme for editing
function loadFromInstalled(theme: MisskeyTheme) {
  themeName.value = theme.name
  baseMode.value = theme.base ?? 'dark'
  // Filter out props that match the base theme defaults
  const base = theme.base === 'light' ? LIGHT_BASE : DARK_BASE
  const filtered: Record<string, string> = {}
  for (const [key, value] of Object.entries(theme.props)) {
    if (base.props[key] !== value) {
      filtered[key] = value
    }
  }
  overrides.value = filtered
  editingThemeId.value = theme.id
  saveSnapshot()
}

// Delete installed theme
// 他の配布物 (skill / widget / plugin / query) と同じく confirm → 元に戻せる
// トースト (#988)
async function deleteInstalledTheme(theme: MisskeyTheme, e: Event) {
  e.stopPropagation()
  const ok = await confirm({
    title: 'テーマを削除',
    message: `「${theme.name}」を削除しますか？テーマの設定も消えます。`,
    okLabel: '削除',
    type: 'danger',
  })
  if (!ok) return
  const undo = themeStore.removeTheme(theme.id)
  if (undo) {
    useToast().show('テーマを削除しました', 'info', {
      action: { label: '元に戻す', onClick: undo },
    })
  }
}

// Section expand states (default: all collapsed)
const expandedSections = reactive<Record<string, boolean>>({})

function toggleSection(section: string) {
  expandedSections[section] = !expandedSections[section]
}

// All non-primary props that have overrides
const secondaryOverrides = computed(() => {
  const primaryKeys = new Set(PRIMARY_PROPS.map((p) => p.key))
  return Object.keys(overrides.value)
    .filter((k) => !primaryKeys.has(k))
    .sort()
})

// Override count for primary
const primaryOverrideCount = computed(() => {
  const primaryKeys = new Set(PRIMARY_PROPS.map((p) => p.key))
  return Object.keys(overrides.value).filter((k) => primaryKeys.has(k)).length
})

// All base theme props not in primary or already overridden
const availableSecondaryProps = computed(() => {
  const primaryKeys = new Set(PRIMARY_PROPS.map((p) => p.key))
  const overriddenKeys = new Set(Object.keys(overrides.value))
  return Object.keys(baseTheme.value.props)
    .filter((k) => !primaryKeys.has(k) && !overriddenKeys.has(k))
    .sort()
})

// Filtered props for add-prop dropdown search
const addPropSearch = ref('')
const filteredSecondaryProps = computed(() => {
  const q = addPropSearch.value.toLowerCase()
  if (!q) return availableSecondaryProps.value
  return availableSecondaryProps.value.filter((k) =>
    k.toLowerCase().includes(q),
  )
})

// Custom dropdown states
const showLoadDropdown = ref(false)
const showAddPropDropdown = ref(false)
const cssModule = useCssModule()

function selectInstalledTheme(theme: MisskeyTheme) {
  loadFromInstalled(theme)
  showLoadDropdown.value = false
}

function selectAddProp(key: string) {
  const baseVal = baseTheme.value.props[key] ?? ''
  overrides.value = { ...overrides.value, [key]: baseVal }
  showAddPropDropdown.value = false
  addPropSearch.value = ''
}

// Resolve accent color from a theme for preview swatch
function themeAccentColor(theme: MisskeyTheme): string {
  const base = theme.base === 'light' ? LIGHT_BASE : DARK_BASE
  const compiled = compileMisskeyTheme(theme, base)
  return compiled.accent ?? '#888'
}

// Close dropdowns on outside click
function handleOutsideClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest(`.${cssModule.dropdown}`)) {
    showLoadDropdown.value = false
    showAddPropDropdown.value = false
    addPropSearch.value = ''
  }
}

// Load theme from initialThemeId prop (e.g. when opened from settings grid)
watch(
  () => props.initialThemeId,
  (id) => {
    if (!id) return
    const theme = themeStore.installedThemes.find((t) => t.id === id)
    if (theme) {
      loadFromInstalled(theme)
      if (tab.value === 'code') syncCodeFromVisual()
    }
  },
  { immediate: true },
)

onMounted(() => document.addEventListener('click', handleOutsideClick))
onUnmounted(() => document.removeEventListener('click', handleOutsideClick))
</script>

<template>
  <div ref="editorRef" :class="$style.editor">
      <!-- カラムのカードと同じ位置・同じ枠でアイテムを識別できるようにする (#955)。
           テーマの識別子はアイコンではなく配色そのものなので、アイコン枠には
           ThemeCard と同じ ThemePreview を入れる -->
      <EditorItemHeader
        fallback-icon="palette"
        :name="themeName || 'Untitled'"
      >
        <template #icon>
          <ThemePreview :theme="previewTheme" :class="$style.headerPreview" />
        </template>
        <template #sub>
          <span :class="$style.headerBadge">{{ baseMode === 'light' ? 'ライト' : 'ダーク' }}</span>
        </template>
      </EditorItemHeader>

      <EditorTabs
        v-model="tab"
        :tabs="[
          { value: 'visual', icon: 'palette', label: 'ビジュアル' },
          ...(isExposed('developer')
            ? [{ value: 'code', icon: 'code', label: 'コード' }]
            : []),
        ]"
      />

      <!-- Visual Editor -->
      <div v-show="tab === 'visual'" :class="$style.visualPanel">
        <!-- Theme info -->
        <div :class="$style.section">
          <button class="_button" :class="$style.sectionLabel" @click="toggleSection('info')">
            <i class="ti ti-tag" />
            テーマ情報
            <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.info }]" />
          </button>
          <template v-if="expandedSections.info">
            <input
              v-model="themeName"
              :class="$style.nameInput"
              type="text"
              placeholder="テーマ名"
              spellcheck="false"
            />
            <div :class="$style.baseToggle">
              <button
                class="_button"
                :class="[$style.baseBtn, { [$style.active]: baseMode === 'dark' }]"
                @click="baseMode = 'dark'"
              >
                <i class="ti ti-moon" />
                Dark
              </button>
              <button
                class="_button"
                :class="[$style.baseBtn, { [$style.active]: baseMode === 'light' }]"
                @click="baseMode = 'light'"
              >
                <i class="ti ti-sun" />
                Light
              </button>
            </div>
          </template>
        </div>

        <!-- Load from existing -->
        <div v-if="themeStore.installedThemes.length" :class="$style.section">
          <button class="_button" :class="$style.sectionLabel" @click="toggleSection('existing')">
            <i class="ti ti-folder-open" />
            既存テーマ
            <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.existing }]" />
          </button>
          <div v-if="expandedSections.existing" :class="$style.dropdown">
            <button
              class="_button"
              :class="$style.dropdownTrigger"
              @click="showLoadDropdown = !showLoadDropdown"
            >
              <span>テーマを選択...</span>
              <i class="ti ti-chevron-down" :class="$style.dropdownChevron" />
            </button>
            <div v-if="showLoadDropdown" :class="$style.dropdownPanel">
              <div
                v-for="t in themeStore.installedThemes"
                :key="t.id"
                :class="$style.dropdownItem"
                @click="selectInstalledTheme(t)"
              >
                <div
                  :class="$style.themeSwatch"
                  :style="{ background: themeAccentColor(t) }"
                />
                <span :class="$style.dropdownItemLabel">{{ t.name }}</span>
                <span :class="$style.dropdownItemBadge">{{ t.base }}</span>
                <button
                  class="_button"
                  :class="$style.dropdownItemDelete"
                  title="削除"
                  @click="deleteInstalledTheme(t, $event)"
                >
                  <i class="ti ti-trash" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Primary Colors -->
        <div :class="$style.section">
          <button
            class="_button"
            :class="$style.sectionLabel"
            @click="toggleSection('primary')"
          >
            <i class="ti ti-palette" />
            基本色
            <span v-if="primaryOverrideCount > 0" :class="$style.sectionValue">
              {{ primaryOverrideCount }}/{{ PRIMARY_PROPS.length }}
            </span>
            <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.primary }]" />
          </button>
          <div v-if="expandedSections.primary" :class="$style.propList">
            <div
              v-for="prop in PRIMARY_PROPS"
              :key="prop.key"
              :class="[$style.propRow, { [$style.overridden]: isOverridden(prop.key) }]"
            >
              <div :class="$style.propInfo">
                <div :class="$style.colorPickerWrap">
                  <input
                    type="color"
                    :class="$style.colorPicker"
                    :value="resolvedHex(prop.key)"
                    @input="(e) => updateColor(prop.key, (e.target as HTMLInputElement).value)"
                  />
                  <div
                    :class="[$style.colorSwatch, { [$style.checkerboard]: hasAlpha(prop.key) }]"
                    :style="{ backgroundColor: resolvedColors[prop.key] ?? 'transparent' }"
                  />
                </div>
                <div :class="$style.propLabel">
                  <span :class="$style.propLabelText">{{ prop.label }}</span>
                  <span :class="$style.propKey">{{ prop.key }}</span>
                </div>
                <button
                  v-if="isOverridden(prop.key)"
                  class="_button"
                  :class="$style.resetBtn"
                  title="デフォルトに戻す"
                  @click="resetProp(prop.key)"
                >
                  <i class="ti ti-x" />
                </button>
              </div>
              <div :class="$style.propControls">
                <input
                  :class="[$style.propValueInput, { [$style.expression]: isExpression(displayValue(prop.key)) }]"
                  type="text"
                  :value="displayValue(prop.key)"
                  :placeholder="baseTheme.props[prop.key] ?? ''"
                  spellcheck="false"
                  @change="(e) => updateColor(prop.key, (e.target as HTMLInputElement).value)"
                  @keydown.enter="(e) => updateColor(prop.key, (e.target as HTMLInputElement).value)"
                />
                <span v-if="isExpression(displayValue(prop.key))" :class="$style.resolvedHex">
                  {{ resolvedDisplay(prop.key) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Secondary overrides -->
        <div v-if="secondaryOverrides.length" :class="$style.section">
          <button
            class="_button"
            :class="$style.sectionLabel"
            @click="toggleSection('secondary')"
          >
            <i class="ti ti-adjustments" />
            追加プロパティ
            <span :class="$style.sectionValue">{{ secondaryOverrides.length }}</span>
            <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.secondary }]" />
          </button>
          <div v-if="expandedSections.secondary" :class="$style.propList">
            <div
              v-for="key in secondaryOverrides"
              :key="key"
              :class="[$style.propRow, $style.overridden]"
            >
              <div :class="$style.propInfo">
                <div :class="$style.colorPickerWrap">
                  <input
                    type="color"
                    :class="$style.colorPicker"
                    :value="resolvedHex(key)"
                    @input="(e) => updateColor(key, (e.target as HTMLInputElement).value)"
                  />
                  <div
                    :class="[$style.colorSwatch, { [$style.checkerboard]: hasAlpha(key) }]"
                    :style="{ backgroundColor: resolvedColors[key] ?? 'transparent' }"
                  />
                </div>
                <div :class="$style.propLabel">
                  <span :class="$style.propKey">{{ key }}</span>
                </div>
                <button
                  class="_button"
                  :class="$style.resetBtn"
                  title="削除"
                  @click="resetProp(key)"
                >
                  <i class="ti ti-x" />
                </button>
              </div>
              <div :class="$style.propControls">
                <input
                  :class="[$style.propValueInput, { [$style.expression]: isExpression(displayValue(key)) }]"
                  type="text"
                  :value="displayValue(key)"
                  spellcheck="false"
                  @change="(e) => updateColor(key, (e.target as HTMLInputElement).value)"
                  @keydown.enter="(e) => updateColor(key, (e.target as HTMLInputElement).value)"
                />
                <span v-if="isExpression(displayValue(key))" :class="$style.resolvedHex">
                  {{ resolvedDisplay(key) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Add more props -->
        <div :class="$style.section">
          <div :class="$style.dropdown">
            <button
              class="_button"
              :class="$style.dropdownTrigger"
              @click="showAddPropDropdown = !showAddPropDropdown"
            >
              <i class="ti ti-plus" />
              <span>プロパティを追加 ({{ availableSecondaryProps.length }})</span>
              <i class="ti ti-chevron-down" :class="$style.dropdownChevron" />
            </button>
            <div v-if="showAddPropDropdown" :class="$style.dropdownPanel">
              <div :class="$style.dropdownSearch">
                <i class="ti ti-search" :class="$style.searchIcon" />
                <input
                  v-model="addPropSearch"
                  :class="$style.searchInput"
                  type="text"
                  placeholder="検索..."
                  spellcheck="false"
                  @click.stop
                />
              </div>
              <button
                v-for="key in filteredSecondaryProps"
                :key="key"
                class="_button"
                :class="$style.dropdownItem"
                @click="selectAddProp(key)"
              >
                <div
                  :class="$style.themeSwatch"
                  :style="{ backgroundColor: resolvedColors[key] ?? 'transparent' }"
                />
                <span :class="$style.dropdownItemLabel">{{ key }}</span>
              </button>
              <div v-if="filteredSecondaryProps.length === 0" :class="$style.dropdownEmpty">
                一致するプロパティがありません
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Code Editor -->
      <div v-show="tab === 'code'" :class="$style.codePanel">
        <CodeEditor
          v-model="codeContent"
          :language="jsonLang"
          :linter="jsonLinter"
          :class="$style.codeEditorWrap"
        />
        <div v-if="codeError" :class="$style.codeError">{{ codeError }}</div>
        <button
          class="_button"
          :class="$style.codeApplyBtn"
          @click="syncVisualFromCode"
        >
          <i class="ti ti-check" />
          コードから反映
        </button>
      </div>

      <EditorActionBar
        :actions="barActions"
        :primary="barPrimary"
        @action="onBarAction"
      />
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* アイコン枠 (48px) をそのまま配色プレビューで埋める */
.headerPreview {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.headerBadge {
  font-size: 0.85em;
  padding: 0 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--nd-fg) 10%, transparent);
  line-height: 1.6;
  flex-shrink: 0;
}

.active {
  /* modifier */
}

.expression {
  /* modifier */
}

.overridden {
  /* modifier */
}

.checkerboard {
  /* modifier */
}

.visualPanel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
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

.sectionValue {
  font-weight: normal;
  font-size: 0.9em;
  opacity: 0.8;
}

.nameInput {
  padding: 6px 10px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.85em;
  font-weight: bold;
  outline: none;
  transition: border-color var(--nd-duration-base);

  &:focus {
    border-color: var(--nd-accent);
  }
}

.baseToggle {
  display: flex;
  gap: 4px;
}

.baseBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  padding: 6px 10px;
  border-radius: var(--nd-radius-sm);
  font-size: 0.8em;
  font-weight: bold;
  color: var(--nd-fg);
  opacity: 0.5;
  background: var(--nd-buttonBg);
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);
  justify-content: center;

  &:hover {
    opacity: 0.7;
  }

  &.active {
    opacity: 1;
    background: var(--nd-accentedBg);
    color: var(--nd-accent);
  }
}

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

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
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

.dropdownSearch {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--nd-divider);
  position: sticky;
  top: 0;
  background: var(--nd-panel);
  z-index: 1;
}

.searchIcon {
  opacity: 0.4;
  font-size: 0.85em;
  flex-shrink: 0;
}

.searchInput {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--nd-fg);
  font-size: 0.8em;
  outline: none;

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.3;
  }
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

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  & + & {
    border-top: 1px solid color-mix(in srgb, var(--nd-divider) 50%, transparent);
  }
}

.dropdownItemLabel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdownItemBadge {
  font-size: 0.85em;
  opacity: 0.5;
  flex-shrink: 0;
}

.dropdownItemDelete {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.3;
  flex-shrink: 0;
  transition: opacity var(--nd-duration-base), color var(--nd-duration-base);

  &:hover {
    opacity: 1;
    color: var(--nd-love);
  }
}

.dropdownEmpty {
  padding: 12px 10px;
  font-size: 0.8em;
  opacity: 0.4;
  text-align: center;
}

.themeSwatch {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  border: 1px solid var(--nd-divider);
  flex-shrink: 0;
}

.propList {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.propRow {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-radius: var(--nd-radius-sm);
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  &.overridden {
    background: color-mix(in srgb, var(--nd-accent) 5%, transparent);
  }
}

.propInfo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.propLabel {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.propLabelText {
  font-size: 0.8em;
  font-weight: 500;
}

.propKey {
  font-family: var(--nd-font-mono);
  font-size: 0.7em;
  opacity: 0.4;
}

.propControls {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 34px;
}

.colorPickerWrap {
  position: relative;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}

.colorPicker {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.colorSwatch {
  width: 26px;
  height: 26px;
  border-radius: var(--nd-radius-sm);
  border: 1px solid var(--nd-divider);
  pointer-events: none;

  &.checkerboard {
    background-image:
      linear-gradient(45deg, #808080 25%, transparent 25%),
      linear-gradient(-45deg, #808080 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #808080 75%),
      linear-gradient(-45deg, transparent 75%, #808080 75%);
    background-size: 8px 8px;
    background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  }
}

.propValueInput {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-family: var(--nd-font-mono);
  font-size: 0.75em;
  outline: none;
  transition: border-color var(--nd-duration-base);

  &:focus {
    border-color: var(--nd-accent);
  }

  &.expression {
    color: var(--nd-accent);
  }
}

.resolvedHex {
  font-family: var(--nd-font-mono);
  font-size: 0.65em;
  opacity: 0.4;
  flex-shrink: 0;
  white-space: nowrap;
}

.resetBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.3;
  flex-shrink: 0;
  transition: opacity var(--nd-duration-base), color var(--nd-duration-base);

  &:hover {
    opacity: 1;
    color: var(--nd-love);
  }
}

.codePanel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  flex: 1;
  min-height: 0;
}

.codeEditorWrap {
  flex: 1;
  min-width: 0;
}

.codeError {
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

.codeApplyBtn { @include btn-secondary; }

</style>
