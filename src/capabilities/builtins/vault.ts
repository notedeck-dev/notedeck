import type { Connection } from '@/bindings'
import type { Command } from '@/commands/registry'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * `connectionRef` (接続名 — 大文字小文字無視 — または id) を `aiVisible: true` な
 * 接続に解決する。見つからなければ `null`。`execute` と `requiresConfirmation` /
 * `onConfirmRemember` で同じ解決ロジックを共有するために切り出している。
 */
async function resolveVisibleConnection(
  ref: string,
): Promise<Connection | null> {
  const all = unwrap(await commands.vaultListConnections())
  const visible = all.filter((c) => c.aiVisible)
  const lower = ref.toLowerCase()
  return (
    visible.find((c) => c.name.toLowerCase() === lower) ??
    visible.find((c) => c.id === ref) ??
    null
  )
}

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
 * confirmation は接続の信頼状態で決まる:
 * - `aiTrusted: true` の接続 → 確認なし (`requiresConfirmation` が null を返す)
 * - それ以外 → 都度確認。ダイアログに「今後この接続を確認なしで使う」を出し、
 *   ON で許可されたら `onConfirmRemember` が接続を `aiTrusted: true` に昇格する。
 * AI チャット・ウィジェット・プラグインすべてがこの 1 つの接続フラグで governed
 * される (呼び出し元単位の許可は持たない)。
 */
export const vaultFetchCapability: Command = {
  id: 'vault.fetch',
  label: 'Vault 接続で HTTP リクエスト',
  icon: 'ti-plug-connected',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['vault.use'],
  requiresConfirmation: async (params) => {
    const ref =
      typeof params?.connectionRef === 'string' ? params.connectionRef : ''
    const conn = ref ? await resolveVisibleConnection(ref) : null
    // 信頼済み接続は確認なしで通す。
    if (conn?.aiTrusted) return null
    return {
      title: '外部接続へのリクエストを許可しますか?',
      message: conn
        ? `接続「${conn.name}」(${conn.baseUrl}) に HTTP リクエストを送ります。`
        : '登録済みの外部サービス接続に HTTP リクエストを送ります。',
      code: JSON.stringify(params ?? {}, null, 2),
      codeLanguage: 'json',
      okLabel: '許可',
      cancelLabel: 'やめる',
      type: 'danger',
      // 接続が解決できたときだけ remember を出す (解決先が確定しているため)。
      ...(conn ? { rememberLabel: '今後この接続を確認なしで使う' } : {}),
    }
  },
  onConfirmRemember: async (params) => {
    const ref =
      typeof params?.connectionRef === 'string' ? params.connectionRef : ''
    const conn = ref ? await resolveVisibleConnection(ref) : null
    if (conn) unwrap(await commands.vaultSetAiTrusted(conn.id, true))
  },
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
    const conn = await resolveVisibleConnection(ref)
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
