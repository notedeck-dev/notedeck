import type { Command } from '@/commands/registry'
import {
  FIELD_META,
  type PerformanceKey,
  usePerformanceStore,
} from '@/stores/performance'

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

export const performanceListCapability: Command = {
  id: 'performance.list',
  label: 'パフォーマンス設定一覧',
  icon: 'ti-gauge',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '全パフォーマンス設定 key と、その現在値 / default / min / max / unit / ' +
      'description / customized フラグを返す。AI がチューニング提案するときの起点。',
    params: {},
    returns: {
      type: 'array',
      description:
        '各要素は { key, value, default, min, max, step, unit, category, label, description, customized }',
    },
    cheap: true,
  },
  visible: false,
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
}

export const performanceSetCapability: Command = {
  id: 'performance.set',
  label: 'パフォーマンス値を設定',
  icon: 'ti-gauge',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['performance.write'],
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
  signature: {
    description:
      '指定 key のパフォーマンス値を上書きする。範囲外の値は store 側で ' +
      'min..max に自動 clamp。default と同じ値を渡すと override 削除扱い。',
    params: {
      key: {
        type: 'string',
        description: '対象 key (performance.list で取得)',
      },
      value: {
        type: 'number',
        description: '新しい値 (FIELD_META.min..max にクランプ)',
      },
    },
    returns: {
      type: 'object',
      description: '{ key, value: clamp 後の実値 }',
    },
  },
  visible: false,
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
}

export const performanceResetCapability: Command = {
  id: 'performance.reset',
  label: 'パフォーマンス値を default に戻す',
  icon: 'ti-arrow-back-up',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['performance.write'],
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
  signature: {
    description: '指定 key の override を破棄して default に戻す。',
    params: {
      key: { type: 'string', description: '対象 key' },
    },
    returns: {
      type: 'object',
      description: '{ key, reset: true, value: default 値 }',
    },
  },
  visible: false,
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
}

export const performanceResetAllCapability: Command = {
  id: 'performance.resetAll',
  label: '全パフォーマンス値を default に戻す',
  icon: 'ti-arrow-back-up',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['performance.write'],
  requiresConfirmation: () => ({
    title: '全パフォーマンス値を default に戻す',
    message:
      '全 override を破棄し、すべて default に戻します (= 設定をクリーン状態に)。',
    okLabel: 'すべて default に戻す',
    cancelLabel: 'やめる',
    type: 'warning',
  }),
  signature: {
    description: '全 key の override を破棄。',
    params: {},
    returns: {
      type: 'object',
      description: '{ reset: true }',
    },
  },
  visible: false,
  execute: () => {
    const store = usePerformanceStore()
    store.resetAll()
    return { reset: true }
  },
}

export const performanceApplySliderCapability: Command = {
  id: 'performance.applySlider',
  label: 'パフォーマンススライダーを適用',
  icon: 'ti-adjustments',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['performance.write'],
  requiresConfirmation: (params) => {
    const t = typeof params?.t === 'number' ? params.t : NaN
    const label = t <= 0.1 ? '省電力寄り' : t >= 0.9 ? 'リッチ寄り' : 'バランス'
    return {
      title: 'パフォーマンスプリセットを適用',
      message: `スライダー位置 t=${t.toFixed(2)} (${label}) のプリセットを全 key に適用します。`,
      okLabel: '適用',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  signature: {
    description:
      '0..1 のスライダー位置 t に応じて全パフォーマンス値を線形補間で一括設定。' +
      ' 0 = 省電力寄り、1 = リッチ寄り。包括的チューニングプリセット。',
    params: {
      t: {
        type: 'number',
        description: 'スライダー位置 (0..1、範囲外は clamp)',
      },
    },
    returns: {
      type: 'object',
      description: '{ applied: true, t: 適用された値 }',
    },
  },
  visible: false,
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
}

export const PERFORMANCE_BUILTIN_CAPABILITIES: readonly Command[] = [
  performanceListCapability,
  performanceSetCapability,
  performanceResetCapability,
  performanceResetAllCapability,
  performanceApplySliderCapability,
]
