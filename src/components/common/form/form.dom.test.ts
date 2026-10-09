import { afterEach, describe, expect, it } from 'vitest'
import { type App, type Component, createApp, h, nextTick, ref } from 'vue'
import FormInput from './FormInput.vue'
import FormNumber from './FormNumber.vue'
import FormRange from './FormRange.vue'
import FormSelect from './FormSelect.vue'
import FormSwitch from './FormSwitch.vue'

let app: App | null = null
let container: HTMLElement | null = null

function mount(render: () => unknown) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({ render } as Component)
  app.mount(container)
  return container
}

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

function type(el: HTMLInputElement | HTMLSelectElement, value: string) {
  el.value = value
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input'))
}

describe('FormSwitch', () => {
  it('押すと v-model を反転し、aria-checked に映す', async () => {
    const on = ref(false)
    const el = mount(() =>
      h(FormSwitch, {
        modelValue: on.value,
        'onUpdate:modelValue': (v: boolean) => {
          on.value = v
        },
        label: 'Preview',
      }),
    )
    const btn = el.querySelector('button') as HTMLButtonElement
    expect(btn.getAttribute('role')).toBe('switch')
    expect(btn.getAttribute('aria-checked')).toBe('false')
    expect(btn.getAttribute('aria-label')).toBe('Preview')
    btn.click()
    await nextTick()
    expect(on.value).toBe(true)
    expect(btn.getAttribute('aria-checked')).toBe('true')
  })

  it('行のクリックと二重に切り替わらない (自分のクリックを親へ伝えない)', () => {
    let rowClicks = 0
    const el = mount(() =>
      h('div', { onClick: () => rowClicks++ }, [
        h(FormSwitch, { modelValue: false }),
      ]),
    )
    ;(el.querySelector('button') as HTMLButtonElement).click()
    expect(rowClicks).toBe(0)
  })

  it('decorative は操作も読み上げも持たない', () => {
    const el = mount(() =>
      h(FormSwitch, { modelValue: true, decorative: true }),
    )
    expect(el.querySelector('button')).toBeNull()
    expect(el.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})

describe('FormNumber', () => {
  function mountNumber(props: Record<string, unknown>) {
    const value = ref(props.modelValue as number)
    const el = mount(() =>
      h(FormNumber, {
        ...props,
        modelValue: value.value,
        'onUpdate:modelValue': (v: number) => {
          value.value = v
        },
      }),
    )
    return { el, value, input: el.querySelector('input') as HTMLInputElement }
  }

  it('範囲内の値だけを v-model に流し、単位を添える', async () => {
    const { el, value, input } = mountNumber({
      modelValue: 10,
      min: 1,
      max: 30,
      unit: 'days',
    })
    expect(el.textContent).toContain('days')
    type(input, '20')
    await nextTick()
    expect(value.value).toBe(20)
    expect(input.getAttribute('aria-invalid')).toBeNull()
  })

  it('範囲外はその場でエラー文を出し、aria-invalid / aria-describedby で結ぶ', async () => {
    const { el, value, input } = mountNumber({
      modelValue: 10,
      min: 1,
      max: 30,
    })
    type(input, '99')
    await nextTick()
    expect(value.value).toBe(10)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const id = input.getAttribute('aria-describedby')
    expect(id).toBeTruthy()
    const msg = el.querySelector(`#${CSS.escape(id as string)}`)
    expect(msg?.textContent).toMatch(/30/)
  })

  it('空欄は emptyValue があればその値を流す', async () => {
    const { value, input } = mountNumber({
      modelValue: 5000,
      min: 0,
      emptyValue: 0,
    })
    type(input, '')
    await nextTick()
    expect(value.value).toBe(0)
    expect(input.getAttribute('aria-invalid')).toBeNull()
  })

  it('空欄で emptyValue が無ければエラーにして値は変えない', async () => {
    const { value, input } = mountNumber({ modelValue: 3, min: 1 })
    type(input, '')
    await nextTick()
    expect(value.value).toBe(3)
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })
})

describe('FormInput', () => {
  it('error を渡すと欄の下に出し、aria で結ぶ。無ければ何も付けない', async () => {
    const error = ref('')
    const el = mount(() =>
      h(FormInput, {
        modelValue: '',
        error: error.value,
        placeholder: 'https://',
        class: 'outer',
      }),
    )
    const input = el.querySelector('input') as HTMLInputElement
    expect(input.getAttribute('placeholder')).toBe('https://')
    expect(input.classList.contains('outer')).toBe(false)
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(input.getAttribute('aria-describedby')).toBeNull()

    error.value = 'URL を入力してください'
    await nextTick()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const id = input.getAttribute('aria-describedby') as string
    expect(el.querySelector(`#${CSS.escape(id)}`)?.textContent).toContain(
      'URL を入力してください',
    )
  })

  it('入力を v-model に流す', async () => {
    const text = ref('')
    const el = mount(() =>
      h(FormInput, {
        modelValue: text.value,
        'onUpdate:modelValue': (v: string) => {
          text.value = v
        },
      }),
    )
    type(el.querySelector('input') as HTMLInputElement, 'abc')
    await nextTick()
    expect(text.value).toBe('abc')
  })
})

describe('FormSelect', () => {
  it('option の値の型を保ったまま v-model に流す', async () => {
    const picked = ref(0)
    const el = mount(() =>
      h(
        FormSelect,
        {
          modelValue: picked.value,
          'onUpdate:modelValue': (v: unknown) => {
            picked.value = v as number
          },
        },
        () => [h('option', { value: 0 }, 'a'), h('option', { value: 1 }, 'b')],
      ),
    )
    type(el.querySelector('select') as HTMLSelectElement, '1')
    await nextTick()
    expect(picked.value).toBe(1)
  })
})

describe('FormRange', () => {
  it('数値で v-model に流し、塗りの割合を --fill に持つ', async () => {
    const v = ref(25)
    const el = mount(() =>
      h(FormRange, {
        modelValue: v.value,
        min: 0,
        max: 100,
        'onUpdate:modelValue': (n: number) => {
          v.value = n
        },
      }),
    )
    const input = el.querySelector('input') as HTMLInputElement
    expect(input.style.getPropertyValue('--fill')).toBe('25%')
    type(input, '50')
    await nextTick()
    expect(v.value).toBe(50)
    expect(input.style.getPropertyValue('--fill')).toBe('50%')
  })
})
