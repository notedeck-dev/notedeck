import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPermissionPreset } from '@/permissions/schema'
import {
  _resetPermissionsForTest,
  usePermissionsConfig,
} from '@/permissions/store'
import { TASKS_BUILTIN_CAPABILITIES, tasksRunCapability } from './tasks'

// Note: 実 Pinia store / TaskRunner 呼び出しは ユニットテストでは
// 検証しない (Tauri / Misskey API 依存)。本テストは capability
// 定義の正しさ + 入力検証 (params validation) のみ。
// 実挙動は手動の統合テスト (DeckTaskRunnerColumn の AI トリガー) で確認。

describe('tasks.run capability', () => {
  it('declares tasks.run permission and aiTool: true', () => {
    expect(tasksRunCapability.permissions).toEqual(['tasks.run'])
    expect(tasksRunCapability.aiTool).toBe(true)
    expect(tasksRunCapability.id).toBe('tasks.run')
    expect(tasksRunCapability.signature?.returns?.type).toBe('object')
  })

  it('marks taskId as required and inputs as optional', () => {
    const params = tasksRunCapability.signature?.params
    expect(params?.taskId?.optional).not.toBe(true)
    expect(params?.inputs?.optional).toBe(true)
  })

  it('throws when taskId is missing or blank', async () => {
    await expect(tasksRunCapability.execute({})).rejects.toThrow(
      /taskId is required/,
    )
    await expect(tasksRunCapability.execute({ taskId: '   ' })).rejects.toThrow(
      /taskId is required/,
    )
  })

  it('is hidden from command palette (visible: false)', () => {
    // タスクは TaskRunner カラムから run するもので、コマンドパレット経由
    // で実行する想定はない (= 重複 UI を避ける)
    expect(tasksRunCapability.visible).toBe(false)
  })
})

describe('TASKS_BUILTIN_CAPABILITIES export', () => {
  it('exposes tasksRunCapability for registry registration', () => {
    expect(TASKS_BUILTIN_CAPABILITIES).toContain(tasksRunCapability)
  })
})

// --- endpoint 別検査 (#1099 段階 D) ---
// tasks.run を持っていても、task の action が叩く endpoint の権限キーを
// 呼び出し元 principal が持たなければ実行しない。

vi.mock('@/stores/tasks', () => ({
  useTasksStore: () => ({
    getById: (id: string) =>
      id === 'post-hello'
        ? {
            id,
            label: 'hello',
            action: { type: 'api', method: 'notes/create' },
          }
        : id === 'whoami'
          ? { id, label: 'me', action: { type: 'api', method: 'i' } }
          : undefined,
  }),
}))

const runTask = vi.fn(async (taskId: string) => ({
  id: 1,
  taskId,
  status: 'ok' as const,
  response: null,
  error: undefined,
}))
vi.mock('@/stores/taskRunner', () => ({
  useTaskRunnerStore: () => ({ runTask }),
}))

describe('tasks.run は action の endpoint を呼び出し元の権限で検査する (#1099)', () => {
  beforeEach(() => {
    runTask.mockClear()
    const { file } = usePermissionsConfig()
    file.value.principals['ai.chat'] = setPermissionPreset(
      file.value.principals['ai.chat'] ?? {
        preset: 'readonly',
        custom: {} as never,
      },
      'safe',
    )
  })
  afterEach(() => _resetPermissionsForTest())

  it('ai.chat=safe は notes/create を叩くタスクを起動できない', async () => {
    await expect(
      tasksRunCapability.execute(
        { taskId: 'post-hello' },
        { principal: { kind: 'ai.chat' } },
      ),
    ).rejects.toThrow(/tasks\.run: permission_denied.*notes\.write/)
    expect(runTask).not.toHaveBeenCalled()
  })

  it('ai.chat=safe でも read 系 endpoint のタスクは起動できる', async () => {
    await expect(
      tasksRunCapability.execute(
        { taskId: 'whoami' },
        { principal: { kind: 'ai.chat' } },
      ),
    ).resolves.toMatchObject({ status: 'ok' })
    expect(runTask).toHaveBeenCalledWith('whoami', undefined)
  })

  it('呼び出し元の連鎖 (onBehalfOf) も検査する', async () => {
    // 実行体は full でも、上流の ai.chat (safe) に notes.write が無ければ起動しない
    const { file } = usePermissionsConfig()
    file.value.principals.scratchpad = setPermissionPreset(
      file.value.principals.scratchpad ?? {
        preset: 'readonly',
        custom: {} as never,
      },
      'full',
    )
    await expect(
      tasksRunCapability.execute(
        { taskId: 'post-hello' },
        {
          principal: { kind: 'scratchpad' },
          onBehalfOf: [{ kind: 'ai.chat' }],
        },
      ),
    ).rejects.toThrow(/tasks\.run: permission_denied.*notes\.write/)
    expect(runTask).not.toHaveBeenCalled()
  })

  it('本人の UI 操作 (ctx なし) は検査しない', async () => {
    await expect(
      tasksRunCapability.execute({ taskId: 'post-hello' }),
    ).resolves.toMatchObject({ status: 'ok' })
  })
})
