// AiScript の語彙の正本 (#1050)。
//
// 文法定義は編集側 (CodeMirror: codemirror/language.ts) と読み取り側 (tmLanguage:
// assets/aiscript.tmLanguage.json) の 2 本あり、形式が違うので片方から片方は
// 生成しない。代わりに「どの語がキーワードで、どの名前空間に何があるか」だけを
// ここに置き、CodeMirror は直接 import、tmLanguage は scripts/gen-aiscript-grammar.mjs
// がここから生成する (一致は tests/lint/aiscriptGrammar.test.ts が検査する)。
// エディタの補完 (codemirror/completions.ts) も同じ一覧から組む。
//
// Node の型除去でそのまま読めるよう、このファイルは import を持たず erasable な
// 構文だけで書く (scripts/ から `.ts` のまま import される)。

/** 制御構文。tmLanguage では keyword.control、CodeMirror では keyword */
export const AISCRIPT_KEYWORDS = [
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
] as const

/** 宣言と単項の exists。tmLanguage では storage.type、CodeMirror では keyword */
export const AISCRIPT_STORAGE_KEYWORDS = ['let', 'var', 'exists'] as const

/** リテラル。tmLanguage では storage.type、CodeMirror では atom */
export const AISCRIPT_LITERALS = ['null', 'true', 'false'] as const

/** 本家 Play / プラグインが注入する定数 (tmLanguage の variable.other.constant) */
export const AISCRIPT_PRESET_CONSTANTS = [
  'USER_ID',
  'USER_NAME',
  'CUSTOM_EMOJIS',
  'LOCALE',
  'SERVER_URL',
  'THIS_ID',
  'THIS_URL',
] as const

// Namespace:member の組込関数。Nd: / Plugin: は NoteDeck 独自 API
// (notedeck-api.ts / plugin-api.ts の登録と一致することを tests/lint が検査する)
export const AISCRIPT_BUILTINS: Record<string, string[]> = {
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

/** 組込の名前空間名 (`Mk` / `Ui` / …)。AISCRIPT_BUILTINS のキー */
export const AISCRIPT_NAMESPACES: readonly string[] =
  Object.keys(AISCRIPT_BUILTINS)

/**
 * 名前空間メンバーが定数か (`Math:PI` / `Str:lf` の区別)。末尾の語 (`Ui:C:text`
 * なら `text`) が大文字で始まれば定数。補完の種別と tmLanguage のスコープの
 * 両方がこの判定を使う
 */
export function isBuiltinConstant(member: string): boolean {
  const leaf = member.slice(member.lastIndexOf(':') + 1)
  const head = leaf[0]
  return (
    head !== undefined &&
    head === head.toUpperCase() &&
    leaf !== leaf.toLowerCase()
  )
}
