import { describe, expect, it } from 'vitest'
import {
  reservedSkillKind,
  type SkillItem,
  skillCodec,
} from '@/services/distributableCodecs/skillCodec'
import type { Frontmatter } from '@/services/skillFrontmatter'

const ctx = { filename: 'note.md', now: 42 }

function read(meta: Frontmatter, filename = 'note.md'): SkillItem {
  return skillCodec.fromFile({ meta, body: 'b' }, { ...ctx, filename })
}

function item(patch: Partial<SkillItem> = {}): SkillItem {
  return {
    id: 's',
    name: 'S',
    createdAt: 1,
    updatedAt: 2,
    scope: { kind: 'none' },
    content: 'body',
    extra: {
      version: '1.0.0',
      mode: 'manual',
      triggers: [],
      builtIn: false,
      cheapCheckCapabilities: [],
      isPersona: false,
    },
    ...patch,
  }
}

describe('reservedSkillKind', () => {
  it('AGENTS / HEARTBEAT だけが予約で、大文字小文字を区別する', () => {
    expect(reservedSkillKind('AGENTS')).toBe('agents')
    expect(reservedSkillKind('HEARTBEAT')).toBe('heartbeat')
    expect(reservedSkillKind('agents')).toBeUndefined()
    expect(reservedSkillKind('Heartbeat')).toBeUndefined()
    expect(reservedSkillKind('AGENTS.md')).toBeUndefined()
  })
})

describe('skillCodec.fromFile の既定値', () => {
  it('空の frontmatter は ID / 名前を拡張子なしファイル名、版 0.1.0、manual で埋める', () => {
    expect(read({})).toEqual({
      id: 'note',
      name: 'note',
      description: undefined,
      iconUrl: undefined,
      createdAt: 42,
      updatedAt: 42,
      store: undefined,
      scope: { kind: 'none' },
      content: 'b',
      extra: {
        version: '0.1.0',
        author: undefined,
        mode: 'manual',
        triggers: [],
        builtIn: false,
        cheapCheckCapabilities: [],
        isPersona: false,
      },
    })
  })

  it('末尾の .md だけを剥がして fallback ID にする', () => {
    expect(read({}, 'a.md.md').id).toBe('a.md')
    expect(read({}, 'plain').id).toBe('plain')
  })

  it('文字列でも数値でもない id / name / version は欠損として fallback する', () => {
    const it_ = read({ id: true, name: ['x'], version: false })
    expect(it_.id).toBe('note')
    expect(it_.name).toBe('note')
    expect(it_.extra.version).toBe('0.1.0')
  })

  it('数値でない時刻は now で埋める', () => {
    const it_ = read({ createdAt: '1', updatedAt: 'x' })
    expect(it_.createdAt).toBe(42)
    expect(it_.updatedAt).toBe(42)
  })
})

describe('skillCodec.fromFile の値の解釈', () => {
  it('既知の mode はそのまま、それ以外は manual', () => {
    expect(read({ mode: 'always' }).extra.mode).toBe('always')
    expect(read({ mode: 'trigger' }).extra.mode).toBe('trigger')
    expect(read({ mode: 'heartbeat' }).extra.mode).toBe('heartbeat')
    expect(read({ mode: 'ALWAYS' }).extra.mode).toBe('manual')
  })

  it('triggers は単一の文字列なら 1 要素の配列、空文字なら空配列にする', () => {
    expect(read({ triggers: 'foo' }).extra.triggers).toEqual(['foo'])
    expect(read({ triggers: '' }).extra.triggers).toEqual([])
    expect(read({ triggers: 3 }).extra.triggers).toEqual([])
  })

  it('cheapCheckCapabilities も同じ規則で配列にする', () => {
    expect(
      read({ cheapCheckCapabilities: 'notes.read' }).extra
        .cheapCheckCapabilities,
    ).toEqual(['notes.read'])
  })

  it('active / tainted は true のときだけキーを作る', () => {
    expect('active' in read({ active: false }).extra).toBe(false)
    expect('tainted' in read({ tainted: 'true' }).extra).toBe(false)
    expect(read({ active: true, tainted: true }).extra).toMatchObject({
      active: true,
      tainted: true,
    })
  })

  it('ストア 3 点は storeId があるときだけ store になる', () => {
    expect(read({ storeSha512: 'h', storeVersion: '1' }).store).toBeUndefined()
    expect(read({ storeId: 's', storeVersion: '1' }).store).toEqual({
      id: 's',
      version: '1',
    })
  })

  it('予約でない skill は reserved のキーを持たない', () => {
    expect('reserved' in read({}).extra).toBe(false)
  })
})

describe('skillCodec.fromFile の数値で書いた値', () => {
  it('手書きで数値になった version / name も文字列として受ける', () => {
    const s = read({ id: 'x', name: 2024, version: 1.5 })
    expect(s.name).toBe('2024')
    expect(s.extra.version).toBe('1.5')
  })
})

describe('skillCodec.fromFile の予約 skill', () => {
  it('AGENTS.md は mode が always に固定され persona にならない', () => {
    const it_ = read({ mode: 'trigger', isPersona: true }, 'AGENTS.md')
    expect(it_.extra).toMatchObject({
      mode: 'always',
      isPersona: false,
      reserved: true,
    })
    expect(it_.id).toBe('AGENTS')
  })

  it('予約の判定は frontmatter の id ではなくファイル名で決まる', () => {
    const it_ = read({ id: 'HEARTBEAT', mode: 'trigger' }, 'other.md')
    expect(it_.extra.mode).toBe('trigger')
    expect('reserved' in it_.extra).toBe(false)
  })
})

describe('skillCodec.toFile', () => {
  it('必須の 6 キーだけを id, name, version, mode, createdAt, updatedAt の順で書く', () => {
    const meta = skillCodec.toFile(item()).meta
    expect(Object.keys(meta)).toEqual([
      'id',
      'name',
      'version',
      'mode',
      'createdAt',
      'updatedAt',
    ])
  })

  it('全部入りのキー順は宣言どおり', () => {
    const meta = skillCodec.toFile(
      item({
        description: 'd',
        iconUrl: 'https://i',
        store: { id: 's', sha512: 'h', version: '1' },
        extra: {
          version: '1.0.0',
          author: 'a',
          mode: 'trigger',
          triggers: ['t'],
          active: true,
          builtIn: true,
          cheapCheckCapabilities: ['c'],
          isPersona: true,
          tainted: true,
        },
      }),
    ).meta
    expect(Object.keys(meta)).toEqual([
      'id',
      'name',
      'version',
      'mode',
      'createdAt',
      'updatedAt',
      'description',
      'author',
      'triggers',
      'active',
      'storeId',
      'storeSha512',
      'storeVersion',
      'builtIn',
      'iconUrl',
      'cheapCheckCapabilities',
      'isPersona',
      'tainted',
    ])
  })

  it('reserved (runtime-only) は書かない', () => {
    const meta = skillCodec.toFile(
      item({ extra: { ...item().extra, reserved: true } }),
    ).meta
    expect('reserved' in meta).toBe(false)
  })

  it('content を body に書く', () => {
    expect(skillCodec.toFile(item({ content: 'x' })).body).toBe('x')
  })
})

describe('skillCodec の往復', () => {
  it('envelope → テキスト → envelope で元に戻る', () => {
    const original = item({
      description: 'has: colon',
      iconUrl: 'https://i',
      store: { id: 's', sha512: 'h', version: '1' },
      extra: {
        version: '1.0.0',
        author: 'a',
        mode: 'trigger',
        triggers: ['x', 'y'],
        active: true,
        builtIn: false,
        cheapCheckCapabilities: ['notes.read'],
        isPersona: true,
        tainted: true,
      },
    })
    const text = skillCodec.encode(skillCodec.toFile(original))
    expect(
      skillCodec.fromFile(skillCodec.decode(text), {
        ...ctx,
        filename: 's.md',
      }),
    ).toEqual(original)
  })

  it('数値に見える版は引用して書くので文字列のまま読み戻せる', () => {
    const original = item({ extra: { ...item().extra, version: '2' } })
    const text = skillCodec.encode(skillCodec.toFile(original))
    expect(text).toContain("version: '2'")
    expect(
      skillCodec.fromFile(skillCodec.decode(text), ctx).extra.version,
    ).toBe('2')
  })

  it('frontmatter の無いテキストは本文全体を content にして既定値で埋める', () => {
    const it_ = skillCodec.fromFile(skillCodec.decode('# just body'), ctx)
    expect(it_.content).toBe('# just body')
    expect(it_.id).toBe('note')
  })

  it('outdated は常に false', () => {
    expect(skillCodec.outdated({ meta: {}, body: '' })).toBe(false)
  })
})

describe('skillCodec.enabled', () => {
  it('mode=always は active の印に関係なく有効', () => {
    expect(
      skillCodec.enabled.get(
        item({ extra: { ...item().extra, mode: 'always' } }),
      ),
    ).toBe(true)
  })

  it('それ以外は active === true のときだけ有効', () => {
    expect(skillCodec.enabled.get(item())).toBe(false)
    expect(
      skillCodec.enabled.get(
        item({ extra: { ...item().extra, active: true } }),
      ),
    ).toBe(true)
  })

  it('set(true) は active: true を立て、set(false) はキーごと消す', () => {
    const on = skillCodec.enabled.set(item(), true)
    expect(on.extra.active).toBe(true)
    const off = skillCodec.enabled.set(on, false)
    expect('active' in off.extra).toBe(false)
    expect(on.extra.active).toBe(true)
  })

  it('mode=always で set(false) しても実効の有効は true のまま', () => {
    const always = item({
      extra: { ...item().extra, mode: 'always', active: true },
    })
    expect(skillCodec.enabled.get(skillCodec.enabled.set(always, false))).toBe(
      true,
    )
  })
})
