import type { Command } from '@/commands/registry'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * `http.fetch` — 外部 HTTP API (CORS なし) を叩く。Rust 側で SSRF / size /
 * timeout を防御するため、本 capability は薄い invoke ラッパに留める。
 *
 * AiScript からは `Nd:call('http.fetch', { url, ... })` または
 * `Nd:http(url, options)` (shorthand) で呼べる。permissions: `network.external`。
 */
export const httpFetchCapability: Command = {
  id: 'http.fetch',
  label: '外部 HTTP リクエスト',
  icon: 'ti-world-www',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['network.external'],
  // 任意 URL への外部送信は AI / プラグインが暴走すると情報漏洩 / 第三者
  // API の悪用につながるため、呼び出し都度 URL を見せて確認させる。
  // dispatcher が cap.label + signature.description + 引数 JSON を出す
  // 汎用モーダルを使う。
  requiresConfirmation: true,
  signature: {
    description:
      '外部 HTTP/HTTPS API にリクエストを送信する。Misskey 以外の API' +
      ' (翻訳・天気・RSS など) との連携に使う。loopback / private /' +
      ' link-local アドレスへの接続は SSRF 防御のため拒否される。',
    params: {
      url: {
        type: 'string',
        description: 'リクエスト先 URL (http または https のみ)',
      },
      method: {
        type: 'string',
        description: 'HTTP メソッド (default: GET)',
        optional: true,
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
      },
      headers: {
        type: 'object',
        description: 'リクエストヘッダ ({ key: string, value: string })',
        optional: true,
      },
      body: {
        type: 'string',
        description: 'リクエストボディ (文字列)',
        optional: true,
      },
      timeoutMs: {
        type: 'number',
        description: 'タイムアウト ms (1000〜120000, default 30000)',
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ status: number, headers: object, body: string }',
    },
  },
  visible: false,
  execute: async (params) => {
    const url = typeof params?.url === 'string' ? params.url : ''
    if (!url) throw new Error('url is required')
    const request = {
      url,
      method: typeof params?.method === 'string' ? params.method : null,
      headers: isStringRecord(params?.headers) ? params.headers : null,
      body: typeof params?.body === 'string' ? params.body : null,
      timeoutMs:
        typeof params?.timeoutMs === 'number' ? params.timeoutMs : null,
    }
    return unwrap(await commands.httpFetch(request))
  },
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  for (const value of Object.values(v as Record<string, unknown>)) {
    if (typeof value !== 'string') return false
  }
  return true
}

export const HTTP_BUILTIN_CAPABILITIES: readonly Command[] = [
  httpFetchCapability,
]
