import type { ThemeRegistration } from 'shiki'

/**
 * 読み取り側 (Shiki) のテーマ (#1050)。
 *
 * 色を直接持たず、トークンの役割ごとに CSS 変数 `--nd-code-token-<役割>` を
 * 指す。値は global.css が持ち、明暗は `data-nd-code-scheme` で切り替わる
 * (エディタ側の `--nd-codeKeyword` 等と同じ仕組み)。テーマは 1 つで済み、
 * 明暗の切替で再トークナイズせず、カスタム CSS から色を上書きできる。
 *
 * スコープの割り当ては VS Code Dark+ の tokenColors をそのまま写し、役割は
 * 「Dark+ と Light+ で同じ色の組になるスコープ群」で切った。これで変数の
 * 既定値 (global.css) に Dark+ / Light+ の値を入れれば従来の見た目になる。
 */

/** 役割名の一覧。global.css が両スキームで定義しているかを lint が検査する */
export const ND_CODE_TOKEN_ROLES = [
  'keyword',
  'control',
  'string',
  'markup-string',
  'number',
  'comment',
  'variable',
  'attribute',
  'key',
  'property-value',
  'function',
  'type',
  'constant',
  'tag',
  'selector',
  'tag-punctuation',
  'regexp',
  'regexp-punctuation',
  'escape',
  'invalid',
  'label',
  'markup-bold',
  'markup-changed',
  'markup-raw',
  'markup-quote',
  'markup-list',
] as const

export type NdCodeTokenRole = (typeof ND_CODE_TOKEN_ROLES)[number]

export function codeTokenVariable(role: NdCodeTokenRole): string {
  return `var(--nd-code-token-${role})`
}

function tokenColor(
  role: NdCodeTokenRole,
  scope: string | string[],
  fontStyle?: 'bold' | 'italic',
) {
  return {
    scope,
    settings: fontStyle
      ? { foreground: codeTokenVariable(role), fontStyle }
      : { foreground: codeTokenVariable(role) },
  }
}

function fontStyleOnly(
  scope: string,
  fontStyle: 'bold' | 'italic' | 'underline' | 'strikethrough',
) {
  return { scope, settings: { fontStyle } }
}

export const ND_CODE_THEME_NAME = 'nd-code'

/** 面の前景色。これと同じ色のトークンは span を付けずに出る (highlight.ts) */
const FOREGROUND = 'var(--nd-codeEditorFg)'

export const ndCodeTheme: ThemeRegistration = {
  name: ND_CODE_THEME_NAME,
  type: 'dark',
  colors: {
    'editor.foreground': FOREGROUND,
    'editor.background': 'var(--nd-codeEditorBg)',
  },
  tokenColors: [
    // 既定の前景色を明示するスコープ (Dark+ の d4d4d4 / Light+ の 000000)。
    // 親スコープの色を打ち消すためのものなので、面の前景色をそのまま指す
    {
      scope: [
        'meta.embedded',
        'source.groovy.embedded',
        'string meta.image.inline.markdown',
        'variable.legacy.builtin.python',
        'meta.template.expression',
        'keyword.operator',
        'storage.modifier.import.java',
        'variable.language.wildcard.java',
        'storage.modifier.package.java',
      ],
      settings: { foreground: FOREGROUND },
    },
    fontStyleOnly('emphasis', 'italic'),
    fontStyleOnly('strong', 'bold'),
    fontStyleOnly('markup.underline', 'underline'),
    fontStyleOnly('markup.italic', 'italic'),
    fontStyleOnly('markup.strikethrough', 'strikethrough'),
    tokenColor('comment', 'comment'),
    tokenColor('keyword', [
      'constant.language',
      'meta.preprocessor',
      'entity.name.function.preprocessor',
      'storage',
      'storage.type',
      'storage.modifier',
      'keyword.operator.noexcept',
      'punctuation.definition.template-expression.begin',
      'punctuation.definition.template-expression.end',
      'punctuation.section.embedded',
      'keyword',
      'keyword.control',
      'keyword.operator.new',
      'keyword.operator.expression',
      'keyword.operator.cast',
      'keyword.operator.sizeof',
      'keyword.operator.alignof',
      'keyword.operator.typeid',
      'keyword.operator.alignas',
      'keyword.operator.instanceof',
      'keyword.operator.logical.python',
      'keyword.operator.wordlike',
      'variable.language',
      'constant.character',
      'constant.other.option',
    ]),
    tokenColor('number', [
      'constant.numeric',
      'variable.other.enummember',
      'keyword.operator.plus.exponent',
      'keyword.operator.minus.exponent',
      'markup.inserted',
      'meta.preprocessor.numeric',
      'keyword.other.unit',
      'constant.sha.git-rebase',
    ]),
    tokenColor('tag', [
      'entity.name.tag',
      'punctuation.section.embedded.begin.php',
      'punctuation.section.embedded.end.php',
    ]),
    tokenColor('tag', 'markup.heading', 'bold'),
    tokenColor('selector', [
      'entity.name.tag.css',
      'entity.name.tag.less',
      'entity.name.selector',
      'entity.other.attribute-name.class.css',
      'source.css entity.other.attribute-name.class',
      'entity.other.attribute-name.id.css',
      'entity.other.attribute-name.parent-selector.css',
      'entity.other.attribute-name.parent.less',
      'source.css entity.other.attribute-name.pseudo-class',
      'entity.other.attribute-name.pseudo-element.css',
      'source.css.less entity.other.attribute-name.id',
      'entity.other.attribute-name.scss',
    ]),
    tokenColor('attribute', [
      'entity.other.attribute-name',
      'support.type.vendored.property-name',
      'support.type.property-name',
      'source.css variable',
      'source.coffee.embedded',
    ]),
    tokenColor('key', [
      'meta.structure.dictionary.key.python',
      'support.function.git-rebase',
      'support.type.property-name.json',
    ]),
    tokenColor('invalid', 'invalid'),
    tokenColor('markup-bold', 'markup.bold', 'bold'),
    tokenColor('markup-bold', 'meta.diff.header'),
    tokenColor('string', [
      'string',
      'meta.embedded.assembly',
      'string.tag',
      'string.value',
      'markup.deleted',
      'meta.preprocessor.string',
    ]),
    tokenColor('markup-string', [
      'string.comment.buffered.block.pug',
      'string.quoted.pug',
      'string.interpolated.pug',
      'string.unquoted.plain.in.yaml',
      'string.unquoted.plain.out.yaml',
      'string.unquoted.block.yaml',
      'string.quoted.single.yaml',
      'string.quoted.double.xml',
      'string.quoted.single.xml',
      'string.unquoted.cdata.xml',
      'string.quoted.double.html',
      'string.quoted.single.html',
      'string.unquoted.html',
      'string.quoted.single.handlebars',
      'string.quoted.double.handlebars',
    ]),
    tokenColor('markup-changed', 'markup.changed'),
    tokenColor('markup-quote', 'punctuation.definition.quote.begin.markdown'),
    tokenColor('markup-list', 'punctuation.definition.list.begin.markdown'),
    tokenColor('markup-raw', 'markup.inline.raw'),
    tokenColor('tag-punctuation', 'punctuation.definition.tag'),
    tokenColor('regexp', [
      'string.regexp',
      'constant.regexp',
      'constant.character.character-class.regexp',
      'constant.other.character-class.set.regexp',
      'constant.other.character-class.regexp',
      'constant.character.set.regexp',
    ]),
    tokenColor('regexp-punctuation', [
      'punctuation.definition.group.regexp',
      'punctuation.definition.group.assertion.regexp',
      'punctuation.definition.character-class.regexp',
      'punctuation.character.set.begin.regexp',
      'punctuation.character.set.end.regexp',
      'keyword.operator.negation.regexp',
      'support.other.parenthesis.regexp',
    ]),
    tokenColor('escape', [
      'constant.character.escape',
      'keyword.operator.or.regexp',
      'keyword.control.anchor.regexp',
      'keyword.operator.quantifier.regexp',
    ]),
    tokenColor('function', [
      'entity.name.function',
      'support.function',
      'support.constant.handlebars',
      'source.powershell variable.other.member',
      'entity.name.operator.custom-literal',
    ]),
    tokenColor('type', [
      'support.class',
      'support.type',
      'entity.name.type',
      'entity.name.namespace',
      'entity.other.attribute',
      'entity.name.scope-resolution',
      'entity.name.class',
      'storage.type.numeric.go',
      'storage.type.byte.go',
      'storage.type.boolean.go',
      'storage.type.string.go',
      'storage.type.uintptr.go',
      'storage.type.error.go',
      'storage.type.rune.go',
      'storage.type.cs',
      'storage.type.generic.cs',
      'storage.type.modifier.cs',
      'storage.type.variable.cs',
      'storage.type.annotation.java',
      'storage.type.generic.java',
      'storage.type.java',
      'storage.type.object.array.java',
      'storage.type.primitive.array.java',
      'storage.type.primitive.java',
      'storage.type.token.java',
      'storage.type.groovy',
      'storage.type.annotation.groovy',
      'storage.type.parameters.groovy',
      'storage.type.generic.groovy',
      'storage.type.object.array.groovy',
      'storage.type.primitive.array.groovy',
      'storage.type.primitive.groovy',
      'meta.type.cast.expr',
      'meta.type.new.expr',
      'support.constant.math',
      'support.constant.dom',
      'support.constant.json',
      'entity.other.inherited-class',
      'punctuation.separator.namespace.ruby',
    ]),
    tokenColor('control', [
      'keyword.control',
      'source.cpp keyword.operator.new',
      'keyword.operator.delete',
      'keyword.other.using',
      'keyword.other.directive.using',
      'keyword.other.operator',
      'entity.name.operator',
    ]),
    tokenColor('variable', [
      'variable',
      'meta.definition.variable.name',
      'support.variable',
      'entity.name.variable',
      'constant.other.placeholder',
      'meta.object-literal.key',
    ]),
    tokenColor('constant', [
      'variable.other.constant',
      'variable.other.enummember',
    ]),
    tokenColor('property-value', [
      'support.constant.property-value',
      'support.constant.font-name',
      'support.constant.media-type',
      'support.constant.media',
      'constant.other.color.rgb-value',
      'constant.other.rgb-value',
      'support.constant.color',
    ]),
    tokenColor('label', 'entity.name.label'),
  ],
}
