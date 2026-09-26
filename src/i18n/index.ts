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
 */

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

let dictionary: Locale | null = null
let lang: LanguageCode = 'ja-JP'
let tsxCache: Tsx<Locale> | null = null

function fill(template: string, args: Record<string, unknown>): string {
  return template.replace(PARAM, (whole, name: string) =>
    Object.hasOwn(args, name) ? String(args[name]) : whole,
  )
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
  if (!dictionary)
    throw new Error('[i18n] accessed the dictionary before it was loaded')
  return dictionary
}

export const i18n = {
  get ts(): Locale {
    return loaded()
  },
  get tsx(): Tsx<Locale> {
    if (!tsxCache) {
      tsxCache = buildTsx(
        loaded() as unknown as Tree,
        new Intl.PluralRules(lang),
      ) as Tsx<Locale>
    }
    return tsxCache
  },
  get lang(): LanguageCode {
    return lang
  },
}

/** 読み込み済みの辞書を差し込む (テストの setup と loadLocale から) */
export function setLocale(code: LanguageCode, locale: Locale): void {
  dictionary = locale
  lang = code
  tsxCache = null
  if (typeof document !== 'undefined') document.documentElement.lang = code
}

/** 合成済みの辞書 (欠けたキーは en-US → ja-JP で埋まっている) を読む */
export async function loadLocale(code: LanguageCode): Promise<void> {
  const { default: locale } = await LOCALE_LOADERS[code]()
  setLocale(code, locale)
}
