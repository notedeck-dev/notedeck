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

describe('TasksEditorContent — ID の重複', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('他のタスクと同じ ID にすると欄の直下にエラーを出し、直すと消える', async () => {
    const wrapper = await mountEditor()
    const toggles = wrapper.findAll('button[aria-expanded]')
    expect(toggles.length).toBeGreaterThanOrEqual(2)
    await toggles[0]?.trigger('click')
    await toggles[1]?.trigger('click')
    await flushPromises()

    const inputs = wrapper.findAll('input[placeholder="my-task"]')
    const first = inputs[0]
    const second = inputs[1]
    if (!first || !second) throw new Error('ID 欄が 2 つ無い')
    const original = (second.element as HTMLInputElement).value
    await second.setValue((first.element as HTMLInputElement).value)
    await flushPromises()

    for (const input of [first, second]) {
      expect(input.attributes('aria-invalid')).toBe('true')
      const describedBy = input.attributes('aria-describedby')
      expect(describedBy).toBeTruthy()
      expect(
        document.getElementById(describedBy ?? '')?.textContent,
      ).toBeTruthy()
    }

    await second.setValue(original)
    await flushPromises()
    expect(first.attributes('aria-invalid')).toBeUndefined()
    expect(second.attributes('aria-invalid')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('TasksEditorContent — ID の形式', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it.each([
    ['空', ''],
    ['使えない文字', 'my task!'],
  ])('ID を%sにすると欄の直下にエラーを出し、直すと消える', async (_, bad) => {
    const wrapper = await mountEditor()
    await wrapper.find('button[aria-expanded]').trigger('click')
    await flushPromises()

    const input = wrapper.find('input[placeholder="my-task"]')
    const original = (input.element as HTMLInputElement).value
    await input.setValue(bad)
    await flushPromises()

    expect(input.attributes('aria-invalid')).toBe('true')
    const describedBy = input.attributes('aria-describedby')
    expect(document.getElementById(describedBy ?? '')?.textContent).toBeTruthy()

    await input.setValue(original)
    await flushPromises()
    expect(input.attributes('aria-invalid')).toBeUndefined()
    wrapper.unmount()
  })
})
