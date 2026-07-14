import type { Connection, PrincipalClass } from '@/bindings'
import type { CapabilityContext } from '@/capabilities/types'
import type { Command } from '@/commands/registry'
import type { Principal } from '@/permissions/principal'
import { commands, unwrap } from '@/utils/tauriInvoke'

/**
 * principal → 開示先クラスのマッピング (#712 §6.1 / #759)。
 * - ai.chat / ai.heartbeat → 'ai'
 * - plugin → 'plugin' (接続ごとの opt-in 開示 — default 非開示)
 * - external → 'external'
 * - user → 'user' を返すが全開示 (本人は常に全接続を扱える)
 */
function classOf(principal: Principal): PrincipalClass | 'user' {
  switch (principal.kind) {
    case 'user':
      return 'user'
    case 'ai.chat':
    case 'ai.heartbeat':
      return 'ai'
    case 'plugin':
      return 'plugin'
    case 'external':
      return 'external'
  }
}

function requirePrincipal(ctx: CapabilityContext | undefined): Principal {
  const principal = ctx?.principal
  if (!principal) {
    throw new Error(
      'vault.fetch: principal が ctx に渡される dispatchCapability 経由で呼ばれる必要があります',
    )
  }
  return principal
}

/**
 * `connectionRef` (接続名 — 大文字小文字無視 — または id) を、principal の
 * クラスに開示された接続に解決する。見つからなければ `null`。`execute` と
 * `requiresConfirmation` / `onConfirmRemember` で同じ解決ロジックを共有する。
 */
async function resolveVisibleConnection(
  ref: string,
  principal: Principal,
): Promise<Connection | null> {
  const cls = classOf(principal)
  const all = unwrap(await commands.vaultListConnections())
  const visible =
    cls === 'user' ? all : all.filter((c) => c.exposedTo?.includes(cls))
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
 * この capability から到達できるのは **呼び出し principal のクラスに開示された
 * 接続のみ** (#712 §6.1 / #759)。「AI に見せる」「プラグインに見せる」
 * 「外部アプリに見せる」は別の同意で、片方への開示が他方に波及しない。
 *
 * confirmation は接続の per-class 信頼状態で決まる (#712 §6.2):
 * - `trustedFor` に呼び出しクラスが含まれる接続 → 確認なし
 * - それ以外 → 都度確認。「今後この接続を確認なしで使う」ON で許可されたら
 *   `onConfirmRemember` が **呼び出しクラスだけ** を `trustedFor` に追加する
 *   — 外部アプリでの同意が AI の trust に化けない。
 */
export const vaultFetchCapability: Command = {
  id: 'vault.fetch',
  label: 'Vault 接続で HTTP リクエスト',
  icon: 'ti-plug-connected',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['vault.use'],
  requiresConfirmation: async (params, ctx) => {
    const principal = requirePrincipal(ctx)
    const cls = classOf(principal)
    const ref =
      typeof params?.connectionRef === 'string' ? params.connectionRef : ''
    const conn = ref ? await resolveVisibleConnection(ref, principal) : null
    // 呼び出しクラスで信頼済みの接続は確認なしで通す (user は常に確認あり —
    // 本人操作の confirm は削らない)
    if (conn && cls !== 'user' && conn.trustedFor?.includes(cls)) {
      return null
    }
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
      // 接続が解決できた + remember の同意先クラスが確定しているときだけ出す。
      // trust はクラス単位 — plugin はダイアログに個体名が出るぶん「この個体
      // だけ」への誤認が起きやすいので、同意の及ぶ範囲を文言で明示する (#759)
      ...(conn && cls !== 'user'
        ? {
            rememberLabel:
              cls === 'plugin'
                ? '今後すべてのプラグイン・ウィジェットからこの接続を確認なしで使う'
                : '今後この接続を確認なしで使う',
          }
        : {}),
    }
  },
  onConfirmRemember: async (params, ctx) => {
    const principal = requirePrincipal(ctx)
    const cls = classOf(principal)
    // 昇格は呼び出しクラスだけに効かせる (#712 §6.2)
    if (cls === 'user') return
    const ref =
      typeof params?.connectionRef === 'string' ? params.connectionRef : ''
    const conn = ref ? await resolveVisibleConnection(ref, principal) : null
    if (conn) unwrap(await commands.vaultSetTrusted(conn.id, cls, true))
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
  execute: async (params, ctx) => {
    const principal = requirePrincipal(ctx)
    const ref =
      typeof params?.connectionRef === 'string' ? params.connectionRef : ''
    if (!ref) throw new Error('connectionRef is required')
    const path = typeof params?.path === 'string' ? params.path : ''
    if (!path) throw new Error('path is required')

    // principal のクラスに開示された接続だけを対象に解決する
    const conn = await resolveVisibleConnection(ref, principal)
    if (!conn) {
      throw new Error(
        `connection "${ref}" は利用できません (存在しないか、この呼び出し元へのアクセスが許可されていません)`,
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
