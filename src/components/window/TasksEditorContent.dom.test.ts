// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import TasksEditorContent from './TasksEditorContent.vue'

/** タスクのカードの開閉と ID 入力 (#1215) */

async function mountEditor() {
  const wrapper = mount(TasksEditorContent, {
    attachTo: document.body,
    global: { stubs: { CodeEditor: true } },
  })
  await flushPromises()
  return wrapper
}

describe('TasksEditorContent — カードの開閉 (#1215)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('見出しの開閉ボタンが aria-expanded を持ち、ボタンで開閉できる', async () => {
    const wrapper = await mountEditor()
    const toggle = wrapper.find('button[aria-expanded]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-expanded')).toBe('false')
    // 取っ手と削除ボタンを開閉のボタンの中に入れ子にしない
    expect(toggle.find('button').exists()).toBe(false)

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
  })

  it('ID を打ち換えてもカードは作り直されず、開いたままになる', async () => {
    const wrapper = await mountEditor()
    const toggle = wrapper.find('button[aria-expanded]')
    await toggle.trigger('click')
    await flushPromises()

    const card = toggle.element.closest('[data-task-idx]')
    const idInput = wrapper.find('input[placeholder="my-task"]')
    expect(idInput.exists()).toBe(true)
    await idInput.setValue(`${(idInput.element as HTMLInputElement).value}x`)
    await flushPromises()

    const after = wrapper.find('button[aria-expanded]')
    expect(after.element.closest('[data-task-idx]')).toBe(card)
    expect(after.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('input[placeholder="my-task"]').element).toBe(
      idInput.element,
    )
    wrapper.unmount()
  })
})
