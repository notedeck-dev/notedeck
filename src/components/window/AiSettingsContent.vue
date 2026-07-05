<script setup lang="ts">
import { json } from '@codemirror/lang-json'
import { type Diagnostic, linter } from '@codemirror/lint'
import JSON5 from 'json5'
import { ref, watch } from 'vue'
import EditorTabs from '@/components/common/EditorTabs.vue'
import CodeEditor from '@/components/deck/widgets/CodeEditor.vue'
import AiConnectionSection from '@/components/window/ai-settings/AiConnectionSection.vue'
import AiDataSourcesSection from '@/components/window/ai-settings/AiDataSourcesSection.vue'
import AiHeartbeatSection from '@/components/window/ai-settings/AiHeartbeatSection.vue'
import AiPersonaSection from '@/components/window/ai-settings/AiPersonaSection.vue'
import {
  type AiConfig,
  defaultConfig,
  useAiConfig,
} from '@/composables/useAiConfig'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useDoubleConfirm } from '@/composables/useDoubleConfirm'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { useWindowExternalFile } from '@/composables/useWindowExternalFile'

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
      rawError.value = e instanceof Error ? e.message : '不正な JSON5'
    }
  }, 500)
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
        { value: 'json', icon: 'braces', label: 'ai.json5' },
      ]"
    />

    <!-- API Settings Tab -->
    <div v-show="tab === 'api'" :class="$style.panel">
      <AiConnectionSection />
      <AiPersonaSection />
      <AiDataSourcesSection />
      <AiHeartbeatSection />
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
</style>
