// 生成物 — 手で編集しない。正本は crates/notecore/connection_templates.json5、
// 生成は `pnpm gen:connection-templates` (scripts/gen-connection-templates.mjs)。
// 生成物が最新かは tests/lint/connectionTemplates.test.ts が検査する (#1160)。

import type { AuthType, ConnectionProtocol } from '@/bindings'

/** secret 入力欄のラベルに使う辞書キー (`_connectionTemplates.<key>`) */
export type SecretLabelKey = "apiKey" | "apiKeyMewk" | "apiToken" | "apiTokenRaw" | "deeplAuthHeader"

export interface ConnectionTemplateDecl {
  /** `builtin:<id>@<version>` 形式の識別子。 */
  id: string
  /** 表示名。 */
  name: string
  /**
   * favicon 取得に失敗したときの fallback アイコン (`ti ti-<icon>`)。
   * 通常は baseUrl host の favicon を表示する (`faviconUrl`)。
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
  /** secret 入力欄のラベル (固定文字列か辞書キー)。 */
  secretLabel: string | { i18n: SecretLabelKey }
  /** secret 発行手順への URL。 */
  secretHelpUrl: string
  /**
   * LLM プロトコル。設定すると AI プロバイダー接続として扱われ、
   * AI 設定の接続ピッカーに表示される。汎用 API テンプレでは未設定。
   */
  protocol?: ConnectionProtocol
  /** AI 設定で接続を選んだときに初期表示するモデル名。 */
  defaultModel?: string
  /**
   * 会話アフィニティ ID を載せるヘッダー名 (#1160)。適用は Rust 側が
   * 宛先ホストで判定するので、フロントは表示にしか使わない。
   */
  affinityHeader?: string
}

export const BUILTIN_TEMPLATE_DECLS: readonly ConnectionTemplateDecl[] = [
  {
    id: "builtin:openai@1",
    name: "OpenAI",
    icon: "sparkles",
    baseUrl: "https://api.openai.com/v1",
    authType: {"kind":"bearer"},
    allowedHosts: ["api.openai.com"],
    testPath: "/models",
    secretLabel: "API Key",
    secretHelpUrl: "https://platform.openai.com/api-keys",
    protocol: "openai-compat",
    defaultModel: "gpt-5.4-mini",
  },
  {
    id: "builtin:anthropic@1",
    name: "Anthropic",
    icon: "robot",
    baseUrl: "https://api.anthropic.com",
    authType: {"kind":"header","name":"x-api-key"},
    allowedHosts: ["api.anthropic.com"],
    testPath: "/v1/models",
    secretLabel: "API Key",
    secretHelpUrl: "https://console.anthropic.com/settings/keys",
    protocol: "anthropic",
    defaultModel: "claude-sonnet-5",
  },
  {
    id: "builtin:xai@1",
    name: "xAI",
    icon: "brand-x",
    baseUrl: "https://api.x.ai/v1",
    authType: {"kind":"bearer"},
    allowedHosts: ["api.x.ai"],
    testPath: "/models",
    secretLabel: "API Key",
    secretHelpUrl: "https://console.x.ai/",
    protocol: "openai-compat",
    defaultModel: "grok-4.5",
  },
  {
    id: "builtin:google@1",
    name: "Google",
    icon: "brand-google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    authType: {"kind":"bearer"},
    allowedHosts: ["generativelanguage.googleapis.com"],
    testPath: "/models",
    secretLabel: "API Key",
    secretHelpUrl: "https://aistudio.google.com/apikey",
    protocol: "openai-compat",
    defaultModel: "gemini-3.7-flash",
  },
  {
    id: "builtin:openrouter@1",
    name: "OpenRouter",
    icon: "router",
    baseUrl: "https://openrouter.ai/api/v1",
    authType: {"kind":"bearer"},
    allowedHosts: ["openrouter.ai"],
    testPath: "/models",
    secretLabel: "API Key",
    secretHelpUrl: "https://openrouter.ai/keys",
    protocol: "openai-compat",
    defaultModel: "moonshotai/kimi-k3",
  },
  {
    id: "builtin:opencode-go@1",
    name: "OpenCode Go",
    icon: "terminal-2",
    baseUrl: "https://opencode.ai/zen/go/v1",
    authType: {"kind":"bearer"},
    allowedHosts: ["opencode.ai"],
    testPath: "/models",
    secretLabel: "API Key",
    secretHelpUrl: "https://opencode.ai/auth",
    protocol: "openai-compat",
    defaultModel: "kimi-k3",
    affinityHeader: "x-opencode-session",
  },
  {
    id: "builtin:deepl@1",
    name: "DeepL",
    icon: "language",
    baseUrl: "https://api-free.deepl.com",
    authType: {"kind":"header","name":"Authorization"},
    allowedHosts: ["api-free.deepl.com","api.deepl.com"],
    testPath: "/v2/usage",
    secretLabel: {"i18n":"deeplAuthHeader"},
    secretHelpUrl: "https://www.deepl.com/your-account/keys",
  },
  {
    id: "builtin:saucenao@1",
    name: "SauceNAO",
    icon: "search",
    baseUrl: "https://saucenao.com",
    authType: {"kind":"query","param":"api_key"},
    allowedHosts: ["saucenao.com"],
    testPath: "/search.php?output_type=2&numres=1&url=https://saucenao.com/images/static/banner.gif",
    secretLabel: "API Key",
    secretHelpUrl: "https://saucenao.com/user.php?page=search-api",
  },
  {
    id: "builtin:todoist@1",
    name: "Todoist",
    icon: "circle-check",
    baseUrl: "https://api.todoist.com",
    authType: {"kind":"bearer"},
    allowedHosts: ["api.todoist.com"],
    testPath: "/api/v1/tasks",
    secretLabel: {"i18n":"apiToken"},
    secretHelpUrl: "https://app.todoist.com/app/settings/integrations/developer",
  },
  {
    id: "builtin:clickup@1",
    name: "ClickUp",
    icon: "checklist",
    baseUrl: "https://api.clickup.com",
    authType: {"kind":"header","name":"Authorization"},
    allowedHosts: ["api.clickup.com"],
    testPath: "/api/v2/user",
    secretLabel: "Personal API Token (pk_...)",
    secretHelpUrl: "https://app.clickup.com/settings/apps",
  },
  {
    id: "builtin:hackerone@1",
    name: "HackerOne",
    icon: "bug",
    baseUrl: "https://api.hackerone.com",
    authType: {"kind":"basic","username":""},
    allowedHosts: ["api.hackerone.com"],
    testPath: "/v1/hackers/payments/balance",
    secretLabel: {"i18n":"apiTokenRaw"},
    secretHelpUrl: "https://hackerone.com/settings/api_token/edit",
  },
  {
    id: "builtin:wakatime@1",
    name: "WakaTime",
    icon: "clock-code",
    baseUrl: "https://api.wakatime.com",
    authType: {"kind":"query","param":"api_key"},
    allowedHosts: ["api.wakatime.com"],
    testPath: "/api/v1/users/current",
    secretLabel: "API Key",
    secretHelpUrl: "https://wakatime.com/settings/api-key",
  },
  {
    id: "builtin:steam@1",
    name: "Steam",
    icon: "brand-steam",
    baseUrl: "https://api.steampowered.com",
    authType: {"kind":"query","param":"key"},
    allowedHosts: ["api.steampowered.com"],
    testPath: "/ISteamUser/GetPlayerSummaries/v2/?steamids=76561197960435530",
    secretLabel: "Web API Key",
    secretHelpUrl: "https://steamcommunity.com/dev/apikey",
  },
  {
    id: "builtin:shodan@1",
    name: "Shodan",
    icon: "shield-search",
    baseUrl: "https://api.shodan.io",
    authType: {"kind":"query","param":"key"},
    allowedHosts: ["api.shodan.io"],
    testPath: "/api-info",
    secretLabel: "API Key",
    secretHelpUrl: "https://account.shodan.io/",
  },
  {
    id: "builtin:habitica@1",
    name: "Habitica",
    icon: "sword",
    baseUrl: "https://habitica.com",
    authType: {"kind":"header","name":"x-api-key"},
    allowedHosts: ["habitica.com"],
    testPath: "/api/v3/status",
    secretLabel: {"i18n":"apiToken"},
    secretHelpUrl: "https://habitica.com/user/settings/api",
  },
  {
    id: "builtin:commafeed@1",
    name: "CommaFeed",
    icon: "rss",
    baseUrl: "https://www.commafeed.com",
    authType: {"kind":"query","param":"apiKey"},
    allowedHosts: ["www.commafeed.com"],
    testPath: "/rest/category/get",
    secretLabel: {"i18n":"apiKey"},
    secretHelpUrl: "https://www.commafeed.com",
  },
  {
    id: "builtin:mewk@1",
    name: "Mewk",
    icon: "message-question",
    baseUrl: "https://mewk.app",
    authType: {"kind":"bearer"},
    allowedHosts: ["mewk.app"],
    testPath: "/api/v1/users/me/stats",
    secretLabel: {"i18n":"apiKeyMewk"},
    secretHelpUrl: "https://mewk.app/settings/developer",
  },
]
