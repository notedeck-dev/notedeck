<script setup lang="ts">
import { css } from '@codemirror/lang-css'
import { type Diagnostic, linter } from '@codemirror/lint'
import { computed, reactive, ref, watch } from 'vue'
import EditorTabs from '@/components/common/EditorTabs.vue'
import SafeModeNotice from '@/components/common/SafeModeNotice.vue'
import CodeEditor from '@/components/deck/widgets/CodeEditor.vue'
import CssPresetDropdown from '@/components/window/CssPresetDropdown.vue'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useDoubleConfirm } from '@/composables/useDoubleConfirm'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { useWindowExternalFile } from '@/composables/useWindowExternalFile'
import {
  buildPresetCss,
  type CssPresets,
  EMPTY_PRESETS,
  extractUserCss,
  FONT_OPTIONS,
  FONT_SIZE_BASE,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  HIDE_COUNT_OPTIONS,
  MONO_FONT_OPTIONS,
  parsePresetsFromCss,
  VISIBILITY_BG_COLORS,
  VISIBILITY_BG_OPTIONS,
} from '@/services/cssPresets'
import { useThemeStore } from '@/stores/theme'

const cssLang = css()

const cssLinter = linter(
  (view) => {
    const diagnostics: Diagnostic[] = []
    const code = view.state.doc.toString()
    if (!code.trim()) return diagnostics
    const testCss = code
      .split('\n')
      .filter((line) => {
        const t = line.trim()
        return !t.startsWith('@import') && !t.startsWith('@font-face')
      })
      .join('\n')
    try {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(testCss)
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

const props = defineProps<{
  initialTab?: string
}>()

const themeStore = useThemeStore()

const { tab, containerRef: editorRef } = useEditorTabs(
  ['presets', 'code'] as const,
  (props.initialTab as 'presets' | 'code') ?? 'presets',
)

useWindowExternalFile(() =>
  tab.value === 'code' ? { name: 'custom.css' } : null,
)

// Local CSS mirror (synced from store on mount)
const cssCode = ref(themeStore.customCss)

// Preset toggles (定義・CSS 変換は src/services/cssPresets.ts)
const presets = ref<CssPresets>(parsePresetsFromCss(cssCode.value))

const expandedSections = reactive<Record<string, boolean>>({})

function toggleSection(key: string) {
  expandedSections[key] = !expandedSections[key]
}

// スライダーの塗りつぶし率 (OS のボリュームバー式に左側をアクセント色で塗る)
function sliderFill(value: number, min: number, max: number): string {
  return `${((value - min) / (max - min)) * 100}%`
}

const fontSizeLabel = computed(() => {
  if (presets.value.fontSize === 0) return 'デフォルト (15px)'
  return `${FONT_SIZE_BASE + presets.value.fontSize}px`
})

function validateCss(cssStr: string): string | null {
  if (!cssStr.trim()) return null
  const testCss = cssStr
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !t.startsWith('@import') && !t.startsWith('@font-face')
    })
    .join('\n')
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(testCss)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'CSSパースエラー'
  }
}

const userFreeformCss = ref(extractUserCss(cssCode.value))
const cssError = ref<string | null>(null)

let validateTimer: ReturnType<typeof setTimeout> | null = null
watch(userFreeformCss, (cssStr) => {
  if (validateTimer) clearTimeout(validateTimer)
  validateTimer = setTimeout(() => {
    cssError.value = validateCss(cssStr)
  }, 300)
})

const fullCss = computed(() => {
  const preset = buildPresetCss(presets.value)
  const user = cssError.value ? '' : userFreeformCss.value.trim()
  if (preset && user) return `${preset}\n\n${user}`
  return preset || user
})

let applyTimer: ReturnType<typeof setTimeout> | null = null
watch(fullCss, (cssStr) => {
  cssCode.value = cssStr
  if (applyTimer) clearTimeout(applyTimer)
  applyTimer = setTimeout(() => {
    themeStore.setCustomCss(cssStr)
  }, 200)
})

watch(
  () => [
    presets.value.customFont,
    presets.value.monoFont,
    presets.value.fontSize,
    presets.value.visibilityBg,
    presets.value.hideNoteCounts,
    presets.value.hideUserStats,
  ],
  () => {
    const cssStr = fullCss.value
    cssCode.value = cssStr
    themeStore.setCustomCss(cssStr)
  },
)

const codeError = ref<string | null>(null)
let codeApplyTimer: ReturnType<typeof setTimeout> | null = null

watch(cssCode, (cssStr) => {
  if (tab.value !== 'code') return
  if (codeApplyTimer) clearTimeout(codeApplyTimer)
  codeApplyTimer = setTimeout(() => {
    const err = validateCss(cssStr)
    codeError.value = err
    if (!err) {
      themeStore.setCustomCss(cssStr)
    }
  }, 400)
})

function applyFromCode() {
  if (codeApplyTimer) clearTimeout(codeApplyTimer)
  const cssStr = cssCode.value
  const err = validateCss(cssStr)
  if (err) {
    codeError.value = err
    return
  }
  codeError.value = null
  presets.value = parsePresetsFromCss(cssStr)
  userFreeformCss.value = extractUserCss(cssStr)
  cssError.value = null
  themeStore.setCustomCss(cssStr)
}

// Import/Export
const {
  copied: copiedMessage,
  imported: importedMessage,
  importError,
  showCopied,
  showImported,
  showImportError,
} = useClipboardFeedback()

function exportCss() {
  navigator.clipboard.writeText(cssCode.value)
  showCopied()
}

async function importCss() {
  try {
    const text = await navigator.clipboard.readText()
    if (!text.trim()) {
      showImportError()
      return
    }
    cssCode.value = text
    presets.value = parsePresetsFromCss(text)
    userFreeformCss.value = extractUserCss(text)
    themeStore.setCustomCss(text)
    showImported()
  } catch {
    showImportError()
  }
}

const { confirming: confirmingClear, trigger: triggerClear } =
  useDoubleConfirm()

function handleClear() {
  triggerClear(() => {
    presets.value = { ...EMPTY_PRESETS }
    userFreeformCss.value = ''
    cssCode.value = ''
    cssError.value = null
    codeError.value = null
    themeStore.setCustomCss('')
  })
}

// プリセット用ドロップダウンは CssPresetDropdown (#778) に共通化。
// セクションヘッダの選択中ラベル表示にだけ label 解決を残す
const selectedVisibilityBgLabel = computed(
  () =>
    VISIBILITY_BG_OPTIONS.find((o) => o.value === presets.value.visibilityBg)
      ?.label ?? 'デフォルト',
)

const selectedMonoFontLabel = computed(
  () =>
    MONO_FONT_OPTIONS.find((o) => o.value === presets.value.monoFont)?.label ??
    'デフォルト',
)

function hideCountLabel(key: string): string {
  return HIDE_COUNT_OPTIONS.find((o) => o.value === key)?.label ?? 'デフォルト'
}

watch(tab, (t) => {
  if (t === 'code') {
    cssCode.value = fullCss.value
    codeError.value = null
  } else {
    presets.value = parsePresetsFromCss(cssCode.value)
    userFreeformCss.value = extractUserCss(cssCode.value)
  }
})
</script>

<template>
  <div ref="editorRef" :class="$style.cssContent">
    <SafeModeNotice subject="カスタム CSS" />

    <EditorTabs
      v-model="tab"
      :tabs="[
        { value: 'presets', icon: 'adjustments', label: 'プリセット' },
        { value: 'code', icon: 'code', label: 'コード' },
      ]"
    />

    <!-- Presets -->
    <div v-show="tab === 'presets'" :class="$style.presetsPanel">
      <!-- Font -->
      <div :class="$style.section">
        <button class="_button" :class="$style.sectionLabel" @click="toggleSection('font')">
          <i class="ti ti-typography" />
          フォント
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.font }]" />
        </button>
        <template v-if="expandedSections.font">
          <CssPresetDropdown
            v-model="presets.customFont"
            :options="FONT_OPTIONS"
            font-preview
          />
          <div v-if="presets.customFont" :class="$style.preview" :style="{ fontFamily: `'${presets.customFont}', sans-serif` }">
            あいうえお 漢字 ABCabc 123 Il1 O0
          </div>
        </template>
      </div>

      <!-- Mono font (#901) -->
      <div :class="$style.section">
        <button class="_button" :class="$style.sectionLabel" @click="toggleSection('monoFont')">
          <i class="ti ti-code" />
          等幅フォント
          <span :class="$style.sectionValue">{{ selectedMonoFontLabel }}</span>
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.monoFont }]" />
        </button>
        <template v-if="expandedSections.monoFont">
          <CssPresetDropdown
            v-model="presets.monoFont"
            :options="MONO_FONT_OPTIONS"
            font-preview
            font-fallback="monospace"
          />
          <div v-if="presets.monoFont" :class="$style.preview" :style="{ fontFamily: `'${presets.monoFont}', monospace` }">
            const 変数 = 0; // Il1 O0
          </div>
          <div :class="$style.hideCountNote">
            コードブロック・JSON ビューア・エディタ系に反映されます
          </div>
        </template>
      </div>

      <!-- Font Size -->
      <div :class="$style.section">
        <button class="_button" :class="$style.sectionLabel" @click="toggleSection('fontSize')">
          <i class="ti ti-text-resize" />
          フォントサイズ
          <span :class="$style.sectionValue">{{ fontSizeLabel }}</span>
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.fontSize }]" />
        </button>
        <template v-if="expandedSections.fontSize">
          <div :class="$style.sliderRow">
            <span :class="$style.sliderLabel">小</span>
            <input
              v-model.number="presets.fontSize"
              type="range"
              :min="FONT_SIZE_MIN"
              :max="FONT_SIZE_MAX"
              step="1"
              :class="$style.slider"
              :style="{ '--fill': sliderFill(presets.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX) }"
            />
            <span :class="$style.sliderLabel">大</span>
          </div>
          <button
            v-if="presets.fontSize !== 0"
            class="_button"
            :class="$style.resetBtn"
            @click="presets.fontSize = 0"
          >
            リセット
          </button>
        </template>
      </div>

      <!-- Visibility background -->
      <div :class="$style.section">
        <button class="_button" :class="$style.sectionLabel" @click="toggleSection('visibilityBg')">
          <i class="ti ti-eye" />
          公開範囲の色分け
          <span :class="$style.sectionValue">{{ selectedVisibilityBgLabel }}</span>
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.visibilityBg }]" />
        </button>
        <template v-if="expandedSections.visibilityBg">
          <CssPresetDropdown
            v-model="presets.visibilityBg"
            :options="VISIBILITY_BG_OPTIONS"
          />
          <div v-if="presets.visibilityBg === 'tint'" :class="$style.visibilityBgPreview">
            <div
              v-for="({ label, color }, visibility) in VISIBILITY_BG_COLORS"
              :key="visibility"
              :class="$style.visibilityBgRow"
              :style="{ backgroundColor: color }"
            >
              {{ label }}
            </div>
          </div>
        </template>
      </div>

      <!-- Hide note counts (#594) -->
      <div :class="$style.section">
        <button class="_button" :class="$style.sectionLabel" @click="toggleSection('noteCounts')">
          <i class="ti ti-mood-smile" />
          ノートの数字を隠す
          <span :class="$style.sectionValue">{{ hideCountLabel(presets.hideNoteCounts) }}</span>
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.noteCounts }]" />
        </button>
        <template v-if="expandedSections.noteCounts">
          <CssPresetDropdown
            v-model="presets.hideNoteCounts"
            :options="HIDE_COUNT_OPTIONS"
          />
          <div :class="$style.hideCountNote">
            リアクション数とリノート数が消えます (返信数は会話の量なので残ります)
          </div>
        </template>
      </div>

      <!-- Hide user stats (#593) -->
      <div :class="$style.section">
        <button class="_button" :class="$style.sectionLabel" @click="toggleSection('userStats')">
          <i class="ti ti-chart-bar" />
          プロフィールの数字を隠す
          <span :class="$style.sectionValue">{{ hideCountLabel(presets.hideUserStats) }}</span>
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.userStats }]" />
        </button>
        <template v-if="expandedSections.userStats">
          <CssPresetDropdown
            v-model="presets.hideUserStats"
            :options="HIDE_COUNT_OPTIONS"
          />
          <div :class="$style.hideCountNote">
            ノート数・フォロー数・フォロワー数が「-」になります (クリック導線は残ります)
          </div>
        </template>
      </div>

      <!-- Freeform CSS -->
      <div :class="$style.section">
        <button class="_button" :class="$style.sectionLabel" @click="toggleSection('css')">
          <i class="ti ti-pencil" />
          追加CSS
          <i class="ti ti-chevron-down" :class="[$style.chevron, { [$style.chevronOpen]: expandedSections.css }]" />
        </button>
        <template v-if="expandedSections.css">
          <CodeEditor
            v-model="userFreeformCss"
            :language="cssLang"
            :linter="cssLinter"
            :class="[$style.editorWrap, { [$style.hasError]: cssError }]"
            max-height="300px"
          />
          <div v-if="cssError" :class="$style.errorMessage">
            <i class="ti ti-alert-triangle" />
            {{ cssError }}
          </div>
          <div v-if="cssError" :class="$style.errorHint">
            CSSにエラーがあるため適用されません
          </div>
        </template>
      </div>
    </div>

    <!-- Code Editor -->
    <div v-show="tab === 'code'" :class="$style.codePanel">
      <div :class="$style.codeHint">
        プリセットと追加CSSを結合した全体のCSSです
      </div>
      <CodeEditor
        v-model="cssCode"
        :language="cssLang"
        :linter="cssLinter"
        :class="[$style.codeEditorWrap, { [$style.hasError]: codeError }]"
        auto-height
      />
      <div v-if="codeError" :class="$style.errorMessage">
        <i class="ti ti-alert-triangle" />
        {{ codeError }}
      </div>
      <div v-if="!codeError && cssCode.trim()" :class="$style.codeSuccess">
        <i class="ti ti-check" />
        適用中
      </div>
      <button
        class="_button"
        :class="$style.codeApplyBtn"
        @click="applyFromCode"
      >
        <i class="ti ti-refresh" />
        プリセットに同期
      </button>
    </div>

    <!-- Actions -->
    <div :class="$style.actions">
      <div :class="$style.actionGroup">
        <button
          class="_button"
          :class="[$style.actionBtn, $style.secondary, { [$style.feedback]: importedMessage || importError }]"
          @click="importCss"
        >
          <i class="ti" :class="importError ? 'ti-alert-circle' : 'ti-clipboard-text'" />
          {{ importError ? '無効' : importedMessage ? '読込済み' : 'インポート' }}
        </button>
        <button
          class="_button"
          :class="[$style.actionBtn, $style.secondary, { [$style.feedback]: copiedMessage }]"
          @click="exportCss"
        >
          <i class="ti ti-clipboard-copy" />
          {{ copiedMessage ? 'コピー済み' : 'エクスポート' }}
        </button>
      </div>
      <button
        class="_button"
        :class="[$style.actionBtn, $style.danger, { [$style.confirming]: confirmingClear }]"
        @click="handleClear"
      >
        <i class="ti ti-trash" />
        {{ confirmingClear ? '本当にクリア？' : 'すべてクリア' }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.cssContent {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.active { /* modifier */ }
.hasError { /* modifier */ }
.confirming { /* modifier */ }
.selected { /* modifier */ }

.presetsPanel {
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

.sectionValue {
  margin-left: auto;
  font-weight: normal;
  font-size: 0.9em;
  opacity: 0.8;
}

// sectionValue がある行では auto マージンを値側だけに持たせ、
// 値をシェブロン直前に右揃えする (両方 auto だと余白が均等分配され中間に浮く)
.sectionValue + .chevron {
  margin-left: 0;
}

/* ドロップダウンの見た目は CssPresetDropdown (#778) が持つ */

/* 本文 / 等幅で同じ見た目。字形の差 (Il1 O0) が読めるよう左揃え + 横スクロール */
.preview {
  padding: 8px 10px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  font-size: 0.9em;
  white-space: nowrap;
  overflow-x: auto;
}

.visibilityBgPreview {
  display: flex;
  flex-direction: column;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  font-size: 0.9em;
  overflow: hidden;
}

.visibilityBgRow {
  padding: 8px 10px;
}

.hideCountNote {
  font-size: 0.75em;
  opacity: 0.6;
}

.sliderRow { display: flex; align-items: center; gap: 8px; }
.sliderLabel { font-size: 0.7em; opacity: 0.5; flex-shrink: 0; }

.slider {
  flex: 1;
  height: 4px;
  appearance: none;
  /* thumb より左を塗りつぶす (--fill は template 側で算出) */
  background: linear-gradient(
    to right,
    var(--nd-accent) var(--fill, 0%),
    var(--nd-divider) var(--fill, 0%)
  );
  border-radius: 2px;
  outline: none;
  cursor: pointer;

  &::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--nd-accent);
    cursor: pointer;
  }

  &::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 50%;
    background: var(--nd-accent);
    cursor: pointer;
  }
}

.resetBtn {
  align-self: flex-end;
  padding: 2px 8px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: 0.7em;
  opacity: 0.6;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover { opacity: 1; background: var(--nd-buttonHoverBg); }
}

.editorWrap {
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

.errorHint { font-size: 0.7em; opacity: 0.5; }

.codePanel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.codeHint { font-size: 0.75em; opacity: 0.4; }

.codeEditorWrap {
  &.hasError {
    box-shadow: 0 0 0 2px var(--nd-love);
    border-radius: var(--nd-radius-sm);
  }
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
