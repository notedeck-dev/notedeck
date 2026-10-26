import type { Capability } from '@/capabilities/types'
import { i18n } from '@/i18n'
import { compileColumnQuery } from '@/services/columnQuery/compiler'
import { useColumnQueriesStore } from '@/stores/columnQueries'
import { implement, implementCore } from '../declare'
import { editAttribution } from '../editAttribution'
import { stageEdit, takeStagedEdit } from '../stagedEdit'

/**
 * カラムクエリ (#783) の capability。読取 / 削除 / 履歴は notecore (core)、
 * 作成と更新は式の検証 (QIR へのコンパイル) がデバイス側にしか無いので device。
 * 保存の条件はエディタと同じ: サブセット外でも純粋なら降格して受け、副作用や
 * 非決定の API に届く式 (または式として成立しない) は拒否する (不変条件 (c))
 */

export const queriesListCapability = implementCore('queries.list')

export const queriesReadCapability = implementCore('queries.read')

function rejectInvalidSrc(
  params: Record<string, unknown> | undefined,
): { error: string } | null {
  if (typeof params?.src !== 'string') return null
  const result = compileColumnQuery(params.src)
  if (result.ok || result.degradable) return null
  return {
    error:
      'The query expression is rejected: it is not a pure boolean expression over `note` ' +
      '(or has syntax errors). Fix src and call this capability again.\n' +
      `diagnostics: ${JSON.stringify(result.diagnostics)}`,
  }
}

export const queriesCreateCapability = implement('queries.create', {
  preflight: rejectInvalidSrc,
  requiresConfirmation: (params) => {
    const name = typeof params?.name === 'string' ? params.name : ''
    return {
      title: i18n.ts._queriesCapability.createTitle,
      message: i18n.tsx._queriesCapability.createMessage({ name }),
      code: typeof params?.src === 'string' ? params.src : '',
      codeLanguage: 'is',
      okLabel: i18n.ts._common.create,
      cancelLabel: i18n.ts._common.cancel,
      type: 'normal',
    }
  },
  execute: async (params) => {
    const name = typeof params?.name === 'string' ? params.name : ''
    const src = typeof params?.src === 'string' ? params.src : ''
    if (!name) throw new Error('queries.create: name is required')
    if (!src) throw new Error('queries.create: src is required')
    const description =
      typeof params?.description === 'string' ? params.description : undefined
    // AI 経由はカラム文脈を持たないのでライブラリにだけ入れる (#1018)
    const added = await useColumnQueriesStore().add({
      name,
      description,
      content: src,
    })
    return { id: added.id, name: added.name }
  },
})

export const queriesUpdateCapability = implement('queries.update', {
  preflight: rejectInvalidSrc,
  requiresConfirmation: (params, ctx) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    const src = typeof params?.src === 'string' ? params.src : ''
    const cur = useColumnQueriesStore().get(id)
    if (!cur) return null
    stageEdit(ctx, cur.content, src)
    return {
      title: i18n.ts._queriesCapability.updateTitle,
      message: i18n.tsx._queriesCapability.updateMessage({
        name: cur.name,
        from: cur.content.length,
        to: src.length,
      }),
      diff: { old: cur.content, new: src, language: 'aiscript' },
      okLabel: i18n.ts._common.update,
      cancelLabel: i18n.ts._common.cancel,
      type: 'warning',
    }
  },
  execute: async (params, ctx) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    const src = typeof params?.src === 'string' ? params.src : ''
    if (!id) throw new Error('queries.update: id is required')
    if (!src) throw new Error('queries.update: src is required')
    const store = useColumnQueriesStore()
    const cur = store.get(id)
    if (!cur) throw new Error(`queries.update: query "${id}" not found`)
    const next = takeStagedEdit(ctx, 'queries.update', cur.content, () => src)
    await store.update(id, { content: next }, editAttribution(ctx, params))
    return { id, length: next.length }
  },
})

export const queriesDeleteCapability = implementCore('queries.delete')

export const queriesHistoryCapability = implementCore('queries.history')

export const queriesRevertCapability = implementCore('queries.revert')

export const QUERIES_BUILTIN_CAPABILITIES: readonly Capability[] = [
  queriesListCapability,
  queriesReadCapability,
  queriesCreateCapability,
  queriesUpdateCapability,
  queriesDeleteCapability,
  queriesHistoryCapability,
  queriesRevertCapability,
]
