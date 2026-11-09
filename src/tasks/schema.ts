import JSON5 from 'json5'

import { stringifyJson5 } from '@/services/json5Document'
import {
  TASKS_FILE_VERSION,
  type TaskAction,
  type TaskDefinition,
  type TaskInput,
  type TaskPresentation,
  type TasksFile,
} from './types'

export class TasksParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TasksParseError'
  }
}

const SUPPORTED_VERSIONS = [1, 2] as const
const ICON_NAME_RE = /^[a-z0-9][a-z0-9-]*$/

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseInput(raw: unknown, path: string): TaskInput {
  if (!isObj(raw)) throw new TasksParseError(`${path}: must be an object`)
  const id = raw.id
  const type = raw.type
  const prompt = raw.prompt
  if (typeof id !== 'string' || !id)
    throw new TasksParseError(`${path}.id: non-empty string required`)
  if (typeof prompt !== 'string')
    throw new TasksParseError(`${path}.prompt: string required`)
  if (type === 'text') {
    const def = raw.default
    return {
      id,
      type: 'text',
      prompt,
      ...(typeof def === 'string' ? { default: def } : {}),
    }
  }
  if (type === 'pick') {
    const options = raw.options
    if (!Array.isArray(options) || options.some((o) => typeof o !== 'string'))
      throw new TasksParseError(`${path}.options: string[] required`)
    const def = raw.default
    return {
      id,
      type: 'pick',
      prompt,
      options: options as string[],
      ...(typeof def === 'string' ? { default: def } : {}),
    }
  }
  throw new TasksParseError(`${path}.type: must be 'text' or 'pick'`)
}

function parseAction(raw: unknown, path: string): TaskAction {
  if (!isObj(raw)) throw new TasksParseError(`${path}: must be an object`)
  if (raw.type !== 'api')
    throw new TasksParseError(`${path}.type: only 'api' is supported`)
  const method = raw.method
  if (typeof method !== 'string' || !method)
    throw new TasksParseError(`${path}.method: non-empty string required`)
  const params = raw.params
  if (params !== undefined && !isObj(params))
    throw new TasksParseError(`${path}.params: must be an object`)
  return {
    type: 'api',
    method,
    ...(isObj(params) ? { params } : {}),
  }
}

function parsePresentation(
  raw: unknown,
  path: string,
): TaskPresentation | undefined {
  if (raw === undefined) return undefined
  if (!isObj(raw)) throw new TasksParseError(`${path}: must be an object`)
  const out: TaskPresentation = {}
  for (const key of ['revealOnRun', 'clearHistoryOnRun'] as const) {
    const v = raw[key]
    if (v === undefined) continue
    if (typeof v !== 'boolean')
      throw new TasksParseError(`${path}.${key}: boolean required`)
    out[key] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseTask(raw: unknown, path: string): TaskDefinition {
  if (!isObj(raw)) throw new TasksParseError(`${path}: must be an object`)
  const id = raw.id
  const label = raw.label
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id))
    throw new TasksParseError(
      `${path}.id: non-empty string matching /^[\\w-]+$/ required`,
    )
  if (typeof label !== 'string' || !label)
    throw new TasksParseError(`${path}.label: non-empty string required`)

  const inputs = raw.inputs
  const parsedInputs =
    inputs === undefined
      ? undefined
      : Array.isArray(inputs)
        ? inputs.map((v, i) => parseInput(v, `${path}.inputs[${i}]`))
        : (() => {
            throw new TasksParseError(`${path}.inputs: must be an array`)
          })()

  const action = parseAction(raw.action, `${path}.action`)
  const accountId = raw.accountId
  const description = raw.description
  const detail = raw.detail
  const icon = raw.icon
  const group = raw.group
  const isDefault = raw.isDefault
  const pinned = raw.pinned
  const presentation = parsePresentation(
    raw.presentation,
    `${path}.presentation`,
  )

  if (detail !== undefined && typeof detail !== 'string')
    throw new TasksParseError(`${path}.detail: string required`)
  if (icon !== undefined) {
    if (typeof icon !== 'string' || !ICON_NAME_RE.test(icon))
      throw new TasksParseError(
        `${path}.icon: non-empty kebab-case string required (e.g. 'player-play')`,
      )
  }
  if (group !== undefined && typeof group !== 'string')
    throw new TasksParseError(`${path}.group: string required`)
  if (isDefault !== undefined && typeof isDefault !== 'boolean')
    throw new TasksParseError(`${path}.isDefault: boolean required`)
  if (pinned !== undefined && typeof pinned !== 'boolean')
    throw new TasksParseError(`${path}.pinned: boolean required`)

  const normalizedGroup =
    typeof group === 'string' && group.trim() ? group.trim() : undefined

  const def: TaskDefinition = {
    id,
    label,
    action,
    ...(typeof description === 'string' ? { description } : {}),
    ...(typeof detail === 'string' && detail ? { detail } : {}),
    ...(typeof icon === 'string' ? { icon } : {}),
    ...(normalizedGroup ? { group: normalizedGroup } : {}),
    ...(isDefault === true ? { isDefault: true } : {}),
    ...(pinned === true ? { pinned: true } : {}),
    ...(typeof accountId === 'string' || accountId === null
      ? { accountId }
      : {}),
    ...(parsedInputs ? { inputs: parsedInputs } : {}),
    ...(presentation ? { presentation } : {}),
  }
  return def
}

function enforceSingleDefault(tasks: TaskDefinition[]): TaskDefinition[] {
  let seen = false
  return tasks.map((t) => {
    if (!t.isDefault) return t
    if (seen) {
      console.warn(
        `[tasks] multiple isDefault tasks found; "${t.id}" demoted (only the first wins)`,
      )
      const { isDefault: _isDefault, ...rest } = t
      return rest
    }
    seen = true
    return t
  })
}

export function parseTasks(raw: string): TasksFile {
  const trimmed = raw.trim()
  if (!trimmed) return { version: TASKS_FILE_VERSION, tasks: [] }
  let data: unknown
  try {
    data = JSON5.parse(trimmed)
  } catch (e) {
    throw new TasksParseError(
      `tasks.json5: JSON5 parse error — ${(e as Error).message}`,
    )
  }
  if (!isObj(data))
    throw new TasksParseError('tasks.json5: root must be an object')

  const version = data.version
  if (
    typeof version !== 'number' ||
    !SUPPORTED_VERSIONS.includes(version as (typeof SUPPORTED_VERSIONS)[number])
  )
    throw new TasksParseError(
      `tasks.json5: version must be one of ${SUPPORTED_VERSIONS.join(', ')}`,
    )
  if (version !== TASKS_FILE_VERSION) {
    console.warn(
      `[tasks] upgrading tasks.json5 from v${version} to v${TASKS_FILE_VERSION}`,
    )
  }

  const tasks = data.tasks
  if (!Array.isArray(tasks))
    throw new TasksParseError('tasks.json5: tasks must be an array')
  const parsed = tasks.map((t, i) => parseTask(t, `tasks[${i}]`))
  const seen = new Set<string>()
  for (const t of parsed) {
    if (seen.has(t.id))
      throw new TasksParseError(`tasks.json5: duplicate task id "${t.id}"`)
    seen.add(t.id)
  }
  return {
    version: TASKS_FILE_VERSION,
    tasks: enforceSingleDefault(parsed),
  }
}

/** tasks.json5 の本文 (決定的、#1333 §2)。`version` を先頭に置く */
export function serializeTasks(file: TasksFile): string {
  return stringifyJson5({ version: file.version, tasks: file.tasks })
}
