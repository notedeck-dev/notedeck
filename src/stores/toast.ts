import { computed, ref } from 'vue'

// アプリ内通知 (VS Code の Notifications と同じ考え方)。
// - 警告・エラー・アクション付き (元に戻す等) は右下に通知カードを出し、
//   受信トレイ (通知センター) にも残す。カードを見逃しても後から読める
// - 「コピーしました」のような軽い成功・情報はカードを出さず、ボトムバーの
//   ステータス表示で短く知らせる。受信トレイには残さない
// - ステータス表示の場所が無い画面 (モバイル / PiP / ブラウザ) では、軽いものも
//   カードで出す
// 呼び出し側の API (`useToast().show`) は従来のトーストと同じ。

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastItem {
  id: number
  text: string
  type: 'success' | 'info' | 'warning' | 'error'
  action?: ToastAction
  /** 発生時刻 (ms) */
  time: number
}

const CARD_DURATION: Record<ToastItem['type'], number> = {
  success: 2000,
  info: 3000,
  warning: 6000,
  error: 8000,
}

/** undo 等のアクション付きは押す猶予を長めに取る */
const ACTION_DURATION = 8000
/** ステータス表示の時間 */
const STATUS_DURATION = 4000
/** ホバーを離れてからカードを消すまで */
const RESUME_DURATION = 2000
/** 受信トレイに残す件数 (古いものから捨てる) */
const INBOX_MAX = 50

function isLight(type: ToastItem['type'], action?: ToastAction): boolean {
  return (type === 'success' || type === 'info') && !action
}

/** 状態一式を作る (テストは個別に作り、アプリは下の単一インスタンスを使う) */
export function createToastCenter() {
  const toasts = ref<ToastItem[]>([])
  const inbox = ref<ToastItem[]>([])
  const unreadCount = ref(0)
  const status = ref<ToastItem | null>(null)
  const statusHosts = ref(0)
  /** 受信トレイ (通知センター) を開いているか。開いている間はカードを出さない */
  const inboxOpen = ref(false)
  let nextId = 0
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  let statusTimer: ReturnType<typeof setTimeout> | null = null

  /** ステータス表示を持つ部品 (ボトムバー) がマウント中に登録する */
  function registerStatusHost(): () => void {
    statusHosts.value++
    let done = false
    return () => {
      if (done) return
      done = true
      statusHosts.value--
    }
  }

  function schedule(id: number, ms: number) {
    const old = timers.get(id)
    if (old) clearTimeout(old)
    timers.set(
      id,
      setTimeout(() => dismiss(id), ms),
    )
  }

  function cardDuration(item: ToastItem): number {
    return item.action ? ACTION_DURATION : CARD_DURATION[item.type]
  }

  function show(
    text: string,
    type: ToastItem['type'] = 'info',
    options?: { action?: ToastAction },
  ) {
    const action = options?.action
    const light = isLight(type, action)

    if (light && statusHosts.value > 0) {
      status.value = { id: nextId++, text, type, time: Date.now() }
      if (statusTimer) clearTimeout(statusTimer)
      statusTimer = setTimeout(() => {
        status.value = null
        statusTimer = null
      }, STATUS_DURATION)
      return
    }

    // 同一内容が表示中なら積み直さず表示時間だけ延長する (連続発火の多重表示防止)
    if (!action) {
      const dup = toasts.value.find(
        (t) => t.text === text && t.type === type && !t.action,
      )
      if (dup) {
        schedule(dup.id, cardDuration(dup))
        return
      }
    }

    const item: ToastItem = {
      id: nextId++,
      text,
      type,
      action,
      time: Date.now(),
    }
    toasts.value = [...toasts.value, item]
    schedule(item.id, cardDuration(item))

    if (!light) {
      inbox.value = [item, ...inbox.value].slice(0, INBOX_MAX)
      unreadCount.value++
    }
  }

  /** カードを閉じる (受信トレイには残る) */
  function dismiss(id: number) {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  /** ホバー中は消さない */
  function pause(id: number) {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
  }

  function resume(id: number) {
    if (!toasts.value.some((t) => t.id === id)) return
    schedule(id, RESUME_DURATION)
  }

  function runAction(item: ToastItem) {
    item.action?.onClick()
    dismiss(item.id)
    // 実行済みのアクションは受信トレイから押せないようにする (二重の undo 防止)
    inbox.value = inbox.value.map((t) =>
      t.id === item.id ? { ...t, action: undefined } : t,
    )
  }

  function removeFromInbox(id: number) {
    inbox.value = inbox.value.filter((t) => t.id !== id)
  }

  function clearInbox() {
    inbox.value = []
    unreadCount.value = 0
    for (const t of toasts.value) dismiss(t.id)
  }

  function markInboxRead() {
    unreadCount.value = 0
  }

  function setInboxOpen(open: boolean) {
    inboxOpen.value = open
    if (open) {
      markInboxRead()
      // 開いた受信トレイに同じものが並ぶので、出ているカードは畳む
      for (const t of toasts.value) dismiss(t.id)
    }
  }

  return {
    toasts,
    inbox,
    unreadCount: computed(() => unreadCount.value),
    status,
    inboxOpen: computed(() => inboxOpen.value),
    setInboxOpen,
    hasStatusHost: computed(() => statusHosts.value > 0),
    registerStatusHost,
    show,
    dismiss,
    pause,
    resume,
    runAction,
    removeFromInbox,
    clearInbox,
    markInboxRead,
  }
}

const center = createToastCenter()

export function useToast() {
  return center
}
