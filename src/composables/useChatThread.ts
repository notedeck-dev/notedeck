import { computed, ref, shallowRef } from 'vue'
import type { ChatMessage } from '@/adapters/types'
import { type VariantKey, variantKey, variantKeyOf } from '@/services/noteKey'

/**
 * チャット会話 thread の状態機械 (#707)。DeckChatColumn から抽出した
 * 「cache hydrate → API reconcile → ライブ購読」ladder (#460 B-1/B-2) と
 * message id リスト操作をここに集約する。
 *
 * 依存は port として注入する。view (viewMode 切替 / スクロール / 通知音 /
 * ミュート判定 / エラー表示) は呼び出し側の責務。
 */

export type ChatThreadTarget =
  | { kind: 'room'; roomId: string }
  | { kind: 'user'; otherId: string }

/** chat_messages_cache の thread id 形式 (`r:<roomId>` / `u:<userId>`)。 */
export function chatThreadId(target: ChatThreadTarget): string {
  return target.kind === 'room' ? `r:${target.roomId}` : `u:${target.otherId}`
}

/** chatMessageStore の必要最小面。 */
export interface ChatThreadStorePort {
  put(msgs: ChatMessage[]): void
  resolve(keys: readonly VariantKey[]): ChatMessage[]
  remove(key: VariantKey): void
}

/** 解決済みの API 面 (adapter 相当)。メッセージは newest-first で返る。 */
export interface ChatThreadApiPort {
  fetch(
    target: ChatThreadTarget,
    opts?: { untilId?: string },
  ): Promise<ChatMessage[]>
}

export interface ChatThreadSubscription {
  dispose(): void
  /** 会話のチャンネルでサーバーに既読を送る (本家の `read`) */
  markRead(messageId: string): void
}

export interface ChatThreadDeps {
  store: ChatThreadStorePort
  /** キャッシュ thread 読み (token 不要、newest-first)。失敗は throw でよい。 */
  getCached(
    accountId: string,
    threadId: string,
    untilId: string | null,
    limit: number,
  ): Promise<ChatMessage[]>
  /**
   * アカウントの API 面を解決する。adapter を初期化できない場合は null
   * (ログイン中なら open は中断、ログアウト中はキャッシュのみで続行)。
   */
  resolveApi(accountId: string): Promise<ChatThreadApiPort | null>
  /** ライブ購読を開く。dispose 可能な handle を返す。 */
  subscribe(
    accountId: string,
    target: ChatThreadTarget,
    handlers: {
      onInsert(msg: ChatMessage): void
      onDelete(id: string): void
    },
  ): ChatThreadSubscription | Promise<ChatThreadSubscription>
  /**
   * WS 新着メッセージの通知。ミュート判定・通知音・スクロール・append の
   * 判断は呼び出し側が行う (append する場合は `append()` を呼ぶ)。
   */
  onIncoming(msg: ChatMessage): void
  /** アカウントの自分の userId (自分の送信には既読を送らない) */
  getMyUserId(accountId: string): string | undefined
  /** 会話を見ているか (ウィンドウが表に出ているか) */
  isViewing(): boolean
}

/** キャッシュからの 1 ページ取得件数 (open hydrate / loadOlder 共通)。 */
const CACHE_PAGE_SIZE = 50

export type ChatThreadOpenOutcome = 'opened' | 'aborted'

export function useChatThread(deps: ChatThreadDeps) {
  // メッセージは store からのキー参照のみで管理する (#460 B-5)。キーは
  // 「取得元アカウント + ID」(#1270)。`messageKeys` の真値を持ち、`messages` は
  // store から resolve した derived。
  const messageKeys = ref<VariantKey[]>([])
  const messages = computed(() => deps.store.resolve(messageKeys.value))
  const target = shallowRef<ChatThreadTarget | null>(null)
  /** 開いている会話のアカウント。WS の削除は ID だけ運ぶので、キーはこれで組む */
  let openAccountId: string | null = null

  let sub: ChatThreadSubscription | null = null

  function setMessages(msgs: ChatMessage[]) {
    deps.store.put(msgs)
    messageKeys.value = msgs.map(variantKeyOf)
  }

  /** 会話に載っているか (append 済みの着信や送信の重複判定) */
  function has(msg: ChatMessage): boolean {
    return messageKeys.value.includes(variantKeyOf(msg))
  }

  function append(msg: ChatMessage) {
    if (has(msg)) return
    deps.store.put([msg])
    messageKeys.value = [...messageKeys.value, variantKeyOf(msg)]
  }

  /** newest-first の older ページを oldest-first に直して前置する。 */
  function prepend(older: ChatMessage[]) {
    if (older.length === 0) return
    deps.store.put(older)
    const existing = new Set(messageKeys.value)
    const newKeys = older
      .slice()
      .reverse()
      .map(variantKeyOf)
      .filter((key) => !existing.has(key))
    messageKeys.value = [...newKeys, ...messageKeys.value]
  }

  /** 開いている会話のメッセージを ID で取り除く (WS の deleted / 自分の削除) */
  function remove(messageId: string) {
    const key = variantKey(openAccountId ?? '', messageId)
    messageKeys.value = messageKeys.value.filter((k) => k !== key)
    deps.store.remove(key)
  }

  async function loadCached(
    accountId: string,
    threadId: string,
    untilId: string | null,
  ): Promise<ChatMessage[]> {
    try {
      return await deps.getCached(accountId, threadId, untilId, CACHE_PAGE_SIZE)
    } catch {
      return []
    }
  }

  /**
   * thread を開く。ladder (#460):
   *   1. キャッシュ hydrate — あれば即表示して `onHydrated` を呼ぶ
   *   2. ログアウト中 / adapter 不在ならキャッシュのみで確定
   *   3. API fetch で完全置換 (server is source of truth)、失敗時は
   *      hydrate 済み表示を保つ
   *   4. ライブ購読を開く (購読エラーは throw され呼び出し側で表示する)
   *
   * ログイン中に adapter を解決できない場合は 'aborted' を返し、
   * 表示状態を変えない。
   */
  async function open(
    nextAccountId: string,
    nextTarget: ChatThreadTarget,
    opts: { loggedOut: boolean; onHydrated?(): void },
  ): Promise<ChatThreadOpenOutcome> {
    sub?.dispose()
    sub = null
    const accountId = nextAccountId

    const api = await deps.resolveApi(accountId)
    if (!api && !opts.loggedOut) return 'aborted'

    target.value = nextTarget
    openAccountId = accountId
    const threadId = chatThreadId(nextTarget)

    // 1. Cache hydrate (B-2): 即時に thread を表示する (newest-first → 表示順)
    const cached = await loadCached(accountId, threadId, null)
    const hydrated = cached.length > 0
    if (hydrated) {
      setMessages(cached.slice().reverse())
      opts.onHydrated?.()
    }

    // 2. ログアウト中はキャッシュだけで終わり。WS 購読も貼らない (B-1)。
    if (opts.loggedOut || !api) {
      if (!hydrated) setMessages([])
      return 'opened'
    }

    // 3. 並行で API fetch して reconcile
    try {
      const msgs = await api.fetch(nextTarget)
      setMessages(msgs.slice().reverse())
    } catch {
      // cache hydrate 済みならそのまま、空ならそのまま空
      if (!hydrated) setMessages([])
    }

    // 4. ライブ購読。見ている間に届いた他人のメッセージは既読をサーバーに送る
    // (#1222、本家 pages/chat/room.vue の onMessage と同じ)。送らないと未読の
    // まま残り、3 秒後に main の newChatMessage とプッシュ通知が来る
    const handle = await deps.subscribe(accountId, nextTarget, {
      onInsert: (msg) => {
        deps.onIncoming(msg)
        if (msg.fromUserId !== deps.getMyUserId(accountId) && deps.isViewing())
          handle.markRead(msg.id)
      },
      onDelete: (id) => remove(id),
    })
    sub = handle
    return 'opened'
  }

  /**
   * 過去分の取得。API → 失敗時キャッシュの fallback ladder。
   * @returns 1 件でも前置したら true
   */
  async function loadOlder(
    accountId: string,
    opts: { loggedOut: boolean },
  ): Promise<boolean> {
    const t = target.value
    const oldest = messages.value[0]
    if (!t || !oldest) return false

    const api = await deps.resolveApi(accountId)
    if (!api && !opts.loggedOut) return false

    const threadId = chatThreadId(t)
    let older: ChatMessage[]
    if (opts.loggedOut || !api) {
      older = await loadCached(accountId, threadId, oldest.id)
    } else {
      try {
        older = await api.fetch(t, { untilId: oldest.id })
      } catch {
        older = await loadCached(accountId, threadId, oldest.id)
      }
    }
    if (older.length === 0) return false
    prepend(older)
    return true
  }

  /** 購読を閉じて state を初期化する (history view へ戻る / unmount)。 */
  function close() {
    sub?.dispose()
    sub = null
    messageKeys.value = []
    target.value = null
    openAccountId = null
  }

  return {
    messageKeys,
    messages,
    target,
    open,
    loadOlder,
    append,
    has,
    remove,
    close,
  }
}
