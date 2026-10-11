import { describe, expect, it } from 'vitest'
import {
  legacyWidgetStoragePrefix,
  placementsFromIds,
  rewritePlacements,
  samePlacement,
  widgetStoragePrefix,
} from './widgetPlacement'

describe('ウィジェットの配置 (#1202 決定 (g))', () => {
  it('同一性は id と実行アカウントの組', () => {
    expect(samePlacement({ id: 'a' }, { id: 'a' })).toBe(true)
    expect(samePlacement({ id: 'a' }, { id: 'a', accountKey: 'h:u' })).toBe(
      false,
    )
    expect(
      samePlacement(
        { id: 'a', accountKey: 'h:u' },
        { id: 'a', accountKey: 'h:u' },
      ),
    ).toBe(true)
  })

  it('旧 widgetIds は実行アカウント無しの配置になる', () => {
    expect(placementsFromIds(['a', 'b'])).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('書き換えは id を差し替え、未指定の実行アカウントを引き継ぎ、重複を畳む', () => {
    const { placements, changed } = rewritePlacements(
      [
        { id: 'copy' },
        { id: 'keep' },
        { id: 'body' },
        { id: 'copy', accountKey: 'h:x' },
      ],
      [
        { from: 'copy', to: { id: 'body', accountKey: 'h:u' } },
        { from: 'body', to: { id: 'body', accountKey: 'h:v' } },
      ],
    )
    expect(changed).toBe(true)
    expect(placements).toEqual([
      { id: 'body', accountKey: 'h:u' },
      { id: 'keep' },
      { id: 'body', accountKey: 'h:v' },
      // 配置が自分で実行アカウントを持っていればそれを優先
      { id: 'body', accountKey: 'h:x' },
    ])
  })

  it('該当しなければ変化なし', () => {
    const { changed } = rewritePlacements(
      [{ id: 'a' }],
      [{ from: 'b', to: { id: 'c' } }],
    )
    expect(changed).toBe(false)
    expect(rewritePlacements([{ id: 'a' }], []).changed).toBe(false)
  })

  it('Mk:save の名前空間はアカウントキーで分け、無ければ旧来の鍵', () => {
    expect(widgetStoragePrefix('w', 'h:u')).toBe('app-w/h:u')
    expect(widgetStoragePrefix('w', undefined)).toBe('app-w')
    expect(legacyWidgetStoragePrefix('w')).toBe('app-w')
  })
})
