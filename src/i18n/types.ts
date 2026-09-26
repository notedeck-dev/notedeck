/**
 * 辞書の型 (#135)。型名は本家 (misskey-dev/misskey) の i18n に合わせる。
 * 実装は独自で、複数形 (PluralString) は本家に無い拡張。
 */

declare const kParameters: unique symbol
declare const kPlural: unique symbol

/** `{name}` を含む文言。`i18n.tsx` からしか埋められない */
export type ParameterizedString<P extends string = string> = string & {
  readonly [kParameters]: P
}

/**
 * 数で形の変わる文言。値は CLDR のカテゴリ (other 必須) ごとの文字列で、
 * `Intl.PluralRules` で選ぶ。数は `count` で渡す
 */
export type PluralString<P extends string = 'count'> = {
  readonly [kPlural]: P
}

type Args<P extends string> = { readonly [_ in P]: string | number }

/** `i18n.tsx`: param を持つ文言だけを、埋める関数として並べたもの */
export type Tsx<T> = {
  readonly [K in keyof T as T[K] extends ParameterizedString | PluralString
    ? K
    : T[K] extends string
      ? never
      : K]: T[K] extends ParameterizedString<infer P>
    ? (args: Args<P>) => string
    : T[K] extends PluralString<infer P>
      ? (args: Args<P>) => string
      : Tsx<T[K]>
}
