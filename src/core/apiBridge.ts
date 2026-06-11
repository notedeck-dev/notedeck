import { emit } from '@tauri-apps/api/event'
import { isColumnType } from '@/columns/registry'
import { useCommandStore } from '@/commands/registry'
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
}

let unlisten: (() => void) | null = null

export async function initApiBridge() {
  if (unlisten) return

  const unlistenFn = await listenTauri(
    'nd:query-request',
    async ({ id, type, params }) => {
      const handler = handlers[type]
      const result = handler
        ? handler(params)
        : { error: `Unknown query type: ${type}` }

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
