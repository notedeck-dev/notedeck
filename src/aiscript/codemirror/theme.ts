import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

// VS Code Dark+ inspired theme (matches Shiki dark-plus)
const editorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#1e1e1e',
      color: '#d4d4d4',
      fontSize: '0.8em',
      fontFamily: 'var(--nd-font-mono)',
    },
    '.cm-content': {
      caretColor: '#aeafad',
      lineHeight: '1.6',
      padding: '4px 0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#aeafad',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: '#264f78',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.04)',
    },
    '.cm-gutters': {
      backgroundColor: '#1e1e1e',
      color: '#858585',
      border: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: '#c6c6c6',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 3px 0 5px',
      minWidth: '2em',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-matchingBracket': {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      outline: '1px solid rgba(255, 255, 255, 0.3)',
    },
    '.cm-tooltip': {
      backgroundColor: '#252526',
      color: '#d4d4d4',
      border: '1px solid #454545',
      borderRadius: '3px',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: '#04395e',
      color: '#d4d4d4',
    },
    '.cm-completionIcon': {
      opacity: '0.6',
    },
    '.cm-panels': {
      backgroundColor: '#252526',
      color: '#d4d4d4',
    },
    '.cm-scroller': {
      overflow: 'auto',
    },
  },
  { dark: true },
)

// VS Code Dark+ syntax colors
const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#569cd6' },
  { tag: tags.atom, color: '#569cd6' },
  { tag: tags.bool, color: '#569cd6' },
  { tag: tags.string, color: '#ce9178' },
  { tag: tags.number, color: '#b5cea8' },
  { tag: tags.comment, color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.operator, color: '#d4d4d4' },
  { tag: tags.definition(tags.variableName), color: '#9cdcfe' },
  { tag: tags.function(tags.variableName), color: '#dcdcaa' },
  { tag: tags.namespace, color: '#4ec9b0' },
  { tag: tags.typeName, color: '#4ec9b0' },
  { tag: tags.variableName, color: '#9cdcfe' },
  { tag: tags.bracket, color: '#d4d4d4' },
  { tag: tags.punctuation, color: '#d4d4d4' },
  // Markdown 用 (skill / memo エディタの lang-markdown が出力する tag 群)
  { tag: tags.heading, color: '#569cd6', fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: '#4fc1ff' },
  { tag: tags.url, color: '#4fc1ff' },
  { tag: tags.monospace, color: '#ce9178' },
  { tag: tags.processingInstruction, color: '#6a9955' },
  { tag: tags.contentSeparator, color: '#6a9955' },
  { tag: tags.quote, color: '#6a9955', fontStyle: 'italic' },
])

export const aiscriptTheme = [editorTheme, syntaxHighlighting(highlightStyle)]
