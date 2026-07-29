import { afterEach, describe, expect, it } from 'vitest'
import { computed, defineComponent, h } from 'vue'
import {
  ACCOUNT_INDEPENDENT_TYPES,
  ALL_COLUMN_TYPES,
  buildColumnDefaults,
  COLUMN_ICONS,
  COLUMN_LABELS,
  COLUMN_REGISTRY,
  COLUMN_TYPE_GROUPS,
  CROSS_ACCOUNT_TYPES,
  GUEST_ALLOWED_TYPES,
  isColumnType,
  PIP_ENABLED_TYPES,
  registerColumnType,
  unregisterColumnType,
  WIDE_COLUMN_TYPES,
} from './registry'

const Stub = defineComponent({ render: () => h('div') })

function spec(overrides: Record<string, unknown> = {}) {
  return {
    label: 'テスト',
    icon: 'flask',
    group: 'tool' as const,
    component: async () => ({ default: Stub }),
    ...overrides,
  }
}

describe('カラムレジストリの実行時登録 (#794 W2)', () => {
  afterEach(() => {
    unregisterColumnType('x:demo')
    unregisterColumnType('x:other')
  })

  it('登録した種別が registry と派生に反映される', () => {
    registerColumnType('x:demo', spec())

    expect(COLUMN_REGISTRY['x:demo']).toBeDefined()
    expect(ALL_COLUMN_TYPES).toContain('x:demo')
    expect(COLUMN_LABELS['x:demo']).toBe('テスト')
    expect(COLUMN_ICONS['x:demo']).toBe('flask')
    expect(isColumnType('x:demo')).toBe(true)
  })

  it('解除すると registry と派生の両方から消える', () => {
    registerColumnType('x:demo', spec())
    unregisterColumnType('x:demo')

    expect(COLUMN_REGISTRY['x:demo']).toBeUndefined()
    expect(ALL_COLUMN_TYPES).not.toContain('x:demo')
    expect(COLUMN_LABELS['x:demo']).toBeUndefined()
    expect(isColumnType('x:demo')).toBe(false)
  })

  it('フラグが各派生 Set に反映される', () => {
    registerColumnType(
      'x:demo',
      spec({ guestAllowed: true, crossAccount: true, wide: true }),
    )

    expect(GUEST_ALLOWED_TYPES.has('x:demo')).toBe(true)
    expect(CROSS_ACCOUNT_TYPES.has('x:demo')).toBe(true)
    expect(WIDE_COLUMN_TYPES.has('x:demo')).toBe(true)
    expect(ACCOUNT_INDEPENDENT_TYPES.has('x:demo')).toBe(false)
  })

  it('登録種別は既定で PiP 非対応 (#794 未決事項 5)', () => {
    registerColumnType('x:demo', spec())
    expect(PIP_ENABLED_TYPES.has('x:demo')).toBe(false)

    // 組込は従来どおり PiP 可
    expect(PIP_ENABLED_TYPES.has('timeline')).toBe(true)
  })

  it('group に応じて COLUMN_TYPE_GROUPS へ入る', () => {
    registerColumnType('x:demo', spec({ group: 'tool' }))
    const tool = COLUMN_TYPE_GROUPS.find((g) => g.group === 'tool')
    expect(tool?.types).toContain('x:demo')
  })

  it('組込の ID 空間は予約されており上書きできない', () => {
    expect(() => registerColumnType('timeline', spec())).toThrow()
    expect(COLUMN_LABELS.timeline).toBe('タイムライン')
  })

  it('同じ ID の二重登録は先勝ちで拒否する (#794 未決事項 2)', () => {
    registerColumnType('x:demo', spec({ label: '先' }))
    expect(() => registerColumnType('x:demo', spec({ label: '後' }))).toThrow()
    expect(COLUMN_LABELS['x:demo']).toBe('先')
  })

  it('組込の解除は拒否する', () => {
    expect(() => unregisterColumnType('timeline')).toThrow()
    expect(COLUMN_REGISTRY.timeline).toBeDefined()
  })

  it('未登録種別の解除は何もしない (停止時の一括解除が二重に走っても安全)', () => {
    expect(() => unregisterColumnType('x:never-registered')).not.toThrow()
  })

  it('buildColumnDefaults が登録種別にも効く', () => {
    registerColumnType('x:demo', spec({ defaultWidth: 480 }))
    const defaults = buildColumnDefaults('x:demo', null)
    expect(defaults.name).toBe('テスト')
    expect(defaults.width).toBe(480)
  })

  it('登録が Vue の computed に伝播する (プラグイン起動はデッキ復元より後)', () => {
    const labels = computed(() => ALL_COLUMN_TYPES.map((t) => COLUMN_LABELS[t]))
    expect(labels.value).not.toContain('テスト')

    registerColumnType('x:demo', spec())
    expect(labels.value).toContain('テスト')

    unregisterColumnType('x:demo')
    expect(labels.value).not.toContain('テスト')
  })
})
