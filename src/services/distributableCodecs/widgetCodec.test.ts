import { describe, expect, it } from 'vitest'
import {
  type WidgetFileMeta,
  type WidgetItem,
  widgetCodec,
} from '@/services/distributableCodecs/widgetCodec'

const ctx = { filename: 'w.meta.json5', now: 42 }

function read(meta: Partial<WidgetFileMeta>, src = ''): WidgetItem {
  return widgetCodec.fromFile({ meta, src }, ctx)
}

function item(patch: Partial<WidgetItem> = {}): WidgetItem {
  return {
    id: 'w',
    name: 'W',
    createdAt: 1,
    updatedAt: 2,
    scope: { kind: 'shared', global: false, installedFor: [] },
    content: 'src',
    extra: { autoRun: false },
    ...patch,
  }
}

describe('widgetCodec.fromFile のスコープ', () => {
  it('accountKey も accountId も global も無い旧個体は全体スコープ', () => {
    expect(read({}).scope).toEqual({
      kind: 'shared',
      global: true,
      installedFor: [],
    })
  })

  it('global があれば accountId より優先し、installedFor をそのまま使う', () => {
    const it_ = read({ global: false, installedFor: ['h:u'], accountId: 'x' })
    expect(it_.scope).toEqual({
      kind: 'shared',
      global: false,
      installedFor: ['h:u'],
    })
    // accountKey が無いので旧々の印は残る
    expect(it_.extra.legacyAccountId).toBe('x')
  })

  it('accountKey は global / installedFor より優先して 1 件の紐付けにする', () => {
    const it_ = read({
      accountKey: 'h:k',
      global: true,
      installedFor: ['h:u'],
    })
    expect(it_.scope).toEqual({
      kind: 'shared',
      global: false,
      installedFor: ['h:k'],
    })
    expect(it_.extra.legacyAccountKey).toBe('h:k')
  })

  it('空文字の accountKey は無いものとして扱う', () => {
    const it_ = read({ accountKey: '' })
    expect(it_.scope).toMatchObject({ global: true })
    expect('legacyAccountKey' in it_.extra).toBe(false)
  })

  it('global: true で installedFor が無いときは空配列', () => {
    expect(read({ global: true }).scope).toEqual({
      kind: 'shared',
      global: true,
      installedFor: [],
    })
  })
})

describe('widgetCodec.fromFile の既定値', () => {
  it('ID / 名前はメタファイル名、時刻は now、autoRun は false で埋める', () => {
    const it_ = read({})
    expect(it_).toMatchObject({
      id: 'w.meta.json5',
      name: 'w.meta.json5',
      createdAt: 42,
      updatedAt: 42,
      store: undefined,
      content: '',
      extra: { autoRun: false },
    })
  })

  it('旧形式の印が無いときは extra に legacy のキーを作らない', () => {
    expect(Object.keys(read({ global: false }).extra)).toEqual(['autoRun'])
  })

  it('description は読まない (ウィジェットは説明を持たない)', () => {
    const meta = { description: 'd' } as Partial<WidgetFileMeta>
    expect(read(meta).description).toBeUndefined()
  })
})

describe('widgetCodec.toFile', () => {
  it('global と autoRun は常に書き、空の installedFor は書かない', () => {
    expect(widgetCodec.toFile(item()).meta).toEqual({
      installId: 'w',
      name: 'W',
      autoRun: false,
      global: false,
      createdAt: 1,
      updatedAt: 2,
    })
  })

  it('キー順は installId, name, autoRun, ストア 3 点, iconUrl, global, installedFor, 時刻', () => {
    const meta = widgetCodec.toFile(
      item({
        iconUrl: 'https://i',
        store: { id: 's', sha512: 'h', version: '1' },
        scope: { kind: 'shared', global: true, installedFor: ['h:u'] },
      }),
    ).meta
    expect(Object.keys(meta)).toEqual([
      'installId',
      'name',
      'autoRun',
      'storeId',
      'storeSha512',
      'storeVersion',
      'iconUrl',
      'global',
      'installedFor',
      'createdAt',
      'updatedAt',
    ])
  })

  it('legacyAccountId は accountId として末尾に書き戻す', () => {
    const meta = widgetCodec.toFile(
      item({ extra: { autoRun: true, legacyAccountId: 'uuid' } }),
    ).meta
    expect(meta.accountId).toBe('uuid')
    expect(Object.keys(meta).at(-1)).toBe('accountId')
  })

  it('legacyAccountKey は書かない (runtime-only)', () => {
    const meta = widgetCodec.toFile(
      item({ extra: { autoRun: true, legacyAccountKey: 'h:u' } }),
    ).meta
    expect('accountKey' in meta).toBe(false)
    expect('legacyAccountKey' in meta).toBe(false)
  })

  it('scope が none のときは global: false を書く', () => {
    expect(
      widgetCodec.toFile(item({ scope: { kind: 'none' } })).meta.global,
    ).toBe(false)
  })

  it('description は envelope にあっても書かない', () => {
    const meta = widgetCodec.toFile(item({ description: 'd' })).meta
    expect('description' in meta).toBe(false)
  })
})

describe('widgetCodec の往復', () => {
  it('envelope → テキスト → envelope で元に戻る', () => {
    const original = item({
      iconUrl: 'https://i',
      store: { id: 's', sha512: 'h' },
      scope: { kind: 'shared', global: false, installedFor: ['h:u', 'h:v'] },
      extra: { autoRun: true },
    })
    const file = widgetCodec.toFile(original)
    const back = widgetCodec.fromFile(
      widgetCodec.decode(widgetCodec.encode(file), file.src),
      ctx,
    )
    expect(back).toEqual({ ...original, description: undefined })
  })

  it('旧 accountKey の個体は書き戻すと global を持つ新形式になり outdated でなくなる', () => {
    const legacy = { meta: { installId: 'a', accountKey: 'h:u' }, src: '' }
    expect(widgetCodec.outdated(legacy)).toBe(true)
    const rewritten = widgetCodec.toFile(widgetCodec.fromFile(legacy, ctx))
    expect(rewritten.meta).toMatchObject({
      global: false,
      installedFor: ['h:u'],
    })
    expect(widgetCodec.outdated(rewritten)).toBe(false)
  })
})

describe('widgetCodec.outdated', () => {
  it('global が真偽値でなければ古い', () => {
    expect(widgetCodec.outdated({ meta: {}, src: '' })).toBe(true)
  })

  it('global が真偽値なら accountKey が残っていても古くない', () => {
    expect(
      widgetCodec.outdated({
        meta: { global: false, accountKey: 'h:u' },
        src: '',
      }),
    ).toBe(false)
  })

  it('有効の宣言は持たない (autoRun は有効フラグではない)', () => {
    expect(widgetCodec.enabled).toBeUndefined()
  })
})
