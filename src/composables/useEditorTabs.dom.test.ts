import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { useEditorTabs } from '@/composables/useEditorTabs'

describe('useEditorTabs', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('タブが減って選択中のものが消えたら先頭に戻す', async () => {
    const tabs = ref<readonly ('visual' | 'code')[]>(['visual', 'code'])
    const { tab } = useEditorTabs(tabs, 'visual')

    tab.value = 'code'
    tabs.value = ['visual']
    await nextTick()

    // 消えたタブを選んだままだと、ボタンは無いのにパネルだけ表示され続ける
    expect(tab.value).toBe('visual')
  })

  it('選択中のタブが残っていれば動かさない', async () => {
    const tabs = ref<readonly ('visual' | 'code' | 'json')[]>([
      'visual',
      'code',
      'json',
    ])
    const { tab } = useEditorTabs(tabs, 'visual')

    tab.value = 'code'
    tabs.value = ['visual', 'code']
    await nextTick()

    expect(tab.value).toBe('code')
  })

  it('固定のタブ集合では何も起きない', async () => {
    const { tab } = useEditorTabs(['visual', 'code'] as const, 'visual')
    tab.value = 'code'
    await nextTick()
    expect(tab.value).toBe('code')
  })
})
