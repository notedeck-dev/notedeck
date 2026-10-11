import { describe, expect, it } from 'vitest'
import type { PluginItem } from '@/services/distributableCodecs/pluginCodec'
import {
  migrateStoreMovedPlugins,
  STORE_MOVED_PLUGIN_IDS,
} from '@/services/storeMovedPlugins'

function plugin(id: string, partial: Partial<PluginItem> = {}): PluginItem {
  return {
    id,
    name: id,
    content: 'src',
    scope: { kind: 'shared', global: true, installedFor: [] },
    extra: { version: '1.0.0', permissions: [], configData: {}, active: true },
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

describe('migrateStoreMovedPlugins (#746)', () => {
  it('同梱していたプラグインを移管対象にする', () => {
    expect(STORE_MOVED_PLUGIN_IDS).toEqual({
      'ai-actions-builtin': 'ai-actions',
    })
  })

  it('同梱の id をストア配布版相当に変換し、変えた個体だけ返す', () => {
    const items = [plugin('ai-actions-builtin'), plugin('other')]
    const changed = migrateStoreMovedPlugins(items)
    expect(changed.map((p) => p.id)).toEqual(['ai-actions-builtin'])
    // id は手元の同一性なので変えない (履歴・設定の参照先が切れる)
    expect(items[0]).toMatchObject({
      id: 'ai-actions-builtin',
      store: { id: 'ai-actions' },
    })
    expect(items[1]?.store).toBeUndefined()
  })

  it('ユーザーが触りうる内容は保つ', () => {
    const items = [
      plugin('ai-actions-builtin', {
        name: '自分で改名した',
        content: 'ユーザーが書き換えたソース',
        extra: {
          version: '1.0.0',
          configData: { prompt: '自作プロンプト' },
          active: false,
        },
      }),
    ]
    migrateStoreMovedPlugins(items)
    expect(items[0]).toMatchObject({
      name: '自分で改名した',
      content: 'ユーザーが書き換えたソース',
      extra: { active: false, configData: { prompt: '自作プロンプト' } },
    })
  })

  it('既に store を持つ (ストアから入れ直し済み) 個体には触れない', () => {
    const items = [
      plugin('ai-actions-builtin', {
        store: { id: 'ai-actions', sha512: 'abc', version: '2' },
      }),
    ]
    expect(migrateStoreMovedPlugins(items)).toEqual([])
    expect(items[0]?.store).toEqual({
      id: 'ai-actions',
      sha512: 'abc',
      version: '2',
    })
  })

  it('対象が無ければ空を返す', () => {
    expect(migrateStoreMovedPlugins([plugin('x')])).toEqual([])
  })
})
