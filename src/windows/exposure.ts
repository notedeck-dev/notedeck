/**
 * ウィンドウの露出判定 (#1034)。
 *
 * ウィンドウには種別ピッカーが無く、入口はすべて呼び出し側のメニュー項目や
 * ボタンなので、判定はこの述語 1 本に集約して各入口が参照する。
 */

import { isExposed } from '@/settings/exposure'
import type { WindowType } from '@/stores/windows'
import { WINDOW_REGISTRY } from './registry'

/** そのウィンドウの入口を今のモードで出してよいか */
export function isWindowExposed(type: WindowType): boolean {
  return isExposed(WINDOW_REGISTRY[type]?.exposure)
}
