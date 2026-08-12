import { describe, expect, it } from 'vitest'
import {
  planStoreMovedPluginMigration,
  STORE_MOVED_PLUGIN_IDS,
} from '@/services/storeMovedPlugins'
import type { PluginMeta } from '@/stores/plugins'

function plugin(
  partial: Partial<PluginMeta> & Pick<PluginMeta, 'installId'>,
): PluginMeta {
  return {
    name: partial.installId,
    version: '1.0.0',
    src: 'src',
    active: true,
    permissions: [],
    configData: {},
    global: true,
    ...partial,
  }
}

describe('planStoreMovedPluginMigration (#746)', () => {
  it('同梱していたプラグインを移管対象にする', () => {
    expect(STORE_MOVED_PLUGIN_IDS).toEqual({
      'ai-actions-builtin': 'ai-actions',
    })
  })

  it('同梱の installId をストア配布版相当に変換する', () => {
    const before = [plugin({ installId: 'ai-actions-builtin' })]
    const { migrated, changed, changedPlugins } =
      planStoreMovedPluginMigration(before)
    expect(changed).toBe(true)
    expect(migrated[0]).toMatchObject({
      // installId は手元の同一性なので変えない (履歴・設定の参照先が切れる)
      installId: 'ai-actions-builtin',
      storeId: 'ai-actions',
    })
    expect(changedPlugins).toHaveLength(1)
  })

  it('ユーザーが触りうる内容は保つ', () => {
    const before = [
      plugin({
        installId: 'ai-actions-builtin',
        name: '自分で改名した',
        src: 'ユーザーが書き換えたソース',
        active: false,
        configData: { prompt: '自作プロンプト' },
      }),
    ]
    const { migrated } = planStoreMovedPluginMigration(before)
    expect(migrated[0]).toMatchObject({
      name: '自分で改名した',
      src: 'ユーザーが書き換えたソース',
      active: false,
      configData: { prompt: '自作プロンプト' },
    })
  })

  it('既に storeId を持つ (入れ直し済み) 個体は触らない', () => {
    const before = [
      plugin({ installId: 'ai-actions-builtin', storeId: 'ai-actions' }),
    ]
    const { migrated, changed } = planStoreMovedPluginMigration(before)
    expect(changed).toBe(false)
    expect(migrated[0]).toBe(before[0])
  })

  it('対象が無ければ元の配列をそのまま返す', () => {
    const before = [plugin({ installId: 'user-made' })]
    const { migrated, changed } = planStoreMovedPluginMigration(before)
    expect(changed).toBe(false)
    expect(migrated).toBe(before)
  })

  it('対象外を混ぜても順序を保つ', () => {
    const before = [
      plugin({ installId: 'user-made' }),
      plugin({ installId: 'ai-actions-builtin' }),
    ]
    const { migrated } = planStoreMovedPluginMigration(before)
    expect(migrated.map((p) => p.installId)).toEqual([
      'user-made',
      'ai-actions-builtin',
    ])
    expect(migrated[0]?.storeId).toBeUndefined()
    expect(migrated[1]?.storeId).toBe('ai-actions')
  })
})
