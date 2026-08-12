import { afterEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp } from 'vue'
import WidgetCard from './WidgetCard.vue'

let app: App | null = null
let container: HTMLElement | null = null

function mountCard(props: Record<string, unknown>) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(WidgetCard, { name: 'Clock', mode: 'store', ...props })
  app.mount(container)
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll('button') ?? [])
}

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

describe('WidgetCard (store mode の更新導線 #1040)', () => {
  it('インストール済み + 更新ありなら「更新あり」バッジと「更新」ボタンを出し、クリックで update を emit する', () => {
    const onUpdate = vi.fn()
    mountCard({
      alreadyInstalled: true,
      hasUpdate: true,
      updatedAt: '2026-08-01T00:00:00.000Z',
      version: '1.1.0',
      onUpdate,
    })
    expect(container?.textContent).toContain('更新あり')
    expect(container?.textContent).not.toContain('インストール済み')
    const updateBtn = buttons().find((b) => b.textContent?.includes('更新'))
    expect(updateBtn).toBeTruthy()
    expect(updateBtn?.disabled).toBe(false)
    updateBtn?.click()
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('インストール済みでも更新なしなら従来どおり「インストール済み」を出す', () => {
    mountCard({ alreadyInstalled: true, hasUpdate: false })
    expect(container?.textContent).toContain('インストール済み')
    expect(container?.textContent).not.toContain('更新あり')
  })

  it('更新の実行中 (installing) は更新ボタンを無効化する', () => {
    mountCard({ alreadyInstalled: true, hasUpdate: true, installing: true })
    const updateBtn = buttons().find((b) => b.textContent?.includes('更新'))
    expect(updateBtn?.disabled).toBe(true)
  })
})
