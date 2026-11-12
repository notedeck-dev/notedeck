<script setup lang="ts">
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { bracketMatching } from '@codemirror/language'
import { type Extension, RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  placeholder as placeholderExtension,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { aiscriptTheme } from '@/aiscript/codemirror/theme'
import { mfmHighlightRanges } from '@/services/mfmHighlight'

/**
 * MFM のソースを書く入力欄 (#1392)。色付けと、入れ子の括弧の対応表示だけを足す。
 * 文字は変えない: 自動の字下げも、括弧の自動補完も入れない (MFM は空白と改行を
 * そのまま表示するので、エディターが文字を足すと表示が変わる)。
 */
const props = defineProps<{
  modelValue: string
  placeholder?: string
  ariaLabel?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

/** 入れ子の深さごとの色の数。これを超えたら最初の色に戻る */
const DEPTH_COLORS = 4

function decorationsOf(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const r of mfmHighlightRanges(view.state.doc.toString())) {
    const depth =
      r.depth === undefined ? '' : ` cm-mfm-d${r.depth % DEPTH_COLORS}`
    builder.add(
      r.from,
      r.to,
      Decoration.mark({ class: `cm-mfm-${r.kind}${depth}` }),
    )
  }
  return builder.finish()
}

const highlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = decorationsOf(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = decorationsOf(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

// 色はコード面の変数 (global.css) から取る。ほかのコードエディターと同じ面に載る
const colors = EditorView.theme({
  '.cm-content': { padding: '10px 12px' },
  '.cm-mfm-d0': { color: 'var(--nd-codeKeyword)' },
  '.cm-mfm-d1': { color: 'var(--nd-codeType)' },
  '.cm-mfm-d2': { color: 'var(--nd-codeString)' },
  '.cm-mfm-d3': { color: 'var(--nd-codeNumber)' },
  '.cm-mfm-fn': { fontWeight: 'bold' },
  '.cm-mfm-fnArgs': { opacity: '0.75' },
  '.cm-mfm-mark': { color: 'var(--nd-codeComment)' },
  '.cm-mfm-emoji': { color: 'var(--nd-codeString)' },
  '.cm-mfm-mention': { color: 'var(--nd-codeType)' },
  '.cm-mfm-hashtag': { color: 'var(--nd-codeVariable)' },
  '.cm-mfm-url': {
    color: 'var(--nd-codeVariable)',
    textDecoration: 'underline',
  },
  '.cm-mfm-code': { color: 'var(--nd-codeComment)' },
})

const editorRef = ref<HTMLDivElement>()
let view: EditorView | null = null
let isExternalUpdate = false

onMounted(() => {
  if (!editorRef.value) return
  const extensions: Extension[] = [
    aiscriptTheme,
    colors,
    highlight,
    history(),
    // 対応を示すのは MFM の関数の括弧だけ。文中の ( ) は対にならないことが多く、
    // 「相手がいない」表示が出続ける
    bracketMatching({ brackets: '[]' }),
    EditorView.lineWrapping,
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.contentAttributes.of({
      spellcheck: 'false',
      ...(props.ariaLabel ? { 'aria-label': props.ariaLabel } : {}),
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !isExternalUpdate) {
        emit('update:modelValue', update.state.doc.toString())
      }
    }),
  ]
  if (props.placeholder) {
    extensions.push(placeholderExtension(props.placeholder))
  }
  view = new EditorView({
    doc: props.modelValue,
    extensions,
    parent: editorRef.value,
  })
})

watch(
  () => props.modelValue,
  (next) => {
    if (!view) return
    const current = view.state.doc.toString()
    if (current === next) return
    isExternalUpdate = true
    view.dispatch({ changes: { from: 0, to: current.length, insert: next } })
    isExternalUpdate = false
  },
)

onUnmounted(() => {
  view?.destroy()
  view = null
})
</script>

<template>
  <div ref="editorRef" :class="$style.mfmSourceEditor" />
</template>

<style lang="scss" module>
.mfmSourceEditor {
  min-height: 0;
  overflow: auto;

  :global(.cm-editor) {
    height: 100%;
  }

  :global(.cm-scroller) {
    font-family: var(--nd-font-mono);
    overflow: auto;
  }
}
</style>
