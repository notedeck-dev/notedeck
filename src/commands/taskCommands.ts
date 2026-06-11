import { watch } from 'vue'
import { useCommandStore } from '@/commands/registry'
import { TASK_COMMAND_PREFIX } from '@/commands/taskCommandPrefix'
import { useTaskRunnerStore } from '@/stores/taskRunner'
import { useTasksStore } from '@/stores/tasks'

const registeredIds = new Set<string>()
let started = false

function syncCommands(): void {
  const commandStore = useCommandStore()
  const runner = useTaskRunnerStore()
  const tasksStore = useTasksStore()
  const next = new Set(
    tasksStore.definitions.map((t) => TASK_COMMAND_PREFIX + t.id),
  )
  for (const id of registeredIds) {
    if (!next.has(id)) commandStore.unregister(id)
  }
  registeredIds.clear()
  for (const t of tasksStore.definitions) {
    const id = TASK_COMMAND_PREFIX + t.id
    commandStore.register({
      id,
      label: `タスク: ${t.label}`,
      icon: 'player-play',
      category: 'general',
      shortcuts: [],
      execute: () => {
        void runner.runTask(t.id)
      },
    })
    registeredIds.add(id)
  }
}

/**
 * タスク定義をコマンドパレットに同期する。
 * tasks ストア (データ) と taskRunner (実行) の橋渡しを leaf 側で行い、
 * ストア間の循環依存を避ける。useDeckInit から 1 回呼ぶ。
 */
export function startTaskCommandSync(): void {
  if (started) return
  started = true
  const tasksStore = useTasksStore()
  watch(() => tasksStore.definitions, syncCommands, {
    deep: true,
    immediate: true,
  })
}
