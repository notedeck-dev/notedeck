import { describe, expect, it, vi } from 'vitest'
import { parseTasks, TasksParseError } from '../schema'
import { TASKS_FILE_VERSION } from '../types'

describe('parseTasks', () => {
  it('empty content yields empty task list', () => {
    expect(parseTasks('')).toEqual({
      version: TASKS_FILE_VERSION,
      tasks: [],
    })
    expect(parseTasks('   \n')).toEqual({
      version: TASKS_FILE_VERSION,
      tasks: [],
    })
  })

  it('accepts a minimal api task', () => {
    const src = `{
      version: ${TASKS_FILE_VERSION},
      tasks: [{
        id: 'post',
        label: '投稿',
        action: { type: 'api', method: 'notes/create' },
      }],
    }`
    const parsed = parseTasks(src)
    expect(parsed.version).toBe(TASKS_FILE_VERSION)
    expect(parsed.tasks).toHaveLength(1)
    expect(parsed.tasks[0]?.id).toBe('post')
    expect(parsed.tasks[0]?.action).toEqual({
      type: 'api',
      method: 'notes/create',
    })
  })

  it('parses text and pick inputs with defaults', () => {
    const src = `{
      version: ${TASKS_FILE_VERSION},
      tasks: [{
        id: 'p', label: 'p',
        inputs: [
          { id: 'body', type: 'text', prompt: '本文', default: 'hello' },
          { id: 'vis', type: 'pick', prompt: '公開範囲',
            options: ['public', 'home'], default: 'home' },
        ],
        action: { type: 'api', method: 'notes/create', params: { text: '\${input:body}' } },
      }],
    }`
    const parsed = parseTasks(src)
    const inputs = parsed.tasks[0]?.inputs
    expect(inputs?.[0]).toMatchObject({ type: 'text', default: 'hello' })
    expect(inputs?.[1]).toMatchObject({
      type: 'pick',
      options: ['public', 'home'],
      default: 'home',
    })
  })

  it('rejects missing version', () => {
    expect(() => parseTasks('{ tasks: [] }')).toThrow(TasksParseError)
  })

  it('rejects unsupported version', () => {
    expect(() => parseTasks('{ version: 99, tasks: [] }')).toThrow(
      /version must be one of/,
    )
  })

  it('rejects non-api action type', () => {
    const src = `{
      version: ${TASKS_FILE_VERSION},
      tasks: [{
        id: 't', label: 't',
        action: { type: 'shell', command: 'ls' },
      }],
    }`
    expect(() => parseTasks(src)).toThrow(/only 'api' is supported/)
  })

  it('rejects duplicate task ids', () => {
    const src = `{
      version: ${TASKS_FILE_VERSION},
      tasks: [
        { id: 'x', label: 'x', action: { type: 'api', method: 'a' } },
        { id: 'x', label: 'y', action: { type: 'api', method: 'b' } },
      ],
    }`
    expect(() => parseTasks(src)).toThrow(/duplicate task id/)
  })

  it('rejects invalid id characters', () => {
    const src = `{
      version: ${TASKS_FILE_VERSION},
      tasks: [{ id: 'bad id!', label: 'x', action: { type: 'api', method: 'a' } }],
    }`
    expect(() => parseTasks(src)).toThrow(/tasks\[0\]\.id/)
  })

  it('reports JSON5 parse errors with context', () => {
    expect(() => parseTasks('{ tasks: ')).toThrow(/JSON5 parse error/)
  })

  it('auto-upgrades a v1 file to the current version', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(vi.fn())
    try {
      const src = `{
        version: 1,
        tasks: [
          { id: 't', label: 't', action: { type: 'api', method: 'i' } },
        ],
      }`
      const parsed = parseTasks(src)
      expect(parsed.version).toBe(TASKS_FILE_VERSION)
      expect(parsed.tasks).toHaveLength(1)
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('parses the new v2 optional fields', () => {
    const src = `{
      version: ${TASKS_FILE_VERSION},
      tasks: [{
        id: 't', label: 't',
        detail: '詳細 1 行',
        icon: 'player-play',
        group: 'Quick Actions',
        isDefault: true,
        pinned: true,
        presentation: { revealOnRun: false, clearHistoryOnRun: true },
        action: { type: 'api', method: 'i' },
      }],
    }`
    const parsed = parseTasks(src)
    expect(parsed.tasks[0]).toMatchObject({
      detail: '詳細 1 行',
      icon: 'player-play',
      group: 'Quick Actions',
      isDefault: true,
      pinned: true,
      presentation: { revealOnRun: false, clearHistoryOnRun: true },
    })
  })

  it('normalizes empty and whitespace-only group to undefined', () => {
    const src = `{
      version: ${TASKS_FILE_VERSION},
      tasks: [
        { id: 'a', label: 'a', group: '', action: { type: 'api', method: 'i' } },
        { id: 'b', label: 'b', group: '   ', action: { type: 'api', method: 'i' } },
        { id: 'c', label: 'c', group: '  Pinned  ', action: { type: 'api', method: 'i' } },
      ],
    }`
    const parsed = parseTasks(src)
    expect(parsed.tasks[0]?.group).toBeUndefined()
    expect(parsed.tasks[1]?.group).toBeUndefined()
    expect(parsed.tasks[2]?.group).toBe('Pinned')
  })

  it('demotes extra isDefault tasks so only the first wins', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(vi.fn())
    try {
      const src = `{
        version: ${TASKS_FILE_VERSION},
        tasks: [
          { id: 'a', label: 'a', isDefault: true, action: { type: 'api', method: 'i' } },
          { id: 'b', label: 'b', isDefault: true, action: { type: 'api', method: 'i' } },
          { id: 'c', label: 'c', isDefault: true, action: { type: 'api', method: 'i' } },
        ],
      }`
      const parsed = parseTasks(src)
      expect(parsed.tasks[0]?.isDefault).toBe(true)
      expect(parsed.tasks[1]?.isDefault).toBeUndefined()
      expect(parsed.tasks[2]?.isDefault).toBeUndefined()
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('rejects invalid icon format', () => {
    const src = `{
      version: ${TASKS_FILE_VERSION},
      tasks: [{
        id: 't', label: 't',
        icon: 'Not A Tabler Name!',
        action: { type: 'api', method: 'i' },
      }],
    }`
    expect(() => parseTasks(src)).toThrow(/icon/)
  })

  it('rejects non-boolean presentation fields', () => {
    const src = `{
      version: ${TASKS_FILE_VERSION},
      tasks: [{
        id: 't', label: 't',
        presentation: { revealOnRun: 'yes' },
        action: { type: 'api', method: 'i' },
      }],
    }`
    expect(() => parseTasks(src)).toThrow(/revealOnRun/)
  })
})
