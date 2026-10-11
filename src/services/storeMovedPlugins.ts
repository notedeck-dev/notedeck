import type { PluginItem } from '@/services/distributableCodecs/pluginCodec'

/**
 * 同梱をやめて MisStore 配布に移したプラグイン (#746)。
 *
 * skill 側 (`storeMovedSkills`) と同じ扱いだが、プラグインは手元の同一性が
 * `id` (installId)、配布側の同一性が `store.id` と別なので対応表になる。id は
 * 履歴サイドカーや設定の参照先なので**変えない** — store を足すだけ。
 */
export const STORE_MOVED_PLUGIN_IDS: Readonly<Record<string, string>> = {
  'ai-actions-builtin': 'ai-actions',
}

/**
 * 手元に残っている旧同梱プラグインを、MisStore 配布版相当 (`store` 付き) に
 * 変換する。skill 側と同じく削除ではなく変換で、ソース・改名・設定・有効状態は
 * そのまま残す。以降はストアから更新を受け取れるようになるだけ。
 *
 * store factory の `migrate` hook の契約どおり in-place で直し、変えた個体を返す
 */
export function migrateStoreMovedPlugins(items: PluginItem[]): PluginItem[] {
  const changed: PluginItem[] = []
  for (const item of items) {
    // 既に store がある = ストアから入れ直し済み。触らない
    if (item.store) continue
    const storeId = STORE_MOVED_PLUGIN_IDS[item.id]
    if (!storeId) continue
    item.store = { id: storeId }
    changed.push(item)
  }
  return changed
}
