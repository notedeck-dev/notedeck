<script setup lang="ts">
import { json } from '@codemirror/lang-json'
import { computed, ref, watch } from 'vue'
import EditorTabs from '@/components/common/EditorTabs.vue'
import DayNightToggle from '@/components/deck/DayNightToggle.vue'
import CodeEditor from '@/components/deck/widgets/CodeEditor.vue'
import AiSwitchRow from '@/components/window/ai-settings/AiSwitchRow.vue'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { useWindowExternalFile } from '@/composables/useWindowExternalFile'
import { CURRENT_SCHEMA_VERSION, parseSettings } from '@/settings/schema'
import { useConfirm } from '@/stores/confirm'
import { useDeckStore } from '@/stores/deck'
import { useSettingsStore } from '@/stores/settings'
import { useThemeStore } from '@/stores/theme'
import { hapticSelection } from '@/utils/haptics'

const props = defineProps<{
  initialTab?: string
}>()

const jsonLang = json()
const settingsStore = useSettingsStore()
const themeStore = useThemeStore()
const deckStore = useDeckStore()
const { confirm } = useConfirm()

// ── Tab management ──
const { tab, containerRef: contentRef } = useEditorTabs(
  ['visual', 'code'] as const,
  (props.initialTab as 'visual' | 'code') ?? 'visual',
)

useWindowExternalFile(() =>
  tab.value === 'code' ? { name: 'settings.json5' } : null,
)

// ── Visual tab: theme settings ──
// テーマの選択 / 編集 / 削除 はテーマカラム (themeManager) に集約済み。
// ここではダーク・ライト切替とシステム追従のみを提供する。
const isDark = computed(() => !themeStore.currentSource?.kind.includes('light'))
const isFollowingSystem = computed(() => themeStore.manualMode == null)
const fileInput = ref<HTMLInputElement | null>(null)

function toggleDarkMode() {
  hapticSelection()
  themeStore.toggleTheme()
}

function toggleSyncDevice(checked: boolean) {
  hapticSelection()
  if (checked) {
    themeStore.resetToOsTheme()
  } else {
    themeStore.pinCurrentMode()
  }
}

function pickWallpaper() {
  fileInput.value?.click()
}

function onFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    deckStore.setWallpaper(reader.result as string)
  }
  reader.readAsDataURL(file)
  if (fileInput.value) fileInput.value.value = ''
}

function removeWallpaper() {
  deckStore.clearWallpaper()
}

// ── Visual tab: note view settings ──
const nyaizeEnabled = computed(() => settingsStore.get('note.nyaize') !== false)

function toggleNyaize() {
  hapticSelection()
  settingsStore.set('note.nyaize', !nyaizeEnabled.value)
}

// ── Code tab: raw JSON editor ──
const jsonCode = ref(serializeOverrides())

function serializeOverrides(): string {
  return `${JSON.stringify(settingsStore.overrides, null, 2)}\n`
}

// Sync from store → editor (when store changes externally, e.g. other store writes)
watch(
  () => settingsStore.settings,
  () => {
    // Only sync if the editor isn't currently being edited (avoid overwriting user typing)
    if (!dirty.value) {
      jsonCode.value = serializeOverrides()
    }
  },
)

// --- Parse + save ---
const error = ref<string | null>(null)
const dirty = ref(false)
const saved = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null

watch(jsonCode, (code) => {
  dirty.value = true
  saved.value = false
  error.value = null

  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const parsed = JSON.parse(code)
      if (!parsed || typeof parsed !== 'object') {
        error.value = 'トップレベルは JSON オブジェクト {} である必要があります'
        return
      }
      // Merge overrides with defaults and replace entire settings
      const normalized = parseSettings(parsed)
      normalized._schema = CURRENT_SCHEMA_VERSION
      settingsStore.replaceAll(normalized)

      error.value = null
      dirty.value = false
      saved.value = true
      setTimeout(() => {
        saved.value = false
      }, 2000)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '不正な JSON'
    }
  }, 600)
})

// Sync code tab when switching to it
watch(tab, (t) => {
  if (t === 'code') {
    jsonCode.value = serializeOverrides()
  }
})

// Status text
const statusText = computed(() => {
  if (error.value) return error.value
  if (saved.value) return '保存しました'
  if (dirty.value) return '編集中...'
  return ''
})

const statusClass = computed(() => {
  if (error.value) return 'statusError'
  if (saved.value) return 'statusSaved'
  return ''
})
</script>

<template>
  <div ref="contentRef" :class="$style.content">
    <EditorTabs
      v-model="tab"
      :tabs="[
        { value: 'visual', icon: 'adjustments', label: 'ビジュアル' },
        { value: 'code', icon: 'code', label: 'コード' },
      ]"
    />

    <!-- Visual tab -->
    <div v-show="tab === 'visual'" :class="$style.visualPanel">
      <!-- Dark/Light toggle -->
      <div :class="$style.section">
        <DayNightToggle
          :is-dark="isDark"
          :is-following-system="isFollowingSystem"
          @toggle-dark="toggleDarkMode"
          @toggle-sync="(checked: boolean) => toggleSyncDevice(checked)"
        />
      </div>

      <!-- テーマ選択 / 編集 / 削除 はテーマカラム (themeManager) に集約。
           コマンドパレット → 「テーマを管理」で開ける。 -->

      <!-- Wallpaper -->
      <div :class="$style.section">
        <button v-if="deckStore.wallpaper == null" :class="$style.menuItem" @click="pickWallpaper">
          <i class="ti ti-photo" />
          <span>壁紙を設定</span>
        </button>
        <button v-else :class="$style.menuItem" @click="removeWallpaper">
          <i class="ti ti-photo-off" />
          <span>壁紙を削除</span>
        </button>
      </div>

      <!-- Note view -->
      <div :class="$style.section">
        <AiSwitchRow
          label="Catユーザーの語尾をにゃ化"
          sub-label="本家 Web UI と同じ表示。コピー・検索は原文のまま"
          icon="ti-cat"
          :on="nyaizeEnabled"
          @toggle="toggleNyaize"
        />
      </div>

      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        style="display: none"
        @change="onFileSelected"
      />
    </div>

    <!-- Code tab -->
    <div v-show="tab === 'code'" :class="$style.codePanel">
      <div :class="$style.codeHint">
        <i class="ti ti-braces" />
        デフォルト値からの差分のみ表示 — 変更は自動保存されます
      </div>

      <CodeEditor
        v-model="jsonCode"
        :language="jsonLang"
        :class="[$style.codeEditorWrap, { [$style.hasError]: error }]"
        auto-height
      />

      <div
        v-if="statusText"
        :class="[$style.status, $style[statusClass]]"
      >
        <i
          class="ti"
          :class="error ? 'ti-alert-triangle' : saved ? 'ti-check' : 'ti-loader-2'"
        />
        {{ statusText }}
      </div>
    </div>
  </div>
</template>

<style module lang="scss">
.content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
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
  gap: 8px;
  padding: 12px 10px;
  border-bottom: 1px solid var(--nd-divider);
}

// ── Menu items ──

.menuItem {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 4px;
  border: none;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 0.85em;
  color: var(--nd-fg);
  border-radius: var(--nd-radius-sm);
  transition: background var(--nd-duration-fast);

  &:hover {
    background: var(--nd-accent-hover);
  }
}

.activeDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--nd-accent);
  margin-left: auto;
}

// ── Code tab ──

.codePanel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 8px 10px;
  gap: 6px;
}

.codeHint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75em;
  color: var(--nd-fgMuted);

  i {
    font-size: 1.1em;
  }
}

.codeEditorWrap {
  border-radius: var(--nd-radius-sm);
}

.hasError {
  box-shadow: 0 0 0 2px var(--nd-love);
}

.status {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75em;
  color: var(--nd-fgMuted);
  min-height: 20px;
}

.statusError {
  color: var(--nd-love);
}

.statusSaved {
  color: var(--nd-accent);
}
</style>
