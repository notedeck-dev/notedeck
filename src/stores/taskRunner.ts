import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { JsonValue } from '@/bindings'
import { useCommandStore } from '@/commands/registry'
import { TASK_COMMAND_PREFIX } from '@/commands/taskCommandPrefix'
import { useAccountsStore } from '@/stores/accounts'
import { usePrompt } from '@/stores/prompt'
import { useTasksStore } from '@/stores/tasks'
import { useToast } from '@/stores/toast'
import { expandTemplate } from '@/tasks/expand'
import { resolveTaskAccount } from '@/tasks/resolveAccount'
import type { TaskInput, TaskRun } from '@/tasks/types'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'

const MAX_RUNS = 200
const RUN_TTL_MS = 24 * 60 * 60 * 1000
const PRUNE_INTERVAL_MS = 60 * 1000

export const useTaskRunnerStore = defineStore('taskRunner', () => {
  const runs = shallowRef<TaskRun[]>([])
  // presentation.revealOnRun で run を自動選択させたいときに更新される。
  // カラム側が watch して selectedId を同期する。
  const autoSelectedRunId = shallowRef<number | null>(null)
  let nextId = 0
  let pruneTimer: ReturnType<typeof setInterval> | null = null

  function ensurePruneTimer(): void {
    if (pruneTimer != null) return
    pruneTimer = setInterval(pruneStale, PRUNE_INTERVAL_MS)
  }

  function pruneStale(): void {
    const cutoff = Date.now() - RUN_TTL_MS
    const filtered = runs.value.filter(
      (r) => r.status === 'running' || r.startedAt >= cutoff,
    )
    if (filtered.length !== runs.value.length) runs.value = filtered
  }

  function updateRun(id: number, patch: Partial<TaskRun>): void {
    runs.value = runs.value.map((r) => (r.id === id ? { ...r, ...patch } : r))
  }

  function pushRun(run: TaskRun): void {
    const arr = [run, ...runs.value]
    if (arr.length > MAX_RUNS) arr.length = MAX_RUNS
    runs.value = arr
  }

  function clear(): void {
    runs.value = []
  }

  async function collectInputs(
    inputs: TaskInput[] | undefined,
  ): Promise<Record<string, string> | null> {
    const out: Record<string, string> = {}
    if (!inputs || inputs.length === 0) return out
    const { prompt } = usePrompt()
    for (const i of inputs) {
      const placeholder =
        i.type === 'pick' ? i.options.join(' / ') : (i.default ?? '')
      const val = await prompt({
        title: i.prompt,
        placeholder,
        defaultValue: i.default ?? '',
      })
      if (val === null) return null
      if (i.type === 'pick' && !i.options.includes(val)) {
        useToast().show(
          `${i.prompt}: "${val}" は選択肢に含まれません (${i.options.join(', ')})`,
          'error',
        )
        return null
      }
      out[i.id] = val
    }
    return out
  }

  function resolveAccount(defAccountId: string | null | undefined): {
    id: string | null
    host: string | null
  } | null {
    const accountsStore = useAccountsStore()
    const resolved = resolveTaskAccount(
      accountsStore.accounts,
      accountsStore.activeAccount,
      defAccountId,
    )
    if (!resolved.ok) {
      useToast().show(
        resolved.reason === 'not-found'
          ? `タスク: アカウント "${resolved.requestedId}" が見つかりません`
          : 'タスク: 利用可能なアカウントがありません',
        'error',
      )
      return null
    }
    return { id: resolved.id, host: resolved.host }
  }

  /**
   * タスクを実行する。
   * @param overrideInputs UI prompt をスキップする場合に渡す。
   *   - `undefined` (default): 従来通り `usePrompt()` で対話的に入力を集める
   *   - `Record<string, string>`: 値を inject (AI / capability 経由の呼び出し)
   *   - `null`: 明示的キャンセル (即 return)
   * @returns 完了 / エラー / キャンセル済みの TaskRun。キャンセル時 / 早期 return 時は null。
   */
  async function runTask(
    taskId: string,
    overrideInputs?: Record<string, string> | null,
  ): Promise<TaskRun | null> {
    const tasksStore = useTasksStore()
    const def = tasksStore.getById(taskId)
    if (!def) {
      useToast().show(`タスク "${taskId}" が見つかりません`, 'error')
      return null
    }
    ensurePruneTimer()

    const account = resolveAccount(def.accountId)
    if (!account) return null

    const inputs =
      overrideInputs !== undefined
        ? overrideInputs
        : await collectInputs(def.inputs)
    if (inputs === null) return null

    const expandedParams = expandTemplate(def.action.params ?? {}, {
      inputs,
      account,
    })

    if (def.presentation?.clearHistoryOnRun === true) {
      runs.value = []
    }

    const run: TaskRun = {
      id: nextId++,
      taskId: def.id,
      label: def.label,
      status: 'running',
      startedAt: Date.now(),
      accountId: account.id,
      method: def.action.method,
      params: expandedParams,
    }
    pushRun(run)

    if (def.presentation?.revealOnRun !== false) {
      autoSelectedRunId.value = run.id
    }

    if (!account.id) {
      updateRun(run.id, {
        status: 'error',
        finishedAt: Date.now(),
        error: 'no account id',
      })
      return runs.value.find((r) => r.id === run.id) ?? null
    }

    try {
      const result = unwrap(
        await commands.apiRequest(
          account.id,
          def.action.method,
          expandedParams as unknown as JsonValue,
        ),
      )
      updateRun(run.id, {
        status: 'ok',
        finishedAt: Date.now(),
        response: result,
      })
      useToast().show(`タスク完了: ${def.label}`, 'success')
    } catch (e) {
      const msg = AppError.from(e).message
      updateRun(run.id, {
        status: 'error',
        finishedAt: Date.now(),
        error: msg,
      })
      useToast().show(`タスク失敗: ${def.label} — ${msg}`, 'error')
    }

    return runs.value.find((r) => r.id === run.id) ?? null
  }

  async function runDefault(): Promise<void> {
    const tasksStore = useTasksStore()
    const def = tasksStore.definitions.find((d) => d.isDefault)
    if (def) {
      await runTask(def.id)
      return
    }
    // VSCode の Run Default Task 相当: 既定が未設定ならタスク一覧を
    // コマンドパレットで選ばせる
    const commandStore = useCommandStore()
    if (tasksStore.definitions.length === 0) {
      useToast().show(
        'デフォルトタスクがありません。tasks.json5 で isDefault: true を設定してください。',
        'info',
      )
      return
    }
    commandStore.openWithFilter((c) => c.id.startsWith(TASK_COMMAND_PREFIX))
  }

  return {
    runs,
    autoSelectedRunId,
    runTask,
    runDefault,
    clear,
  }
})
