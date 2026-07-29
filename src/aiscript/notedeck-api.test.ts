import { utils, values } from '@syuilo/aiscript'
import type { Value } from '@syuilo/aiscript/interpreter/value.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _clearCapabilitiesForTest,
  registerCapability,
} from '@/capabilities/registry'
import type { Command, useCommandStore } from '@/commands/registry'
import { setPermissionPreset } from '@/permissions/schema'
import { usePermissionsConfig } from '@/permissions/store'
import * as eventsModule from './events'
import {
  cleanupNoteDeckEnv,
  createNoteDeckEnv,
  type NoteDeckEnvContext,
} from './notedeck-api'

vi.mock('./events', async () => {
  const actual = await vi.importActual<typeof import('./events')>('./events')
  return {
    ...actual,
    subscribeNoteDeckEvent: vi.fn(),
  }
})

// Note: 本テストは「Nd:register_command が options を Command にどう乗せるか」と
// 「Nd:call / Nd:capabilities が dispatcher / registry を正しく呼ぶか」を検証する。
// AiScript インタプリタ経由の execute 挙動は実機 / E2E で確認する。

function makeFakeStores(): {
  ctx: NoteDeckEnvContext
  register: ReturnType<typeof vi.fn>
  unregister: ReturnType<typeof vi.fn>
} {
  // 衝突検出 (先勝ち) を検証するため、登録済み Map を持つ実体に寄せる
  const registered = new Map<string, unknown>()
  const register = vi.fn((cmd: { id: string }) => {
    registered.set(cmd.id, cmd)
  })
  const unregister = vi.fn((id: string) => {
    registered.delete(id)
  })
  const commandStore = {
    register,
    unregister,
    commands: registered,
  } as unknown as ReturnType<typeof useCommandStore>
  // dispatcher は useAiConfig() singleton から権限を解決する。既定は full で
  // permission gate を通し、拒否系テストだけ setPresetForTest で絞る。
  setPresetForTest('full')
  return {
    ctx: {
      commandStore,
      principal: { kind: 'plugin', pluginId: 'test-plugin' } as const,
      provider: 'acme.clock',
      disposers: [],
    },
    register,
    unregister,
  }
}

function setPresetForTest(preset: 'readonly' | 'safe' | 'full'): void {
  // Nd:call は env 構築時の principal (= plugin) プロファイルで enforce される
  const { file } = usePermissionsConfig()
  file.value.principals.plugin = setPermissionPreset(
    file.value.principals.plugin ?? {
      preset: 'readonly',
      custom: {} as never,
    },
    preset,
  )
}

function makeCapability(overrides: Partial<Command> = {}): Command {
  return {
    id: 'test.cap',
    label: 'test',
    icon: 'ti-flask',
    category: 'general',
    shortcuts: [],
    aiTool: true,
    permissions: [],
    signature: { description: 'test capability' },
    execute: () => 'ok',
    ...overrides,
  }
}

const noop = () => {
  // AiScript の AbortHandler 系コールバック用ダミー
}

const nativeOpts = {
  call: () => Promise.resolve(values.NULL),
  topCall: () => Promise.resolve(values.NULL),
  registerAbortHandler: noop,
  registerPauseHandler: noop,
  registerUnpauseHandler: noop,
  unregisterAbortHandler: noop,
  unregisterPauseHandler: noop,
  unregisterUnpauseHandler: noop,
}

/** Nd:* native fn を呼ぶ汎用ヘルパ */
async function callNative(
  env: Record<string, Value>,
  name: string,
  args: (Value | undefined)[],
): Promise<Value> {
  const fn = env[name]
  if (!fn || fn.type !== 'fn' || !fn.native) {
    throw new Error(`${name} is not a native fn`)
  }
  // biome-ignore lint/suspicious/noExplicitAny: AiScript の native opts は run-time に大量のコールバックを持つ
  const result = await fn.native(args, nativeOpts as any)
  return result ?? values.NULL
}

/** `Nd:register_command` を呼ぶショートカット (戻り値不要) */
async function callRegisterCommand(
  env: Record<string, Value>,
  args: (Value | undefined)[],
): Promise<void> {
  await callNative(env, 'Nd:register_command', args)
}

/** register モックの n 回目に渡された Command を取り出す */
function nthCommand(
  register: ReturnType<typeof vi.fn>,
  index: number,
): Command {
  const call = register.mock.calls[index]
  if (!call) throw new Error(`register was not called ${index + 1} times`)
  return call[0] as Command
}

const dummyHandler = values.FN_NATIVE(() => values.NULL)

describe('Nd:register_command (4-arg legacy form)', () => {
  let env: Record<string, Value>
  let register: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const stores = makeFakeStores()
    env = createNoteDeckEnv(stores.ctx)
    register = stores.register
  })

  it('registers a UI-only command without capability fields', async () => {
    await callRegisterCommand(env, [
      values.STR('greet'),
      values.STR('Greet'),
      values.STR('ti-hand'),
      dummyHandler,
    ])
    expect(register).toHaveBeenCalledTimes(1)
    const cmd = nthCommand(register, 0)
    expect(cmd.id).toBe('acme.clock:greet')
    expect(cmd.label).toBe('Greet')
    expect(cmd.icon).toBe('ti-hand')
    expect(cmd.category).toBe('general')
    expect(cmd.aiTool).toBeUndefined()
    expect(cmd.signature).toBeUndefined()
    expect(cmd.permissions).toBeUndefined()
    expect(cmd.requiresConfirmation).toBeUndefined()
  })
})

describe('Nd:register_command (5-arg with options)', () => {
  let env: Record<string, Value>
  let register: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const stores = makeFakeStores()
    env = createNoteDeckEnv(stores.ctx)
    register = stores.register
  })

  it('forwards aiTool/signature/permissions/requiresConfirmation to commandStore', async () => {
    const options = utils.jsToVal({
      aiTool: true,
      permissions: ['notes.write.post'],
      requiresConfirmation: true,
      signature: {
        description: 'Reverse the input string',
        params: {
          text: {
            type: 'string',
            description: 'Input text',
          },
        },
        returns: { type: 'string', description: 'Reversed text' },
        cheap: true,
      },
    })
    await callRegisterCommand(env, [
      values.STR('reverse'),
      values.STR('Reverse'),
      values.STR('ti-arrow-back'),
      dummyHandler,
      options,
    ])
    expect(register).toHaveBeenCalledTimes(1)
    const cmd = nthCommand(register, 0)
    expect(cmd.aiTool).toBe(true)
    expect(cmd.permissions).toEqual(['notes.write.post'])
    expect(cmd.requiresConfirmation).toBe(true)
    expect(cmd.signature?.description).toBe('Reverse the input string')
    expect(cmd.signature?.params?.text?.type).toBe('string')
    expect(cmd.signature?.returns?.type).toBe('string')
    expect(cmd.signature?.cheap).toBe(true)
  })

  it('keeps aiTool false when omitted, even if signature is present', async () => {
    const options = utils.jsToVal({
      signature: { description: 'no ai exposure' },
    })
    await callRegisterCommand(env, [
      values.STR('local-only'),
      values.STR('Local'),
      values.STR('ti-home'),
      dummyHandler,
      options,
    ])
    const cmd = nthCommand(register, 0)
    expect(cmd.aiTool).toBeUndefined()
    expect(cmd.signature?.description).toBe('no ai exposure')
  })

  it('drops non-string entries from permissions array', async () => {
    const options = utils.jsToVal({
      aiTool: true,
      permissions: ['notes.read', 123, null, 'notifications.read'],
      signature: { description: 'mixed perms' },
    })
    await callRegisterCommand(env, [
      values.STR('mixed'),
      values.STR('Mixed'),
      values.STR('ti-filter'),
      dummyHandler,
      options,
    ])
    const cmd = nthCommand(register, 0)
    expect(cmd.permissions).toEqual(['notes.read', 'notifications.read'])
  })

  it('ignores a non-object options argument', async () => {
    await callRegisterCommand(env, [
      values.STR('plain'),
      values.STR('Plain'),
      values.STR('ti-dot'),
      dummyHandler,
      values.STR('not-an-object'),
    ])
    const cmd = nthCommand(register, 0)
    expect(cmd.aiTool).toBeUndefined()
    expect(cmd.signature).toBeUndefined()
  })
})

describe('Nd:call', () => {
  beforeEach(() => {
    _clearCapabilitiesForTest()
  })

  afterEach(() => {
    _clearCapabilitiesForTest()
  })

  it('returns the capability result when permissions are satisfied', async () => {
    registerCapability(makeCapability({ id: 'demo.echo', execute: () => 42 }))
    const stores = makeFakeStores()
    const env = createNoteDeckEnv(stores.ctx)
    const result = await callNative(env, 'Nd:call', [values.STR('demo.echo')])
    expect(utils.valToJs(result)).toBe(42)
  })

  it('passes params from AiScript obj to the capability execute', async () => {
    const execute = vi.fn().mockReturnValue('ok')
    registerCapability(makeCapability({ id: 'demo.with-params', execute }))
    const stores = makeFakeStores()
    const env = createNoteDeckEnv(stores.ctx)
    await callNative(env, 'Nd:call', [
      values.STR('demo.with-params'),
      utils.jsToVal({ q: 'AI', limit: 5 }),
    ])
    expect(execute).toHaveBeenCalledWith(
      { q: 'AI', limit: 5 },
      expect.objectContaining({ aiConfig: expect.any(Object) }),
    )
  })

  it('throws with unknown_capability when id is not registered', async () => {
    const stores = makeFakeStores()
    const env = createNoteDeckEnv(stores.ctx)
    await expect(
      callNative(env, 'Nd:call', [values.STR('nope.nope')]),
    ).rejects.toThrow(/unknown_capability/)
  })

  it('throws with permission_denied when readonly preset disallows the cap', async () => {
    registerCapability(
      makeCapability({
        id: 'demo.write',
        permissions: ['notes.write'],
        execute: () => 'should not run',
      }),
    )
    const stores = makeFakeStores()
    setPresetForTest('readonly')
    const env = createNoteDeckEnv(stores.ctx)
    await expect(
      callNative(env, 'Nd:call', [values.STR('demo.write')]),
    ).rejects.toThrow(/permission_denied/)
  })

  it('Nd:http は plugin の network.external gate に従う — OFF で送出不能 (#712 PR 1d)', async () => {
    // secret exfiltration 経路の封鎖: 直 invoke ではなく dispatcher を通るため
    // plugin プロファイルの network.external=false で送出前に拒否される
    registerCapability(
      makeCapability({
        id: 'http.fetch',
        permissions: ['network.external'],
        execute: () => ({ status: 200, headers: {}, body: 'should not run' }),
      }),
    )
    const stores = makeFakeStores()
    setPresetForTest('readonly') // network.external = false
    const env = createNoteDeckEnv(stores.ctx)
    await expect(
      callNative(env, 'Nd:http', [values.STR('https://evil.example.com')]),
    ).rejects.toThrow(/permission_denied/)
  })

  it('chat プロファイルを緩めても plugin は緩まない (#712 PR 1c 分離)', async () => {
    registerCapability(
      makeCapability({
        id: 'demo.write',
        permissions: ['notes.write'],
        execute: () => 'should not run',
      }),
    )
    const stores = makeFakeStores()
    setPresetForTest('readonly') // plugin = readonly
    const { file } = usePermissionsConfig()
    file.value.principals['ai.chat'] = setPermissionPreset(
      file.value.principals['ai.chat'] ?? {
        preset: 'readonly',
        custom: {} as never,
      },
      'full',
    )
    const env = createNoteDeckEnv(stores.ctx)
    await expect(
      callNative(env, 'Nd:call', [values.STR('demo.write')]),
    ).rejects.toThrow(/permission_denied/)
  })
})

describe('Nd:capabilities', () => {
  beforeEach(() => {
    _clearCapabilitiesForTest()
  })

  afterEach(() => {
    _clearCapabilitiesForTest()
  })

  it('returns an empty array when the registry is empty', async () => {
    const stores = makeFakeStores()
    const env = createNoteDeckEnv(stores.ctx)
    const result = await callNative(env, 'Nd:capabilities', [])
    expect(utils.valToJs(result)).toEqual([])
  })

  it('exposes id / description / permissions / requiresConfirmation for each capability', async () => {
    registerCapability(
      makeCapability({
        id: 'demo.list',
        label: 'List',
        permissions: ['notes.read'],
        signature: {
          description: 'list things',
          params: { q: { type: 'string', description: 'query' } },
          returns: { type: 'array', description: 'matches' },
        },
        requiresConfirmation: true,
      }),
    )
    const stores = makeFakeStores()
    const env = createNoteDeckEnv(stores.ctx)
    const result = await callNative(env, 'Nd:capabilities', [])
    const arr = utils.valToJs(result) as Array<Record<string, unknown>>
    expect(arr).toHaveLength(1)
    expect(arr[0]).toMatchObject({
      id: 'demo.list',
      label: 'List',
      description: 'list things',
      permissions: ['notes.read'],
      requiresConfirmation: true,
    })
  })
})

describe('Nd:on', () => {
  const subscribeMock = vi.mocked(eventsModule.subscribeNoteDeckEvent)

  beforeEach(() => {
    subscribeMock.mockReset()
  })

  it('throws on an unsupported event name', async () => {
    const stores = makeFakeStores()
    const env = createNoteDeckEnv(stores.ctx)
    await expect(
      callNative(env, 'Nd:on', [values.STR('mystery:event'), dummyHandler]),
    ).rejects.toThrow(/unsupported event/)
  })

  it('passes the event name to subscribeNoteDeckEvent and pushes unsubscribe', async () => {
    const unsub = vi.fn()
    subscribeMock.mockReturnValue(unsub)
    const stores = makeFakeStores()
    const env = createNoteDeckEnv(stores.ctx)
    await callNative(env, 'Nd:on', [values.STR('column:added'), dummyHandler])
    expect(subscribeMock).toHaveBeenCalledTimes(1)
    expect(subscribeMock.mock.calls[0]?.[0]).toBe('column:added')
    expect(stores.ctx.disposers).toHaveLength(1)
  })

  it('returns an AiScript fn that, when called, unsubscribes', async () => {
    const unsub = vi.fn()
    subscribeMock.mockReturnValue(unsub)
    const stores = makeFakeStores()
    const env = createNoteDeckEnv(stores.ctx)
    const result = await callNative(env, 'Nd:on', [
      values.STR('account:switch'),
      dummyHandler,
    ])
    expect(result.type).toBe('fn')
    if (result.type !== 'fn' || !result.native) {
      throw new Error('expected native fn')
    }
    // biome-ignore lint/suspicious/noExplicitAny: AiScript の native opts は run-time に大量のコールバックを持つ
    await result.native([], nativeOpts as any)
    expect(unsub).toHaveBeenCalledTimes(1)
    expect(stores.ctx.disposers).toHaveLength(0)
  })
})

describe('cleanupNoteDeckEnv', () => {
  it('unregisters every command registered through Nd:register_command', async () => {
    const stores = makeFakeStores()
    const env = createNoteDeckEnv(stores.ctx)
    await callRegisterCommand(env, [
      values.STR('a'),
      values.STR('A'),
      values.STR('ti-a'),
      dummyHandler,
    ])
    await callRegisterCommand(env, [
      values.STR('b'),
      values.STR('B'),
      values.STR('ti-b'),
      dummyHandler,
    ])
    expect(stores.ctx.disposers).toHaveLength(2)
    cleanupNoteDeckEnv(stores.ctx)
    expect(stores.unregister).toHaveBeenCalledTimes(2)
    expect(stores.unregister).toHaveBeenNthCalledWith(1, 'acme.clock:a')
    expect(stores.unregister).toHaveBeenNthCalledWith(2, 'acme.clock:b')
    expect(stores.ctx.disposers).toEqual([])
  })

  it('unsubscribes every active Nd:on subscription', async () => {
    const subscribeMock = vi.mocked(eventsModule.subscribeNoteDeckEvent)
    subscribeMock.mockReset()
    const unsubA = vi.fn()
    const unsubB = vi.fn()
    subscribeMock.mockReturnValueOnce(unsubA).mockReturnValueOnce(unsubB)
    const stores = makeFakeStores()
    const env = createNoteDeckEnv(stores.ctx)
    await callNative(env, 'Nd:on', [values.STR('column:added'), dummyHandler])
    await callNative(env, 'Nd:on', [
      values.STR('streaming:status'),
      dummyHandler,
    ])
    expect(stores.ctx.disposers).toHaveLength(2)
    cleanupNoteDeckEnv(stores.ctx)
    expect(unsubA).toHaveBeenCalledTimes(1)
    expect(unsubB).toHaveBeenCalledTimes(1)
    expect(stores.ctx.disposers).toEqual([])
  })
})

describe('登録解除の規約 — disposers 一本化 (#794 原則 5)', () => {
  it('登録種別に関係なく cleanupNoteDeckEnv が一括解除する', () => {
    const stores = makeFakeStores()
    const order: string[] = []
    stores.ctx.disposers.push(() => order.push('a'))
    stores.ctx.disposers.push(() => order.push('b'))

    cleanupNoteDeckEnv(stores.ctx)

    expect(order).toEqual(['a', 'b'])
    expect(stores.ctx.disposers).toEqual([])
  })

  it('1 つの disposer が throw しても残りは解除される', () => {
    const stores = makeFakeStores()
    const after = vi.fn()
    stores.ctx.disposers.push(() => {
      throw new Error('boom')
    })
    stores.ctx.disposers.push(after)

    expect(() => cleanupNoteDeckEnv(stores.ctx)).not.toThrow()
    expect(after).toHaveBeenCalledTimes(1)
    expect(stores.ctx.disposers).toEqual([])
  })

  it('二重 cleanup は安全 (プラグイン停止が二度走っても壊れない)', () => {
    const stores = makeFakeStores()
    const dispose = vi.fn()
    stores.ctx.disposers.push(dispose)

    cleanupNoteDeckEnv(stores.ctx)
    cleanupNoteDeckEnv(stores.ctx)

    expect(dispose).toHaveBeenCalledTimes(1)
  })
})

describe('登録 ID は provider 名前空間 (#794 未決事項 2)', () => {
  it('コマンド ID が <provider>:<localName> になる', async () => {
    const stores = makeFakeStores()
    const env = createNoteDeckEnv(stores.ctx)
    await callRegisterCommand(env, [
      values.STR('greet'),
      values.STR('G'),
      values.STR('ti-g'),
      dummyHandler,
    ])
    expect(stores.register.mock.calls[0]?.[0]?.id).toBe('acme.clock:greet')
  })

  it('同一 ID の二重登録は先勝ちで拒否する', async () => {
    const stores = makeFakeStores()
    const env = createNoteDeckEnv(stores.ctx)
    const args = [
      values.STR('greet'),
      values.STR('G'),
      values.STR('ti-g'),
      dummyHandler,
    ]
    await callRegisterCommand(env, args)
    await expect(callRegisterCommand(env, args)).rejects.toThrow(
      /already registered/,
    )
    expect(stores.register).toHaveBeenCalledTimes(1)
  })

  it('provider が違えば同じ名前でも衝突しない', async () => {
    const a = makeFakeStores()
    const b = makeFakeStores()
    b.ctx.provider = 'other.plugin'
    await callRegisterCommand(createNoteDeckEnv(a.ctx), [
      values.STR('greet'),
      values.STR('G'),
      values.STR('ti-g'),
      dummyHandler,
    ])
    await callRegisterCommand(createNoteDeckEnv(b.ctx), [
      values.STR('greet'),
      values.STR('G'),
      values.STR('ti-g'),
      dummyHandler,
    ])
    expect(a.register.mock.calls[0]?.[0]?.id).toBe('acme.clock:greet')
    expect(b.register.mock.calls[0]?.[0]?.id).toBe('other.plugin:greet')
  })
})
