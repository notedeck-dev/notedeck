import { usePerformanceStore } from '@/stores/performance'
import { useThemeStore } from '@/stores/theme'
import type { WindowType } from '@/stores/windows'

/**
 * 設定メニューのセクション定義 (#794 W7)。
 *
 * 従来はメニューのテンプレートに同型のブロックを 10 個直書きしており、
 * 項目を足すたびにマークアップを複製していた。ここを唯一の定義元にする。
 *
 * ラベルとアイコンは持たない — セクションは「どのウィンドウを開くか」だけを
 * 宣言し、表示はウィンドウレジストリから引く。両方に書くと、メニューの見た目と
 * 開いた先のタイトルバーがずれていく (実際に 2 件ずれていた)。
 *
 * ウィンドウレジストリと同じく実行時登録は開けない。組み込みが自分自身を
 * ここに列挙する形に揃えるところまでが範囲。
 */
export interface SettingsSection {
  /** 開くウィンドウ種別 */
  window: WindowType
  /**
   * ユーザーが既定から変更していれば true。メニューに変更済みの点を出す。
   * Pinia store を読むので、setup 済みの文脈から呼ぶこと。
   */
  hasOverride?: () => boolean
}

/** 表示順はこの配列の順 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { window: 'appearanceEditor' },
  { window: 'aiSettings' },
  { window: 'permissions' },
  { window: 'connections' },
  {
    window: 'performanceEditor',
    hasOverride: () => Object.keys(usePerformanceStore().overrides).length > 0,
  },
  {
    window: 'cssEditor',
    hasOverride: () => !!useThemeStore().customCss,
  },
  { window: 'tasksEditor' },
  { window: 'snippetsEditor' },
  { window: 'backup' },
  { window: 'cacheEditor' },
]
