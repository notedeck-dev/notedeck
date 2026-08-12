import { useWindowsStore } from '@/stores/windows'
import type { HistoryKind } from '@/utils/settingsFs'

/**
 * 編集履歴ウィンドウを開く (#981)。skill / widget / plugin / theme / CSS の
 * 各エディタから同じ導線で呼ぶ。
 */
export function openEditHistoryWindow(params: {
  kind: HistoryKind
  /** 履歴サイドカーの basename (#913 の fileBase) */
  basename: string
  /** revert capability に渡す対象 id。css では不要 */
  itemId?: string
  name?: string
}): void {
  useWindowsStore().open('edit-history', { ...params })
}

/**
 * 履歴サイドカーのキー。#913 の対応表 (fileBase) が正で、未割当なら
 * 各 capability と同じ旧キー (表示名 → id) に落ちる。
 */
export function historyBasename(
  fileBase: string | undefined,
  name: string,
  id: string,
): string {
  return fileBase ?? (name || id)
}
