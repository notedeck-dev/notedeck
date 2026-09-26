/**
 * 表示言語の設定 (locale.json5) の codec と、表示言語の解決 (#135)。
 *
 * 表示言語は端末ごとの値 (#1106 の「手元側」) なので、notecore 側の
 * settings.json5 ではなく独立したファイルに置く。
 */

import JSON5 from 'json5'
import type { LanguageCode } from '@/i18n'

export type LocalePreference = 'auto' | LanguageCode

export interface LocaleSetting {
  locale: LocalePreference
  /**
   * i18n 導入前からのインストールで、日本語に固定したもの。英語を公開したときに
   * 「OS が日本語以外なのに日本語に固定された人」へ一度だけ案内するための印
   */
  migrated?: true
}

interface LanguageAvailability {
  readonly code: string
  readonly published: boolean
}

const FALLBACK = 'en-US'

/** 空 (= ファイル未作成) なら null。壊れていたら auto として読む */
export function parseLocaleSetting(raw: string): LocaleSetting | null {
  if (raw.trim() === '') return null
  try {
    const parsed = JSON5.parse(raw) as Partial<LocaleSetting>
    if (typeof parsed?.locale !== 'string') return { locale: 'auto' }
    return parsed.migrated === true
      ? { locale: parsed.locale, migrated: true }
      : { locale: parsed.locale }
  } catch {
    return { locale: 'auto' }
  }
}

export function serializeLocaleSetting(setting: LocaleSetting): string {
  return `// 表示言語。'auto' は OS の言語に合わせる (#135)\n${JSON5.stringify(setting, null, 2)}\n`
}

/**
 * ファイルが無いときの初期値。i18n 導入前からのインストールは日本語に固定する
 * (英語 OS を使う日本語の利用者を、半訳の英語 UI に勝手に切り替えないため)
 */
export function initialLocaleSetting(existingInstall: boolean): LocaleSetting {
  return existingInstall
    ? { locale: 'ja-JP', migrated: true }
    : { locale: 'auto' }
}

const primary = (code: string) => (code.split('-')[0] ?? '').toLowerCase()

/**
 * 表示言語を決める。明示された言語はそのまま (未公開でも — 開発者モードで
 * 選んだもの)。auto は公開済みの言語から OS 言語の順に探す: 完全一致 →
 * 言語部の一致。ただし zh は完全一致のみ (zh-TW / zh-HK を簡体に落とさない)。
 * 一致しなければ en-US、en-US が未公開なら最初の公開言語。
 */
export function resolveLanguage<L extends LanguageAvailability>(
  preference: string,
  systemLanguages: readonly string[],
  languages: readonly L[],
): L['code'] {
  const chosen = languages.find((l) => l.code === preference)
  if (chosen) return chosen.code

  const published = languages.filter((l) => l.published)
  for (const system of systemLanguages) {
    const exact = published.find(
      (l) => l.code.toLowerCase() === system.toLowerCase(),
    )
    if (exact) return exact.code
    if (primary(system) === 'zh') continue
    const sameLanguage = published.find(
      (l) => primary(l.code) === primary(system),
    )
    if (sameLanguage) return sameLanguage.code
  }
  const fallback = published.find((l) => l.code === FALLBACK) ?? published[0]
  if (!fallback) throw new Error('[i18n] no published language')
  return fallback.code
}
