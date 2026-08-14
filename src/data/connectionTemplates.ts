/**
 * Secret Vault (#564) の内蔵接続テンプレート。
 *
 * よく使う外部サービスの baseUrl / authType / allowedHosts を事前定義し、
 * ユーザーは secret を貼るだけで接続を作れるようにする。
 * テンプレ id は `builtin:<id>@<version>` 形式 — v2 で MisStore 配布の
 * `@<author>/<id>@<version>` 形式と名前空間を分離するための予約。
 *
 * 収録範囲は「AI プロバイダー」と「MisStore 配布のプラグイン / ウィジェットが
 * 要求する外部サービス」。配布物を入れた利用者がセットアップ手順の baseUrl や
 * 認証方式を自分で書き写さずに済むことを基準にしている。ここに無いサービスも
 * 手動追加 / URL ペーストで登録できる。
 */

import type { AuthType, ConnectionProtocol } from '@/bindings'
import { proxyUrl } from '@/utils/mediaProxy'

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
    // 最新世代の軽量モデルをデフォルトに (チャット用途の価格/速度バランス)
    defaultModel: 'gpt-5.4-mini',
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
    defaultModel: 'claude-sonnet-5',
  },
  {
    // テンプレの単位は「どこに繋ぐか」なので、名前は提供元に揃える
    // (Grok はモデル名で、defaultModel 側に出る)
    id: 'builtin:xai@1',
    name: 'xAI',
    icon: 'brand-x',
    baseUrl: 'https://api.x.ai/v1',
    authType: { kind: 'bearer' },
    allowedHosts: ['api.x.ai'],
    testPath: '/models',
    secretLabel: 'API Key',
    secretHelpUrl: 'https://console.x.ai/',
    protocol: 'openai-compat',
    defaultModel: 'grok-4.5',
  },
  {
    id: 'builtin:google@1',
    name: 'Google',
    icon: 'brand-google',
    // Gemini API (AI Studio 系) の、ネイティブ形式ではなく OpenAI 互換
    // レイヤーの baseUrl。Vertex AI は別経路なのでこのテンプレでは扱わない。
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    authType: { kind: 'bearer' },
    allowedHosts: ['generativelanguage.googleapis.com'],
    testPath: '/models',
    secretLabel: 'API Key',
    secretHelpUrl: 'https://aistudio.google.com/apikey',
    protocol: 'openai-compat',
    defaultModel: 'gemini-3.7-flash',
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
    defaultModel: 'moonshotai/kimi-k3',
  },
  {
    // 同じ OpenCode が Zen と Go という別 API を出しており、Zen は
    // モデル系統ごとにエンドポイントが分かれる (= 単一の baseUrl に
    // 収まらない)。ここで扱うのは単一エンドポイントの Go の方。
    id: 'builtin:opencode-go@1',
    name: 'OpenCode Go',
    icon: 'terminal-2',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    authType: { kind: 'bearer' },
    allowedHosts: ['opencode.ai'],
    testPath: '/models',
    secretLabel: 'API Key',
    secretHelpUrl: 'https://opencode.ai/auth',
    protocol: 'openai-compat',
    defaultModel: 'deepseek-v4-pro',
  },

  // ── MisStore 配布のプラグイン / ウィジェットが要求する外部サービス ──
  // AI プロバイダーではないので protocol は持たず、AI 設定のピッカーには出ない。
  // baseUrl / 認証方式は各配布物のセットアップ手順に合わせてある (ずれると
  // 配布物がそのまま動かない)。testPath は「鍵が正しいときだけ 2xx」を選ぶ。
  {
    id: 'builtin:deepl@1',
    name: 'DeepL',
    icon: 'language',
    // 無料枠と Pro でホストが分かれる。Pro 契約なら baseUrl を api.deepl.com に変える
    baseUrl: 'https://api-free.deepl.com',
    // 認証スキームが Bearer ではなく DeepL-Auth-Key なので、ヘッダ値ごと秘匿する
    authType: { kind: 'header', name: 'Authorization' },
    allowedHosts: ['api-free.deepl.com', 'api.deepl.com'],
    testPath: '/v2/usage',
    secretLabel: 'Authorization ヘッダ値 (DeepL-Auth-Key <API キー>)',
    secretHelpUrl: 'https://www.deepl.com/your-account/keys',
  },
  {
    id: 'builtin:saucenao@1',
    name: 'SauceNAO',
    icon: 'search',
    baseUrl: 'https://saucenao.com',
    authType: { kind: 'query', param: 'api_key' },
    allowedHosts: ['saucenao.com'],
    // 身元だけを返すエンドポイントが無いため、疎通テストは検索 1 回を消費する
    // (無料枠 100 回/日)。応答ヘッダに残枠が入る
    testPath:
      '/search.php?output_type=2&numres=1&url=https://saucenao.com/images/static/banner.gif',
    secretLabel: 'API Key',
    secretHelpUrl: 'https://saucenao.com/user.php?page=search-api',
  },
  {
    id: 'builtin:todoist@1',
    name: 'Todoist',
    icon: 'circle-check',
    baseUrl: 'https://api.todoist.com',
    authType: { kind: 'bearer' },
    allowedHosts: ['api.todoist.com'],
    testPath: '/api/v1/tasks',
    secretLabel: 'API トークン',
    secretHelpUrl:
      'https://app.todoist.com/app/settings/integrations/developer',
  },
  {
    id: 'builtin:clickup@1',
    name: 'ClickUp',
    icon: 'checklist',
    baseUrl: 'https://api.clickup.com',
    // Personal API Token は素のまま Authorization に載せる (Bearer を付けると 401)
    authType: { kind: 'header', name: 'Authorization' },
    allowedHosts: ['api.clickup.com'],
    testPath: '/api/v2/user',
    secretLabel: 'Personal API Token (pk_...)',
    secretHelpUrl: 'https://app.clickup.com/settings/apps',
  },
  {
    id: 'builtin:hackerone@1',
    name: 'HackerOne',
    icon: 'bug',
    baseUrl: 'https://api.hackerone.com',
    // ユーザー名はテンプレでは決められないので、接続を作るときに入力してもらう
    authType: { kind: 'basic', username: '' },
    allowedHosts: ['api.hackerone.com'],
    testPath: '/v1/hackers/payments/balance',
    secretLabel: 'API トークン (生の値)',
    secretHelpUrl: 'https://hackerone.com/settings/api_token/edit',
  },
  {
    id: 'builtin:wakatime@1',
    name: 'WakaTime',
    icon: 'clock-code',
    baseUrl: 'https://api.wakatime.com',
    // Bearer / ヘッダーでは 401 になる
    authType: { kind: 'query', param: 'api_key' },
    allowedHosts: ['api.wakatime.com'],
    testPath: '/api/v1/users/current',
    secretLabel: 'API Key',
    secretHelpUrl: 'https://wakatime.com/settings/api-key',
  },
  {
    id: 'builtin:steam@1',
    name: 'Steam',
    icon: 'brand-steam',
    baseUrl: 'https://api.steampowered.com',
    // Bearer / ヘッダーでは 403 になる
    authType: { kind: 'query', param: 'key' },
    allowedHosts: ['api.steampowered.com'],
    // 身元を返すエンドポイントが無いので、Valve のドキュメントと同じ公開 ID を引いて
    // 鍵の有効性だけを見る
    testPath: '/ISteamUser/GetPlayerSummaries/v2/?steamids=76561197960435530',
    secretLabel: 'Web API Key',
    secretHelpUrl: 'https://steamcommunity.com/dev/apikey',
  },
  {
    id: 'builtin:shodan@1',
    name: 'Shodan',
    icon: 'shield-search',
    baseUrl: 'https://api.shodan.io',
    authType: { kind: 'query', param: 'key' },
    allowedHosts: ['api.shodan.io'],
    testPath: '/api-info',
    secretLabel: 'API Key',
    secretHelpUrl: 'https://account.shodan.io/',
  },
  {
    id: 'builtin:habitica@1',
    name: 'Habitica',
    icon: 'sword',
    baseUrl: 'https://habitica.com',
    // 既定の Bearer では 401
    authType: { kind: 'header', name: 'x-api-key' },
    allowedHosts: ['habitica.com'],
    // 認証つきの面は x-api-user (User ID) も要求し、それは接続ではなくウィジェット側が
    // 持つ。ここで見られるのは到達性まで
    testPath: '/api/v3/status',
    secretLabel: 'API トークン',
    secretHelpUrl: 'https://habitica.com/user/settings/api',
  },
  {
    id: 'builtin:commafeed@1',
    name: 'CommaFeed',
    icon: 'rss',
    // セルフホストなら自分のインスタンスに変える
    baseUrl: 'https://www.commafeed.com',
    authType: { kind: 'query', param: 'apiKey' },
    allowedHosts: ['www.commafeed.com'],
    // API キー認証で通るのは GET のみ
    testPath: '/rest/category/get',
    secretLabel: 'API キー',
    secretHelpUrl: 'https://www.commafeed.com',
  },
  {
    id: 'builtin:mewk@1',
    name: 'Mewk',
    icon: 'message-question',
    baseUrl: 'https://mewk.app',
    authType: { kind: 'bearer' },
    allowedHosts: ['mewk.app'],
    testPath: '/api/v1/users/me/stats',
    secretLabel: 'API キー (mewk_...)',
    secretHelpUrl: 'https://mewk.app/settings/developer',
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
