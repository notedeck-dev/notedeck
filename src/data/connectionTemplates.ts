/**
 * Secret Vault (#564) の内蔵接続テンプレート。
 *
 * よく使う外部サービスの baseUrl / authType / allowedHosts を事前定義し、
 * ユーザーは secret を貼るだけで接続を作れるようにする。
 * テンプレ id は `builtin:<id>@<version>` 形式 — v2 で MisStore 配布の
 * `@<author>/<id>@<version>` 形式と名前空間を分離するための予約。
 *
 * v1 では AI プロバイダー 3 種のみ。GitHub / Linear / Slack 等の汎用 API
 * テンプレは需要を見て v1.x で追加する (手動追加 / URL ペーストは現状でも可)。
 */

import type { AuthType, ConnectionProtocol } from '@/bindings'
import { proxyUrl } from '@/utils/imageProxy'

export interface ConnectionTemplate {
  /** `builtin:<id>@<version>` 形式の識別子。 */
  id: string
  /** 表示名。 */
  name: string
  /**
   * favicon 取得に失敗したときの fallback アイコン (`ti ti-<icon>`)。
   * 通常は baseUrl host の favicon を表示する ([`faviconUrl`])。
   */
  icon: string
  /** デフォルト baseUrl。 */
  baseUrl: string
  /** デフォルト authType。 */
  authType: AuthType
  /** デフォルト allowedHosts。 */
  allowedHosts: string[]
  /** 疎通テストに使うパス (自分の身元を返すエンドポイント)。 */
  testPath: string
  /** secret 入力欄のラベル。 */
  secretLabel: string
  /** secret 発行手順への URL。 */
  secretHelpUrl: string
  /**
   * LLM プロトコル。設定すると AI プロバイダー接続として扱われ、
   * AI 設定の接続ピッカーに表示される。汎用 API テンプレでは未設定。
   */
  protocol?: ConnectionProtocol
  /** AI 設定で接続を選んだときに初期表示するモデル名。 */
  defaultModel?: string
}

export const BUILTIN_TEMPLATES: ConnectionTemplate[] = [
  {
    id: 'builtin:openai@1',
    name: 'OpenAI',
    icon: 'sparkles',
    baseUrl: 'https://api.openai.com/v1',
    authType: { kind: 'bearer' },
    allowedHosts: ['api.openai.com'],
    testPath: '/models',
    secretLabel: 'API Key',
    secretHelpUrl: 'https://platform.openai.com/api-keys',
    protocol: 'openai-compat',
    defaultModel: 'gpt-4o',
  },
  {
    id: 'builtin:anthropic@1',
    name: 'Anthropic',
    icon: 'robot',
    baseUrl: 'https://api.anthropic.com',
    authType: { kind: 'header', name: 'x-api-key' },
    allowedHosts: ['api.anthropic.com'],
    testPath: '/v1/models',
    secretLabel: 'API Key',
    secretHelpUrl: 'https://console.anthropic.com/settings/keys',
    protocol: 'anthropic',
    defaultModel: 'claude-opus-4-7',
  },
  {
    id: 'builtin:openrouter@1',
    name: 'OpenRouter',
    icon: 'router',
    baseUrl: 'https://openrouter.ai/api/v1',
    authType: { kind: 'bearer' },
    allowedHosts: ['openrouter.ai'],
    testPath: '/models',
    secretLabel: 'API Key',
    secretHelpUrl: 'https://openrouter.ai/keys',
    protocol: 'openai-compat',
  },
]

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
