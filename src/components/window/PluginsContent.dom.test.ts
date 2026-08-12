// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { type PluginMeta, usePluginsStore } from '@/stores/plugins'
import PluginsContent from './PluginsContent.vue'

/** 外部変更の取り込み (#981) の配線検証。詳細は WidgetEditContent の同名テスト。 */

vi.mock('@/utils/historyFs', () => ({
  pushSnapshot: vi.fn(async () => undefined),
}))
vi.mock('@/aiscript/plugin-api', () => ({
  launchPlugin: vi.fn(async () => undefined),
  abortPlugin: vi.fn(),
  parsePluginMeta: vi.fn(() => null),
}))

function makePlugin(installId: string, src: string): PluginMeta {
  return {
    installId,
    name: 'test-plugin',
    version: '1.0.0',
    configData: {},
    src,
    active: false,
    fileBase: installId,
  }
}

async function mountEditor(plugin: PluginMeta) {
  usePluginsStore().addPlugin(plugin)
  const wrapper = mount(PluginsContent, {
    props: { initialPluginId: plugin.installId, initialTab: 'code' },
    shallow: true,
  })
  await nextTick()
  return wrapper
}

function bufferOf(wrapper: Awaited<ReturnType<typeof mountEditor>>): string {
  return wrapper
    .findComponent({ name: 'AiScriptEditor' })
    .props('modelValue') as string
}

describe('PluginsContent — 外部変更の取り込み (#981)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('未編集なら外部の src 変更を編集バッファへ取り込む', async () => {
    const store = usePluginsStore()
    const wrapper = await mountEditor(makePlugin('p-sync-clean', 'let x = 1'))
    expect(bufferOf(wrapper)).toBe('let x = 1')

    store.updateSrc('p-sync-clean', 'let y = 2')
    await nextTick()
    expect(bufferOf(wrapper)).toBe('let y = 2')
  })

  it('編集中 (未保存) なら外部変更で打ちかけの内容を消さない', async () => {
    const store = usePluginsStore()
    const wrapper = await mountEditor(makePlugin('p-sync-dirty', 'let x = 1'))
    const editor = wrapper.findComponent({ name: 'AiScriptEditor' })

    editor.vm.$emit('update:modelValue', '打ちかけ')
    await nextTick()

    store.updateSrc('p-sync-dirty', 'let y = 2')
    await nextTick()
    expect(bufferOf(wrapper)).toBe('打ちかけ')
  })
})
