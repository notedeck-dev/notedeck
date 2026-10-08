// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick } from 'vue'
import { useDeckStore } from '@/stores/deck'

/**
 * プロファイルはその場で書き換える (shallowRef + profileVersion)。由来の
 * computed が同じ参照を返すと Vue は「変化なし」として下流を再計算しないので、
 * カラムの追加・削除・設定変更が次の無関係な更新まで画面に出なくなる (v1.81.0)。
 */
describe('デッキのカラムの反映 (v1.81.0 退行)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('追加したカラムはすぐ columnMap と windowLayout に出る (2 本目以降も)', async () => {
    const deck = useDeckStore()
    deck.load()
    for (let i = 0; i < 3; i++) {
      const col = deck.addColumn({ type: 'home', accountId: null } as never)
      await nextTick()
      expect(deck.getColumn(col.id)?.id).toBe(col.id)
      expect(deck.windowLayout.flat()).toContain(col.id)
    }
  })

  it('削除したカラムはすぐ windowLayout から消える', async () => {
    const deck = useDeckStore()
    deck.load()
    const a = deck.addColumn({ type: 'home', accountId: null } as never)
    await nextTick()
    deck.removeColumn(a.id)
    await nextTick()
    expect(deck.windowLayout.flat()).not.toContain(a.id)
    expect(deck.getColumn(a.id)).toBeUndefined()
  })

  it('updateColumn の変更は永続化の区切りで読み手に届く', async () => {
    const deck = useDeckStore()
    deck.load()
    const a = deck.addColumn({ type: 'home', accountId: null } as never)
    await nextTick()
    const name = computed(() => deck.getColumn(a.id)?.name)
    expect(name.value).toBeUndefined()
    deck.updateColumn(a.id, { name: 'renamed' })
    await vi.runAllTimersAsync()
    await nextTick()
    expect(name.value).toBe('renamed')
  })
})
