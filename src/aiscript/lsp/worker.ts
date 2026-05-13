/// <reference lib="webworker" />

import { validateAiScript } from '../validate'

// LSP message parameter types
interface LspTextDocument {
  uri: string
  text: string
}

interface LspContentChange {
  text: string
}

interface LspPosition {
  line: number
  character: number
}

interface LspRequestParams {
  textDocument: LspTextDocument
  position: LspPosition
}

interface LspNotificationParams {
  textDocument: LspTextDocument
  contentChanges: LspContentChange[]
}

interface LspDiagnostic {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  severity: number
  message: string
  source: string
}

// Document storage
const documents = new Map<string, string>()
const diagnosticTimers = new Map<string, ReturnType<typeof setTimeout>>()

// Built-in completions data
const keywords = [
  'let',
  'var',
  'if',
  'elif',
  'else',
  'for',
  'each',
  'loop',
  'while',
  'do',
  'match',
  'case',
  'default',
  'break',
  'continue',
  'return',
  'eval',
  'exists',
  'null',
  'true',
  'false',
]

const builtins: Record<string, string[]> = {
  Mk: ['dialog', 'confirm', 'api', 'save', 'load'],
  Ui: [
    'render',
    'get',
    'C:text',
    'C:mfm',
    'C:button',
    'C:textInput',
    'C:numberInput',
    'C:switch',
    'C:select',
    'C:container',
    'C:folder',
  ],
  Core: ['v', 'type', 'to_str', 'sleep', 'abort', 'range'],
  Math: [
    'Infinity',
    'E',
    'LN2',
    'LN10',
    'LOG2E',
    'LOG10E',
    'PI',
    'SQRT1_2',
    'SQRT2',
    'abs',
    'acos',
    'acosh',
    'asin',
    'asinh',
    'atan',
    'atan2',
    'atanh',
    'cbrt',
    'ceil',
    'clz32',
    'cos',
    'cosh',
    'exp',
    'expm1',
    'floor',
    'fround',
    'hypot',
    'imul',
    'log',
    'log1p',
    'log10',
    'log2',
    'max',
    'min',
    'pow',
    'round',
    'sign',
    'sin',
    'sinh',
    'sqrt',
    'tan',
    'tanh',
    'trunc',
    'gen_rng',
  ],
  Str: [
    'lf',
    'lt',
    'gt',
    'from_codepoint',
    'len',
    'pick',
    'incl',
    'slice',
    'split',
    'replace',
    'index_of',
    'trim',
    'upper',
    'lower',
    'pad_start',
    'pad_end',
    'charcode_at',
    'to_arr',
    'to_num',
    'to_char_arr',
    'to_unicode_arr',
    'to_unicode_codepoint_arr',
    'to_utf8_byte_arr',
    'to_byte_arr',
  ],
  Date: [
    'now',
    'year',
    'month',
    'day',
    'hour',
    'minute',
    'second',
    'millisecond',
    'parse',
    'to_iso_str',
  ],
  Json: ['stringify', 'parse', 'parsable'],
  Obj: ['keys', 'vals', 'kvs', 'get', 'set', 'has', 'copy', 'merge'],
  Arr: [
    'create',
    'len',
    'push',
    'unshift',
    'pop',
    'shift',
    'concat',
    'join',
    'slice',
    'incl',
    'map',
    'filter',
    'reduce',
    'find',
    'index_of',
    'reverse',
    'copy',
    'sort',
    'fill',
    'repeat',
    'splice',
    'flat',
    'flat_map',
    'every',
    'some',
    'insert',
    'remove',
    'unique',
  ],
  Async: ['interval', 'timeout'],
  Uri: ['encode_full', 'encode_component', 'decode_full', 'decode_component'],
  Util: ['uuid'],
  Error: ['create'],
}

// LSP constants
const TextDocumentSyncKind = { Full: 1 } as const
const CompletionItemKind = {
  Function: 3,
  Module: 9,
  Keyword: 14,
  Constant: 21,
} as const
const DiagnosticSeverity = { Error: 1 } as const

// JSON-RPC handler
self.onmessage = (e: MessageEvent<string>) => {
  try {
    const msg = JSON.parse(e.data)
    if ('id' in msg && msg.method) {
      handleRequest(msg.id, msg.method, msg.params)
    } else if (msg.method) {
      handleNotification(msg.method, msg.params)
    }
  } catch (err) {
    console.error('[aiscript-lsp-worker]', err)
  }
}

function send(msg: unknown) {
  self.postMessage(JSON.stringify(msg))
}

function respond(id: number | string, result: unknown) {
  send({ jsonrpc: '2.0', id, result })
}

function notify(method: string, params: unknown) {
  send({ jsonrpc: '2.0', method, params })
}

function handleRequest(
  id: number | string,
  method: string,
  params: LspRequestParams,
) {
  switch (method) {
    case 'initialize':
      respond(id, {
        capabilities: {
          textDocumentSync: TextDocumentSyncKind.Full,
          completionProvider: { triggerCharacters: [':'] },
        },
      })
      break
    case 'textDocument/completion':
      respond(id, getCompletions(params.textDocument.uri, params.position))
      break
    case 'shutdown':
      respond(id, null)
      break
    default:
      respond(id, null)
      break
  }
}

function handleNotification(method: string, params: LspNotificationParams) {
  switch (method) {
    case 'initialized':
      break
    case 'textDocument/didOpen':
      documents.set(params.textDocument.uri, params.textDocument.text)
      scheduleValidation(params.textDocument.uri)
      break
    case 'textDocument/didChange':
      if (params.contentChanges.length > 0) {
        const last = params.contentChanges[params.contentChanges.length - 1]
        if (last) documents.set(params.textDocument.uri, last.text)
      }
      scheduleValidation(params.textDocument.uri)
      break
    case 'textDocument/didClose': {
      documents.delete(params.textDocument.uri)
      const timer = diagnosticTimers.get(params.textDocument.uri)
      if (timer) {
        clearTimeout(timer)
        diagnosticTimers.delete(params.textDocument.uri)
      }
      break
    }
    case 'exit':
      break
  }
}

function scheduleValidation(uri: string) {
  const existing = diagnosticTimers.get(uri)
  if (existing) clearTimeout(existing)
  diagnosticTimers.set(
    uri,
    setTimeout(() => {
      diagnosticTimers.delete(uri)
      validateDocument(uri)
    }, 300),
  )
}

function validateDocument(uri: string) {
  const text = documents.get(uri)
  if (text === undefined) return

  const result = validateAiScript(text)
  // LSP は 0-based 行/列、validateAiScript は 1-based なので変換
  const diagnostics: LspDiagnostic[] = result.diagnostics.map((d) => ({
    range: {
      start: { line: d.line - 1, character: d.column - 1 },
      end: { line: d.endLine - 1, character: d.endColumn - 1 },
    },
    severity: DiagnosticSeverity.Error,
    message: d.message,
    source: 'aiscript',
  }))

  notify('textDocument/publishDiagnostics', { uri, diagnostics })
}

function isConstant(name: string): boolean {
  return (
    name[0] !== undefined &&
    name[0] === name[0].toUpperCase() &&
    name !== name.toLowerCase()
  )
}

function getCompletions(
  uri: string,
  position: { line: number; character: number },
) {
  const text = documents.get(uri)
  if (!text) return { isIncomplete: false, items: [] }

  const lines = text.split('\n')
  const line = lines[position.line] ?? ''
  const textBefore = line.slice(0, position.character)

  // Namespace:member pattern (e.g. "Mk:" or "Mk:di")
  const nsMatch = textBefore.match(/([A-Z][a-z]*):(\w*)$/)
  if (nsMatch) {
    const ns = nsMatch[1] ?? ''
    const members = builtins[ns]
    if (members) {
      return {
        isIncomplete: false,
        items: members.map((m) => ({
          label: `${ns}:${m}`,
          kind: isConstant(m)
            ? CompletionItemKind.Constant
            : CompletionItemKind.Function,
          detail: ns,
        })),
      }
    }
  }

  // General word completion
  const wordMatch = textBefore.match(/\w+$/)
  if (!wordMatch) return { isIncomplete: false, items: [] }

  return {
    isIncomplete: false,
    items: [
      ...keywords.map((kw) => ({
        label: kw,
        kind: CompletionItemKind.Keyword,
      })),
      ...Object.keys(builtins).map((ns) => ({
        label: ns,
        kind: CompletionItemKind.Module,
      })),
    ],
  }
}
