import { describe, expect, it } from 'vitest'
import { queryBadgeIcon, queryBadgeTitle } from './badge'

describe('queryBadgeTitle / queryBadgeIcon — カラムヘッダのクエリ表示 (#783 / #1043)', () => {
  it('停止系 (セーフモード / 全適用が無効) は filter-off で、文言は別', () => {
    expect(queryBadgeIcon('safeMode')).toBe('ti ti-filter-off')
    expect(queryBadgeIcon('disabled')).toBe('ti ti-filter-off')
    expect(queryBadgeTitle({ status: 'safeMode', disabled: [] }, 0)).toContain(
      'セーフモード',
    )
    expect(
      queryBadgeTitle({ status: 'disabled', disabled: ['a'] }, 0),
    ).toContain('すべて無効')
  })

  it('適用中はエラー件数と無効なクエリ名を導線の前に添える', () => {
    const title = queryBadgeTitle({ status: 'active', disabled: ['x', 'y'] }, 3)
    expect(title).toBe(
      'クエリ適用中 (評価エラー 3 件を除外) (無効: x, y) — 押すとクエリ管理カラムを開きます',
    )
    expect(queryBadgeIcon('active')).toBe('ti ti-filter-check')
    expect(queryBadgeIcon('degraded')).toBe('ti ti-hourglass')
    expect(queryBadgeIcon('invalid')).toBe('ti ti-alert-triangle')
  })
})
