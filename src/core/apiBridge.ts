import { emit } from '@tauri-apps/api/event'
import { dispatchCapability } from '@/capabilities/dispatcher'
import { sanitizeToolName } from '@/capabilities/identifier'
import { listCapabilities } from '@/capabilities/registry'
import { useCommandStore } from '@/commands/registry'
import { listStreamHealth } from '@/core/streamHealth'
import type { ProfiledPrincipalId } from '@/permissions/principal'
import { PERMISSION_KEYS } from '@/permissions/schema'
import { resolveForProfiled } from '@/permissions/store'
import { useDeckStore } from '@/stores/deck'
import { getStartupEntries, getWebviewFixedCost } from '@/utils/startupTrace'
import { listenTauri } from '@/utils/tauriEvents'

export interface QueryRequest {
  id: string
  type: string
  params: Record<string, unknown>
}

type QueryHandler = (params: Record<string, unknown>) => unknown

const handlers: Record<string, QueryHandler> = {
  'deck/columns': () => {
    const deck = useDeckStore()
    return deck.columns
  },

  'deck/active': () => {
    const deck = useDeckStore()
    return {
      columnId: deck.activeColumnId,
    }
  },

  'commands/list': () => {
    const commandStore = useCommandStore()
    const cmds = [...commandStore.commands.values()].map((cmd) => ({
      id: cmd.id,
      label: cmd.label,
      icon: cmd.icon,
      category: cmd.category,
      enabled: cmd.enabled?.() !== false,
      visible: cmd.visible !== false,
    }))
    return cmds
  },

  // /api/health のフロント側パート: WebView 死活の証明 + ストリーム接続状態
  'health/streams': () => listStreamHealth(),

  // --- dev ダッシュボード向け読み取り診断 (#977) ---
  // ephemeral トークン (dev) 前提。永続トークン (external principal) には
  // permissions_gate の route_rule が既定 Deny を返すので開かない

  'startup/trace': () => ({
    entries: getStartupEntries(),
    webviewFixedCost: getWebviewFixedCost(),
  }),

  'permissions/resolved': () => {
    const principals: ProfiledPrincipalId[] = [
      'ai.chat',
      'ai.heartbeat',
      'plugin',
      'external',
    ]
    return {
      keys: PERMISSION_KEYS,
      principals: Object.fromEntries(
        principals.map((id) => [id, resolveForProfiled(id)]),
      ),
    }
  },

  // --- 外部アプリ向け capability 面 (#709) ---
  // 権限は external principal のプロファイルで gate される (dispatcher が照合)。
  // カラム追加/削除・コマンド実行の旧 store 直叩きハンドラは #711 で削除済み —
  // 外部からの操作はすべて capabilities/execute (= dispatcher) に一本化する。

  'capabilities/list': () =>
    listCapabilities().map((cap) => ({
      id: cap.id,
      // Anthropic / OpenAI tool 名と同じ sanitized 形式 (外部 AI がそのまま使える)
      name: sanitizeToolName(cap.id),
      label: cap.label,
      category: cap.category,
      description: cap.signature?.description ?? '',
      params: cap.signature?.params ?? {},
      returns: cap.signature?.returns ?? { type: 'void' },
      permissions: cap.permissions ?? [],
      requiresConfirmation: !!cap.requiresConfirmation,
    })),

  'capabilities/execute': async (params) => {
    return await dispatchCapability(
      params.capabilityId as string,
      // body 省略時に Rust 側から null が来る → capability には undefined で渡す
      (params.params ?? undefined) as Record<string, unknown> | undefined,
      { principal: { kind: 'external' } },
    )
  },
}

/**
 * Query type からハンドラを引いて実行する。HTTP API (query_bridge) と
 * テストの共通入口。ハンドラ throw は構造化エラーに変換して返す
 * (= 呼び出し元の HTTP handler が 500 QUERY_FAILED にしない)。
 */
export async function handleQuery(
  type: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const handler = handlers[type]
  if (!handler) return { error: `Unknown query type: ${type}` }
  try {
    return await handler(params)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

let unlisten: (() => void) | null = null

export async function initApiBridge() {
  if (unlisten) return

  const unlistenFn = await listenTauri(
    'nd:query-request',
    async ({ id, type, params }) => {
      const result = await handleQuery(type, params)

      // 動的イベント名なので TauriEventPayloads の対象外 (型付け不可)
      await emit(`nd:query-response-${id}`, result)
    },
  )

  unlisten = unlistenFn
}

export function destroyApiBridge() {
  if (unlisten) {
    unlisten()
    unlisten = null
  }
}
