import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type App, createApp, h, nextTick } from 'vue'
import { useColumnQueriesStore } from '@/stores/columnQueries'
import type { DeckColumn } from '@/stores/deck'
import ColumnFilterButton from './ColumnFilterButton.vue'

let app: App | null = null
let container: HTMLElement | null = null

function mountButton(
  column: Partial<DeckColumn>,
  props: Record<string, unknown> = {},
) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp({
    render: () =>
      h(
        ColumnFilterButton,
        {
          column: {
            id: 'c1',
            type: 'clientSearch',
            name: null,
            width: 300,
            accountId: null,
            ...column,
          },
          ...props,
        },
        props.extra ? { extra: () => h('div', 'EXTRA') } : undefined,
      ),
  })
  app.mount(container)
}

async function openMenu(): Promise<string> {
  const btn = container?.querySelector('button') as HTMLButtonElement
  btn.click()
  await nextTick()
  await new Promise((r) => setTimeout(r, 0))
  await nextTick()
  return document.body.textContent ?? ''
}

beforeEach(() => {
  setActivePinia(createPinia())
  const store = useColumnQueriesStore()
  store.ensureLoaded()
  store.queries.push({
    id: 'q-global',
    name: 'しずかなタイムライン',
    src: 'true',
    global: true,
    createdAt: 0,
    updatedAt: 0,
  })
})

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

describe('ColumnFilterButton のクエリトグル (#1178)', () => {
  it('prop を省略したカラム (クライアント検索など) でも全体スコープのクエリのトグルが出る', async () => {
    mountButton({}, { extra: true })
    const text = await openMenu()
    expect(text).toContain('EXTRA')
    expect(text).toContain('しずかなタイムライン')
  })

  it('hideQueries のカラム (サーバー検索) ではクエリのトグルを出さない', async () => {
    mountButton({ type: 'search' }, { extra: true, hideQueries: true })
    const text = await openMenu()
    expect(text).toContain('EXTRA')
    expect(text).not.toContain('しずかなタイムライン')
  })
})
