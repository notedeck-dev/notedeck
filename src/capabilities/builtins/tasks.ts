import type { Command } from '@/commands/registry'
import { assertMisskeyApiAllowed } from '@/permissions/misskeyApiGate'
import { useTaskRunnerStore } from '@/stores/taskRunner'
import { useTasksStore } from '@/stores/tasks'
import { implement } from '../declare'

/**
 * `tasks.run` — ユーザー定義タスク (tasks.json5) を id で実行する。
 *
 * - TaskRunner 既存の `runTask()` を薄ラッパーで呼ぶ (= API 直叩きの実体は触らない)
 * - `inputs` を渡せば `usePrompt()` の対話 UI をスキップ (= AI / capability 経由
 *   での非対話実行を可能にする)
 * - task の action が叩く Misskey endpoint は、plugin の `Mk:api` と同じ対応表で
 *   呼び出し元 principal の権限を検査する (#1099)。`tasks.run` は「タスクを起動
 *   してよい」であって「任意の endpoint に届いてよい」ではない — safe preset が
 *   `notes.write: false` のまま `tasks.run: true` を持てるのはこの検査があるから
 * - 戻り値は TaskRun の projection (status / response / error / runId)
 */
export const tasksRunCapability = implement('tasks.run', {
  execute: async (params, ctx) => {
    const taskId =
      typeof params?.taskId === 'string' ? params.taskId.trim() : ''
    if (!taskId) throw new Error('tasks.run: taskId is required')

    const def = useTasksStore().getById(taskId)
    if (!def) throw new Error(`tasks.run: task "${taskId}" not found`)

    // dispatcher 経由なら principal が入る。無ければ本人の UI 操作 (gate 免除)
    await assertMisskeyApiAllowed(
      ctx?.principal ?? { kind: 'user' },
      def.action.method,
      { source: 'tasks.run', onBehalfOf: ctx?.onBehalfOf },
    )

    const rawInputs = params?.inputs
    const inputs =
      rawInputs && typeof rawInputs === 'object' && !Array.isArray(rawInputs)
        ? (rawInputs as Record<string, string>)
        : undefined

    const run = await useTaskRunnerStore().runTask(taskId, inputs)
    if (!run) return { status: 'cancelled' as const }
    return {
      runId: run.id,
      status: run.status,
      response: run.response,
      error: run.error,
    }
  },
})

export const TASKS_BUILTIN_CAPABILITIES: readonly Command[] = [
  tasksRunCapability,
]
