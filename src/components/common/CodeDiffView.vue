<script setup lang="ts">
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { unifiedMergeView } from '@codemirror/merge'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { aiscriptLanguage } from '@/aiscript/codemirror/language'
import { aiscriptTheme } from '@/aiscript/codemirror/theme'

/**
 * 共通 diff コンポーネント (#981 詳細設計 / #1040 が最初の消費者)。
 * 表示専用。入力は文字列 2 本と言語キーのみで、どの機能から呼ばれたかを
 * 知らない。v1 は unified 固定 (side-by-side / チャンク承認は将来
 * @codemirror/merge の merge ビューへ載せ替え可能な形で塞がない)。
 */
const props = withDefaults(
  defineProps<{
    /** 編集前の全文。新規作成は空文字 (全行挿入の diff として自然に見える) */
    oldText: string
    /** 適用後の全文 */
    newText: string
    /** 言語モードは既存のエディタ基盤から解決 (json5 は lang-json で代用) */
    language?: 'aiscript' | 'json5' | 'markdown' | 'css' | 'text'
    /** 未変更領域を前後数行のコンテキストを残して折りたたむ (展開可) */
    collapseUnchanged?: boolean
  }>(),
  {
    language: 'text',
    collapseUnchanged: true,
  },
)

function languageExtension(): Extension[] {
  switch (props.language) {
    case 'aiscript':
      return [aiscriptLanguage]
    case 'json5':
      return [json()]
    case 'markdown':
      return [markdown()]
    case 'css':
      return [css()]
    default:
      return []
  }
}

const editorRef = ref<HTMLDivElement>()
let view: EditorView | null = null

function createView() {
  if (!editorRef.value) return
  view?.destroy()
  view = new EditorView({
    doc: props.newText,
    extensions: [
      ...languageExtension(),
      aiscriptTheme,
      unifiedMergeView({
        original: props.oldText,
        mergeControls: false,
        ...(props.collapseUnchanged
          ? { collapseUnchanged: { margin: 3, minSize: 4 } }
          : {}),
      }),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
    ],
    parent: editorRef.value,
  })
}

onMounted(createView)

// 表示専用なので入力変更は作り直しで受ける (編集状態の保持が不要)
watch(() => [props.oldText, props.newText, props.language], createView)

onUnmounted(() => {
  view?.destroy()
  view = null
})
</script>

<template>
  <div
    ref="editorRef"
    :class="$style.diffView"
    data-nd-code-diff
    :data-language="language"
  />
</template>

<style lang="scss" module>
.diffView {
  border-radius: var(--nd-radius-sm);
  overflow: auto;
  background: var(--nd-codeEditorBg);
  text-align: left;

  :global(.cm-editor) {
    height: 100%;
  }

  :global(.cm-scroller) {
    font-family: var(--nd-font-mono);
  }

  // 挿入 / 削除の色はグローバル CSS 変数 (ライト/ダーク両対応・カスタム CSS の
  // DOM フックからも上書き可能)
  :global(.cm-changedLine) {
    background: var(--nd-diffInsertBg) !important;
  }

  :global(.cm-changedText) {
    background: var(--nd-diffInsertTextBg) !important;
  }

  :global(.cm-deletedChunk) {
    background: var(--nd-diffDeleteBg) !important;
  }

  :global(.cm-deletedText) {
    background: var(--nd-diffDeleteTextBg) !important;
  }

  :global(.cm-collapsedLines) {
    background: color-mix(in srgb, var(--nd-accent) 10%, var(--nd-codeEditorBg));
    color: var(--nd-codeEditorFgMuted);
    padding: 2px 8px;
    cursor: pointer;
  }
}
</style>
