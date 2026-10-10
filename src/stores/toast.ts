import { computed, ref } from 'vue'

// アプリ内通知 (VS Code の Notifications と同じ考え方)。
// - 警告・エラー・アクション付き (元に戻す等) は右下に通知カードを出し、
//   受信トレイ (通知センター) にも残す。カードを見逃しても後から読める
// - 「コピーしました」のような軽い成功・情報はカードを出さず、ボトムバーの
//   ステータス表示で短く知らせる。受信トレイには残さない。押して移る先が
//   あるもの (HEARTBEAT の報告など) は後から開けるよう軽いものに含めない
//   ステータス表示を押して受信トレイを開いたときだけ、今出ていた文言を一覧の
//   先頭に控えめに添える (#1218。閉じたら消え、未読にも数えない)
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
  /** 最後に起きた時刻 (ms) */
  time: number
  /** 同じ通知が起きた回数 (まとめて 1 件で持つ) */
  count: number
  /** 受信トレイで未読か */
  unread: boolean
  /** 送り元 (プラグイン名など)。見出しの補足に出す */
  source?: string
  /** 通知を押したときに移る先 */
  onClick?: () => void
}

export interface ToastOptions {
  action?: ToastAction
  /** 操作 (元に戻す等) を押せる期限 (ms)。過ぎたら受信トレイからボタンを外す */
  actionTimeout?: number
  source?: string
  onClick?: () => void
}

const CARD_DURATION: Record<ToastItem['type'], number> = {
  success: 2000,
  info: 3000,
  warning: 6000,
  error: 8000,
}

/** undo 等のアクション付きは押す猶予を長めに取る */
const ACTION_DURATION = 8000
/** 受信トレイで操作を押せる既定の期限。何時間も後の「元に戻す」は意図と食い違う */
const ACTION_TTL = 5 * 60_000
/** ステータス表示の時間 */
const STATUS_DURATION = 4000
/** ホバーを離れてからカードを消すまで */
const RESUME_DURATION = 2000
/** 受信トレイに残す件数 (古いものから捨てる) */
const INBOX_MAX = 50
/** カードの同時表示数 (VS Code と同じ)。あふれた分は受信トレイだけに残る */
const CARD_MAX = 3

function isLight(
  type: ToastItem['type'],
  action?: ToastAction,
  onClick?: () => void,
): boolean {
  return (type === 'success' || type === 'info') && !action && !onClick
}

/** まとめてよい同じ通知か。アクション付きはそれぞれ別の操作なのでまとめない */
function sameNotice(
  t: ToastItem,
  text: string,
  type: ToastItem['type'],
  source: string | undefined,
): boolean {
  return t.text === text && t.type === type && t.source === source && !t.action
}

/** 状態一式を作る (テストは個別に作り、アプリは下の単一インスタンスを使う) */
export function createToastCenter() {
  const toasts = ref<ToastItem[]>([])
  const inbox = ref<ToastItem[]>([])
  const status = ref<ToastItem | null>(null)
  const statusHosts = ref(0)
  /** 受信トレイ (通知センター) を開いているか。開いている間はカードを出さない */
  const inboxOpen = ref(false)
  /** 今回開いた受信トレイで新着として見せる id (開いた時点の未読 + 開いている間に来たもの) */
  const freshIds = ref<ReadonlySet<number>>(new Set())
  /** ステータス表示から開いたときだけ、一覧の先頭に添える直前の軽い通知 (#1218)。
   *  受信トレイには入れず、未読にも数えず、閉じたら消す */
  const recentStatus = ref<ToastItem | null>(null)
  /** 最後にステータス表示へ出したもの。退場のフェード中に押されても文言が合うよう、
   *  時間切れでは消さない */
  let lastStatus: ToastItem | null = null
  let nextId = 0
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  const paused = new Set<number>()
  const actionTimers = new Map<number, ReturnType<typeof setTimeout>>()
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

  function showCard(item: ToastItem) {
    const i = toasts.value.findIndex((t) => t.id === item.id)
    if (i >= 0) {
      const next = [...toasts.value]
      next[i] = item
      toasts.value = next
      if (!paused.has(item.id)) schedule(item.id, cardDuration(item))
      return
    }
    toasts.value = [...toasts.value, item]
    schedule(item.id, cardDuration(item))
    // あふれたら古いものから畳む。読んでいる (ホバー中の) カードは残す
    while (toasts.value.length > CARD_MAX) {
      const victim =
        toasts.value.find((t) => !paused.has(t.id)) ?? toasts.value[0]
      if (!victim) break
      dismiss(victim.id)
    }
  }

  function expireAction(id: number) {
    actionTimers.delete(id)
    const strip = (t: ToastItem) =>
      t.id === id ? { ...t, action: undefined } : t
    inbox.value = inbox.value.map(strip)
    toasts.value = toasts.value.map(strip)
  }

  function forgetAction(id: number) {
    const timer = actionTimers.get(id)
    if (timer) clearTimeout(timer)
    actionTimers.delete(id)
  }

  function setInbox(next: ToastItem[]) {
    const kept = next.slice(0, INBOX_MAX)
    for (const t of next.slice(INBOX_MAX)) forgetAction(t.id)
    inbox.value = kept
  }

  function addFresh(id: number) {
    freshIds.value = new Set([...freshIds.value, id])
  }

  function show(
    text: string,
    type: ToastItem['type'] = 'info',
    options?: ToastOptions,
  ) {
    const action = options?.action
    const source = options?.source
    const light = isLight(type, action, options?.onClick)
    const now = Date.now()

    if (light && statusHosts.value > 0) {
      status.value = {
        id: nextId++,
        text,
        type,
        time: now,
        count: 1,
        unread: false,
        source,
      }
      lastStatus = status.value
      if (statusTimer) clearTimeout(statusTimer)
      statusTimer = setTimeout(() => {
        status.value = null
        statusTimer = null
      }, STATUS_DURATION)
      return
    }

    // 軽いもの (ステータス表示の場所が無い画面) は受信トレイに残さず、カードだけ
    if (light) {
      const dup = toasts.value.find((t) => sameNotice(t, text, type, source))
      if (dup) {
        showCard({ ...dup, count: dup.count + 1, time: now })
        return
      }
      showCard({
        id: nextId++,
        text,
        type,
        time: now,
        count: 1,
        unread: false,
        source,
      })
      return
    }

    // 同じ通知は受信トレイで 1 件にまとめ、先頭に移して回数を数える
    // (カードが消えた後でも行を増やさない)
    const existing = action
      ? undefined
      : inbox.value.find((t) => sameNotice(t, text, type, source))
    let item: ToastItem
    if (existing) {
      item = {
        ...existing,
        count: existing.count + 1,
        time: now,
        unread: !inboxOpen.value,
        onClick: options?.onClick ?? existing.onClick,
      }
      setInbox([item, ...inbox.value.filter((t) => t.id !== existing.id)])
    } else {
      item = {
        id: nextId++,
        text,
        type,
        action,
        time: now,
        count: 1,
        // 開いている間は目の前で増えるので未読にしない (新着としては見せる)
        unread: !inboxOpen.value,
        source,
        onClick: options?.onClick,
      }
      if (action) {
        const id = item.id
        actionTimers.set(
          id,
          setTimeout(
            () => expireAction(id),
            options?.actionTimeout ?? ACTION_TTL,
          ),
        )
      }
      setInbox([item, ...inbox.value])
    }

    // 受信トレイを開いている間は、同じものが一覧に並ぶのでカードは出さない
    if (inboxOpen.value) {
      addFresh(item.id)
      return
    }
    showCard(item)
  }

  /** カードを閉じる (受信トレイには残る) */
  function dismiss(id: number) {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    paused.delete(id)
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  /** ホバー中は消さない */
  function pause(id: number) {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    paused.add(id)
  }

  function resume(id: number) {
    paused.delete(id)
    if (!toasts.value.some((t) => t.id === id)) return
    schedule(id, RESUME_DURATION)
  }

  function runAction(item: ToastItem) {
    // 期限切れの後に古い参照から押されても走らせない
    const current =
      inbox.value.find((t) => t.id === item.id) ??
      toasts.value.find((t) => t.id === item.id) ??
      item
    current.action?.onClick()
    dismiss(item.id)
    forgetAction(item.id)
    // 実行済みのアクションは受信トレイから押せないようにする (二重の undo 防止)
    inbox.value = inbox.value.map((t) =>
      t.id === item.id ? { ...t, action: undefined } : t,
    )
  }

  /** 通知を押したとき: 移る先があれば移り、カードと受信トレイを閉じる */
  function open(id: number) {
    const item =
      inbox.value.find((t) => t.id === id) ??
      toasts.value.find((t) => t.id === id)
    if (!item?.onClick) return
    item.onClick()
    dismiss(id)
    if (inboxOpen.value) setInboxOpen(false)
  }

  function removeFromInbox(id: number) {
    forgetAction(id)
    inbox.value = inbox.value.filter((t) => t.id !== id)
  }

  function clearInbox() {
    for (const t of inbox.value) forgetAction(t.id)
    inbox.value = []
    recentStatus.value = null
    for (const t of toasts.value) dismiss(t.id)
  }

  function markInboxRead() {
    if (!inbox.value.some((t) => t.unread)) return
    inbox.value = inbox.value.map((t) =>
      t.unread ? { ...t, unread: false } : t,
    )
  }

  function setInboxOpen(open: boolean) {
    inboxOpen.value = open
    recentStatus.value = null
    if (open) {
      freshIds.value = new Set(
        inbox.value.filter((t) => t.unread).map((t) => t.id),
      )
      markInboxRead()
      // 開いた受信トレイに同じものが並ぶので、出ているカードは畳む
      for (const t of toasts.value) dismiss(t.id)
    } else {
      freshIds.value = new Set()
    }
  }

  /** ステータス表示を押したとき: 受信トレイを開き、今出ていた文言を先頭に添える */
  function openFromStatus() {
    setInboxOpen(true)
    recentStatus.value = lastStatus
  }

  return {
    toasts,
    inbox,
    unreadCount: computed(() => inbox.value.filter((t) => t.unread).length),
    freshIds: computed(() => freshIds.value),
    status,
    inboxOpen: computed(() => inboxOpen.value),
    setInboxOpen,
    recentStatus: computed(() => recentStatus.value),
    openFromStatus,
    hasStatusHost: computed(() => statusHosts.value > 0),
    registerStatusHost,
    show,
    dismiss,
    pause,
    resume,
    runAction,
    open,
    removeFromInbox,
    clearInbox,
    markInboxRead,
  }
}

const center = createToastCenter()

export function useToast() {
  return center
}
