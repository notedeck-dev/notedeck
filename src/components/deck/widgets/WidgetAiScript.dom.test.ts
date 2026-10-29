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

  it('handler のエラーが続いても出力の行数は上限で止まる', async () => {
    // interpreter を止めなくなった分、失敗し続ける interval がエラー行を
    // 積み続ける。上限を超えた分は古い行から捨てる (#987 の不変条件)
    wrapper = mount(WidgetAiScript, {
      props: {
        widget: makeWidget('Async:interval(1, @() { Core:add(1, "a") })'),
        columnId: 'col-1',
        accountId: null,
      },
    })
    const count = () => {
      const text = wrapper?.find('[class*="outputSummary"]').text() ?? ''
      return Number(text.match(/\d+/)?.[0] ?? 0)
    }
    await vi.waitFor(() => expect(count()).toBeGreaterThanOrEqual(200), {
      timeout: 5000,
      interval: 20,
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(count()).toBe(200)
  })
})
