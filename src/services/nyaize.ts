/**
 * nyaize — cat ユーザーのノート本文の語尾を にゃ化する (#763)。
 * Misskey 本家は v13.13.0 以降、保存時ではなく描画時に適用する方式。
 * 変換ロジックは misskey-js/src/nyaize.ts と同一。
 */
import type { MfmToken } from './mfmParser'

const enRegex1 = /(?<=n)a/gi
const enRegex2 = /(?<=morn)ing/gi
const enRegex3 = /(?<=every)one/gi
const koRegex1 = /[나-낳]/g
const koRegex2 = /(다$)|(다(?=\.))|(다(?= ))|(다(?=!))|(다(?=\?))/gm
const koRegex3 = /(야(?=\?))|(야$)|(야(?= ))/gm

export function nyaize(text: string): string {
  return text
    .replaceAll('な', 'にゃ')
    .replaceAll('ナ', 'ニャ')
    .replaceAll('ﾅ', 'ﾆｬ')
    .replace(enRegex1, (x) => (x === 'A' ? 'YA' : 'ya'))
    .replace(enRegex2, (x) => (x === 'ING' ? 'YAN' : 'yan'))
    .replace(enRegex3, (x) => (x === 'ONE' ? 'NYAN' : 'nyan'))
    .replace(koRegex1, (match) =>
      !Number.isNaN(match.charCodeAt(0))
        ? String.fromCharCode(
            match.charCodeAt(0) + '냐'.charCodeAt(0) - '나'.charCodeAt(0),
          )
        : match,
    )
    .replace(koRegex2, '다냥')
    .replace(koRegex3, '냥')
}

/**
 * parse 済み MFM トークンツリーの text ノードだけ にゃ化した新しいツリーを返す
 * (本家 frontend の `nyaize: 'respect'` 相当)。URL・コード・メンション・
 * カスタム絵文字・`<plain>` は変換しない。
 * parseMfm の LRU キャッシュを汚染しないよう、入力は変更せずコピーを返す。
 */
export function nyaizeTokens(tokens: MfmToken[]): MfmToken[] {
  return tokens.map((token) => {
    switch (token.type) {
      case 'text':
        return { ...token, value: nyaize(token.value) }
      case 'bold':
      case 'italic':
      case 'strike':
      case 'small':
      case 'center':
      case 'quote':
      case 'heading':
      case 'fn':
        return { ...token, children: nyaizeTokens(token.children) }
      case 'link':
        return { ...token, label: nyaizeTokens(token.label) }
      case 'list':
        return {
          ...token,
          items: token.items.map((item) => nyaizeTokens(item)),
        }
      default:
        return token
    }
  })
}
