// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, ref } from 'vue'
import MfmPlayground from './MfmPlayground.vue'
import { MFM_PLAYGROUND_SAMPLES } from './mfmPlaygroundSamples'

beforeEach(() => {
  setActivePinia(createPinia())
})

const Host = defineComponent({
  components: { MfmPlayground },
  setup: () => ({ text: ref('') }),
  template: '<MfmPlayground v-model="text" />',
})

describe('MfmPlayground のサンプル', () => {
  it('同じサンプルを選び直すと、編集した本文がサンプルに戻る', async () => {
    const wrapper = mount(Host, {
      global: {
        stubs: { MkMfm: true, MfmFunctionTable: true, CodeEditor: true },
      },
    })
    const basic = MFM_PLAYGROUND_SAMPLES.find((s) => s.id === 'basic')?.text
    expect(basic).toBeTruthy()
    const select = wrapper.find('select')

    await select.setValue('basic')
    expect(wrapper.vm.text).toBe(basic)

    await wrapper.find('textarea').setValue('編集した')
    expect(wrapper.vm.text).toBe('編集した')

    await select.setValue('basic')
    expect(wrapper.vm.text).toBe(basic)
    wrapper.unmount()
  })
})
