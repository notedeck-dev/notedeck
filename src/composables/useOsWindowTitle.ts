import { getCurrentWindow } from '@tauri-apps/api/window'
import { computed, watch } from 'vue'
import { COLUMN_LABELS } from '@/columns/registry'
import type { DeckColumn } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { catchIgnore } from '@/utils/logger'

/** カラムの人間可読な表示名 (name 上書き > type ラベル) */
export function columnDisplayName(col: DeckColumn): string {
  return col.name ?? COLUMN_LABELS[col.type] ?? col.type
}

/**
 * OS ウィンドウタイトルに表示内容を反映し、Alt-Tab やタスクバーで
 * 複数ウィンドウを区別できるようにする (#748)。
 * - メインウィンドウ: "NoteDeck — {プロファイル名}"
 * - ポップアウトカラムウィンドウ: "{カラム名} — NoteDeck"
 * App.vue で 1 mount する (PiP は PipPage 側で独自に設定)。
 */
export function useOsWindowTitle() {
  const deckStore = useDeckStore()

  const title = computed(() => {
    const windowId = deckStore.currentWindowId
    if (windowId) {
      const cols = deckStore.columns.filter((c) => c.windowId === windowId)
      const firstCol = cols[0]
      if (!firstCol) return 'NoteDeck'
      const first = columnDisplayName(firstCol)
      return cols.length > 1
        ? `${first} 他${cols.length - 1} — NoteDeck`
        : `${first} — NoteDeck`
    }
    const profile = deckStore.currentProfileName
    return profile ? `NoteDeck — ${profile}` : 'NoteDeck'
  })

  watch(
    title,
    (t) => {
      getCurrentWindow().setTitle(t).catch(catchIgnore('os-window-title'))
    },
    { immediate: true },
  )
}
