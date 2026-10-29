// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToast } from '@/stores/toast'
import type { WidgetItem } from '@/stores/widgets'
import WidgetAiScript from './WidgetAiScript.vue'

/**
 * ウィジェットは長寿命の interpreter 1 つに Async:interval / Ui の handler を
 * 登録する構造 (プラグインと同形)。handler の 1 回のエラーで interpreter を
 * 止めると、通信断が 1 回起きただけで以後の更新が全部死ぬ (#1294)
 */

vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))

vi.mock('@/windows/exposure', () => ({
  isWindowExposed: vi.fn(() => false),
}))

function makeWidget(content: string): WidgetItem {
  return {
    id: 'w1',
    name: 'Interval Widget',
    content,
    scope: { kind: 'shared', global: true, installedFor: [] },
    extra: { autoRun: true },
    createdAt: 1,
    updatedAt: 1,
  }
}

let wrapper: VueWrapper | null = null

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('WidgetAiScript の handler エラー (#1294)', () => {
  it('Async:interval の handler が 1 回エラーを出しても次の tick は走る', async () => {
    wrapper = mount(WidgetAiScript, {
      props: {
        widget: makeWidget(
          [
            'var n = 0',
            'Async:interval(5, @() {',
            '  n += 1',
            '  Mk:toast(`tick{n}`)',
            '  if n == 1 { Core:add(1, "a") }',
            '})',
          ].join('\n'),
        ),
        columnId: 'col-1',
        accountId: null,
      },
    })
    const toasts = useToast().toasts
    await vi.waitFor(
      () => {
        expect(toasts.value.map((t) => t.text)).toContain('tick2')
      },
      { timeout: 1000, interval: 10 },
    )
  })
})
