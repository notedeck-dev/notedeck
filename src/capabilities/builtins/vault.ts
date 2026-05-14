import type { Command } from '@/commands/registry'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * `vault.fetch` — 登録済みの外部サービス接続 (Secret Vault, #564) を使って
 * HTTP リクエストを送る。secret は Rust 側で注入され、AI / AiScript には
 * 渡らない。
 *
 * この capability から到達できるのは **`aiVisible: true` な接続のみ**。
 * ユーザーが明示的に「AI からのアクセスを許可」した接続だけが対象になる。
 * UI からの直接操作 (接続編集画面のテスト等) は `commands.vaultFetch` を
 * 直接呼ぶため、この制限を受けない。
 *
 * 呼び出し都度 confirmation を出す (`requiresConfirmation: true`) —
 * 外部 API への送信は AI / プラグインが暴走すると情報漏洩につながるため。
 */
export const vaultFetchCapability: Command = {
  id: 'vault.fetch',
  label: 'Vault 接続で HTTP リクエスト',
  icon: 'ti-plug-connected',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['vault.use'],
  requiresConfirmation: true,
  signature: {
    description:
      '登録済みの外部サービス接続を使って HTTP リクエストを送る。' +
      ' secret (API キー等) は NoteDeck が Rust 側で注入するため、' +
      ' connectionRef で接続を指定するだけでよい。利用可能な接続は' +
      ' system prompt の <available-connections> に列挙される。',
    params: {
      connectionRef: {
        type: 'string',
        description: '接続の名前 (<available-connections> に出ているもの)。',
      },
      path: {
        type: 'string',
        description: '接続の baseUrl からの相対パス (例: /user/repos)',
      },
      method: {
        type: 'string',
        description: 'HTTP メソッド (default: GET)',
        optional: true,
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
      },
      headers: {
        type: 'object',
        description:
          'リクエストヘッダ。Authorization / Cookie 等は無視される (secret は自動注入)。',
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
      description:
        '{ status, headers, body, redactedCount, bytesTotal, truncated }',
    },
  },
  visible: false,
  execute: async (params) => {
    const ref =
      typeof params?.connectionRef === 'string' ? params.connectionRef : ''
    if (!ref) throw new Error('connectionRef is required')
    const path = typeof params?.path === 'string' ? params.path : ''
    if (!path) throw new Error('path is required')

    // aiVisible な接続だけを対象に、名前 (大文字小文字無視) または id で解決する。
    const all = unwrap(await commands.vaultListConnections())
    const visible = all.filter((c) => c.aiVisible)
    const lower = ref.toLowerCase()
    const conn =
      visible.find((c) => c.name.toLowerCase() === lower) ??
      visible.find((c) => c.id === ref)
    if (!conn) {
      throw new Error(
        `connection "${ref}" は利用できません (存在しないか、AI からのアクセスが許可されていません)`,
      )
    }

    const request = {
      path,
      method: typeof params?.method === 'string' ? params.method : null,
      headers: isStringRecord(params?.headers) ? params.headers : null,
      body: typeof params?.body === 'string' ? params.body : null,
      timeoutMs:
        typeof params?.timeoutMs === 'number' ? params.timeoutMs : null,
      slot: null,
    }
    return unwrap(await commands.vaultFetch(conn.id, request))
  },
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  for (const value of Object.values(v as Record<string, unknown>)) {
    if (typeof value !== 'string') return false
  }
  return true
}

export const VAULT_BUILTIN_CAPABILITIES: readonly Command[] = [
  vaultFetchCapability,
]
