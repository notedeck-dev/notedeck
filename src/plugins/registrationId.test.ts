import { describe, expect, it } from 'vitest'
import {
  makeRegistrationId,
  parseRegistrationId,
  pluginProviderKey,
  providerFromPrincipal,
  registrationId,
} from './registrationId'

describe('pluginProviderKey (#794 未決事項 2)', () => {
  it('MisStore 由来は storeId を安定キーにする', () => {
    expect(
      pluginProviderKey({ installId: 'inst-1', storeId: 'acme.clock' }),
    ).toBe('acme.clock')
  })

  it('再インストールで installId が変わっても storeId 由来なら同一', () => {
    const before = pluginProviderKey({ installId: 'a', storeId: 'acme.clock' })
    const after = pluginProviderKey({ installId: 'b', storeId: 'acme.clock' })
    expect(before).toBe(after)
  })

  it('ローカル自作は local: 接頭辞つき installId', () => {
    expect(pluginProviderKey({ installId: 'inst-1' })).toBe('local:inst-1')
  })

  it('ローカル自作は再インストールで別物になる (意図した挙動)', () => {
    expect(pluginProviderKey({ installId: 'a' })).not.toBe(
      pluginProviderKey({ installId: 'b' }),
    )
  })
})

describe('registrationId', () => {
  it('provider:localName の 2 段 ID を組む', () => {
    expect(
      registrationId({ installId: 'i', storeId: 'acme.clock' }, 'main'),
    ).toBe('acme.clock:main')
  })

  // ローカル自作は必ず local: が付くので予約領域に届かない。
  // 予約を突破しうるのは storeId を自称できる配布物だけ。
  it('組込の予約接頭辞 nd は storeId でも名乗れない', () => {
    expect(() =>
      registrationId({ installId: 'i', storeId: 'nd' }, 'x'),
    ).toThrow()
    expect(() =>
      registrationId({ installId: 'i', storeId: 'nd:core' }, 'x'),
    ).toThrow()
  })

  it('localName が空なら拒否する', () => {
    expect(() => registrationId({ installId: 'i' }, '')).toThrow()
  })

  it('localName に区切り文字を含められない (ID の解釈が壊れるため)', () => {
    expect(() => registrationId({ installId: 'i' }, 'a:b')).toThrow()
  })

  it('往復できる', () => {
    const id = registrationId({ installId: 'i', storeId: 'acme.clock' }, 'main')
    expect(parseRegistrationId(id)).toEqual({
      provider: 'acme.clock',
      localName: 'main',
    })
  })

  it('local: 接頭辞つきでも往復できる (provider に : を含む)', () => {
    const id = registrationId({ installId: 'inst-1' }, 'main')
    expect(parseRegistrationId(id)).toEqual({
      provider: 'local:inst-1',
      localName: 'main',
    })
  })

  it('2 段になっていない ID は null', () => {
    expect(parseRegistrationId('timeline')).toBeNull()
  })
})

describe('makeRegistrationId', () => {
  it('provider 文字列から直接組める', () => {
    expect(makeRegistrationId('acme.clock', 'main')).toBe('acme.clock:main')
  })

  it('provider が違えば localName が同じでも衝突しない', () => {
    expect(makeRegistrationId('a', 'main')).not.toBe(
      makeRegistrationId('b', 'main'),
    )
  })
})

describe('providerFromPrincipal', () => {
  it('storeId があれば最優先', () => {
    expect(
      providerFromPrincipal(
        { kind: 'plugin', pluginId: 'widget:w1' },
        'acme.clock',
      ),
    ).toBe('acme.clock')
  })

  it('plugin principal は local:<pluginId>', () => {
    expect(providerFromPrincipal({ kind: 'plugin', pluginId: 'play:p1' })).toBe(
      'local:play:p1',
    )
  })

  it('user principal は local:user', () => {
    expect(providerFromPrincipal({ kind: 'user' })).toBe('local:user')
  })
})
