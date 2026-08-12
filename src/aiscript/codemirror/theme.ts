import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

// 色はすべて CSS 変数 (global.css) から取る。コード面の明暗を設定で
// 切り替えても (#1053) エディタを作り直さずに追従させるため。
// なお EditorView.theme の dark フラグだけは再構成が要るので据え置き —
// 実害のある既定値 (選択色 / パネル / ツールチップ) はここで上書き済み
const editorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--nd-codeEditorBg)',
      color: 'var(--nd-codeEditorFg)',
      fontSize: '0.8em',
      fontFamily: 'var(--nd-font-mono)',
    },
    '.cm-content': {
      caretColor: 'var(--nd-codeEditorCaret)',
      lineHeight: '1.6',
      padding: '4px 0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--nd-codeEditorCaret)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'var(--nd-codeEditorSelectionBg)',
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--nd-codeEditorActiveLineBg)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--nd-codeEditorBg)',
      color: 'var(--nd-codeEditorGutterFg)',
      border: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--nd-codeEditorGutterActiveFg)',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 3px 0 5px',
      minWidth: '2em',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-matchingBracket': {
      backgroundColor: 'var(--nd-codeEditorMatchBg)',
      outline: '1px solid var(--nd-codeEditorMatchBorder)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--nd-codeEditorPanelBg)',
      color: 'var(--nd-codeEditorFg)',
      border: '1px solid var(--nd-codeEditorPanelBorder)',
      borderRadius: '3px',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--nd-codeEditorActiveItemBg)',
      color: 'var(--nd-codeEditorFg)',
    },
    '.cm-completionIcon': {
      opacity: '0.6',
    },
    '.cm-panels': {
      backgroundColor: 'var(--nd-codeEditorPanelBg)',
      color: 'var(--nd-codeEditorFg)',
    },
    '.cm-scroller': {
      overflow: 'auto',
    },
  },
  { dark: true },
)

// トークン色も CSS 変数から (明暗の切替は変数側で行う)
const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--nd-codeKeyword)' },
  { tag: tags.atom, color: 'var(--nd-codeKeyword)' },
  { tag: tags.bool, color: 'var(--nd-codeKeyword)' },
  { tag: tags.string, color: 'var(--nd-codeString)' },
  { tag: tags.number, color: 'var(--nd-codeNumber)' },
  { tag: tags.comment, color: 'var(--nd-codeComment)', fontStyle: 'italic' },
  { tag: tags.operator, color: 'var(--nd-codeEditorFg)' },
  { tag: tags.definition(tags.variableName), color: 'var(--nd-codeVariable)' },
  { tag: tags.function(tags.variableName), color: 'var(--nd-codeFunction)' },
  { tag: tags.namespace, color: 'var(--nd-codeType)' },
  { tag: tags.typeName, color: 'var(--nd-codeType)' },
  { tag: tags.variableName, color: 'var(--nd-codeVariable)' },
  { tag: tags.bracket, color: 'var(--nd-codeEditorFg)' },
  { tag: tags.punctuation, color: 'var(--nd-codeEditorFg)' },
  // Markdown 用 (skill / memo エディタの lang-markdown が出力する tag 群)
  { tag: tags.heading, color: 'var(--nd-codeKeyword)', fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: 'var(--nd-codeLink)' },
  { tag: tags.url, color: 'var(--nd-codeLink)' },
  { tag: tags.monospace, color: 'var(--nd-codeString)' },
  { tag: tags.processingInstruction, color: 'var(--nd-codeComment)' },
  { tag: tags.contentSeparator, color: 'var(--nd-codeComment)' },
  { tag: tags.quote, color: 'var(--nd-codeComment)', fontStyle: 'italic' },
])

export const aiscriptTheme = [editorTheme, syntaxHighlighting(highlightStyle)]
