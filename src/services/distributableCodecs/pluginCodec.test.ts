import { describe, expect, it } from 'vitest'
import {
  type PluginFile,
  type PluginFileMeta,
  type PluginItem,
  pluginCodec,
} from '@/services/distributableCodecs/pluginCodec'

const ctx = { filename: 'p.meta.json5', now: 42 }

function read(meta: Partial<PluginFileMeta>, src = ''): PluginItem {
  return pluginCodec.fromFile({ meta, src }, ctx)
}

function item(patch: Partial<PluginItem> = {}): PluginItem {
  return {
    id: 'p',
    name: 'P',
    createdAt: 1,
    updatedAt: 2,
    scope: { kind: 'shared', global: false, installedFor: [] },
    content: 'src',
    extra: { version: '1', configData: {}, active: false },
    ...patch,
  }
}

describe('pluginCodec.fromFile', () => {
  it('空のメタは ID / 名前をファイル名、版を 0.0.0、時刻を now、無効で埋める', () => {
    expect(read({})).toEqual({
      id: 'p.meta.json5',
      name: 'p.meta.json5',
      description: undefined,
      iconUrl: undefined,
      createdAt: 42,
      updatedAt: 42,
      store: undefined,
      scope: { kind: 'shared', global: false, installedFor: [] },
      content: '',
      extra: {
        version: '0.0.0',
        author: undefined,
        permissions: undefined,
        config: undefined,
        configData: {},
        active: false,
      },
    })
  })

  it('空文字の installId / name / version は欠損として fallback する', () => {
    const it_ = read({ installId: '', name: '', version: '' })
    expect(it_.id).toBe('p.meta.json5')
    expect(it_.name).toBe('p.meta.json5')
    expect(it_.extra.version).toBe('0.0.0')
  })

  it('global は true のときだけ全体スコープ (truthy な非真偽値は false)', () => {
    expect(read({ global: true }).scope).toMatchObject({ global: true })
    expect(read({ global: 'yes' as unknown as boolean }).scope).toMatchObject({
      global: false,
    })
  })

  it('時刻 0 は欠損扱いせずそのまま使う', () => {
    const it_ = read({ createdAt: 0, updatedAt: 0 })
    expect(it_.createdAt).toBe(0)
    expect(it_.updatedAt).toBe(0)
  })

  it('src は content に入る', () => {
    expect(read({}, '<: 1').content).toBe('<: 1')
  })
})

describe('pluginCodec.toFile', () => {
  it('省略可能なキーは書かず、configData / active / 時刻は常に書く', () => {
    expect(pluginCodec.toFile(item()).meta).toEqual({
      installId: 'p',
      name: 'P',
      version: '1',
      configData: {},
      active: false,
      createdAt: 1,
      updatedAt: 2,
    })
  })

  it('空の permissions / installedFor は書かない', () => {
    const meta = pluginCodec.toFile(
      item({
        scope: { kind: 'shared', global: false, installedFor: [] },
        extra: {
          version: '1',
          configData: {},
          active: true,
          permissions: [],
        },
      }),
    ).meta
    expect('permissions' in meta).toBe(false)
    expect('installedFor' in meta).toBe(false)
    expect('global' in meta).toBe(false)
  })

  it('空オブジェクトの config は truthy なので書く', () => {
    const meta = pluginCodec.toFile(
      item({
        extra: { version: '1', config: {}, configData: {}, active: false },
      }),
    ).meta
    expect(meta.config).toEqual({})
  })

  it('scope が none のときはスコープのキーを書かない', () => {
    const meta = pluginCodec.toFile(item({ scope: { kind: 'none' } })).meta
    expect('global' in meta).toBe(false)
    expect('installedFor' in meta).toBe(false)
  })

  it('fileBase / readOnly (runtime-only) は書かない', () => {
    const meta = pluginCodec.toFile(
      item({ fileBase: 'x', readOnly: true }),
    ).meta
    expect('fileBase' in meta).toBe(false)
    expect('readOnly' in meta).toBe(false)
  })

  it('content を src に書く', () => {
    expect(pluginCodec.toFile(item({ content: 'abc' })).src).toBe('abc')
  })
})

describe('pluginCodec の往復', () => {
  it('envelope → ファイル → envelope で元に戻る (省略値を含まない個体)', () => {
    const original = item({
      description: 'd',
      iconUrl: 'https://i',
      store: { id: 's', sha512: 'h', version: '1' },
      scope: { kind: 'shared', global: true, installedFor: ['h:u'] },
      extra: {
        version: '2',
        author: 'a',
        permissions: ['read:account'],
        config: { k: { type: 'string', label: 'K', default: 'v' } },
        configData: { k: 'v' },
        active: true,
      },
    })
    const file = pluginCodec.toFile(original)
    const text = pluginCodec.encode(file)
    expect(
      pluginCodec.fromFile(pluginCodec.decode(text, file.src), ctx),
    ).toEqual(original)
  })

  it('decode は src を省略すると空文字にする', () => {
    expect(pluginCodec.decode("{ installId: 'p' }").src).toBe('')
  })

  it('壊れた JSON5 の decode は throw する', () => {
    expect(() => pluginCodec.decode('{ installId: ')).toThrow()
  })
})

describe('pluginCodec.outdated', () => {
  const file = (meta: Partial<PluginFileMeta>): PluginFile => ({
    meta,
    src: '',
  })

  it('createdAt / updatedAt が両方 number なら古くない', () => {
    expect(pluginCodec.outdated(file({ createdAt: 1, updatedAt: 2 }))).toBe(
      false,
    )
  })

  it('どちらかが欠けていれば古い', () => {
    expect(pluginCodec.outdated(file({ createdAt: 1 }))).toBe(true)
    expect(pluginCodec.outdated(file({ updatedAt: 1 }))).toBe(true)
  })

  it('数値でない時刻 (文字列) は古いとみなす', () => {
    expect(
      pluginCodec.outdated(
        file({ createdAt: '1' as unknown as number, updatedAt: 2 }),
      ),
    ).toBe(true)
  })
})

describe('pluginCodec.enabled', () => {
  it('get は extra.active を返す', () => {
    const enabled = pluginCodec.enabled
    if (!enabled) throw new Error('no enabled')
    expect(enabled.get(item())).toBe(false)
  })

  it('set は active だけを書き換えた新しい個体を返し、元は変えない', () => {
    const enabled = pluginCodec.enabled
    if (!enabled) throw new Error('no enabled')
    const before = item()
    const after = enabled.set(before, true)
    expect(after).not.toBe(before)
    expect(after.extra).toEqual({ ...before.extra, active: true })
    expect(before.extra.active).toBe(false)
  })
})
