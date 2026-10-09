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

  it('同じ内容の連続は積み直さず、受信トレイにも重ねず回数を数える', () => {
    const c = createToastCenter()
    c.show('失敗しました', 'error')
    c.show('失敗しました', 'error')
    expect(c.toasts.value).toHaveLength(1)
    expect(c.toasts.value[0]?.count).toBe(2)
    expect(c.inbox.value).toHaveLength(1)
    expect(c.inbox.value[0]?.count).toBe(2)
  })
})

describe('受信トレイでのまとめ', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('カードが消えた後の同じ通知も 1 件にまとめ、先頭に移して回数を数える', () => {
    const c = createToastCenter()
    c.show('失敗しました', 'error')
    vi.advanceTimersByTime(60_000)
    c.show('別の警告', 'warning')
    c.show('失敗しました', 'error')
    expect(c.inbox.value.map((t) => [t.text, t.count])).toEqual([
      ['失敗しました', 2],
      ['別の警告', 1],
    ])
    expect(c.inbox.value[0]?.time).toBe(Date.now())
    // 消えていたカードはもう一度出す
    expect(c.toasts.value.map((t) => t.text)).toContain('失敗しました')
  })

  it('種類や送り元が違えばまとめない', () => {
    const c = createToastCenter()
    c.show('失敗しました', 'error')
    c.show('失敗しました', 'warning')
    c.show('失敗しました', 'error', { source: 'プラグイン A' })
    expect(c.inbox.value).toHaveLength(3)
  })

  it('アクション付きはそれぞれ別の操作なのでまとめない', () => {
    const c = createToastCenter()
    const action = { label: '元に戻す', onClick: vi.fn() }
    c.show('削除しました', 'info', { action })
    c.show('削除しました', 'info', { action })
    expect(c.inbox.value).toHaveLength(2)
  })
})

describe('カードの同時表示数', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('カードは同時 3 件までで、あふれたら古いものを畳む (受信トレイには残る)', () => {
    const c = createToastCenter()
    for (const t of ['a', 'b', 'c', 'd']) c.show(t, 'error')
    expect(c.toasts.value.map((t) => t.text)).toEqual(['b', 'c', 'd'])
    expect(c.inbox.value).toHaveLength(4)
  })

  it('ホバー中のカードは押し出さない', () => {
    const c = createToastCenter()
    for (const t of ['a', 'b', 'c']) c.show(t, 'error')
    c.pause(c.toasts.value[0]?.id ?? -1)
    c.show('d', 'error')
    expect(c.toasts.value.map((t) => t.text)).toEqual(['a', 'c', 'd'])
  })
})

describe('1 件ごとの未読', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('開くと既読にするが、その回の表示では新着として見分けられる', () => {
    const c = createToastCenter()
    c.show('a', 'error')
    c.setInboxOpen(true)
    c.setInboxOpen(false)
    c.show('b', 'error')
    expect(c.unreadCount.value).toBe(1)
    c.setInboxOpen(true)
    expect(c.unreadCount.value).toBe(0)
    expect(c.inbox.value.every((t) => !t.unread)).toBe(true)
    const b = c.inbox.value.find((t) => t.text === 'b')
    const a = c.inbox.value.find((t) => t.text === 'a')
    expect(c.freshIds.value.has(b?.id ?? -1)).toBe(true)
    expect(c.freshIds.value.has(a?.id ?? -1)).toBe(false)
    c.setInboxOpen(false)
    expect(c.freshIds.value.size).toBe(0)
  })

  it('開いている間に来たものも新着として見せる', () => {
    const c = createToastCenter()
    c.setInboxOpen(true)
    c.show('a', 'error')
    expect(c.freshIds.value.has(c.inbox.value[0]?.id ?? -1)).toBe(true)
  })

  it('既読の通知がもう一度起きたら未読に戻る', () => {
    const c = createToastCenter()
    c.show('a', 'error')
    c.markInboxRead()
    c.show('a', 'error')
    expect(c.unreadCount.value).toBe(1)
  })
})

describe('操作の期限', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('既定では 5 分で受信トレイから操作ボタンを外す', () => {
    const c = createToastCenter()
    const onClick = vi.fn()
    c.show('削除しました', 'info', { action: { label: '元に戻す', onClick } })
    vi.advanceTimersByTime(4 * 60_000)
    expect(c.inbox.value[0]?.action).toBeDefined()
    vi.advanceTimersByTime(60_000)
    expect(c.inbox.value[0]?.action).toBeUndefined()
  })

  it('期限は show のオプションで変えられる', () => {
    const c = createToastCenter()
    c.show('削除しました', 'info', {
      action: { label: '元に戻す', onClick: vi.fn() },
      actionTimeout: 30_000,
    })
    vi.advanceTimersByTime(30_000)
    expect(c.inbox.value[0]?.action).toBeUndefined()
  })
})

describe('送り元とクリックで移る先', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('開くと onClick を呼び、カードと受信トレイを閉じる', () => {
    const c = createToastCenter()
    const onClick = vi.fn()
    c.show('権限がありません', 'error', { source: 'プラグイン A', onClick })
    const item = c.inbox.value[0]
    expect(item?.source).toBe('プラグイン A')
    c.setInboxOpen(true)
    c.open(item?.id ?? -1)
    expect(onClick).toHaveBeenCalledOnce()
    expect(c.inboxOpen.value).toBe(false)
    expect(c.toasts.value).toHaveLength(0)
  })
})

describe('受信トレイを開いている間', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('カードは出さず受信トレイにだけ足し、未読も増やさない', () => {
    const c = createToastCenter()
    c.setInboxOpen(true)
    c.show('失敗しました', 'error')
    expect(c.toasts.value).toHaveLength(0)
    expect(c.inbox.value.map((t) => t.text)).toEqual(['失敗しました'])
    expect(c.unreadCount.value).toBe(0)
  })
})
