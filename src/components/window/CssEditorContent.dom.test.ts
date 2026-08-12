// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useThemeStore } from '@/stores/theme'
import CssEditorContent from './CssEditorContent.vue'

/** 外部変更の取り込み (#981) の配線検証。詳細は WidgetEditContent の同名テスト。 */

vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))

async function mountEditor(initial: string) {
  useThemeStore().customCss = initial
  const wrapper = mount(CssEditorContent, {
    props: { initialTab: 'code' },
    shallow: true,
  })
  await nextTick()
  return wrapper
}

function bufferOf(wrapper: Awaited<ReturnType<typeof mountEditor>>): string {
  return wrapper
    .findComponent({ name: 'CodeEditor' })
    .props('modelValue') as string
}

describe('CssEditorContent — 外部変更の取り込み (#981)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('外部の custom.css 変更を編集バッファへ取り込む', async () => {
    const store = useThemeStore()
    const wrapper = await mountEditor('.before {}')
    expect(bufferOf(wrapper)).toBe('.before {}')

    // 履歴からの revert / AI 編集に相当する外部からの書き換え
    store.setCustomCss('.after {}')
    await nextTick()
    expect(bufferOf(wrapper)).toBe('.after {}')
  })

  it('取り込んだ内容をそのまま保持する (再構築した内容に化けない)', async () => {
    const store = useThemeStore()
    const wrapper = await mountEditor('.before {}')
    // 前後の空行を持つ原文。取り込みを書込み側へ素通しすると、プリセットと
    // ユーザー CSS から組み立て直された (= 整形された) 内容に化ける
    const restored = '\n.a { color: red }\n'
    store.setCustomCss(restored)
    await nextTick()
    await nextTick()
    expect(bufferOf(wrapper)).toBe(restored)
    expect(store.customCss).toBe(restored)
  })
})
