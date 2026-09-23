import type { Command } from '@/commands/registry'
import {
  FIELD_META,
  type PerformanceKey,
  usePerformanceStore,
} from '@/stores/performance'
import { implement } from '../declare'

/**
 * Performance 系 capability — 「自己拡張する IDE」(memory:
 * project_self_extending_ide_roadmap) の延長線。「重いから下げて」
 * 「アニメーション切って」のようなチューニング委譲を会話で完結させる。
 *
 * 設計判断:
 * - performance.json5 は 50+ 個の数値 key を持つ巨大スキーマだが、AI は
 *   個別 key 単位で set / reset するだけ。FIELD_META の min/max/label を
 *   list で返すので AI が範囲を把握して提案できる
 * - applySlider (0..1 線形補間) は包括的チューニングプリセットとして公開
 * - clamp は store 側で行うので AI は範囲外の値を投げてもエラーにならず
 *   勝手に丸まる
 */

function isValidPerformanceKey(key: string): key is PerformanceKey {
  return key in FIELD_META
}

export const performanceListCapability = implement('performance.list', {
  execute: () => {
    const store = usePerformanceStore()
    return (Object.keys(FIELD_META) as PerformanceKey[]).map((key) => {
      const meta = FIELD_META[key]
      return {
        key,
        value: store.get(key),
        default: store.getDefault(key),
        min: meta.min,
        max: meta.max,
        step: meta.step,
        unit: meta.unit,
        category: meta.category,
        label: meta.label,
        description: meta.description,
        customized: store.isCustomized(key),
      }
    })
  },
})

export const performanceSetCapability = implement('performance.set', {
  requiresConfirmation: (params) => {
    const key = typeof params?.key === 'string' ? params.key : ''
    const value = typeof params?.value === 'number' ? params.value : NaN
    const meta = isValidPerformanceKey(key) ? FIELD_META[key] : null
    return {
      title: 'パフォーマンス値を変更',
      message: meta
        ? `${meta.label} (\`${key}\`) を ${value}${meta.unit} に変更します。` +
          ` 範囲外なら ${meta.min}..${meta.max} に自動 clamp されます。`
        : `\`${key}\` を ${value} に変更します。`,
      okLabel: '変更',
      cancelLabel: 'やめる',
      type: 'normal',
    }
  },
  execute: (params) => {
    const key = typeof params?.key === 'string' ? params.key : ''
    if (!key) throw new Error('performance.set: key is required')
    if (!isValidPerformanceKey(key)) {
      throw new Error(`performance.set: unknown key "${key}"`)
    }
    const value = typeof params?.value === 'number' ? params.value : NaN
    if (!Number.isFinite(value)) {
      throw new Error('performance.set: value must be a finite number')
    }
    const store = usePerformanceStore()
    store.set(key, value)
    return { key, value: store.get(key) }
  },
})

export const performanceResetCapability = implement('performance.reset', {
  requiresConfirmation: (params) => {
    const key = typeof params?.key === 'string' ? params.key : ''
    const meta = isValidPerformanceKey(key) ? FIELD_META[key] : null
    return {
      title: 'パフォーマンス値を default に戻す',
      message: meta
        ? `${meta.label} (\`${key}\`) を default に戻します。`
        : `\`${key}\` を default に戻します。`,
      okLabel: 'default に戻す',
      cancelLabel: 'やめる',
      type: 'normal',
    }
  },
  execute: (params) => {
    const key = typeof params?.key === 'string' ? params.key : ''
    if (!key) throw new Error('performance.reset: key is required')
    if (!isValidPerformanceKey(key)) {
      throw new Error(`performance.reset: unknown key "${key}"`)
    }
    const store = usePerformanceStore()
    store.resetKey(key)
    return { key, reset: true, value: store.get(key) }
  },
})

export const performanceResetAllCapability = implement('performance.resetAll', {
  requiresConfirmation: () => ({
    title: '全パフォーマンス値を default に戻す',
    message:
      '全 override を破棄し、すべて default に戻します (= 設定をクリーン状態に)。',
    okLabel: 'すべて default に戻す',
    cancelLabel: 'やめる',
    type: 'warning',
  }),
  execute: () => {
    const store = usePerformanceStore()
    store.resetAll()
    return { reset: true }
  },
})

export const performanceApplySliderCapability = implement(
  'performance.applySlider',
  {
    requiresConfirmation: (params) => {
      const t = typeof params?.t === 'number' ? params.t : NaN
      const label =
        t <= 0.1 ? '省電力寄り' : t >= 0.9 ? 'リッチ寄り' : 'バランス'
      return {
        title: 'パフォーマンスプリセットを適用',
        message: `スライダー位置 t=${t.toFixed(2)} (${label}) のプリセットを全 key に適用します。`,
        okLabel: '適用',
        cancelLabel: 'やめる',
        type: 'warning',
      }
    },
    execute: (params) => {
      const raw = typeof params?.t === 'number' ? params.t : NaN
      if (!Number.isFinite(raw)) {
        throw new Error('performance.applySlider: t must be a finite number')
      }
      const t = Math.max(0, Math.min(1, raw))
      const store = usePerformanceStore()
      store.applySlider(t)
      return { applied: true, t }
    },
  },
)

export const PERFORMANCE_BUILTIN_CAPABILITIES: readonly Command[] = [
  performanceListCapability,
  performanceSetCapability,
  performanceResetCapability,
  performanceResetAllCapability,
  performanceApplySliderCapability,
]
