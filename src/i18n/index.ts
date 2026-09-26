/**
 * UI 文言の辞書 (#135)。
 *
 * - `i18n.ts.<key>`: param の無い文言 (型付き。存在しないキーは型検査で落ちる)
 * - `i18n.tsx.<key>({ ... })`: `{name}` や複数形を埋めた文言
 * - `i18n.lang`: 今の表示言語 (日付・数値の書式にも渡す)
 *
 * 辞書は起動時に 1 言語分だけ読む (main.ts の起動待ちに相乗り)。読む前に
 * `i18n.ts` を触るのはバグなので throw する。モジュールのトップレベルで
 * 辞書を読む書き方は tests/lint/i18nDictionary.test.ts が禁止している
 * (定数は getter か key で持つ)。
 *
 * 辞書と表示言語はリアクティブで、言語を切り替えると辞書を読んだ描画や
 * computed が描き直される (リロード不要)。逆に、辞書の文言を一度だけ
 * 取り出して変数やオブジェクトに保存すると、切り替えに追従しない。
 * 文言は描画のたびに引く (getter / computed で持つ)。
 */

import { shallowRef } from 'vue'
import {
  type LanguageCode,
  LOCALE_LOADERS,
  type Locale,
} from './locale.generated'
import type { Tsx } from './types'

export { LANGUAGES } from './locale.generated'
export type { LanguageCode, Locale }

const PARAM = /\{(\w+)\}/g
const PLURAL_SUFFIX = '_plural'

type Tree = { [key: string]: string | Tree }

const dictionary = shallowRef<Locale | null>(null)
const lang = shallowRef<LanguageCode>('ja-JP')
// tsx は辞書と言語 (複数形の規則) ごとに組み直す
let tsxCache: Tsx<Locale> | null = null
let tsxSource: Locale | null = null
let tsxLang: LanguageCode | null = null

// 数値の param は表示言語の書式で出す (桁区切り)。toLocaleString() を
// 呼び出し側に書かせると、複数形の数の判定に文字列が渡ってしまうため
let numberFormat: Intl.NumberFormat | null = null

function isHint(
  value: unknown,
): value is { key: string; params?: Record<string, unknown> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { key?: unknown }).key === 'string'
  )
}

function fill(template: string, args: Record<string, unknown>): string {
  return template.replace(PARAM, (whole, name: string) => {
    if (!Object.hasOwn(args, name)) return whole
    const value = args[name]
    // Rust から届く param は、それ自体が辞書の手がかり { key, params } のことがある
    if (isHint(value)) return i18n.byKey(value.key, value.params) ?? ''
    if (typeof value !== 'number') return String(value)
    numberFormat ??= new Intl.NumberFormat(lang.value)
    return numberFormat.format(value)
  })
}

function buildTsx(tree: Tree, rules: Intl.PluralRules): unknown {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(tree)) {
    if (key.endsWith(PLURAL_SUFFIX) && typeof value === 'object') {
      const forms = value as Record<string, string>
      out[key] = (args: Record<string, unknown>) =>
        fill(forms[rules.select(Number(args.count))] ?? forms.other ?? '', args)
    } else if (typeof value === 'string') {
      out[key] = (args: Record<string, unknown>) => fill(value, args)
    } else {
      out[key] = buildTsx(value, rules)
    }
  }
  return out
}

function loaded(): Locale {
  const current = dictionary.value
  if (!current)
    throw new Error('[i18n] accessed the dictionary before it was loaded')
  return current
}

export const i18n = {
  get ts(): Locale {
    return loaded()
  },
  get tsx(): Tsx<Locale> {
    const current = loaded()
    if (!tsxCache || tsxSource !== current || tsxLang !== lang.value) {
      tsxCache = buildTsx(
        current as unknown as Tree,
        new Intl.PluralRules(lang.value),
      ) as Tsx<Locale>
      tsxSource = current
      tsxLang = lang.value
    }
    return tsxCache
  },
  get lang(): LanguageCode {
    return lang.value
  },
  /**
   * キー文字列 (`_native.preview.generic.title` など) で引く。Rust から届く
   * `{ key, params }` を表示言語で描き直すための口で、型の付かない経路なので
   * コードから直接使うのは避ける (`i18n.ts` / `i18n.tsx` を使う)。無ければ undefined
   */
  byKey(key: string, params: Record<string, unknown> = {}): string | undefined {
    let node: unknown = loaded()
    for (const part of key.split('.')) {
      node = (node as Record<string, unknown> | undefined)?.[part]
    }
    if (typeof node === 'string') return fill(node, params)
    if (node && typeof node === 'object' && key.endsWith(PLURAL_SUFFIX)) {
      const forms = node as Record<string, string>
      const rules = new Intl.PluralRules(lang.value)
      const form = forms[rules.select(Number(params.count))] ?? forms.other
      return form === undefined ? undefined : fill(form, params)
    }
    return undefined
  },
}

/** 読み込み済みの辞書を差し込む (テストの setup と loadLocale から) */
export function setLocale(code: LanguageCode, locale: Locale): void {
  numberFormat = null
  lang.value = code
  dictionary.value = locale
  if (typeof document !== 'undefined') document.documentElement.lang = code
}

/** 合成済みの辞書 (欠けたキーは en-US → ja-JP で埋まっている) を読む */
export async function loadLocale(code: LanguageCode): Promise<void> {
  const { default: locale } = await LOCALE_LOADERS[code]()
  setLocale(code, locale)
}
