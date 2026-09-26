import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import golden from '@/capabilities/golden/performance.json'
import { i18n } from '@/i18n'
import type { PerformanceKey } from '@/stores/performance'
import {
  DEFAULTS,
  FIELD_META,
  SLIDER_HIGH,
  SLIDER_LOW,
} from '@/stores/performanceData'

/**
 * パフォーマンス設定の数値表 (min / max / step / category / 単位のキー /
 * スライダー両端) の golden (#1133)。
 *
 * notecore の `performance.*` capability は同じ表で clamp と補間を行う。
 * 表の正本は TS (`performanceData.ts`) で、`pnpm gen:golden-perf` で採取して
 * 書き戻し、Rust は同じ JSON を読む (tools.json と同じ方式)。
 */

/** 単位が辞書 (`_performanceData.units`) の値ならそのキー、直書き ('MB' 等) なら null */
function unitKeyOf(unit: string): string | null {
  if (unit === '') return null
  const units = i18n.ts._performanceData.units as Record<string, string>
  return Object.entries(units).find(([, text]) => text === unit)?.[0] ?? null
}

function snapshot() {
  const fields: Record<string, unknown> = {}
  for (const key of Object.keys(DEFAULTS) as PerformanceKey[]) {
    const m = FIELD_META[key]
    fields[key] = {
      min: m.min,
      max: m.max,
      step: m.step,
      category: m.category,
      unit: m.unit,
      unitKey: unitKeyOf(m.unit),
      low: SLIDER_LOW[key],
      high: SLIDER_HIGH[key],
    }
  }
  return { fields }
}

const UPDATE = process.env.UPDATE_GOLDEN_PERF === '1'

describe('golden × パフォーマンス設定の数値表 (#1133)', () => {
  it('数値表が golden と一致する', () => {
    if (UPDATE) return
    expect(golden, '`pnpm gen:golden-perf` で採取し直す').toEqual(snapshot())
  })

  it('UPDATE_GOLDEN_PERF=1 で期待値を書き戻す', () => {
    if (!UPDATE) return
    writeFileSync(
      join(__dirname, '..', 'capabilities', 'golden', 'performance.json'),
      `${JSON.stringify(snapshot(), null, 2)}\n`,
    )
  })
})
