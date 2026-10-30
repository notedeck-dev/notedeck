/**
 * eviction preset の選択肢 (設定画面用)。preset → 掃き出し設定の解決は notecore
 * (`crates/notecore/src/eviction_preset.rs`) が settings.json5 を読んで行う (#1131)。
 */
import { i18n } from '@/i18n'
import type { NotedeckSettings } from '@/settings/schema'

export type EvictionPreset = NonNullable<
  NotedeckSettings['cache.evictionPreset']
>

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
