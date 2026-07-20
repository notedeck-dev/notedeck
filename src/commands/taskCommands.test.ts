import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

vi.mock('@/stores/tasks', () => ({ useTasksStore: vi.fn() }))
vi.mock('@/stores/taskRunner', () => ({ useTaskRunnerStore: vi.fn() }))

import { useTaskRunnerStore } from '@/stores/taskRunner'
import { useTasksStore } from '@/stores/tasks'
import { useCommandStore } from './registry'
import { startTaskCommandSync } from './taskCommands'

// startTaskCommandSync はモジュールスコープの started フラグを持つため、
// 1 つの pinia / 1 回の起動でシナリオを通しで検証する。
setActivePinia(createPinia())

const tasksState = reactive({
  definitions: [{ id: 'build', label: 'Build' }] as {
    id: string
    label: string
  }[],
})
const runTask = vi.fn(async () => undefined)

vi.mocked(useTasksStore).mockReturnValue(tasksState as never)
vi.mocked(useTaskRunnerStore).mockReturnValue({ runTask } as never)

describe('startTaskCommandSync', () => {
  it('registers task commands immediately and keeps them in sync with definitions', async () => {
    const store = useCommandStore()
    startTaskCommandSync()

    // immediate sync
    const cmd = store.commands.get('task.build')
    expect(cmd).toBeDefined()
    expect(cmd?.label).toBe('タスク: Build')

    // execute delegates to the task runner
    store.execute('task.build')
    expect(runTask).toHaveBeenCalledWith('build')

    // definitions change → old command removed, new one registered
    tasksState.definitions = [{ id: 'deploy', label: 'Deploy' }]
    await nextTick()
    expect(store.commands.get('task.build')).toBeUndefined()
    expect(store.commands.get('task.deploy')?.label).toBe('タスク: Deploy')
  })

  it('is idempotent: calling again does not re-register or duplicate watchers', async () => {
    const store = useCommandStore()
    const spy = vi.spyOn(store, 'register')
    startTaskCommandSync()
    expect(spy).not.toHaveBeenCalled()

    // 既存 watcher は引き続き 1 本だけ動く (変更 1 回 = 定義ぶんの register 1 回)
    tasksState.definitions = [{ id: 'test', label: 'Test' }]
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(store.commands.get('task.test')).toBeDefined()
  })
})
