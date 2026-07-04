import { emit } from '@tauri-apps/api/event'
import { dispatchCapability } from '@/capabilities/dispatcher'
import { sanitizeToolName } from '@/capabilities/identifier'
import { listCapabilities } from '@/capabilities/registry'
import { isColumnType } from '@/columns/registry'
import { useCommandStore } from '@/commands/registry'
import { useAiConfig } from '@/composables/useAiConfig'
import { useDeckStore } from '@/stores/deck'
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

  'deck/add-column': (params) => {
    const deck = useDeckStore()
    const col = deck.addColumn({
      type: isColumnType(params.type) ? params.type : 'timeline',
      name: (params.name as string) ?? null,
      width: (params.width as number) ?? 400,
      accountId: (params.accountId as string) ?? null,
      tl: params.tl as string | undefined,
      query: params.query as string | undefined,
      listId: params.listId as string | undefined,
      antennaId: params.antennaId as string | undefined,
      clipId: params.clipId as string | undefined,
      channelId: params.channelId as string | undefined,
      userId: params.userId as string | undefined,
    })
    return { id: col.id }
  },

  'deck/remove-column': (params) => {
    const deck = useDeckStore()
    deck.removeColumn(params.columnId as string)
    return { ok: true }
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

  'commands/execute': (params) => {
    const commandStore = useCommandStore()
    commandStore.execute(params.commandId as string)
    return { ok: true }
  },

  // --- 外部アプリ向け capability 面 (#709) ---
  // 権限は chat と独立の httpApi.permissions で gate される (dispatcher が照合)。

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
    const { config } = useAiConfig()
    return await dispatchCapability(
      params.capabilityId as string,
      // body 省略時に Rust 側から null が来る → capability には undefined で渡す
      (params.params ?? undefined) as Record<string, unknown> | undefined,
      { ...config.value, permissions: config.value.httpApi.permissions },
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
