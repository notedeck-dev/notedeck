import { i18n } from '@/i18n'
import { useConfirm } from '@/stores/confirm'
import type { DeckColumn } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { usePrompt } from '@/stores/prompt'
import { useToast } from '@/stores/toast'
import {
  antennaCacheKey,
  clipCacheKey,
  userListCacheKey,
} from '@/utils/columnCacheKey'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'

export type EntityType = 'clip' | 'list' | 'antenna'

type EntityIdKey = 'clipId' | 'listId' | 'antennaId'

export function isEntityType(value: unknown): value is EntityType {
  return typeof value === 'string' && value in ENTITY_CONFIGS
}

export const ENTITY_CONFIGS: Record<
  EntityType,
  {
    label: string
    idKey: EntityIdKey
    updateEndpoint: string
    deleteEndpoint: string
    /** エンティティ削除後に掃除する timeline キャッシュの canonical キー */
    cacheKey: (entityId: string) => string
  }
> = {
  clip: {
    get label() {
      return i18n.ts._useEntityCrud.clip
    },
    idKey: 'clipId',
    updateEndpoint: 'clips/update',
    deleteEndpoint: 'clips/delete',
    cacheKey: clipCacheKey,
  },
  list: {
    get label() {
      return i18n.ts._useEntityCrud.list
    },
    idKey: 'listId',
    updateEndpoint: 'users/lists/update',
    deleteEndpoint: 'users/lists/delete',
    cacheKey: userListCacheKey,
  },
  antenna: {
    get label() {
      return i18n.ts._useEntityCrud.antenna
    },
    idKey: 'antennaId',
    updateEndpoint: 'antennas/update',
    deleteEndpoint: 'antennas/delete',
    cacheKey: antennaCacheKey,
  },
}

export function useEntityCrud(type: EntityType, getColumn: () => DeckColumn) {
  const config = ENTITY_CONFIGS[type]
  const deckStore = useDeckStore()
  const { confirm } = useConfirm()
  const { prompt } = usePrompt()
  const toast = useToast()

  function getEntityId(): string | undefined {
    return getColumn()[config.idKey]
  }

  async function rename(closeMenu: () => void) {
    closeMenu()
    const col = getColumn()
    const newName = await prompt({
      title: i18n.tsx._useEntityCrud.renameTitle({ label: config.label }),
      defaultValue: col.name ?? '',
    })
    if (!newName) return
    try {
      const entityId = getEntityId()
      if (!entityId || !col.accountId) return
      unwrap(
        await commands.apiRequest(col.accountId, config.updateEndpoint, {
          [config.idKey]: entityId,
          name: newName,
        }),
      )
      deckStore.updateColumn(col.id, { name: newName })
      toast.show(i18n.tsx._useEntityCrud.renamed({ label: config.label }))
    } catch (e) {
      const err = AppError.from(e)
      console.error('[entity:rename]', err.code, err.message)
      toast.show(
        i18n.tsx._useEntityCrud.renameFailed({
          label: config.label,
          code: err.displayCode,
        }),
        'error',
      )
    }
  }

  async function deleteEntity(closeMenu: () => void) {
    closeMenu()
    const col = getColumn()
    const ok = await confirm({
      title: i18n.tsx._common.deleteItem({ label: config.label }),
      message: i18n.tsx._useEntityCrud.confirmDelete({ label: config.label }),
      okLabel: i18n.ts._common.delete,
      type: 'danger',
    })
    if (!ok) return
    try {
      const entityId = getEntityId()
      if (!entityId || !col.accountId) return
      unwrap(
        await commands.apiRequest(col.accountId, config.deleteEndpoint, {
          [config.idKey]: entityId,
        }),
      )
      // サーバー削除成功後、死にバケットの membership を掃除 (notecli#30 v5
      // §6-7 / R11-1)。fire-and-forget — 失敗しても stale キャッシュが残る
      // だけなので warn + 続行
      commands
        .apiClearTimelineCache(col.accountId, config.cacheKey(entityId))
        .then((r) => unwrap(r))
        .catch((e) => {
          console.warn('[entity:delete] clear-timeline-cache failed:', e)
        })
      deckStore.removeColumn(col.id)
      toast.show(i18n.tsx._useEntityCrud.deleted({ label: config.label }))
    } catch (e) {
      const err = AppError.from(e)
      console.error('[entity:delete]', err.code, err.message)
      toast.show(
        i18n.tsx._useEntityCrud.deleteFailed({
          label: config.label,
          code: err.displayCode,
        }),
        'error',
      )
    }
  }

  return { rename, deleteEntity, config }
}
