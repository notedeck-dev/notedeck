import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete'
import { getSnippetCompletions } from '@/aiscript/snippets/cache'

const keywordCompletions: Completion[] = [
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
].map((kw) => ({ label: kw, type: 'keyword' }))

// Namespace:member built-in functions。Nd: / Plugin: は NoteDeck 独自 API
// (notedeck-api.ts / plugin-api.ts の登録と一致することを tests/lint が検査する)
export const AISCRIPT_BUILTIN_COMPLETIONS: Record<string, string[]> = {
  Mk: [
    'dialog',
    'confirm',
    'api',
    'save',
    'load',
    'remove',
    'toast',
    'url',
    'nyaize',
  ],
  Ui: [
    'render',
    'get',
    'root',
    'C:text',
    'C:mfm',
    'C:button',
    'C:buttons',
    'C:textInput',
    'C:textarea',
    'C:numberInput',
    'C:switch',
    'C:select',
    'C:container',
    'C:folder',
    'C:postFormButton',
    'C:postForm',
    'C:spacer',
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
  Nd: ['call', 'capabilities', 'http', 'on', 'register_command', 'version'],
  Plugin: [
    'config',
    'open_url',
    'register_note_action',
    'register_note_post_interruptor',
    'register_note_view_interruptor',
    'register_page_view_interruptor',
    'register_post_form_action',
    'register_user_action',
  ],
}
const builtins = AISCRIPT_BUILTIN_COMPLETIONS

// Pre-build namespace member completions
const nsMemberCompletions = new Map<string, Completion[]>()
for (const [ns, members] of Object.entries(builtins)) {
  nsMemberCompletions.set(
    ns,
    members.map((m) => ({
      label: `${ns}:${m}`,
      type:
        m[0] !== undefined &&
        m[0] === m[0].toUpperCase() &&
        m !== m.toLowerCase()
          ? 'constant'
          : 'function',
      detail: ns,
    })),
  )
}

const namespaceCompletions: Completion[] = Object.keys(builtins).map((ns) => ({
  label: ns,
  type: 'namespace',
}))

export function aiscriptCompletions(
  context: CompletionContext,
): CompletionResult | null {
  // Check for namespace:member pattern (e.g., "Mk:" or "Mk:di")
  const nsMatch = context.matchBefore(/[A-Z][a-z]*:[\w]*/)
  if (nsMatch) {
    const colonIdx = nsMatch.text.indexOf(':')
    const ns = nsMatch.text.slice(0, colonIdx)
    const members = nsMemberCompletions.get(ns)
    if (members) {
      return {
        from: nsMatch.from,
        options: members,
        validFor: /^[A-Z][a-z]*:[\w]*$/,
      }
    }
  }

  // General word completion (keywords + namespaces + user snippets)
  const word = context.matchBefore(/\w+/)
  if (!word || (word.from === word.to && !context.explicit)) return null

  return {
    from: word.from,
    options: [
      ...keywordCompletions,
      ...namespaceCompletions,
      ...getSnippetCompletions(),
    ],
    validFor: /^\w*$/,
  }
}
