<script setup lang="ts">
import { css } from '@codemirror/lang-css'
import { type Diagnostic, linter } from '@codemirror/lint'
import { computed, reactive, ref, watch } from 'vue'
import EditorTabs from '@/components/common/EditorTabs.vue'
import CodeEditor from '@/components/deck/widgets/CodeEditor.vue'
import { useClickOutside } from '@/composables/useClickOutside'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useDoubleConfirm } from '@/composables/useDoubleConfirm'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { useWindowExternalFile } from '@/composables/useWindowExternalFile'
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

// Preset toggles
const presets = ref({
  customFont: '',
  fontSize: 0,
  visibilityBg: '',
  hideNoteCounts: '',
  hideUserStats: '',
})

// Parse existing CSS to restore preset states
function parsePresetsFromCss(cssStr: string) {
  const fontMatch = cssStr.match(/\/\* nd-font: (.+?) \*\//)
  presets.value.customFont = fontMatch?.[1] ?? ''
  const sizeMatch = cssStr.match(/\/\* nd-fontsize: (.+?) \*\//)
  presets.value.fontSize = sizeMatch ? Number(sizeMatch[1]) : 0
  const visibilityBgMatch = cssStr.match(/\/\* nd-visibility-bg: (.+?) \*\//)
  presets.value.visibilityBg = visibilityBgMatch?.[1] ?? ''
  const noteCountsMatch = cssStr.match(/\/\* nd-hide-note-counts: (.+?) \*\//)
  presets.value.hideNoteCounts = noteCountsMatch?.[1] ?? ''
  const userStatsMatch = cssStr.match(/\/\* nd-hide-user-stats: (.+?) \*\//)
  presets.value.hideUserStats = userStatsMatch?.[1] ?? ''
}
parsePresetsFromCss(cssCode.value)

const expandedSections = reactive<Record<string, boolean>>({ font: true })

function toggleSection(key: string) {
  expandedSections[key] = !expandedSections[key]
}

interface FontOption {
  value: string
  label: string
  importUrl?: string
  customCss?: string
}

const FONT_OPTIONS: FontOption[] = [
  { value: '', label: 'デフォルト' },
  { value: 'Noto Sans JP', label: 'Noto Sans JP' },
  { value: 'Noto Serif JP', label: 'Noto Serif JP' },
  { value: 'Sawarabi Gothic', label: 'Sawarabi Gothic' },
  { value: 'Sawarabi Mincho', label: 'Sawarabi Mincho' },
  { value: 'M PLUS 1p', label: 'M PLUS' },
  { value: 'M PLUS Rounded 1c', label: 'M PLUS Rounded' },
  { value: 'M PLUS 2', label: 'M PLUS 2' },
  { value: 'Murecho', label: 'Murecho' },
  { value: 'RocknRoll One', label: 'RocknRoll One' },
  { value: 'Klee One', label: 'Klee One' },
  { value: 'Zen Maru Gothic', label: 'Zen Maru Gothic' },
  { value: 'Kaisei Decol', label: 'Kaisei Decol' },
  { value: 'Yomogi', label: 'Yomogi' },
  { value: 'Kosugi', label: 'Kosugi' },
  { value: 'Kosugi Maru', label: 'Kosugi Maru' },
  {
    value: 'Kiwi Maru',
    label: 'Kiwi Maru',
    importUrl:
      'https://fonts.googleapis.com/css2?family=Kiwi+Maru:wght@300&display=swap',
  },
  { value: 'Hachi Maru Pop', label: 'Hachi Maru Pop' },
  { value: 'Mochiy Pop One', label: 'Mochiy Pop One' },
  { value: 'Mochiy Pop P One', label: 'Mochiy Pop P One' },
  { value: 'Yusei Magic', label: 'Yusei Magic' },
  { value: 'DotGothic16', label: 'Dot Gothic 16' },
  {
    value: '手書き雑フォント',
    label: '手書き雑フォント',
    customCss: `@font-face { font-family: '手書き雑フォント'; src: url('https://cdn.leafscape.be/tegaki_zatsu/851tegaki_zatsu_web.woff2') format("woff2"); font-display: swap; }`,
  },
  {
    value: '瀬戸フォント',
    label: '瀬戸フォント',
    customCss: `@font-face { font-family: '瀬戸フォント'; src: url('https://cdn.leafscape.be/setofont/setofont_web.woff2') format("woff2"); font-display: swap; }`,
  },
]

const FONT_SIZE_BASE = 15
const FONT_SIZE_MIN = -3
const FONT_SIZE_MAX = 5

// スライダーの塗りつぶし率 (OS のボリュームバー式に左側をアクセント色で塗る)
function sliderFill(value: number, min: number, max: number): string {
  return `${((value - min) / (max - min)) * 100}%`
}

// 公開範囲ごとのノート背景色 (public はデフォルトのまま)
const VISIBILITY_BG_COLORS: Record<string, { label: string; color: string }> = {
  home: { label: 'ホーム', color: 'rgba(51, 127, 255, 0.08)' },
  followers: { label: 'フォロワー', color: 'rgba(0, 170, 100, 0.08)' },
  specified: { label: 'ダイレクト', color: 'rgba(255, 90, 120, 0.1)' },
}

interface VisibilityBgOption {
  key: string
  label: string
}

const VISIBILITY_BG_OPTIONS: VisibilityBgOption[] = [
  { key: '', label: 'デフォルト' },
  { key: 'tint', label: '背景色で色分け' },
]

// 数字の非表示 (#593/#594)。yamisskey の hideReactionCount / hide*Count と
// 同じ self/others/all の 3 段階。導線 (クリックで一覧を開く等) は残し数字だけ消す。
// ノート側はリアクション数 + リノート数 (評価シグナル)。返信数は会話の量なので対象外
interface HideCountOption {
  key: string
  label: string
}

const HIDE_COUNT_OPTIONS: HideCountOption[] = [
  { key: '', label: 'デフォルト' },
  { key: 'self', label: '自分のみ隠す' },
  { key: 'others', label: '他人のみ隠す' },
  { key: 'all', label: 'すべて隠す' },
]

function hideCountTargets(key: string): string[] {
  if (key === 'self') return ['true']
  if (key === 'others') return ['false']
  if (key === 'all') return ['true', 'false']
  return []
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

function buildPresetCss(): string {
  const parts: string[] = []

  if (presets.value.customFont) {
    const font = presets.value.customFont
    const opt = FONT_OPTIONS.find((o) => o.value === font)
    parts.push(`/* nd-font: ${font} */`)
    if (opt?.customCss) {
      parts.push(opt.customCss)
    } else {
      const url =
        opt?.importUrl ??
        `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}&display=swap`
      parts.push(`@import url('${url}');`)
    }
    parts.push(`html { font-family: '${font}', sans-serif; }`)
  }

  if (presets.value.fontSize !== 0) {
    const px = FONT_SIZE_BASE + presets.value.fontSize
    parts.push(`/* nd-fontsize: ${presets.value.fontSize} */`)
    parts.push(`html { font-size: ${px}px; }`)
  }

  if (presets.value.visibilityBg === 'tint') {
    parts.push('/* nd-visibility-bg: tint */')
    for (const [visibility, { color }] of Object.entries(
      VISIBILITY_BG_COLORS,
    )) {
      parts.push(
        `.note-root[data-visibility="${visibility}"] { background-color: ${color}; }`,
      )
    }
  }

  const noteCountTargets = hideCountTargets(presets.value.hideNoteCounts)
  if (noteCountTargets.length > 0) {
    parts.push(`/* nd-hide-note-counts: ${presets.value.hideNoteCounts} */`)
    for (const own of noteCountTargets) {
      parts.push(
        `.note-root[data-own="${own}"] :is(.note-reaction-count, .note-renote-count) { display: none; }`,
      )
    }
  }

  const statsTargets = hideCountTargets(presets.value.hideUserStats)
  if (statsTargets.length > 0) {
    parts.push(`/* nd-hide-user-stats: ${presets.value.hideUserStats} */`)
    for (const own of statsTargets) {
      parts.push(
        `.user-stats[data-own="${own}"] .user-stat-count { font-size: 0; }`,
      )
      parts.push(
        `.user-stats[data-own="${own}"] .user-stat-count::before { content: '-'; font-size: 1rem; }`,
      )
    }
  }

  return parts.join('\n')
}

function extractUserCss(fullCss: string): string {
  return fullCss
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (!t) return false
      if (t.startsWith('/* nd-font:')) return false
      if (t.startsWith('/* nd-fontsize:')) return false
      if (t.startsWith('/* nd-visibility-bg:')) return false
      if (t.startsWith('/* nd-hide-note-counts:')) return false
      if (t.startsWith('/* nd-hide-user-stats:')) return false
      // 生成行 (1 行完結) のみ除去。ユーザーが複数行で書いた同セレクタは残す
      if (t.match(/^\.note-root\[data-visibility=.+\{.*\}$/)) return false
      if (t.match(/^\.note-root\[data-own=.+\{.*\}$/)) return false
      if (t.match(/^\.user-stats\[data-own=.+\{.*\}$/)) return false
      if (t.startsWith('@import url(')) return false
      if (t.startsWith('@font-face')) return false
      if (t.match(/^html\s*\{\s*font-family:/)) return false
      if (t.match(/^html\s*\{\s*font-size:/)) return false
      return true
    })
    .join('\n')
    .trim()
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
  const preset = buildPresetCss()
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
  parsePresetsFromCss(cssStr)
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
    parsePresetsFromCss(text)
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
    presets.value = {
      customFont: '',
      fontSize: 0,
      visibilityBg: '',
      hideNoteCounts: '',
      hideUserStats: '',
    }
    userFreeformCss.value = ''
    cssCode.value = ''
    cssError.value = null
    codeError.value = null
    themeStore.setCustomCss('')
  })
}

// Font dropdown
const showFontDropdown = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

const selectedFontLabel = computed(() => {
  const opt = FONT_OPTIONS.find((o) => o.value === presets.value.customFont)
  return opt?.label ?? 'デフォルト'
})

function selectFont(value: string) {
  presets.value.customFont = value
  showFontDropdown.value = false
}

useClickOutside(dropdownRef, () => {
  showFontDropdown.value = false
})

// Visibility background dropdown
const showVisibilityBgDropdown = ref(false)
const visibilityBgDropdownRef = ref<HTMLElement | null>(null)

const selectedVisibilityBgLabel = computed(() => {
  const opt = VISIBILITY_BG_OPTIONS.find(
    (o) => o.key === presets.value.visibilityBg,
  )
  return opt?.label ?? 'デフォルト'
})

function selectVisibilityBg(key: string) {
  presets.value.visibilityBg = key
  showVisibilityBgDropdown.value = false
}

useClickOutside(visibilityBgDropdownRef, () => {
  showVisibilityBgDropdown.value = false
})

// Hide-count dropdowns (#593/#594)
const showNoteCountsDropdown = ref(false)
const noteCountsDropdownRef = ref<HTMLElement | null>(null)
const showUserStatsDropdown = ref(false)
const userStatsDropdownRef = ref<HTMLElement | null>(null)

function hideCountLabel(key: string): string {
  return HIDE_COUNT_OPTIONS.find((o) => o.key === key)?.label ?? 'デフォルト'
}

function selectNoteCounts(key: string) {
  presets.value.hideNoteCounts = key
  showNoteCountsDropdown.value = false
}

function selectUserStats(key: string) {
  presets.value.hideUserStats = key
  showUserStatsDropdown.value = false
}

useClickOutside(noteCountsDropdownRef, () => {
  showNoteCountsDropdown.value = false
})

useClickOutside(userStatsDropdownRef, () => {
  showUserStatsDropdown.value = false
})

watch(tab, (t) => {
  if (t === 'code') {
    cssCode.value = fullCss.value
    codeError.value = null
  } else {
    parsePresetsFromCss(cssCode.value)
    userFreeformCss.value = extractUserCss(cssCode.value)
  }
})
</script>

<template>
  <div ref="editorRef" :class="$style.cssContent">
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
          <div ref="dropdownRef" :class="$style.dropdown">
            <button
              class="_button"
              :class="$style.dropdownTrigger"
              @click="showFontDropdown = !showFontDropdown"
            >
              <span
                v-if="presets.customFont"
                :class="$style.fontPreviewLabel"
                :style="{ fontFamily: `'${presets.customFont}', sans-serif` }"
              >{{ selectedFontLabel }}</span>
              <span v-else>{{ selectedFontLabel }}</span>
              <i class="ti ti-chevron-down" :class="$style.dropdownChevron" />
            </button>
            <div v-if="showFontDropdown" :class="$style.dropdownPanel">
              <button
                v-for="opt in FONT_OPTIONS"
                :key="opt.value"
                class="_button"
                :class="[$style.dropdownItem, { [$style.selected]: presets.customFont === opt.value }]"
                @click="selectFont(opt.value)"
              >
                <span
                  v-if="opt.value"
                  :class="$style.fontPreviewLabel"
                  :style="{ fontFamily: `'${opt.value}', sans-serif` }"
                >{{ opt.label }}</span>
                <span v-else>{{ opt.label }}</span>
                <i v-if="presets.customFont === opt.value" class="ti ti-check" :class="$style.checkIcon" />
              </button>
            </div>
          </div>
          <div v-if="presets.customFont" :class="$style.preview" :style="{ fontFamily: `'${presets.customFont}', sans-serif` }">
            あいうえお ABCabc 123
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
          <div ref="visibilityBgDropdownRef" :class="$style.dropdown">
            <button
              class="_button"
              :class="$style.dropdownTrigger"
              @click="showVisibilityBgDropdown = !showVisibilityBgDropdown"
            >
              <span>{{ selectedVisibilityBgLabel }}</span>
              <i class="ti ti-chevron-down" :class="$style.dropdownChevron" />
            </button>
            <div v-if="showVisibilityBgDropdown" :class="$style.dropdownPanel">
              <button
                v-for="opt in VISIBILITY_BG_OPTIONS"
                :key="opt.key"
                class="_button"
                :class="[$style.dropdownItem, { [$style.selected]: presets.visibilityBg === opt.key }]"
                @click="selectVisibilityBg(opt.key)"
              >
                <span>{{ opt.label }}</span>
                <i v-if="presets.visibilityBg === opt.key" class="ti ti-check" :class="$style.checkIcon" />
              </button>
            </div>
          </div>
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
          <div ref="noteCountsDropdownRef" :class="$style.dropdown">
            <button
              class="_button"
              :class="$style.dropdownTrigger"
              @click="showNoteCountsDropdown = !showNoteCountsDropdown"
            >
              <span>{{ hideCountLabel(presets.hideNoteCounts) }}</span>
              <i class="ti ti-chevron-down" :class="$style.dropdownChevron" />
            </button>
            <div v-if="showNoteCountsDropdown" :class="$style.dropdownPanel">
              <button
                v-for="opt in HIDE_COUNT_OPTIONS"
                :key="opt.key"
                class="_button"
                :class="[$style.dropdownItem, { [$style.selected]: presets.hideNoteCounts === opt.key }]"
                @click="selectNoteCounts(opt.key)"
              >
                <span>{{ opt.label }}</span>
                <i v-if="presets.hideNoteCounts === opt.key" class="ti ti-check" :class="$style.checkIcon" />
              </button>
            </div>
          </div>
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
          <div ref="userStatsDropdownRef" :class="$style.dropdown">
            <button
              class="_button"
              :class="$style.dropdownTrigger"
              @click="showUserStatsDropdown = !showUserStatsDropdown"
            >
              <span>{{ hideCountLabel(presets.hideUserStats) }}</span>
              <i class="ti ti-chevron-down" :class="$style.dropdownChevron" />
            </button>
            <div v-if="showUserStatsDropdown" :class="$style.dropdownPanel">
              <button
                v-for="opt in HIDE_COUNT_OPTIONS"
                :key="opt.key"
                class="_button"
                :class="[$style.dropdownItem, { [$style.selected]: presets.hideUserStats === opt.key }]"
                @click="selectUserStats(opt.key)"
              >
                <span>{{ opt.label }}</span>
                <i v-if="presets.hideUserStats === opt.key" class="ti ti-check" :class="$style.checkIcon" />
              </button>
            </div>
          </div>
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

.fontPreviewLabel { flex: 1; min-width: 0; }
.checkIcon { margin-left: auto; opacity: 0.7; flex-shrink: 0; }

.preview {
  padding: 8px 10px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  font-size: 0.9em;
  text-align: center;
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
