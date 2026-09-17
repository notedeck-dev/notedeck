import type { Command } from '@/commands/registry'
import { useColumnQueriesStore } from '@/stores/columnQueries'
import { getSnapshotAt, listSnapshots } from '@/utils/historyFs'
import { editAttribution, REASON_PARAM } from '../editAttribution'
import { stageEdit, takeStagedEdit } from '../stagedEdit'

interface QuerySnapshot {
  src: string
  name?: string
  description?: string
}

/**
 * カラムクエリ (名前付きクエリ) の編集履歴 capability (#1117)。
 *
 * 他の配布物 (skill / widget / plugin / theme / CSS) と同じく、履歴の閲覧と
 * 「その状態に戻す」を capability として持つ。履歴ウィンドウの復元はこの
 * capability を user principal で呼ぶ (確認ダイアログ・diff・帰属を dispatcher
 * 側に通すため、store を直接触らない)。作成・編集そのものは開発者モードの
 * エディタが担い、AI には開放していない (#1034)。
 */

function basenameOf(q: {
  fileBase?: string
  name: string
  id: string
}): string {
  return q.fileBase ?? (q.name || q.id)
}

export const queriesHistoryCapability: Command = {
  id: 'queries.history',
  label: 'クエリの編集履歴',
  icon: 'ti-history',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['queries.read'],
  signature: {
    description:
      '指定 id の名前付きクエリの編集前 snapshot 一覧 (新しい順) を返す。',
    params: {
      id: { type: 'string', description: '対象クエリの id' },
    },
    returns: {
      type: 'array',
      description: '編集前 snapshot の配列 (新しい順)',
    },
    cheap: true,
  },
  visible: false,
  execute: async (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('queries.history: id is required')
    const query = useColumnQueriesStore().getQuery(id)
    if (!query) throw new Error(`queries.history: query "${id}" not found`)
    return await listSnapshots<QuerySnapshot>('query', basenameOf(query))
  },
}

export const queriesRevertCapability: Command = {
  id: 'queries.revert',
  label: 'クエリを過去の状態に戻す',
  icon: 'ti-arrow-back-up',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['queries.write'],
  requiresConfirmation: async (params, ctx) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    const index = typeof params?.index === 'number' ? params.index : -1
    const cur = useColumnQueriesStore().getQuery(id)
    if (!cur || index < 0) return null
    const entry = await getSnapshotAt<QuerySnapshot>(
      'query',
      basenameOf(cur),
      index,
    )
    if (!entry) return null
    const next = stageEdit(ctx, cur.src, entry.snapshot.src)
    return {
      title: 'クエリを過去の状態に戻す',
      message:
        `${cur.name} を編集履歴 #${index} (${new Date(entry.at).toLocaleString()}) ` +
        'の状態に戻します。現在のソースは上書きされます。',
      diff: { old: cur.src, new: next, language: 'aiscript' },
      okLabel: 'この状態に戻す',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  signature: {
    description: '名前付きクエリのソースを編集履歴の index 番目に戻す。',
    params: {
      id: { type: 'string', description: '対象クエリの id' },
      index: { type: 'number', description: 'snapshot index (0 = 最新)' },
      reason: REASON_PARAM,
    },
    returns: {
      type: 'object',
      description: '{ id, reverted: boolean, at: number }',
    },
  },
  visible: false,
  execute: async (params, ctx) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    const index = typeof params?.index === 'number' ? params.index : -1
    if (!id) throw new Error('queries.revert: id is required')
    if (index < 0) throw new Error('queries.revert: index must be >= 0')
    const store = useColumnQueriesStore()
    const query = store.getQuery(id)
    if (!query) throw new Error(`queries.revert: query "${id}" not found`)
    const entry = await getSnapshotAt<QuerySnapshot>(
      'query',
      basenameOf(query),
      index,
    )
    if (!entry) throw new Error(`queries.revert: no snapshot at index ${index}`)
    const next = takeStagedEdit(
      ctx,
      'queries.revert',
      query.src,
      () => entry.snapshot.src,
    )
    const ok = await store.updateQuery(
      id,
      { src: next },
      editAttribution(ctx, params),
    )
    if (!ok) {
      throw new Error(
        'queries.revert: ソースファイルが見つからないため変更できません',
      )
    }
    return { id, reverted: true, at: entry.at }
  },
}

export const QUERIES_BUILTIN_CAPABILITIES: readonly Command[] = [
  queriesHistoryCapability,
  queriesRevertCapability,
]
