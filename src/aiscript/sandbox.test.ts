import { Parser, values } from '@syuilo/aiscript'
import type { Value, VFn } from '@syuilo/aiscript/interpreter/value.js'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertMisskeyApiAllowed } from '@/permissions/misskeyApiGate'
import type { Principal } from '@/permissions/principal'
import { commands } from '@/utils/tauriInvoke'
import { createAiScriptSandbox } from './sandbox'

vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    ...actual,
    commands: {
      apiRequest: vi.fn(async () => ({ status: 'ok', data: { ok: true } })),
    },
  }
})

vi.mock('@/permissions/misskeyApiGate', () => ({
  assertMisskeyApiAllowed: vi.fn(async () => undefined),
}))

const pluginPrincipal: Principal = {
  kind: 'plugin',
  pluginId: 'p1',
  name: 'Plugin One',
}

function io() {
  return { onOutput: vi.fn(), onError: vi.fn() }
}

async function callNative(
  env: Record<string, Value>,
  name: string,
  args: Value[],
): Promise<Value> {
  const fn = env[name] as VFn | undefined
  if (fn?.type !== 'fn' || !fn.native) throw new Error(`${name} missing`)
  return (await fn.native(args, {} as never)) ?? values.NULL
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('createAiScriptSandbox', () => {
  it('principal は Mk:api の gate と Nd:* の文脈の両方に 1 回で届く', async () => {
    const sandbox = createAiScriptSandbox({
      principal: pluginPrincipal,
      accountId: 'acc-1',
      io: io(),
    })
    expect(sandbox.ndCtx.principal).toEqual(pluginPrincipal)
    expect(sandbox.ndCtx.provider).toBe('local:p1')
    expect(sandbox.ndCtx.interpreter).toBe(sandbox.interpreter)

    // Mk:api は principal で gate を通り、accountId で apiRequest する
    const result = await callNative(sandbox.env, 'Mk:api', [
      values.STR('notes/show'),
      values.OBJ(new Map()),
    ])
    expect(assertMisskeyApiAllowed).toHaveBeenCalledWith(
      pluginPrincipal,
      'notes/show',
      { onBehalfOf: [] },
    )
    expect(commands.apiRequest).toHaveBeenCalledWith('acc-1', 'notes/show', {})
    expect(result.type).toBe('obj')
  })

  it('storeId があれば登録の名前空間はストア id になる', () => {
    const sandbox = createAiScriptSandbox({
      principal: pluginPrincipal,
      storeId: 'store-x',
      io: io(),
    })
    expect(sandbox.ndCtx.provider).toBe('store-x')
  })

  it('accountId が関数なら Mk:api のたびに評価し、無ければ fail-closed', async () => {
    let current: string | null = null
    const sandbox = createAiScriptSandbox({
      principal: pluginPrincipal,
      accountId: () => current,
      io: io(),
    })
    const args = [values.STR('i'), values.OBJ(new Map())]
    await expect(callNative(sandbox.env, 'Mk:api', args)).rejects.toThrow(
      'no account context',
    )
    current = 'acc-2'
    await callNative(sandbox.env, 'Mk:api', args)
    expect(commands.apiRequest).toHaveBeenCalledWith('acc-2', 'i', {})
    expect(sandbox.ndCtx.getAccountId?.()).toBe('acc-2')
  })

  it('extraEnv は callers を受け取り、Mk:* を上書きできるが Nd:* には上書きされる', () => {
    const extra = vi.fn(() => ({
      'Mk:dialog': values.STR('overridden'),
      'Nd:version': values.STR('stolen'),
      'Plugin:config': values.STR('mine'),
    }))
    const sandbox = createAiScriptSandbox({
      principal: pluginPrincipal,
      io: io(),
      extraEnv: extra,
    })
    expect(extra).toHaveBeenCalledWith({
      principal: pluginPrincipal,
      callers: sandbox.ndCtx.callers,
    })
    expect(sandbox.env['Mk:dialog']).toEqual(values.STR('overridden'))
    expect(sandbox.env['Plugin:config']).toEqual(values.STR('mine'))
    expect(sandbox.env['Nd:version']).not.toEqual(values.STR('stolen'))
  })

  it('ui を渡したときだけ Ui:* が入る', () => {
    const without = createAiScriptSandbox({
      principal: { kind: 'scratchpad' },
      io: io(),
    })
    expect(without.env['Ui:render']).toBeUndefined()
    const withUi = createAiScriptSandbox({
      principal: { kind: 'scratchpad' },
      io: io(),
      ui: { onRender: vi.fn() },
    })
    expect(withUi.env['Ui:render']?.type).toBe('fn')
  })

  it('exec は出力を io に流し、dispose は interpreter を止めて登録を解除する', async () => {
    const out = io()
    const sandbox = createAiScriptSandbox({
      principal: { kind: 'scratchpad' },
      io: out,
    })
    await sandbox.exec(new Parser().parse('<: "hi"'))
    expect(out.onOutput).toHaveBeenCalledTimes(1)
    expect(out.onOutput.mock.calls[0]?.[0]).toContain('hi')

    const disposer = vi.fn()
    sandbox.ndCtx.disposers.push(disposer)
    // aiscript のメソッドは初回 get で own property に束縛されるので、先に触ってから spy する
    void sandbox.interpreter.abort
    const abort = vi.spyOn(sandbox.interpreter, 'abort')
    sandbox.dispose()
    expect(abort).toHaveBeenCalled()
    expect(disposer).toHaveBeenCalled()
  })

  // 本家向けに書かれたプラグインの定型 (`Core:type(res) == "error"` と
  // `res.info.code`) が、そのまま動くこと (#1249)
  it('Mk:api の失敗は止まらず、スクリプトが error 値として見分けられる', async () => {
    vi.mocked(commands.apiRequest).mockResolvedValueOnce({
      status: 'error',
      error: {
        code: 'API',
        apiCode: 'NO_SUCH_NOTE',
        message: 'notes/show: NO_SUCH_NOTE: No such note.',
      },
    } as never)
    const out: string[] = []
    const notices: string[] = []
    const errors: string[] = []
    const sandbox = createAiScriptSandbox({
      principal: pluginPrincipal,
      accountId: 'acc-1',
      io: {
        onOutput: (t) => out.push(t),
        onError: (e) => errors.push(e.message),
        onNotice: (t) => notices.push(t),
      },
    })
    await sandbox.exec(
      new Parser().parse(
        [
          'let res = Mk:api("notes/show", { noteId: "x" })',
          'if Core:type(res) == "error" {',
          '  <: res.name',
          '  <: res.info.code',
          '}',
          '<: "after"',
        ].join('\n'),
      ),
    )
    expect(errors).toEqual([])
    expect(out).toEqual(['request_failed', 'NO_SUCH_NOTE', 'after'])
    expect(notices).toEqual([
      'Mk:api notes/show (NO_SUCH_NOTE): notes/show: NO_SUCH_NOTE: No such note.',
    ])
  })
})
