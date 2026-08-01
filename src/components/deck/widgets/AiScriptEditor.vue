<script setup lang="ts">
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { bracketMatching } from '@codemirror/language'
import { lintGutter } from '@codemirror/lint'
import { EditorState, type Extension } from '@codemirror/state'
import {
  placeholder as cmPlaceholder,
  EditorView,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { aiscriptCompletions } from '@/aiscript/codemirror/completions'
import { aiscriptLanguage } from '@/aiscript/codemirror/language'
import { aiscriptLinter } from '@/aiscript/codemirror/linter'
import { aiscriptTheme } from '@/aiscript/codemirror/theme'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    maxHeight?: string
    useLsp?: boolean
    autoHeight?: boolean
  }>(),
  {
    placeholder: '',
    maxHeight: 'none',
    useLsp: false,
    autoHeight: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const editorStyle = computed(() =>
  props.maxHeight !== 'none' ? { maxHeight: props.maxHeight } : undefined,
)

const editorRef = ref<HTMLDivElement>()
let view: EditorView | null = null
let isExternalUpdate = false
let lspWorker: Worker | null = null
let lspClient: InstanceType<
  typeof import('@codemirror/lsp-client').LSPClient
> | null = null

const fileURI = `file:///aiscript-${Math.random().toString(36).slice(2, 8)}.ais`

onMounted(async () => {
  if (!editorRef.value) return

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && !isExternalUpdate) {
      emit('update:modelValue', update.state.doc.toString())
    }
  })

  const commonExtensions = [
    aiscriptLanguage,
    aiscriptTheme,
    lineNumbers(),
    history(),
    bracketMatching(),
    closeBrackets(),
    lintGutter(),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
    cmPlaceholder(props.placeholder),
    updateListener,
  ]

  let extensions: Extension[]
  if (props.useLsp) {
    // Dynamic import: only load LSP modules when needed
    const [
      { LSPClient, serverCompletion, serverDiagnostics },
      { createWorkerTransport },
    ] = await Promise.all([
      import('@codemirror/lsp-client'),
      import('@/aiscript/lsp/transport'),
    ])

    lspWorker = new Worker(
      new URL('../../../aiscript/lsp/worker.ts', import.meta.url),
      { type: 'module' },
    )
    const transport = createWorkerTransport(lspWorker)
    lspClient = new LSPClient({
      extensions: [serverCompletion({ override: true }), serverDiagnostics()],
    })
    lspClient.connect(transport)
    extensions = [
      ...commonExtensions,
      autocompletion(),
      lspClient.plugin(fileURI, 'aiscript'),
    ]
  } else {
    extensions = [
      ...commonExtensions,
      autocompletion({ override: [aiscriptCompletions] }),
      aiscriptLinter,
    ]
  }

  view = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions,
    }),
    parent: editorRef.value,
  })
})

// Sync external changes into the editor
watch(
  () => props.modelValue,
  (newVal) => {
    if (!view) return
    const current = view.state.doc.toString()
    if (current === newVal) return

    isExternalUpdate = true
    view.dispatch({
      changes: { from: 0, to: current.length, insert: newVal },
    })
    isExternalUpdate = false
  },
)

onUnmounted(() => {
  view?.destroy()
  view = null
  lspClient?.disconnect()
  lspClient = null
  lspWorker?.terminate()
  lspWorker = null
})
</script>

<template>
  <div ref="editorRef" :class="[$style.aisEditor, { [$style.autoHeight]: autoHeight }]" :style="editorStyle" />
</template>

<style lang="scss" module>
.aisEditor {
  border-radius: var(--nd-radius-sm);
  overflow: auto;
  background: #1e1e1e;
  transition: box-shadow var(--nd-duration-base);

  &:focus-within {
    box-shadow: 0 0 0 2px var(--nd-accent);
  }

  :deep(.cm-editor) {
    height: 100%;
    min-height: 80px;
  }

  :deep(.cm-scroller) {
    font-family: var(--nd-font-mono);
    overflow: auto;
  }

  &.autoHeight {
    overflow: visible;

    :deep(.cm-editor) {
      height: auto;
    }
  }
}
</style>
