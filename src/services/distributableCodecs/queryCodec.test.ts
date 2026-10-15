import { describe, expect, it } from 'vitest'
import {
  type QueryFileMeta,
  type QueryItem,
  queryCodec,
} from '@/services/distributableCodecs/queryCodec'

const ctx = { filename: 'q.meta.json5', now: 42 }

function read(meta: Partial<QueryFileMeta>, src = ''): QueryItem {
  return queryCodec.fromFile({ meta, src }, ctx)
}

function item(patch: Partial<QueryItem> = {}): QueryItem {
  return {
    id: 'q',
    name: 'Q',
    createdAt: 1,
    updatedAt: 2,
    scope: { kind: 'shared', global: false, installedFor: [] },
    content: 'src',
    extra: { scoped: false, active: true },
    ...patch,
  }
}

describe('queryCodec.fromFile', () => {
  it('空のメタは ID / 名前をファイル名、時刻を now、有効・未スコープで埋める', () => {
    expect(read({})).toEqual({
      id: 'q.meta.json5',
      name: 'q.meta.json5',
      description: undefined,
      iconUrl: undefined,
      createdAt: 42,
      updatedAt: 42,
      store: undefined,
      scope: { kind: 'shared', global: false, installedFor: [] },
      content: '',
      extra: { scoped: false, active: true },
    })
  })

  it('active があれば disabled より優先する', () => {
    expect(read({ active: true, disabled: true }).extra.active).toBe(true)
    expect(read({ active: false, disabled: false }).extra.active).toBe(false)
  })

  it('active が無いときは disabled !== true で決める', () => {
    expect(read({ disabled: true }).extra.active).toBe(false)
    expect(read({ disabled: false }).extra.active).toBe(true)
  })

  it('active が真偽値でないときは disabled に落ちる', () => {
    expect(
      read({ active: 'no' as unknown as boolean, disabled: true }).extra.active,
    ).toBe(false)
  })

  it('scoped は true のときだけ立つ', () => {
    expect(read({ scoped: true }).extra.scoped).toBe(true)
    expect(read({ scoped: 1 as unknown as boolean }).extra.scoped).toBe(false)
  })
})

describe('queryCodec.toFile', () => {
  it('省略可能なキーは書かず、active と時刻は常に書く', () => {
    expect(queryCodec.toFile(item()).meta).toEqual({
      id: 'q',
      name: 'Q',
      active: true,
      createdAt: 1,
      updatedAt: 2,
    })
  })

  it('無効のときも active: false を書き、disabled は書かない', () => {
    const meta = queryCodec.toFile(
      item({ extra: { scoped: false, active: false } }),
    ).meta
    expect(meta.active).toBe(false)
    expect('disabled' in meta).toBe(false)
  })

  it('キー順は id, name, description, ストア 3 点, iconUrl, global, installedFor, scoped, active, 時刻', () => {
    const meta = queryCodec.toFile(
      item({
        description: 'd',
        iconUrl: 'https://i',
        store: { id: 's', sha512: 'h', version: '1' },
        scope: { kind: 'shared', global: true, installedFor: ['h:u'] },
        extra: { scoped: true, active: true },
      }),
    ).meta
    expect(Object.keys(meta)).toEqual([
      'id',
      'name',
      'description',
      'storeId',
      'storeSha512',
      'storeVersion',
      'iconUrl',
      'global',
      'installedFor',
      'scoped',
      'active',
      'createdAt',
      'updatedAt',
    ])
  })

  it('scope が none のときはスコープのキーを書かない', () => {
    const meta = queryCodec.toFile(item({ scope: { kind: 'none' } })).meta
    expect('global' in meta).toBe(false)
    expect('installedFor' in meta).toBe(false)
  })
})

describe('queryCodec の往復', () => {
  it('envelope → テキスト → envelope で元に戻る', () => {
    const original = item({
      description: 'd',
      iconUrl: 'https://i',
      store: { id: 's', version: '3' },
      scope: { kind: 'shared', global: true, installedFor: ['h:u'] },
      extra: { scoped: true, active: false },
    })
    const file = queryCodec.toFile(original)
    expect(
      queryCodec.fromFile(
        queryCodec.decode(queryCodec.encode(file), file.src),
        ctx,
      ),
    ).toEqual(original)
  })

  it('旧 disabled 形式は書き戻すと outdated でなくなる', () => {
    const legacy = { meta: { id: 'q', disabled: true }, src: '' }
    expect(queryCodec.outdated(legacy)).toBe(true)
    const rewritten = queryCodec.toFile(queryCodec.fromFile(legacy, ctx))
    expect(rewritten.meta.active).toBe(false)
    expect(queryCodec.outdated(rewritten)).toBe(false)
  })
})

describe('queryCodec.outdated', () => {
  it('active が真偽値なら古くない (時刻の欠損は見ない)', () => {
    expect(queryCodec.outdated({ meta: { active: false }, src: '' })).toBe(
      false,
    )
  })

  it('active が無ければ古い', () => {
    expect(queryCodec.outdated({ meta: {}, src: '' })).toBe(true)
  })
})

describe('queryCodec.enabled', () => {
  it('get は extra.active を返す', () => {
    expect(queryCodec.enabled.get(item())).toBe(true)
  })

  it('set は active だけを書き換え、scoped やスコープには触れない', () => {
    const before = item({
      scope: { kind: 'shared', global: true, installedFor: ['h:u'] },
      extra: { scoped: true, active: true },
    })
    const after = queryCodec.enabled.set(before, false)
    expect(after.extra).toEqual({ scoped: true, active: false })
    expect(after.scope).toBe(before.scope)
    expect(before.extra.active).toBe(true)
  })
})
