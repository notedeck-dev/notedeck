import { utils, values } from '@syuilo/aiscript'
import type { Value } from '@syuilo/aiscript/interpreter/value.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertMisskeyApiAllowed } from '@/permissions/misskeyApiGate'
import { openSafeUrl } from '@/utils/url'
import { type AiScriptEnvOptions, createAiScriptEnv } from './api'

vi.mock('@/permissions/misskeyApiGate', () => ({
  assertMisskeyApiAllowed: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/utils/url', async () => {
  const actual =
    await vi.importActual<typeof import('@/utils/url')>('@/utils/url')
  return { ...actual, openSafeUrl: vi.fn(() => Promise.resolve()) }
})

// Note: 本テストは createAiScriptEnv が返す Mk:* native fn の
// 「AiScript 値 ⇄ JS 値の変換」「コールバック / gate への委譲」を検証する。
// onDialog / onConfirm 未指定時の useConfirm フォールバックは UI の責務なので
// 実機で確認する。

const gateMock = vi.mocked(assertMisskeyApiAllowed)
const openSafeUrlMock = vi.mocked(openSafeUrl)

// unit プロジェクトは node 環境のため localStorage を stub する
// (capabilities/builtins/plugins.test.ts と同じ方式)
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
  get length() {
    return storage.size
  },
})

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

/** Mk:* native fn を呼ぶ汎用ヘルパ */
async function callNative(
  env: Record<string, Value>,
  name: string,
  args: (Value | undefined)[],
): Promise<Value> {
  const fn = env[name]
  if (fn?.type !== 'fn' || !fn.native) {
    throw new Error(`${name} is not a native fn`)
  }
  // biome-ignore lint/suspicious/noExplicitAny: AiScript の native opts は run-time に大量のコールバックを持つ
  const result = await fn.native(args, nativeOpts as any)
  return result ?? values.NULL
}

function makeEnv(
  overrides: Partial<AiScriptEnvOptions> = {},
): Record<string, Value> {
  return createAiScriptEnv({ principal: { kind: 'user' }, ...overrides })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('Mk:dialog', () => {
  it('forwards title / text / type to onDialog and returns NULL', async () => {
    const onDialog = vi.fn(() => Promise.resolve())
    const env = makeEnv({ onDialog })
    const result = await callNative(env, 'Mk:dialog', [
      values.STR('Title'),
      values.STR('Body'),
      values.STR('error'),
    ])
    expect(onDialog).toHaveBeenCalledWith('Title', 'Body', 'error')
    expect(result.type).toBe('null')
  })

  it('defaults to empty strings and type "info" when args are not strings', async () => {
    const onDialog = vi.fn(() => Promise.resolve())
    const env = makeEnv({ onDialog })
    await callNative(env, 'Mk:dialog', [undefined, values.NUM(1), undefined])
    expect(onDialog).toHaveBeenCalledWith('', '', 'info')
  })
})

describe('Mk:confirm', () => {
  it('forwards title / text to onConfirm and returns BOOL(true)', async () => {
    const onConfirm = vi.fn(async () => true)
    const env = makeEnv({ onConfirm })
    const result = await callNative(env, 'Mk:confirm', [
      values.STR('OK?'),
      values.STR('really?'),
    ])
    expect(onConfirm).toHaveBeenCalledWith('OK?', 'really?')
    expect(result).toMatchObject({ type: 'bool', value: true })
  })

  it('returns BOOL(false) when onConfirm resolves false', async () => {
    const env = makeEnv({ onConfirm: async () => false })
    const result = await callNative(env, 'Mk:confirm', [
      values.STR('t'),
      values.STR('m'),
    ])
    expect(result).toMatchObject({ type: 'bool', value: false })
  })
})

describe('Mk:api', () => {
  it('throws when options.api is not provided', async () => {
    const env = makeEnv()
    await expect(
      callNative(env, 'Mk:api', [values.STR('notes/show')]),
    ).rejects.toThrow('Mk:api is not available')
  })

  it('passes the gate check, then calls api with converted params and converts the result back', async () => {
    const api = vi.fn(async () => ({ id: 'n1', text: 'hi' }))
    const principal = { kind: 'plugin', pluginId: 'p1' } as const
    const env = makeEnv({ principal, api })
    const result = await callNative(env, 'Mk:api', [
      values.STR('notes/show'),
      utils.jsToVal({ noteId: 'n1' }),
    ])
    expect(gateMock).toHaveBeenCalledWith(principal, 'notes/show')
    expect(api).toHaveBeenCalledWith('notes/show', { noteId: 'n1' })
    expect(utils.valToJs(result)).toEqual({ id: 'n1', text: 'hi' })
  })

  it('treats a non-obj params argument as {}', async () => {
    const api = vi.fn(async () => null)
    const env = makeEnv({ api })
    await callNative(env, 'Mk:api', [values.STR('meta'), values.STR('junk')])
    expect(api).toHaveBeenCalledWith('meta', {})
  })

  it('propagates gate rejection without calling api', async () => {
    gateMock.mockRejectedValueOnce(new Error('permission_denied for "x"'))
    const api = vi.fn(async () => null)
    const env = makeEnv({ api })
    await expect(callNative(env, 'Mk:api', [values.STR('x')])).rejects.toThrow(
      /permission_denied/,
    )
    expect(api).not.toHaveBeenCalled()
  })
})

describe('Mk:save / Mk:load / Mk:remove', () => {
  it('Mk:save writes JSON under the prefixed storage key', async () => {
    const env = makeEnv({ storagePrefix: 'plugin:p1' })
    await callNative(env, 'Mk:save', [
      values.STR('foo'),
      utils.jsToVal({ a: 1 }),
    ])
    expect(localStorage.getItem('nd-aiscript-plugin:p1:foo')).toBe(
      JSON.stringify({ a: 1 }),
    )
  })

  it('Mk:save falls back to the "default" prefix when storagePrefix is omitted', async () => {
    const env = makeEnv()
    await callNative(env, 'Mk:save', [values.STR('k'), values.STR('v')])
    expect(localStorage.getItem('nd-aiscript-default:k')).toBe('"v"')
  })

  it('Mk:save ignores a non-string key', async () => {
    const env = makeEnv()
    await callNative(env, 'Mk:save', [values.NUM(1), values.STR('v')])
    expect(localStorage.length).toBe(0)
  })

  it('Mk:load round-trips a value saved via Mk:save', async () => {
    const env = makeEnv({ storagePrefix: 'plugin:p1' })
    await callNative(env, 'Mk:save', [
      values.STR('foo'),
      utils.jsToVal({ nested: [1, 2] }),
    ])
    const result = await callNative(env, 'Mk:load', [values.STR('foo')])
    expect(utils.valToJs(result)).toEqual({ nested: [1, 2] })
  })

  it('Mk:load returns NULL for a missing key', async () => {
    const env = makeEnv()
    const result = await callNative(env, 'Mk:load', [values.STR('nope')])
    expect(result.type).toBe('null')
  })

  it('Mk:load returns NULL for corrupt JSON', async () => {
    localStorage.setItem('nd-aiscript-default:bad', '{not json')
    const env = makeEnv()
    const result = await callNative(env, 'Mk:load', [values.STR('bad')])
    expect(result.type).toBe('null')
  })

  it('Mk:remove deletes only the prefixed key', async () => {
    localStorage.setItem('nd-aiscript-default:gone', '"x"')
    localStorage.setItem('unrelated', '"y"')
    const env = makeEnv()
    await callNative(env, 'Mk:remove', [values.STR('gone')])
    expect(localStorage.getItem('nd-aiscript-default:gone')).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('"y"')
  })
})

describe('Mk:toast', () => {
  it('forwards text / type to onToast', async () => {
    const onToast = vi.fn()
    const env = makeEnv({ onToast })
    await callNative(env, 'Mk:toast', [
      values.STR('done'),
      values.STR('success'),
    ])
    expect(onToast).toHaveBeenCalledWith('done', 'success')
  })

  it('defaults type to "info" and does not throw without onToast', async () => {
    const onToast = vi.fn()
    const env = makeEnv({ onToast })
    await callNative(env, 'Mk:toast', [values.STR('hey'), values.NUM(3)])
    expect(onToast).toHaveBeenCalledWith('hey', 'info')
    // onToast 未指定でも no-op で完走する
    await expect(
      callNative(makeEnv(), 'Mk:toast', [values.STR('x')]),
    ).resolves.toBeDefined()
  })
})

describe('Mk:url', () => {
  it('opens a string url via openSafeUrl', async () => {
    const env = makeEnv()
    await callNative(env, 'Mk:url', [values.STR('https://example.com/')])
    expect(openSafeUrlMock).toHaveBeenCalledWith('https://example.com/')
  })

  it('does nothing for a missing or non-string url', async () => {
    const env = makeEnv()
    await callNative(env, 'Mk:url', [undefined])
    await callNative(env, 'Mk:url', [values.NUM(1)])
    expect(openSafeUrlMock).not.toHaveBeenCalled()
  })
})

describe('Mk:nyaize', () => {
  it('nyaizes the input text', async () => {
    const env = makeEnv()
    const result = await callNative(env, 'Mk:nyaize', [values.STR('なにこれ')])
    expect(result).toMatchObject({ type: 'str', value: 'にゃにこれ' })
  })

  it('returns an empty string for non-string input', async () => {
    const env = makeEnv()
    const result = await callNative(env, 'Mk:nyaize', [values.NUM(1)])
    expect(result).toMatchObject({ type: 'str', value: '' })
  })
})

describe('global constants', () => {
  it('exposes defined globals as STR consts', () => {
    const env = createAiScriptEnv(
      { principal: { kind: 'user' } },
      {
        USER_ID: 'u1',
        USER_USERNAME: 'alice',
        LOCALE: 'ja',
        SERVER_URL: 'https://example.com',
      },
    )
    expect(env.USER_ID).toMatchObject({ type: 'str', value: 'u1' })
    expect(env.USER_USERNAME).toMatchObject({ type: 'str', value: 'alice' })
    expect(env.LOCALE).toMatchObject({ type: 'str', value: 'ja' })
    expect(env.SERVER_URL).toMatchObject({
      type: 'str',
      value: 'https://example.com',
    })
  })

  it('omits undefined globals', () => {
    const env = createAiScriptEnv(
      { principal: { kind: 'user' } },
      { LOCALE: 'ja' },
    )
    expect(env.THIS_ID).toBeUndefined()
    expect(env.USER_ID).toBeUndefined()
    expect(env.CUSTOM_EMOJIS).toBeUndefined()
  })

  it('converts CUSTOM_EMOJIS with jsToVal', () => {
    const emojis = [{ name: 'blob', url: 'https://example.com/blob.png' }]
    const env = createAiScriptEnv(
      { principal: { kind: 'user' } },
      { CUSTOM_EMOJIS: emojis },
    )
    expect(env.CUSTOM_EMOJIS).toBeDefined()
    expect(utils.valToJs(env.CUSTOM_EMOJIS as Value)).toEqual(emojis)
  })
})
