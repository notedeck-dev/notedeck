import JSON5 from 'json5'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import defaultTasksJson5 from '@/defaults/tasks.json5?raw'
import { useToast } from '@/stores/toast'
import { parseTasks, TasksParseError } from '@/tasks/schema'
import { TASKS_FILE_VERSION, type TaskDefinition } from '@/tasks/types'
import { createDebouncedPersist } from '@/utils/debouncedPersist'
import { isTauri, readTasks, writeTasks } from '@/utils/settingsFs'

export const useTasksStore = defineStore('tasks', () => {
  const definitions = ref<TaskDefinition[]>([])
  const initialized = ref(false)
  const lastError = ref<string | null>(null)

  const { schedule: schedulePersist } = createDebouncedPersist(persist, {
    onError: (e) => console.warn('[tasks] persist failed:', e),
  })

  async function persist(): Promise<void> {
    if (!isTauri) return
    const payload = {
      version: TASKS_FILE_VERSION,
      tasks: definitions.value,
    }
    const content = JSON5.stringify(payload, null, 2)
    await writeTasks(`${content}\n`)
  }

  function setFromRaw(raw: string): void {
    try {
      const parsed = parseTasks(raw)
      definitions.value = parsed.tasks
      lastError.value = null
    } catch (e) {
      definitions.value = []
      const msg =
        e instanceof TasksParseError ? e.message : String((e as Error).message)
      lastError.value = msg
      useToast().show(`tasks.json5: ${msg}`, 'error')
      console.warn('[tasks] parse failed:', e)
    }
  }

  function peekVersion(raw: string): number | null {
    try {
      const d = JSON5.parse(raw)
      if (d && typeof d === 'object' && !Array.isArray(d)) {
        const v = (d as Record<string, unknown>).version
        return typeof v === 'number' ? v : null
      }
    } catch {
      return null
    }
    return null
  }

  async function init(): Promise<void> {
    if (isTauri) {
      try {
        const content = await readTasks()
        if (!content.trim()) {
          // First-run seed: write defaults so the file exists to edit
          await writeTasks(defaultTasksJson5).catch((e) =>
            console.warn('[tasks] seed failed:', e),
          )
          setFromRaw(defaultTasksJson5)
        } else {
          const sourceVersion = peekVersion(content)
          setFromRaw(content)
          if (
            sourceVersion !== null &&
            sourceVersion !== TASKS_FILE_VERSION &&
            lastError.value === null
          ) {
            await persist().catch((e) =>
              console.warn('[tasks] migration write failed:', e),
            )
          }
        }
      } catch (e) {
        console.warn('[tasks] read failed:', e)
      }
    } else {
      setFromRaw(defaultTasksJson5)
    }
    initialized.value = true
  }

  function getById(id: string): TaskDefinition | undefined {
    return definitions.value.find((t) => t.id === id)
  }

  function upsert(def: TaskDefinition): void {
    const idx = definitions.value.findIndex((t) => t.id === def.id)
    if (idx >= 0) {
      definitions.value[idx] = def
    } else {
      definitions.value.push(def)
    }
    schedulePersist()
  }

  function remove(id: string): void {
    definitions.value = definitions.value.filter((t) => t.id !== id)
    schedulePersist()
  }

  return {
    definitions,
    initialized,
    lastError,
    init,
    setFromRaw,
    getById,
    upsert,
    remove,
  }
})
