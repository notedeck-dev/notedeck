/**
 * eviction preset の選択肢 (設定画面用)。preset → `EvictionConfig` の解決は
 * services/cacheEvictionConfig。
 */
import { i18n } from '@/i18n'
import type { EvictionPreset } from '@/services/cacheEvictionConfig'

export const PRESET_OPTIONS: ReadonlyArray<{
  value: EvictionPreset
  label: string
  hint: string
}> = [
  {
    value: 'search-priority',
    get label() {
      return i18n.ts._cacheEviction.searchPriority
    },
    get hint() {
      return i18n.ts._cacheEviction.searchPriorityHint
    },
  },
  {
    value: 'balanced',
    get label() {
      return i18n.ts._cacheEviction.balanced
    },
    get hint() {
      return i18n.ts._cacheEviction.balancedHint
    },
  },
  {
    value: 'storage-priority',
    get label() {
      return i18n.ts._cacheEviction.storagePriority
    },
    get hint() {
      return i18n.ts._cacheEviction.storagePriorityHint
    },
  },
  {
    value: 'custom',
    get label() {
      return i18n.ts._cacheEviction.custom
    },
    get hint() {
      return i18n.ts._cacheEviction.customHint
    },
  },
]
