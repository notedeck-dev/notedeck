#!/usr/bin/env node
// UI 文言の辞書 (locales/*.yml) から生成物を作り、辞書を検査する (#135)。
//
//   pnpm gen:i18n                  src/i18n/locale.generated.ts を書き直す
//   pnpm gen:i18n --stamp en-US    en-US の訳を「今の原文から訳した」と記録する
//
// 正本は locales/ja-JP.yml。ほかの言語は ja-JP のキーの部分集合で、欠けたキーは
// 実行時に「選択言語 → en-US → ja-JP」の順で埋まる。言語ごとに合成した辞書は
// コミットせず、Vite plugin (i18nLocalePlugin) がビルド時に作る。
//
// 生成物が最新か・辞書が壊れていないか・訳が原文に置き去りにされていないかは
// tests/lint/i18nDictionary.test.ts が検査する。
//
// Node 24 の型除去でそのまま実行する (erasableSyntaxOnly)。vite.config.ts /
// vitest.config.ts からも import する。

import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'
import JSON5 from 'json5'
import type { Plugin } from 'vite'

const ROOT = join(import.meta.dirname, '..')
export const LOCALES_DIR = join(ROOT, 'locales')
export const LANGUAGES_PATH = join(LOCALES_DIR, 'languages.json5')
export const GENERATED_PATH = join(ROOT, 'src/i18n/locale.generated.ts')
/** capability の表示名の正本。辞書の `_capabilities` 節はここから作る */
const CAPABILITIES_PATH = join(ROOT, 'crates/notecore/capabilities.json5')
const CAPABILITIES_SECTION = '_capabilities'

/**
 * Rust (notecore / src-tauri) が描く文言の節 (#135 段 4)。この節だけを言語ごとの
 * JSON に書き出し、Rust は include_str! で埋め込む。英語の正本文も英語の辞書から
 * 組むので、Rust のソースに英文を二重に持たない
 */
export const NATIVE_SECTION = '_native'
export const NATIVE_DIR = join(ROOT, 'crates/notecore/locales')
export const NATIVE_RS_PATH = join(ROOT, 'crates/notecore/src/i18n/dictionaries.generated.rs')
/** Android の文字列リソース (`_native.android` 節)。sync.sh が gen/android へコピーする */
export const ANDROID_RES_DIR = join(ROOT, 'src-tauri/android/res')

/** 正本の言語 */
export const SOURCE_LANG = 'ja-JP'
/** 選択言語に無いキーを先に埋める言語。海外利用者に未訳を日本語で見せないため */
export const FALLBACK_LANG = 'en-US'

const PLURAL_SUFFIX = '_plural'
const PLURAL_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other'])
const PARAM = /\{(\w+)\}/g
const VIRTUAL_PREFIX = 'virtual:nd-locale/'

export interface LocaleTree {
  [key: string]: string | LocaleTree
}

export interface LanguageEntry {
  code: string
  /** その言語自身での名前 (言語選択に出す。訳さない) */
  name: string
  /** 言語選択に出し、OS 言語からの自動解決の対象にするか */
  published: boolean
  /**
   * 疑似ロケールの元の言語。辞書ファイルを持たず、元の言語の文を
   * pseudoize で変えて作る。画面だけのもので、Rust / Android には渡さない
   */
  pseudo?: string
}

export function loadLanguages(): LanguageEntry[] {
  return JSON5.parse(readFileSync(LANGUAGES_PATH, 'utf8')) as LanguageEntry[]
}

/** 辞書ファイルを持つ言語 (疑似ロケールを除く) */
function realLanguages(): LanguageEntry[] {
  return loadLanguages().filter((l) => !l.pseudo)
}

const ACCENTED: Record<string, string> = Object.fromEntries(
  [...'abcdeghiklmnoprstuwyzABCDEGHIKLNORSTUWYZ'].map((c, i) => [
    c,
    [...'áƀçđéğĥíķĺḿñóƥŕšťúŵýžÁƁÇĐÉĞĤÍĶĹÑÓŔŠŤÚŴÝŽ'][i],
  ]),
)
const PSEUDO_FILLER = ' ĺóŕéḿ íƥšúḿ đóĺóŕ šíť áḿéť ćóñšéćťéťúŕ'

/**
 * 疑似ロケールの文 (#135)。英語化での崩れを目で見つけるため、文字を
 * アクセント付きにして (直書きの文字列と見分ける) 1.4 倍程度に伸ばし、
 * 切り詰められたら分かるよう括弧で囲む。param はそのまま残す
 */
export function pseudoize(text: string): string {
  const body = text
    .split(/(\{\w+\})/)
    .map((part, i) =>
      i % 2 === 1 ? part : [...part].map((c) => ACCENTED[c] ?? c).join(''),
    )
    .join('')
  const pad = Math.ceil(text.length * 0.4)
  const filler = PSEUDO_FILLER.repeat(Math.ceil(pad / PSEUDO_FILLER.length))
  return `[${body}${filler.slice(0, pad)}]`
}

function pseudoizeTree(tree: LocaleTree): LocaleTree {
  const out: LocaleTree = {}
  for (const [key, value] of Object.entries(tree))
    out[key] = typeof value === 'string' ? pseudoize(value) : pseudoizeTree(value)
  return out
}

/**
 * capability の表示名 (capabilities.json5 の label) を `_capabilities.<id>` の
 * 形にする。id の `.` はそのまま入れ子になる (`note.create` → note: { create })。
 * 宣言ファイルが正本なので ja-JP.yml には書かない (#135)
 */
export function capabilityLabels(): LocaleTree {
  const doc = JSON5.parse(readFileSync(CAPABILITIES_PATH, 'utf8')) as {
    capabilities: Record<string, { label: string }>
  }
  const tree: LocaleTree = {}
  for (const [id, { label }] of Object.entries(doc.capabilities)) {
    const path = id.split('.')
    const leaf = path.pop() as string
    let node = tree
    for (const part of path) {
      const next = node[part]
      if (typeof next === 'string')
        throw new Error(`capability id ${id} が別の id と入れ子で衝突する`)
      node = (node[part] ??= {}) as LocaleTree
    }
    node[leaf] = label
  }
  return tree
}

export function loadLocale(lang: string): LocaleTree {
  const base = loadLanguages().find((l) => l.code === lang)?.pseudo
  if (base) return pseudoizeTree(compose(base))
  const parsed = (yaml.load(
    readFileSync(join(LOCALES_DIR, `${lang}.yml`), 'utf8'),
  ) ?? {}) as LocaleTree
  if (lang !== SOURCE_LANG) return parsed
  if (CAPABILITIES_SECTION in parsed)
    throw new Error(
      `${SOURCE_LANG}.yml に ${CAPABILITIES_SECTION} を書かない (capabilities.json5 の label が正本)`,
    )
  return { ...parsed, [CAPABILITIES_SECTION]: capabilityLabels() }
}

function sourceRecordPath(lang: string): string {
  return join(LOCALES_DIR, `${lang}.source.json`)
}

function loadSourceRecord(lang: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(sourceRecordPath(lang), 'utf8'))
  } catch {
    return {}
  }
}

const isPluralKey = (key: string) => key.endsWith(PLURAL_SUFFIX)

type Leaf = string | LocaleTree

/** 葉 (文字列か複数形オブジェクト) を `a.b.c` のキーで列挙する */
export function flatten(tree: LocaleTree, prefix = ''): Map<string, Leaf> {
  const out = new Map<string, Leaf>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string' || isPluralKey(key)) out.set(path, value)
    else for (const [k, v] of flatten(value, path)) out.set(k, v)
  }
  return out
}

/** 葉が受け取る param 名 (複数形は全カテゴリの和集合 + count) */
export function paramsOf(key: string, leaf: Leaf): string[] {
  const texts = typeof leaf === 'string' ? [leaf] : Object.values(leaf)
  const names = new Set<string>()
  for (const text of texts) {
    if (typeof text !== 'string') continue
    for (const [, name] of text.matchAll(PARAM)) names.add(name)
  }
  if (isPluralKey(key.split('.').at(-1) ?? '')) names.add('count')
  return [...names].sort()
}

function hashOf(leaf: Leaf): string {
  return createHash('sha256')
    .update(JSON.stringify(leaf))
    .digest('hex')
    .slice(0, 12)
}

export interface CheckResult {
  /** 辞書が壊れている。CI で落とす */
  errors: string[]
  /** 未訳キーの一覧。落とさない (#135 P3(d)) */
  missing: Map<string, string[]>
}

/** 辞書の構造・param・訳の置き去りを検査する */
export function check(): CheckResult {
  const errors: string[] = []
  const missing = new Map<string, string[]>()
  const languages = realLanguages()
  const source = flatten(loadLocale(SOURCE_LANG))

  const files = readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => f.slice(0, -'.yml'.length))
  for (const code of files) {
    if (!languages.some((l) => l.code === code))
      errors.push(`locales/${code}.yml が languages.json5 に無い`)
  }
  for (const { code } of languages) {
    if (!files.includes(code))
      errors.push(`languages.json5 の ${code} に locales/${code}.yml が無い`)
  }

  for (const [key, leaf] of source) errors.push(...checkLeaf(SOURCE_LANG, key, leaf))

  for (const { code } of languages) {
    if (code === SOURCE_LANG || !files.includes(code)) continue
    const translated = flatten(loadLocale(code))
    const record = loadSourceRecord(code)
    const absent: string[] = []
    for (const key of source.keys()) if (!translated.has(key)) absent.push(key)
    if (absent.length) missing.set(code, absent)

    for (const [key, leaf] of translated) {
      const original = source.get(key)
      if (original === undefined) {
        errors.push(`${code}: ${key} は ${SOURCE_LANG} に無いキー`)
        continue
      }
      errors.push(...checkLeaf(code, key, leaf))
      if (typeof leaf !== typeof original) {
        errors.push(`${code}: ${key} の形 (文字列 / 複数形) が原文と違う`)
        continue
      }
      const expected = paramsOf(key, original).join(', ')
      const actual = paramsOf(key, leaf).join(', ')
      if (expected !== actual)
        errors.push(`${code}: ${key} の param が原文と違う (原文 {${expected}} / 訳 {${actual}})`)
      if (record[key] !== hashOf(original))
        errors.push(
          record[key] === undefined
            ? `${code}: ${key} を訳した記録が無い — 訳してから \`pnpm gen:i18n --stamp ${code}\``
            : `${code}: ${key} の原文が訳の後に変わった — 訳を追従させてから \`pnpm gen:i18n --stamp ${code}\` (追従できないならキーを消せば原文に戻る)`,
        )
    }
  }
  return { errors, missing }
}

function checkLeaf(lang: string, key: string, leaf: Leaf): string[] {
  const errors: string[] = []
  if (typeof leaf === 'string') {
    if (leaf.trim() === '') errors.push(`${lang}: ${key} が空文字列`)
    return errors
  }
  const categories = Object.keys(leaf)
  if (!categories.includes('other'))
    errors.push(`${lang}: ${key} (複数形) に other が無い`)
  for (const c of categories) {
    if (!PLURAL_CATEGORIES.has(c))
      errors.push(`${lang}: ${key} (複数形) の ${c} は CLDR のカテゴリではない`)
    else if (typeof leaf[c] !== 'string' || leaf[c].trim() === '')
      errors.push(`${lang}: ${key}.${c} が空か文字列でない`)
  }
  return errors
}

/** 今の原文から訳したと記録する (訳の置き去り検出の基準を更新する) */
export function stamp(lang: string): string {
  const source = flatten(loadLocale(SOURCE_LANG))
  const translated = flatten(loadLocale(lang))
  const record: Record<string, string> = {}
  for (const key of [...translated.keys()].sort()) {
    const original = source.get(key)
    if (original !== undefined) record[key] = hashOf(original)
  }
  const text = `${JSON.stringify(record, null, 2)}\n`
  writeFileSync(sourceRecordPath(lang), text)
  return text
}

// --- 合成 (実行時に読む辞書) ---

function merge(base: LocaleTree, over: LocaleTree): LocaleTree {
  const out: LocaleTree = { ...base }
  for (const [key, value] of Object.entries(over)) {
    const current = out[key]
    // 複数形はカテゴリの集合が言語ごとに違うので、混ぜずに丸ごと置き換える
    out[key] =
      typeof value === 'object' &&
      typeof current === 'object' &&
      !isPluralKey(key)
        ? merge(current, value)
        : value
  }
  return out
}

/** `lang` を読むときの辞書 (欠けたキーは en-US → ja-JP の順で埋める) */
export function compose(lang: string): LocaleTree {
  // 後ろほど優先。原文そのものを読むときは en-US を挟まない
  const chain =
    lang === SOURCE_LANG
      ? [SOURCE_LANG]
      : [...new Set([SOURCE_LANG, FALLBACK_LANG, lang])]
  return chain.map(loadLocale).reduce(merge, {})
}

/** `import('virtual:nd-locale/<lang>')` で合成済みの辞書を返す */
export function i18nLocalePlugin(): Plugin {
  return {
    name: 'nd-i18n-locale',
    resolveId(id) {
      return id.startsWith(VIRTUAL_PREFIX) ? `\0${id}` : undefined
    },
    load(id) {
      if (!id.startsWith(`\0${VIRTUAL_PREFIX}`)) return undefined
      const lang = id.slice(`\0${VIRTUAL_PREFIX}`.length)
      for (const f of readdirSync(LOCALES_DIR))
        if (f.endsWith('.yml')) this.addWatchFile(join(LOCALES_DIR, f))
      this.addWatchFile(CAPABILITIES_PATH)
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(compose(lang)))})`
    },
  }
}

// --- 型の生成 ---

function renderType(tree: LocaleTree, indent: string): string {
  const lines = ['{']
  for (const [key, value] of Object.entries(tree)) {
    const inner = `${indent}  `
    if (typeof value === 'string' || isPluralKey(key)) {
      const doc = typeof value === 'string' ? value : (value.other as string)
      lines.push(`${inner}/** ${doc.replaceAll('*/', '*\\/')} */`)
      const params = paramsOf(key, value)
      const union = params.map((p) => `'${p}'`).join(' | ')
      const type = isPluralKey(key)
        ? `PluralString<${union}>`
        : params.length
          ? `ParameterizedString<${union}>`
          : 'string'
      lines.push(`${inner}readonly ${JSON.stringify(key)}: ${type}`)
    } else {
      lines.push(`${inner}readonly ${JSON.stringify(key)}: ${renderType(value, inner)}`)
    }
  }
  lines.push(`${indent}}`)
  return lines.join('\n')
}

function columnLabelsByType(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const { code } of loadLanguages()) {
    const columns = compose(code)._columns
    if (!columns || typeof columns === 'string') continue
    for (const [type, label] of Object.entries(columns)) {
      if (typeof label !== 'string') continue
      const labels = (out[type] ??= [])
      if (!labels.includes(label)) labels.push(label)
    }
  }
  return out
}

export function generate(): string {
  const languages = loadLanguages()
  const loaders = languages
    .map((l) => `  '${l.code}': () => import('${VIRTUAL_PREFIX}${l.code}'),`)
    .join('\n')
  const body = renderType(loadLocale(SOURCE_LANG), '')
  const used = ['ParameterizedString', 'PluralString'].filter((t) =>
    body.includes(`${t}<`),
  )
  const imports = used.length
    ? `\nimport type { ${used.join(', ')} } from './types'\n`
    : ''
  return `// 生成物 — 編集しない。locales/ から \`pnpm gen:i18n\` で作る (#135)
${imports}
export interface Locale ${body}

export const LANGUAGES = ${JSON.stringify(languages, null, 2)} as const

/**
 * カラム種別ごとの既定の表示名 (全言語)。以前のバージョンは既定の表示名を
 * カラムの name に保存していたので、それを「名前なし」と見分けるのに使う
 * (表示中の言語に関係なく判定するため、辞書ではなくここに持つ)
 */
export const COLUMN_LABELS_BY_TYPE: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(columnLabelsByType(), null, 2)}

export type LanguageCode = (typeof LANGUAGES)[number]['code']

export const LOCALE_LOADERS: Record<
  LanguageCode,
  () => Promise<{ default: Locale }>
> = {
${loaders}
}
`
}

function xmlText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", "\\'")
    .replaceAll('"', '\\"')
    .replace(/\{count\}/g, '%1$d')
}

const snake = (key: string) =>
  key
    .replace(PLURAL_SUFFIX, '')
    .replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

/**
 * Android の文字列リソース。Kotlin の通知ワーカーは Rust を通らずに通知を出すので
 * 辞書を Android の形で渡す。言語は端末の言語で選ばれる。param は `{count}` だけ
 */
function androidResources(): Map<string, string> {
  const files = new Map<string, string>()
  for (const { code } of realLanguages()) {
    const tree = (compose(code)[NATIVE_SECTION] as LocaleTree | undefined)?.android
    if (!tree || typeof tree === 'string') continue
    const lines: string[] = []
    for (const [key, value] of Object.entries(tree)) {
      const name = `nd_${snake(key)}`
      if (typeof value === 'string') {
        lines.push(`    <string name="${name}">${xmlText(value)}</string>`)
      } else {
        lines.push(`    <plurals name="${name}">`)
        for (const [q, v] of Object.entries(value))
          lines.push(`        <item quantity="${q}">${xmlText(v as string)}</item>`)
        lines.push('    </plurals>')
      }
    }
    const dir = code === FALLBACK_LANG ? 'values' : `values-${code.split('-')[0]}`
    files.set(
      join(ANDROID_RES_DIR, dir, 'nd_strings.xml'),
      `<?xml version="1.0" encoding="utf-8"?>\n<!-- 生成物 — 編集しない。locales/ の _native.android から \`pnpm gen:i18n\` で作る (#135) -->\n<resources>\n${lines.join('\n')}\n</resources>\n`,
    )
  }
  return files
}

/** Rust に埋め込む辞書 (言語ごとの `_native` 節。欠けたキーは fallback で埋まっている) */
export function generateNative(): {
  files: Map<string, string>
  rs: string
  android: Map<string, string>
} {
  const files = new Map<string, string>()
  const languages = realLanguages()
  for (const { code } of languages) {
    const composed = compose(code)
    // capability の表示名も要る (確認プレビューの「{label} を実行しますか？」)
    const sections = {
      [NATIVE_SECTION]: composed[NATIVE_SECTION] ?? {},
      [CAPABILITIES_SECTION]: composed[CAPABILITIES_SECTION] ?? {},
      // OS 通知の「実績獲得」の本文 (TS と同じ表を使い、二重に持たない)
      _achievementLabels: composed._achievementLabels ?? {},
      // パフォーマンス設定の表示名・説明・単位 (notecore の performance.list が返す)
      _performanceData: composed._performanceData ?? {},
    }
    files.set(code, `${JSON.stringify(sections, null, 2)}\n`)
  }
  const entries = languages
    .map((l) => `    ("${l.code}", include_str!("../../locales/${l.code}.json")),`)
    .join('\n')
  const rs = `// 生成物 — 編集しない。locales/ から \`pnpm gen:i18n\` で作る (#135)

/// (言語コード, その言語の \`_native\` / \`_capabilities\` / \`_achievementLabels\` / \`_performanceData\` 節の JSON)
pub const DICTIONARIES: &[(&str, &str)] = &[
${entries}
];

/// 公開済みの言語 (OS の言語から自動で選んでよい言語)
pub const PUBLISHED: &[&str] = &[${languages
    .filter((l) => l.published)
    .map((l) => `"${l.code}"`)
    .join(', ')}];
`
  return { files, rs, android: androidResources() }
}

function writeNative(): void {
  const { files, rs, android } = generateNative()
  for (const [path, text] of android) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  mkdirSync(NATIVE_DIR, { recursive: true })
  for (const [code, text] of files) writeFileSync(join(NATIVE_DIR, `${code}.json`), text)
  mkdirSync(dirname(NATIVE_RS_PATH), { recursive: true })
  writeFileSync(NATIVE_RS_PATH, rs)
}

if (import.meta.main) {
  const stampIndex = process.argv.indexOf('--stamp')
  if (stampIndex !== -1) {
    const lang = process.argv[stampIndex + 1]
    if (!lang || lang === SOURCE_LANG) {
      console.error(`--stamp には ${SOURCE_LANG} 以外の言語コードを渡す`)
      process.exit(1)
    }
    stamp(lang)
    console.log(`locales/${lang}.source.json を更新した`)
  }
  writeFileSync(GENERATED_PATH, generate())
  writeNative()
  const { errors, missing } = check()
  for (const [lang, keys] of missing)
    console.warn(`${lang}: 未訳 ${keys.length} キー (原文で表示される)`)
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exit(1)
  }
}
