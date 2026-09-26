<script setup lang="ts">
import { json as jsonLang } from '@codemirror/lang-json'
import { type Diagnostic, linter } from '@codemirror/lint'
import JSON5 from 'json5'
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { reloadSnippets } from '@/aiscript/snippets/cache'
import { DEFAULT_AISCRIPT_SNIPPETS } from '@/aiscript/snippets/defaultSnippets'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { useDoubleConfirm } from '@/composables/useDoubleConfirm'
import { useWindowExternalFile } from '@/composables/useWindowExternalFile'
import { i18n } from '@/i18n'
import { useToast } from '@/stores/toast'
import {
  isTauri,
  listSnippetFiles,
  readSnippetFile,
  writeSnippetFile,
} from '@/utils/settingsFs'

const CodeEditor = defineAsyncComponent(
  () => import('@/components/deck/widgets/CodeEditor.vue'),
)

const lang = jsonLang()

const jsonLinter = linter(
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

const DEFAULT_FILE = 'aiscript.json5'
const toast = useToast()

const files = ref<string[]>([])
const currentFile = ref<string>(DEFAULT_FILE)
const code = ref<string>('')
const dirty = ref(false)
const saved = ref(false)
const error = ref<string | null>(null)
const loaded = ref(false)

useWindowExternalFile(() =>
  currentFile.value ? { name: currentFile.value, subdir: 'snippets' } : null,
)

const statusText = computed(() => {
  if (error.value) return error.value
  if (saved.value) return i18n.ts._common.saved
  if (dirty.value) return i18n.ts._snippetsEditorContent.editing
  return ''
})

const statusClass = computed(() => {
  if (error.value) return 'statusError'
  if (saved.value) return 'statusSaved'
  return ''
})

async function refreshFiles() {
  if (!isTauri) {
    files.value = [DEFAULT_FILE]
    return
  }
  const list = await listSnippetFiles()
  if (list.length === 0) {
    await writeSnippetFile(DEFAULT_FILE, DEFAULT_AISCRIPT_SNIPPETS)
    files.value = [DEFAULT_FILE]
  } else {
    files.value = list
  }
}

async function loadCurrent() {
  if (!isTauri) {
    code.value = DEFAULT_AISCRIPT_SNIPPETS
    dirty.value = false
    return
  }
  try {
    const raw = await readSnippetFile(currentFile.value)
    code.value = raw || DEFAULT_AISCRIPT_SNIPPETS
    dirty.value = false
    error.value = null
  } catch (e) {
    toast.show(
      i18n.tsx._snippetsEditorContent.loadFailed({
        file: currentFile.value,
        error: (e as Error).message,
      }),
      'error',
    )
  }
}

onMounted(async () => {
  await refreshFiles()
  await loadCurrent()
  loaded.value = true
})

async function selectFile(name: string) {
  if (dirty.value) {
    await save()
  }
  currentFile.value = name
  await loadCurrent()
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
watch(code, () => {
  if (!loaded.value) return
  dirty.value = true
  saved.value = false
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 600)
})

async function save() {
  if (!loaded.value || !isTauri) return
  try {
    if (code.value.trim()) JSON5.parse(code.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : i18n.ts._common.invalidJson5
    return
  }
  try {
    await writeSnippetFile(currentFile.value, code.value)
    await reloadSnippets()
    dirty.value = false
    saved.value = true
    error.value = null
    setTimeout(() => {
      saved.value = false
    }, 2000)
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : i18n.ts._snippetsEditorContent.saveFailed
  }
}

// ── Import / Export ──
const {
  copied: copiedMessage,
  imported: importedMessage,
  importError,
  showCopied,
  showImported,
  showImportError,
} = useClipboardFeedback()

function exportSnippets() {
  navigator.clipboard.writeText(code.value)
  showCopied()
}

async function importSnippets() {
  try {
    const text = await navigator.clipboard.readText()
    if (!text.trim()) {
      showImportError()
      return
    }
    try {
      JSON5.parse(text)
    } catch {
      showImportError()
      return
    }
    code.value = text
    showImported()
  } catch {
    showImportError()
  }
}

// ── Reset to defaults ──
const { confirming: confirmingReset, trigger: triggerReset } =
  useDoubleConfirm()

function handleReset() {
  triggerReset(() => {
    code.value = DEFAULT_AISCRIPT_SNIPPETS
    error.value = null
  })
}
</script>

<template>
  <div :class="$style.content">
    <aside v-if="files.length > 1" :class="$style.fileList">
      <button
        v-for="f in files"
        :key="f"
        class="_button"
        :class="[$style.fileItem, { [$style.active]: f === currentFile }]"
        @click="selectFile(f)"
      >
        <i class="ti ti-file-code" />
        <span>{{ f }}</span>
      </button>
    </aside>

    <div :class="$style.editorPanel">
      <div :class="$style.codePanel">
        <div :class="$style.codeHint">
          {{ i18n.ts._snippetsEditorContent.codeHint }}
        </div>

        <CodeEditor
          v-model="code"
          :language="lang"
          :linter="jsonLinter"
          :class="[$style.codeEditorWrap, { [$style.hasError]: error }]"
          auto-height
        />

        <div v-if="statusText" :class="[$style.status, $style[statusClass]]">
          <i
            class="ti"
            :class="
              error ? 'ti-alert-triangle' : saved ? 'ti-check' : 'ti-loader-2'
            "
          />
          {{ statusText }}
        </div>
      </div>

      <div :class="$style.actions">
        <div :class="$style.actionGroup">
          <button
            class="_button"
            :class="[$style.actionBtn, $style.secondary, { [$style.feedback]: importedMessage || importError }]"
            @click="importSnippets"
          >
            <i class="ti" :class="importError ? 'ti-alert-circle' : 'ti-clipboard-text'" />
            {{ importError ? i18n.ts._common.invalid : importedMessage ? i18n.ts._common.loaded : i18n.ts._common.import }}
          </button>
          <button
            class="_button"
            :class="[$style.actionBtn, $style.secondary, { [$style.feedback]: copiedMessage }]"
            @click="exportSnippets"
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
          <i class="ti ti-refresh" />
          {{ confirmingReset ? i18n.ts._snippetsEditorContent.confirmReset : i18n.ts._common.resetToDefault }}
        </button>
      </div>
    </div>
  </div>
</template>

<style module lang="scss">
@use '@/styles/buttons' as *;

.content {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.fileList {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 160px;
  padding: 8px 6px;
  border-right: 1px solid var(--nd-divider);
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.fileItem {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--nd-radius-sm);
  font-size: 0.8em;
  color: var(--nd-fg);
  text-align: left;
  transition: background var(--nd-duration-fast);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  &.active {
    background: var(--nd-accent-hover);
    color: var(--nd-accent);
  }

  i {
    flex-shrink: 0;
    opacity: 0.7;
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.active {
  /* modifier */
}

.editorPanel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

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

.hasError {
  /* modifier */
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

.actions {
  @include action-bar;
}
.actionGroup {
  @include action-group;
}

.actionBtn {
  &.secondary {
    @include btn-action;
  }
  &.danger {
    @include btn-danger-ghost;
  }
}

.secondary {
  /* modifier */
}
.feedback {
  /* modifier */
}
.danger {
  /* modifier */
}
.confirming {
  /* modifier */
}
</style>
