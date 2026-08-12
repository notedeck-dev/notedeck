// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useThemeStore } from '@/stores/theme'
import type { MisskeyTheme } from '@/theme/types'
import ThemeEditorContent from './ThemeEditorContent.vue'

/** 外部変更の取り込み (#981) の配線検証。詳細は WidgetEditContent の同名テスト。 */

vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))

function makeTheme(props: Record<string, string>): MisskeyTheme {
  return { id: 'th-sync', name: 'T', base: 'dark', props }
}

async function mountEditor(theme: MisskeyTheme) {
  useThemeStore().installedThemes = [theme]
  const wrapper = mount(ThemeEditorContent, {
    props: { initialThemeId: theme.id },
    shallow: true,
  })
  await nextTick()
  return wrapper
}

/** テーマ名の入力欄は「テーマ情報」セクションを開くと現れる。 */
async function openInfoSection(
  wrapper: Awaited<ReturnType<typeof mountEditor>>,
): Promise<void> {
  const header = wrapper
    .findAll('button')
    .find((b) => b.text().includes('テーマ情報'))
  if (!header) throw new Error('テーマ情報セクションが見つからない')
  await header.trigger('click')
}

/** 編集中の値 = 名前入力欄に流れている値。 */
function nameOf(wrapper: Awaited<ReturnType<typeof mountEditor>>): string {
  const input = wrapper.find('input[type="text"]')
  return (input.element as HTMLInputElement).value
}

describe('ThemeEditorContent — 外部変更の取り込み (#981)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('未編集なら外部のテーマ変更を編集中の値へ取り込む', async () => {
    const store = useThemeStore()
    const wrapper = await mountEditor(makeTheme({ accent: '#f00' }))
    await openInfoSection(wrapper)
    expect(nameOf(wrapper)).toBe('T')

    // 履歴からの revert / AI の theme.update に相当する外部からの書き換え
    store.installedThemes = [
      { id: 'th-sync', name: '戻したあとの名前', base: 'dark', props: {} },
    ]
    await nextTick()
    expect(nameOf(wrapper)).toBe('戻したあとの名前')
  })

  it('編集中 (未保存) なら外部変更で編集内容を消さない', async () => {
    const store = useThemeStore()
    const wrapper = await mountEditor(makeTheme({ accent: '#f00' }))
    await openInfoSection(wrapper)

    // ユーザーが名前を書き換えた = 未保存の変更がある状態
    const input = wrapper.find('input[type="text"]')
    await input.setValue('編集中の名前')

    store.installedThemes = [
      { id: 'th-sync', name: '戻したあとの名前', base: 'dark', props: {} },
    ]
    await nextTick()
    expect(nameOf(wrapper)).toBe('編集中の名前')
  })
})
