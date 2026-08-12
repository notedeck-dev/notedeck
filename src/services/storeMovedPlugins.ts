import type { PluginMeta } from '@/stores/plugins'

/**
 * 同梱をやめて MisStore 配布に移したプラグイン (#746)。
 *
 * skill 側 (`storeMovedSkills`) と同じ扱いだが、プラグインは手元の同一性が
 * `installId`、配布側の同一性が `storeId` と別なので対応表になる。installId は
 * 履歴サイドカーや設定の参照先なので**変えない** — storeId を足すだけ。
 */
export const STORE_MOVED_PLUGIN_IDS: Readonly<Record<string, string>> = {
  'ai-actions-builtin': 'ai-actions',
}

export interface StoreMovedPluginMigrationPlan {
  migrated: PluginMeta[]
  /** 1 件でも変換したか (false なら永続化も不要) */
  changed: boolean
  /** 実際に変換した plugin (呼び出し側はこれだけ persist すればよい) */
  changedPlugins: PluginMeta[]
}

function movedStoreId(plugin: PluginMeta): string | undefined {
  // 既に storeId がある = ストアから入れ直し済み。触らない
  if (plugin.storeId) return undefined
  return STORE_MOVED_PLUGIN_IDS[plugin.installId]
}

/**
 * 手元に残っている旧同梱プラグインを、MisStore 配布版相当 (`storeId` 付き) に
 * 変換する。skill 側と同じく削除ではなく変換で、ソース・改名・設定・有効状態は
 * そのまま残す。以降はストアから更新を受け取れるようになるだけ。
 */
export function planStoreMovedPluginMigration(
  plugins: readonly PluginMeta[],
): StoreMovedPluginMigrationPlan {
  if (!plugins.some((p) => movedStoreId(p))) {
    return {
      migrated: plugins as PluginMeta[],
      changed: false,
      changedPlugins: [],
    }
  }
  const changedPlugins: PluginMeta[] = []
  const migrated = plugins.map((p) => {
    const storeId = movedStoreId(p)
    if (!storeId) return p
    const next: PluginMeta = { ...p, storeId }
    changedPlugins.push(next)
    return next
  })
  return { migrated, changed: true, changedPlugins }
}
