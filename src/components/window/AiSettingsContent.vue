<script setup lang="ts">
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { type Diagnostic, linter } from '@codemirror/lint'
import JSON5 from 'json5'
import { computed, ref, watch } from 'vue'
import EditorTabs from '@/components/common/EditorTabs.vue'
import CodeEditor from '@/components/deck/widgets/CodeEditor.vue'
import AiConnectionSection from '@/components/window/ai-settings/AiConnectionSection.vue'
import AiDataSourcesSection from '@/components/window/ai-settings/AiDataSourcesSection.vue'
import AiGenerationSection from '@/components/window/ai-settings/AiGenerationSection.vue'
import AiHeartbeatSection from '@/components/window/ai-settings/AiHeartbeatSection.vue'
import AiPersonalitySection from '@/components/window/ai-settings/AiPersonalitySection.vue'
import {
  type AiConfig,
  defaultConfig,
  useAiConfig,
} from '@/composables/useAiConfig'
import { useAiWorkspace } from '@/composables/useAiWorkspace'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useDoubleConfirm } from '@/composables/useDoubleConfirm'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { useWindowExternalFile } from '@/composables/useWindowExternalFile'
import { i18n } from '@/i18n'
import { isExposed } from '@/settings/exposure'

const jsonLang = json()
const markdownLang = markdown()

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
        message:
          e instanceof Error ? e.message : i18n.ts._common.json5ParseError,
      })
    }
    return diagnostics
  },
  { delay: 400 },
)

const props = defineProps<{
  initialTab?: string
  /** 開いて見せる節 (アプリの通知から, #1165)。同じ節を開き直すときは `revealAt` を変える */
  section?: 'heartbeat'
  revealAt?: number
}>()

// AI そのものは一般側の面だが、ai.json5 / SOUL.md を直接編集するタブは他の設定窓の
// code タブと同じ「生ファイルを編集する面」なので開発者モードに従う (#1034 / #1186)
type EditorTab = 'api' | 'json' | 'soul'
const editorTabs = computed(() =>
  isExposed('developer')
    ? (['api', 'json', 'soul'] as const)
    : (['api'] as const),
)

const { tab, containerRef: editorRef } = useEditorTabs<EditorTab>(
  editorTabs,
  props.initialTab !== 'api' && !isExposed('developer')
    ? 'api'
    : ((props.initialTab as EditorTab) ?? 'api'),
)

useWindowExternalFile(() =>
  !isExposed('developer')
    ? null
    : tab.value === 'soul'
      ? { name: 'SOUL.md', subdir: 'notemaid' }
      : { name: 'ai.json5' },
)

// --- Config (delegated to composable) ---
// 各セクションコンポーネントは useAiConfig() のシングルトン config を直接
// 変更する。ここの deep watch が全セクションの変更を拾って保存する。

const { config, save: saveConfig, mergeConfig } = useAiConfig()

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
      rawError.value =
        e instanceof Error ? e.message : i18n.ts._common.invalidJson5
    }
  }, 500)
})

// --- SOUL.md raw editor (開発者モード)。人格のフォームと同じ写しを markdown のまま編む ---

const workspace = useAiWorkspace()
const rawSoul = ref('')
const soulError = ref<string | null>(null)
const soulSaved = ref(false)
let soulSyncing = false
/** 最後に読み込んだ (または保存した) 本文。これと違えば未保存の入力がある */
let soulLoaded = ''

watch(
  () => workspace.fileOf('soul')?.body,
  (body) => {
    if (soulSyncing) return
    const next = body ?? ''
    // 未保存の入力があるときは外の変更で上書きしない (入力を残して知らせる)
    if (rawSoul.value !== soulLoaded && next !== rawSoul.value) {
      soulLoaded = next
      soulError.value = i18n.ts._aiPersonalitySection.externallyChanged
      return
    }
    soulLoaded = next
    rawSoul.value = next
  },
  { immediate: true },
)

let soulSaveTimer: ReturnType<typeof setTimeout> | null = null
watch(rawSoul, (v) => {
  // 保存済みの本文に戻したときも、先に積んだ保存は取り消す
  if (soulSaveTimer) clearTimeout(soulSaveTimer)
  soulSaveTimer = null
  if (tab.value !== 'soul') return
  if (v === workspace.fileOf('soul')?.body) return
  soulSaveTimer = setTimeout(async () => {
    soulSyncing = true
    try {
      await workspace.write('soul', v)
      soulLoaded = v
      soulError.value = null
      soulSaved.value = true
      setTimeout(() => {
        soulSaved.value = false
      }, 1500)
    } catch (e) {
      soulError.value = e instanceof Error ? e.message : String(e)
    } finally {
      soulSyncing = false
    }
  }, 800)
})

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
        ...(isExposed('developer')
          ? [
              { value: 'json', icon: 'braces', label: 'ai.json5' },
              { value: 'soul', icon: 'markdown', label: 'SOUL.md' },
            ]
          : []),
      ]"
    />

    <!-- API Settings Tab -->
    <div v-show="tab === 'api'" :class="$style.panel">
      <AiConnectionSection />
      <AiPersonalitySection />
      <AiDataSourcesSection />
      <AiHeartbeatSection
        :reveal="section === 'heartbeat' ? revealAt : undefined"
      />
      <AiGenerationSection />
    </div>

    <!-- ai.json5 raw editor tab -->
    <div v-show="tab === 'json'" :class="$style.codePanel">
      <div :class="$style.codeHint">
        {{ i18n.ts._aiSettingsContent.rawHint }}
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
          {{ i18n.ts._common.saved }}
        </div>
      </div>
    </div>

    <!-- SOUL.md raw editor tab -->
    <div v-show="tab === 'soul'" :class="$style.codePanel">
      <div :class="$style.codeHint">
        {{ i18n.ts._aiSettingsContent.soulHint }}
      </div>
      <CodeEditor
        v-model="rawSoul"
        :language="markdownLang"
        :class="$style.codeEditorWrap"
        auto-height
      />
      <div :class="$style.promptStatus">
        <div v-if="soulError" :class="$style.errorMessage">
          <i class="ti ti-alert-triangle" />
          {{ soulError }}
        </div>
        <div v-else-if="soulSaved" :class="$style.codeSuccess">
          <i class="ti ti-check" />
          {{ i18n.ts._common.saved }}
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
          {{ importError ? i18n.ts._common.invalid : importedMessage ? i18n.ts._common.loaded : i18n.ts._common.import }}
        </button>
        <button
          class="_button"
          :class="[$style.actionBtn, $style.secondary, { [$style.feedback]: copiedMessage }]"
          @click="exportConfig"
        >
          <i class="ti ti-clipboard-copy" />
          {{ copiedMessage ? i18n.ts._common.copied : i18n.ts._common.export }}
        </button>
      </div>
      <button
        class="_button"
        :class="[$style.actionBtn, $style.danger, { [$style.confirming]: confirmingReset }]"
        @click="handleReset"
      >
        <i class="ti ti-trash" />
        {{ confirmingReset ? i18n.ts._common.confirmReset : i18n.ts._common.resetAll }}
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
  font-size: var(--nd-font-xs);
  opacity: 0.4;
}

.codeEditorWrap {
}

.promptStatus {
  display: flex;
  align-items: center;
  gap: 8px;
}

.errorMessage {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: var(--nd-radius-sm);
  background: color-mix(in srgb, var(--nd-love) 10%, var(--nd-bg));
  color: var(--nd-love);
  font-size: var(--nd-font-xs);
  word-break: break-all;
}

.codeSuccess {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--nd-font-xs);
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
</style>
