<script setup lang="ts">
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
} from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { lintGutter } from '@codemirror/lint'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { aiscriptTheme } from '@/aiscript/codemirror/theme'

const props = withDefaults(
  defineProps<{
    modelValue: string
    language: Extension
    linter?: Extension
    maxHeight?: string
    readOnly?: boolean
    /**
     * Grow the editor to fit its content instead of scrolling internally.
     * Use this when the editor is placed inside an already-scrolling parent
     * so there is a single outer scroll container (no nested scrolling).
     */
    autoHeight?: boolean
  }>(),
  {
    maxHeight: 'none',
    readOnly: false,
    autoHeight: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const editorRef = ref<HTMLDivElement>()
let view: EditorView | null = null
let isExternalUpdate = false

onMounted(() => {
  if (!editorRef.value) return

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && !isExternalUpdate) {
      emit('update:modelValue', update.state.doc.toString())
    }
  })

  const extensions: Extension[] = [
    props.language,
    aiscriptTheme,
    lineNumbers(),
    history(),
    bracketMatching(),
    closeBrackets(),
    indentOnInput(),
    autocompletion(),
    lintGutter(),
    keymap.of([
      indentWithTab,
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    updateListener,
  ]
  if (props.readOnly) extensions.push(EditorState.readOnly.of(true))
  if (props.linter) extensions.push(props.linter)

  view = new EditorView({
    doc: props.modelValue,
    extensions,
    parent: editorRef.value,
  })
})

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
})
</script>

<template>
  <div
    ref="editorRef"
    :class="[$style.codeEditor, { [$style.autoHeight]: autoHeight }]"
    :style="maxHeight !== 'none' ? { maxHeight } : undefined"
  />
</template>

<style lang="scss" module>
.codeEditor {
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

  // Content-height mode: let the editor grow with its content so an outer
  // parent provides the single scroll container.
  &.autoHeight {
    overflow: visible;

    :deep(.cm-editor) {
      height: auto;
    }
  }
}
</style>
