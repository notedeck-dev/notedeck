// 生成物 — 編集しない。locales/ から `pnpm gen:i18n` で作る (#135)

import type { ParameterizedString } from './types'

export interface Locale {
  readonly "_time": {
    /** たった今 */
    readonly "justNow": string
  }
  readonly "_settings": {
    /** 表示言語 */
    readonly "language": string
    /** システムに合わせる */
    readonly "languageAuto": string
    /** {name} (翻訳中) */
    readonly "languageUnpublished": ParameterizedString<'name'>
    /** 切り替えるとすべてのウィンドウを再読み込みします */
    readonly "languageReloadNote": string
  }
}

export const LANGUAGES = [
  {
    "code": "ja-JP",
    "name": "日本語",
    "published": true
  },
  {
    "code": "en-US",
    "name": "English",
    "published": false
  }
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

export const LOCALE_LOADERS: Record<
  LanguageCode,
  () => Promise<{ default: Locale }>
> = {
  'ja-JP': () => import('virtual:nd-locale/ja-JP'),
  'en-US': () => import('virtual:nd-locale/en-US'),
}
