import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createToastCenter } from './toast'

describe('toast center', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('ステータス表示の場所があるとき', () => {
    it('軽い成功・情報はカードを出さずステータスに出し、受信トレイに残さない', () => {
      const c = createToastCenter()
      c.registerStatusHost()
      c.show('コピーしました', 'success')
      expect(c.toasts.value).toHaveLength(0)
      expect(c.status.value?.text).toBe('コピーしました')
      expect(c.inbox.value).toHaveLength(0)
      vi.advanceTimersByTime(5000)
      expect(c.status.value).toBeNull()
    })

    it('警告・エラーはカードを出し、受信トレイにも残して未読を数える', () => {
      const c = createToastCenter()
      c.registerStatusHost()
      c.show('失敗しました', 'error')
      expect(c.toasts.value.map((t) => t.text)).toEqual(['失敗しました'])
      expect(c.inbox.value.map((t) => t.text)).toEqual(['失敗しました'])
      expect(c.unreadCount.value).toBe(1)
    })

    it('アクション付きは種類を問わずカードと受信トレイに出す', () => {
      const c = createToastCenter()
      c.registerStatusHost()
      c.show('削除しました', 'info', {
        action: { label: '元に戻す', onClick: () => {} },
      })
      expect(c.toasts.value).toHaveLength(1)
      expect(c.inbox.value).toHaveLength(1)
    })
  })

  it('ステータス表示の場所が無いとき (モバイル等) は軽いものもカードで出す', () => {
    const c = createToastCenter()
    c.show('コピーしました', 'success')
    expect(c.toasts.value).toHaveLength(1)
    expect(c.inbox.value).toHaveLength(0)
  })

  it('カードは時間が来ると消えるが受信トレイには残る', () => {
    const c = createToastCenter()
    c.show('失敗しました', 'error')
    vi.advanceTimersByTime(60_000)
    expect(c.toasts.value).toHaveLength(0)
    expect(c.inbox.value).toHaveLength(1)
  })

  it('ホバー中はカードを消さず、離れてから消す', () => {
    const c = createToastCenter()
    c.show('失敗しました', 'error')
    const id = c.toasts.value[0]?.id ?? -1
    c.pause(id)
    vi.advanceTimersByTime(60_000)
    expect(c.toasts.value).toHaveLength(1)
    c.resume(id)
    vi.advanceTimersByTime(60_000)
    expect(c.toasts.value).toHaveLength(0)
  })

  it('アクションを実行するとカードを閉じ、受信トレイからはアクションを外す', () => {
    const c = createToastCenter()
    const onClick = vi.fn()
    c.show('削除しました', 'info', { action: { label: '元に戻す', onClick } })
    const item = c.toasts.value[0]
    if (!item) throw new Error('no toast')
    c.runAction(item)
    expect(onClick).toHaveBeenCalledOnce()
    expect(c.toasts.value).toHaveLength(0)
    expect(c.inbox.value[0]?.action).toBeUndefined()
  })

  it('既読にすると未読数が 0 になり、クリアで受信トレイが空になる', () => {
    const c = createToastCenter()
    c.show('a', 'error')
    c.show('b', 'warning')
    expect(c.unreadCount.value).toBe(2)
    expect(c.inbox.value.map((t) => t.text)).toEqual(['b', 'a'])
    c.markInboxRead()
    expect(c.unreadCount.value).toBe(0)
    c.clearInbox()
    expect(c.inbox.value).toHaveLength(0)
  })

  it('同じ内容の連続は積み直さず、受信トレイにも重ねない', () => {
    const c = createToastCenter()
    c.show('失敗しました', 'error')
    c.show('失敗しました', 'error')
    expect(c.toasts.value).toHaveLength(1)
    expect(c.inbox.value).toHaveLength(1)
  })
})
