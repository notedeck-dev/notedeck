import { afterEach, describe, expect, it, vi } from 'vitest'
import { type App, createApp, nextTick } from 'vue'
import type { SearchFilter } from '@/services/searchFilter'
import SearchFilterPanel from './SearchFilterPanel.vue'

let app: App | null = null
let container: HTMLElement | null = null

function mountPanel(props: Record<string, unknown>) {
  container = document.createElement('div')
  document.body.appendChild(container)
  app = createApp(SearchFilterPanel, props)
  app.mount(container)
}

function labels(): string[] {
  return Array.from(container?.querySelectorAll('span') ?? [])
    .map((s) => s.textContent?.trim() ?? '')
    .filter(Boolean)
}

function dateInputs(): HTMLInputElement[] {
  return Array.from(
    container?.querySelectorAll('input[type="date"]') ?? [],
  ) as HTMLInputElement[]
}

afterEach(() => {
  app?.unmount()
  container?.remove()
  app = null
  container = null
})

describe('SearchFilterPanel (#1180)', () => {
  it('クライアント検索は 範囲 / 投稿者 / 期間 / 添付 を出し、ホストの行は出さない', () => {
    mountPanel({
      face: 'client',
      filter: {} satisfies SearchFilter,
      scopeOptions: { servers: ['a.example'], accounts: [] },
      onUpdate: vi.fn(),
    })
    const text = labels().join(' ')
    expect(text).toContain('範囲')
    expect(text).toContain('投稿者')
    expect(text).toContain('期間')
    expect(text).toContain('添付')
    expect(text).toContain('本文の条件')
    expect(container?.querySelector('select')).toBeTruthy()
  })

  it('サーバー検索は選択肢が 2 つ以上あるときだけ範囲 (ホスト) の行を出す', () => {
    mountPanel({
      face: 'server',
      filter: {},
      hostOptions: ['local'],
      onUpdate: vi.fn(),
    })
    expect(labels().join(' ')).not.toContain('範囲')
    app?.unmount()
    container?.remove()
    mountPanel({
      face: 'server',
      filter: {},
      hostOptions: ['all', 'local', 'host'],
      onUpdate: vi.fn(),
    })
    expect(labels().join(' ')).toContain('範囲')
    expect(labels().join(' ')).not.toContain('添付')
  })

  it('面に意味の無い行に値が残っていれば「効かない」と見せ、外すと update が来る', async () => {
    const onUpdate = vi.fn()
    mountPanel({
      face: 'server',
      filter: { hasFiles: true, since: '2026-01-01' },
      hostOptions: ['local'],
      onUpdate,
    })
    expect(container?.textContent).toContain('このカラムでは効きません')
    const remove = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.includes('外す'),
    )
    expect(remove).toBeTruthy()
    remove?.click()
    await nextTick()
    expect(onUpdate).toHaveBeenCalledWith({ since: '2026-01-01' })
  })

  it('日付は年が揃うまで change で確定せず、欄を離れたら確定する', async () => {
    const onUpdate = vi.fn()
    mountPanel({ face: 'client', filter: {}, onUpdate })
    const [since] = dateInputs()
    if (!since) throw new Error('no date input')
    since.value = '0020-01-01'
    since.dispatchEvent(new Event('input'))
    since.dispatchEvent(new Event('change'))
    await nextTick()
    expect(onUpdate).not.toHaveBeenCalled()
    since.value = '2026-01-01'
    since.dispatchEvent(new Event('input'))
    since.dispatchEvent(new Event('change'))
    await nextTick()
    expect(onUpdate).toHaveBeenCalledWith({ since: '2026-01-01' })
  })

  it('「フィルターをクリア」はパネルの行 (本文の条件を含む) を消し、並び順は残す', async () => {
    const onUpdate = vi.fn()
    mountPanel({
      face: 'client',
      filter: {
        scope: 'account:a1',
        ascending: true,
        conditions: [{ type: 'excludes', words: ['bot'] }],
      },
      onUpdate,
    })
    const clear = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.includes('フィルターをクリア'),
    )
    clear?.click()
    await nextTick()
    expect(onUpdate).toHaveBeenCalledWith({ ascending: true })
  })

  it('本文の条件は行として編集でき、確定で update が来て一時停止の印が外れる', async () => {
    const onUpdate = vi.fn()
    mountPanel({
      face: 'server',
      filter: {
        conditionsPaused: true,
        conditions: [{ type: 'excludes', words: ['bot'] }],
      },
      hostOptions: ['local'],
      onUpdate,
    })
    expect(container?.textContent).toContain('止まっています')
    const words = Array.from(
      container?.querySelectorAll('input[type="text"]') ?? [],
    ).at(-1) as HTMLInputElement
    words.value = 'bot, spam'
    words.dispatchEvent(new Event('input'))
    words.dispatchEvent(new Event('blur'))
    await nextTick()
    expect(onUpdate).toHaveBeenCalledWith({
      conditions: [{ type: 'excludes', words: ['bot', 'spam'] }],
    })
  })
})
