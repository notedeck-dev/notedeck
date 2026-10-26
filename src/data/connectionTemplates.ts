/**
 * Secret Vault (#564) の内蔵接続テンプレート。
 *
 * 一覧の正本は `crates/notecore/connection_templates.json5` で、宣言表
 * (`BUILTIN_TEMPLATE_DECLS`) はそこから生成する (`pnpm gen:connection-templates`、
 * #1160)。Rust 側もプロバイダー固有のリクエスト要件 (会話アフィニティ ID のヘッダー名)
 * を同じ宣言から引く。ここに置くのは手書きの補助 (辞書ラベルの解決 / favicon の導出 /
 * URL ペースト時の照合) だけ。
 */

import { i18n } from '@/i18n'
import { proxyUrl } from '@/utils/mediaProxy'
import {
  BUILTIN_TEMPLATE_DECLS,
  type ConnectionTemplateDecl,
  type SecretLabelKey,
} from './connectionTemplates.generated'

/** UI が使う形 (secret 入力欄のラベルは解決済みの文字列)。 */
export interface ConnectionTemplate
  extends Omit<ConnectionTemplateDecl, 'secretLabel'> {
  /** secret 入力欄のラベル。 */
  secretLabel: string
}

/**
 * 宣言の辞書キーを文言に引く。宣言にキーを足したらここにも足す (型で強制される)。
 * 生成物からは辞書を引かない — 辞書の参照検査 (tests/lint/i18nDictionary.test.ts)
 * が生成物を走査しないため、参照はこの手書きの表に置く。
 */
const SECRET_LABELS = {
  apiKey: () => i18n.ts._connectionTemplates.apiKey,
  apiKeyMewk: () => i18n.ts._connectionTemplates.apiKeyMewk,
  apiToken: () => i18n.ts._connectionTemplates.apiToken,
  apiTokenRaw: () => i18n.ts._connectionTemplates.apiTokenRaw,
  deeplAuthHeader: () => i18n.ts._connectionTemplates.deeplAuthHeader,
  vrchatAuthCookie: () => i18n.ts._connectionTemplates.vrchatAuthCookie,
} satisfies Record<SecretLabelKey, () => string>

export const BUILTIN_TEMPLATES: ConnectionTemplate[] =
  BUILTIN_TEMPLATE_DECLS.map((decl) => {
    const { secretLabel, ...rest } = decl
    if (typeof secretLabel === 'string') return { ...rest, secretLabel }
    return {
      ...rest,
      // 言語切替に追従するよう、読むたびに辞書を引く
      get secretLabel() {
        return SECRET_LABELS[secretLabel.i18n]()
      },
    }
  })

/**
 * baseUrl の host から favicon URL を導出する。
 *
 * DuckDuckGo の favicon サービスを使う — 任意のサービスに対して動作し、
 * NoteDeck 側でロゴ画像をバンドル・メンテする必要がない。これにより
 * 内蔵テンプレ以外のユーザー登録接続でもロゴが自動で付く。
 * 取得は NoteDeck の画像プロキシ経由 (キャッシュ + プライバシー保護)。
 * 取得失敗時は呼び出し側で tabler icon に fallback する。
 *
 * `api.` / `www.` などの API サブドメインは favicon を持たないことが多いので
 * 除去して apex ドメインで引く (例: `api.openai.com` → `openai.com`)。
 */
export function faviconUrl(baseUrl: string): string | null {
  try {
    const host = new URL(baseUrl).host
    if (!host) return null
    const apex = host.replace(/^(api|www|console)\./, '')
    return proxyUrl(`https://icons.duckduckgo.com/ip3/${apex}.ico`) ?? null
  } catch {
    return null
  }
}

/** 貼り付けられた URL の host から一致するテンプレートを探す。 */
export function matchTemplateByUrl(rawUrl: string): ConnectionTemplate | null {
  let host: string
  try {
    host = new URL(rawUrl).host.toLowerCase()
  } catch {
    return null
  }
  return (
    BUILTIN_TEMPLATES.find((t) =>
      t.allowedHosts.some((h) => h.toLowerCase() === host),
    ) ?? null
  )
}
