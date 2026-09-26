// 「UI 文言の辞書 (locales/) が壊れず、生成物とコードに一致している」を
// 機械検査に落とす (#135)。
//
// - locale.generated.ts は辞書から再生成したものと一致する (ずれたら `pnpm gen:i18n`)
// - 辞書の構造 / param / 訳の置き去り (scripts/gen-i18n.ts の check)
// - 正本のキーはすべてコードから参照されている (死にキー)
// - モジュールのトップレベルで辞書を読まない。辞書は起動待ちの中で読むので、
//   import 時に評価される定数から触ると読む前に参照して落ちる。定数は getter か
//   キーで持つ
// - 辞書の文言を v-html / MkMfm に渡さない。param に他人の文字列が入ると、
//   MFM や HTML として解釈されて表示を偽装できるため
//
// 未訳キーはここでは落とさない (#135 P3(d))。`pnpm gen:i18n` が一覧を出す。

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  check,
  flatten,
  GENERATED_PATH,
  generate,
  generateNative,
  loadLocale,
  NATIVE_DIR,
  NATIVE_RS_PATH,
  NATIVE_SECTION,
  SOURCE_LANG,
} from '../../scripts/gen-i18n.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const SRC = join(ROOT, 'src')

/** キーを動的に組み立てて引く節。死にキー検出の対象外 */
const DYNAMIC_SECTIONS = [
  // capability id から引く (capabilityLabel)。正本は capabilities.json5
  '_capabilities',
]

function collect(dir: string, exts: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return collect(path, exts)
    return exts.some((e) => entry.name.endsWith(e)) ? [path] : []
  })
}

const sources = collect(SRC, ['.ts', '.vue']).filter(
  (f) => !f.endsWith('.test.ts') && !f.endsWith('.generated.ts'),
)

/** Rust のソース (辞書の `_native` 節を引く側)。生成物とテストを除く */
const rustSources = ['crates', 'src-tauri/src']
  .flatMap((dir) => collect(join(ROOT, dir), ['.rs']))
  .filter((f) => !f.includes('generated'))
  .map((f) => {
    const text = readFileSync(f, 'utf8')
    const cut = text.search(/^\s*#\[cfg\(test\)\]/m)
    return cut === -1 ? text : text.slice(0, cut)
  })
  .join('\n')

const NATIVE_KEY = new RegExp(`"(${NATIVE_SECTION}\\.[\\w.]+)"`, 'g')

const FUNCTION_LIKE = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.Constructor,
])

/** `i18n.ts` / `i18n.tsx` を関数の外 (import 時に評価される位置) で触っている箇所 */
function topLevelAccesses(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  if (!/\bi18n\.tsx?\b/.test(text)) return []
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'i18n' &&
      (node.name.text === 'ts' || node.name.text === 'tsx')
    ) {
      let parent: ts.Node | undefined = node.parent
      while (parent && !FUNCTION_LIKE.has(parent.kind)) parent = parent.parent
      if (!parent) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart())
        found.push(`${relative(ROOT, file)}:${line + 1}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('UI 文言の辞書 (#135)', () => {
  it('locale.generated.ts は辞書から再生成したものと一致する', () => {
    expect(
      readFileSync(GENERATED_PATH, 'utf8'),
      'locale.generated.ts が古い — `pnpm gen:i18n` を実行してコミットする',
    ).toBe(generate())
  })

  it('辞書が壊れていない (構造 / param / 訳の置き去り)', () => {
    expect(check().errors).toEqual([])
  })

  it('Rust 用の辞書 (crates/notecore/locales) は辞書から再生成したものと一致する', () => {
    const { files, rs } = generateNative()
    for (const [code, text] of files)
      expect(
        readFileSync(join(NATIVE_DIR, `${code}.json`), 'utf8'),
        `${code}.json が古い — \`pnpm gen:i18n\``,
      ).toBe(text)
    expect(readFileSync(NATIVE_RS_PATH, 'utf8')).toBe(rs)
  })

  it('Rust が引くキーは辞書にある', () => {
    const keys = new Set(flatten(loadLocale(SOURCE_LANG)).keys())
    const missing = [...rustSources.matchAll(NATIVE_KEY)]
      .map((m) => m[1] as string)
      .filter((key) => !keys.has(key))
    expect(missing).toEqual([])
  })

  it('正本のキーはすべてコードから参照されている', () => {
    const code = sources.map((f) => readFileSync(f, 'utf8')).join('\n')
    const dead = [...flatten(loadLocale(SOURCE_LANG)).keys()].filter(
      (key) =>
        !DYNAMIC_SECTIONS.some((s) => key.startsWith(`${s}.`)) &&
        !code.includes(`.${key}`) &&
        !rustSources.includes(`"${key}"`),
    )
    expect(dead, '使われていないキーは辞書から消す').toEqual([])
  })

  it('モジュールのトップレベルで辞書を読まない', () => {
    const offenders = sources
      .filter((f) => f.endsWith('.ts'))
      .flatMap(topLevelAccesses)
    expect(offenders, '定数は getter か辞書のキーで持つ').toEqual([])
  })

  it('検出器は関数の外の参照を拾う (自己検査)', () => {
    const probe = join(ROOT, 'tests/lint/fixtures/i18nTopLevel.ts')
    expect(topLevelAccesses(probe)).toEqual([
      'tests/lint/fixtures/i18nTopLevel.ts:3',
      'tests/lint/fixtures/i18nTopLevel.ts:6',
    ])
  })

  it('辞書の文言を v-html / MkMfm に渡さない', () => {
    const pattern = /(v-html|<MkMfm[^>]*:text)="[^"]*\bi18n\.tsx?\b/
    const offenders = sources
      .filter((f) => f.endsWith('.vue'))
      .filter((f) => pattern.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f))
    expect(offenders).toEqual([])
  })
})
