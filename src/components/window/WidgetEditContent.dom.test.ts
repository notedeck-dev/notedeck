// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useWidgetsStore, type WidgetMeta } from '@/stores/widgets'
import WidgetEditContent from './WidgetEditContent.vue'

/**
 * 外部変更の取り込み (#981) の**配線**を検証する。規則そのものは
 * useExternalEditSync のユニットテストが持つが、どのエディタが何を
 * 「未保存の編集」として渡しているかはここでしか分からない。取り違えても
 * 型は通り、壊れるとユーザーの編集中バッファが無言で消える。
 */

vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))

function makeWidget(installId: string, src: string): WidgetMeta {
  return {
    installId,
    name: 'test-widget',
    src,
    autoRun: false,
    createdAt: 0,
    updatedAt: 0,
    fileBase: installId,
  }
}

async function mountEditor(widget: WidgetMeta) {
  useWidgetsStore().addWidget(widget)
  const wrapper = mount(WidgetEditContent, {
    props: { widgetId: widget.installId },
    global: { stubs: { teleport: true } },
    shallow: true,
  })
  await nextTick()
  return wrapper
}

/** 編集バッファ (エディタに渡っている v-model) の現在値。 */
function bufferOf(wrapper: Awaited<ReturnType<typeof mountEditor>>): string {
  const editor = wrapper.findComponent({ name: 'AiScriptEditor' })
  return editor.props('modelValue') as string
}

describe('WidgetEditContent — 外部変更の取り込み (#981)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('未編集なら外部の src 変更を編集バッファへ取り込む', async () => {
    const store = useWidgetsStore()
    const wrapper = await mountEditor(makeWidget('w-sync-clean', 'let x = 1'))
    expect(bufferOf(wrapper)).toBe('let x = 1')

    // 履歴からの revert / AI 編集に相当する外部からの書き換え
    store.updateSrc('w-sync-clean', 'let y = 2')
    await nextTick()
    expect(bufferOf(wrapper)).toBe('let y = 2')
  })

  it('編集中 (未保存) なら外部変更で打ちかけの内容を消さない', async () => {
    const store = useWidgetsStore()
    const wrapper = await mountEditor(makeWidget('w-sync-dirty', 'let x = 1'))
    const editor = wrapper.findComponent({ name: 'AiScriptEditor' })

    // ユーザーが打鍵した直後 (デバウンス保存の前) の状態を作る
    editor.vm.$emit('update:modelValue', '打ちかけ')
    await nextTick()

    store.updateSrc('w-sync-dirty', 'let y = 2')
    await nextTick()
    expect(bufferOf(wrapper)).toBe('打ちかけ')
  })
})
