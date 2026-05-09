<script setup lang="ts">
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
} from 'vue'
import { createQuerySubscription } from '@/adapters/misskey/query'
import type {
  AvatarDecoration,
  ChannelSubscription,
  ChatMessage,
  NormalizedDriveFile,
} from '@/adapters/types'
import type { ChatReactionUser, JsonValue } from '@/bindings'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkAvatar from '@/components/common/MkAvatar.vue'
import MkChatMessage from '@/components/common/MkChatMessage.vue'
import MkDrivePicker from '@/components/common/MkDrivePicker.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import MkReactionPicker from '@/components/common/MkReactionPicker.vue'
import NoteScroller from '@/components/common/NoteScroller.vue'
import {
  type PrefetchTarget,
  useChatThreadPrefetch,
} from '@/composables/useChatThreadPrefetch'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { showLoginPrompt } from '@/composables/useLoginPrompt'
import { useMultiAccountAdapters } from '@/composables/useMultiAccountAdapters'
import type { NoteScrollerExpose } from '@/composables/useNoteScrollerRef'
import { useNoteSound } from '@/composables/useNoteSound'
import { getAccountAvatarUrl, useAccountsStore } from '@/stores/accounts'
import { useChatMessageStore } from '@/stores/chatMessageStore'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useServersStore } from '@/stores/servers'
import { AppError } from '@/utils/errors'
import { formatTime } from '@/utils/formatTime'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DeckColumn from './DeckColumn.vue'

/**
 * `stream-chat-message-reacted` / `stream-chat-message-unreacted` の WS payload (#460)。
 * notecli `StreamChatMessageReactedEvent` / `StreamChatMessageUnreactedEvent` と同形だが
 * specta export 対象外なので frontend 側で手書き定義する。
 */
interface StreamChatReactionPayload {
  accountId: string
  subscriptionId: string
  messageId: string
  reaction: string
  user: ChatReactionUser | null
}

const props = defineProps<{
  column: DeckColumnType
}>()

const isCrossAccount = computed(() => props.column.accountId == null)

const {
  account,
  columnThemeVars,
  serverIconUrl,
  serverInfoImageUrl,
  serverNotFoundImageUrl,
  serverErrorImageUrl,
  isLoading,
  error,
  initAdapter,
  getAdapter,
} = useColumnSetup(() => props.column)

const accountsStore = useAccountsStore()
const multiAdapters = useMultiAccountAdapters()
const chatMessageStore = useChatMessageStore()
const serversStore = useServersStore()
const { prefetch: prefetchThreads } = useChatThreadPrefetch()

/** cross-account history entry のサーバー favicon URL を解決する。 */
function resolveEntryServerIcon(host: string): string {
  return (
    serversStore.servers.get(host)?.iconUrl || `https://${host}/favicon.ico`
  )
}

/** 2 アカウント以上ログイン中の cross-account view でのみサーバーバッジを出す。 */
const showServerBadge = computed(
  () => isCrossAccount.value && accountsStore.accounts.length >= 2,
)

function entryBadgeTitle(entry: HistoryEntry): string {
  const acc = accountsStore.accounts.find((a) => a.id === entry.accountId)
  if (!acc) return entry.serverHost
  return `@${acc.username}@${acc.host}`
}

/**
 * 操作対象アカウントが投稿可能 (token 保持) かをチェックする (#460)。
 * ログアウト中・ゲストアカウントでチャットカラムを開けるようになったので、
 * リアクションピッカーを開く / 送信 / 添付など auth 必須操作の **ボタン押下直後** に
 * 呼んで早期 return する。トーストは TL カラム等と同じ共通 `showLoginPrompt()` を使う。
 */
function ensureActiveAccountAuth(): boolean {
  const accId = activeAccountId.value
  const acc = accountsStore.accounts.find((a) => a.id === accId)
  if (!acc?.hasToken) {
    showLoginPrompt()
    return false
  }
  return true
}

/**
 * 投稿/リアクション/添付などの auth 必須操作時の **遅延エラーハンドリング** (#460)。
 * 通常は `ensureActiveAccountAuth` で先回り誘導しているが、ネットワーク経由で
 * token 失効が判明するケースもある (サーバ BAN / 別端末でログアウト等) ので保険として残す。
 */
function handleActionError(e: unknown) {
  const err = AppError.from(e)
  if (err.isAuth) {
    showLoginPrompt()
    return
  }
  error.value = err
}

const chatSound = useNoteSound(() => account.value?.host, 'syuilo/waon')

const viewMode = ref<'history' | 'conversation'>('history')
// B-5: messages は chatMessageStore からの ID 参照のみで管理する。
// `messageIds` の真値を持ち、`messages` は store から resolve した derived。
// これにより WS の reaction/unreaction event が store.applyUpdate 経由で
// in-place 更新されると、UI が自動的に再描画される。
const messageIds = ref<string[]>([])
const messages = computed(() => chatMessageStore.resolve(messageIds.value))
const currentOtherId = ref<string | null>(null)
const currentRoomId = ref<string | null>(null)
const conversationTitle = ref('')
const conversationOtherAvatarUrl = ref<string | null>(null)
const conversationAccountId = ref<string | null>(null)
const conversationServerHost = ref<string | null>(null)
const messageText = ref('')
const isSending = ref(false)
const showEmojiPicker = ref(false)
const showDrivePicker = ref(false)
const attachedFile = ref<NormalizedDriveFile | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

let chatSub: ChannelSubscription | null = null

// --- Cross-account history ---
interface HistoryEntry {
  key: string
  accountId: string
  serverHost: string
  message: ChatMessage
  isRoom: boolean
  name: string
  /** 表示名 (`name`) が user-defined か (false なら fallback の username/roomId を使用)。 */
  hasName: boolean
  /** name に含まれる `:shortcode:` を画像に解決するための辞書。 */
  emojis?: Record<string, string>
  avatarUrl?: string
  avatarDecorations?: AvatarDecoration[]
  otherId?: string
  roomId?: string
}

const historyEntries = shallowRef<HistoryEntry[]>([])
const loadProgress = ref<{ host: string; done: boolean }[]>([])

// Per-account: chatHistory も messageIds ベースで store から resolve する (B-5)。
const chatHistoryIds = ref<string[]>([])
const chatHistory = computed(() =>
  chatMessageStore.resolve(chatHistoryIds.value),
)

const myUserId = computed(() => {
  if (isCrossAccount.value) {
    if (!conversationAccountId.value) return undefined
    return accountsStore.accounts.find(
      (a) => a.id === conversationAccountId.value,
    )?.userId
  }
  if (!account.value) return undefined
  return account.value.userId
})

// --- Active account for conversation (cross-account or per-account) ---
const activeAccountId = computed(() =>
  isCrossAccount.value ? conversationAccountId.value : props.column.accountId,
)
const activeServerHost = computed(() => {
  if (isCrossAccount.value) return conversationServerHost.value
  return account.value?.host ?? null
})

async function connect() {
  error.value = null
  isLoading.value = true

  if (isCrossAccount.value) {
    await connectCrossAccount()
  } else {
    await connectPerAccount()
  }
}

/**
 * ログアウト中 / API エラー時のキャッシュ fallback (#460)。
 * `apiGetCachedChatHistory` はトークンを要求しないので、ログアウト後でも
 * `chat_messages_cache` に残っている履歴を表示できる。
 */
async function loadCachedHistory(accountId: string): Promise<ChatMessage[]> {
  try {
    return unwrap(
      await commands.apiGetCachedChatHistory(accountId, 100),
    ) as unknown as ChatMessage[]
  } catch {
    return []
  }
}

/**
 * cross-account history view の entry 構築 (#460)。
 * 全アカウントから集めた message を thread (room/DM) 単位の最新 1 件に dedup する。
 * cache hydrate phase / API reconcile phase の両方から呼ぶ。
 */
function buildCrossAccountHistoryEntries(
  allMessages: { msg: ChatMessage; accountId: string; host: string }[],
): HistoryEntry[] {
  const entries: HistoryEntry[] = []
  const seen = new Set<string>()
  const sorted = [...allMessages].sort(
    (a, b) =>
      new Date(b.msg.createdAt).getTime() - new Date(a.msg.createdAt).getTime(),
  )

  for (const { msg, accountId, host } of sorted) {
    const uid = accountsStore.accounts.find((a) => a.id === accountId)?.userId
    if (msg.toRoomId) {
      const key = `${accountId}:room:${msg.toRoomId}`
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({
        key,
        accountId,
        serverHost: host,
        message: msg,
        isRoom: true,
        name: msg.toRoom?.name || 'Room',
        hasName: !!msg.toRoom?.name,
        // ChatRoom には emojis 辞書が無いので、最新メッセージ送信者の辞書で代替する
        // (同一サーバー上の shortcode は同じ辞書で解決できる)
        emojis: msg.fromUser?.emojis ?? undefined,
        avatarUrl: msg.fromUser?.avatarUrl ?? undefined,
        avatarDecorations: msg.fromUser?.avatarDecorations,
        roomId: msg.toRoomId,
      })
    } else {
      const otherId = msg.fromUserId === uid ? msg.toUserId : msg.fromUserId
      if (!otherId) continue
      const key = `${accountId}:user:${otherId}`
      if (seen.has(key)) continue
      seen.add(key)
      const other = msg.fromUserId === uid ? msg.toUser : msg.fromUser
      entries.push({
        key,
        accountId,
        serverHost: host,
        message: msg,
        isRoom: false,
        name: other?.name || other?.username || otherId,
        hasName: !!other?.name,
        emojis: other?.emojis ?? undefined,
        avatarUrl: other?.avatarUrl ?? undefined,
        avatarDecorations: other?.avatarDecorations,
        otherId,
      })
    }
  }

  return entries
}

/**
 * Per-account history (chatHistory: ChatMessage[]) から prefetch 対象 thread を
 * 抽出する (#460 B-6)。`fromUserId === uid` で送信側 / 受信側を判定して
 * thread の相手 (otherId or roomId) を導出する。
 */
function buildPerAccountPrefetchTargets(
  accountId: string,
  uid: string | undefined,
  msgs: ChatMessage[],
): PrefetchTarget[] {
  const seen = new Set<string>()
  const targets: PrefetchTarget[] = []
  for (const msg of msgs) {
    if (msg.toRoomId) {
      const key = `room:${msg.toRoomId}`
      if (seen.has(key)) continue
      seen.add(key)
      targets.push({ accountId, isRoom: true, targetId: msg.toRoomId })
    } else {
      const otherId = msg.fromUserId === uid ? msg.toUserId : msg.fromUserId
      if (!otherId) continue
      const key = `user:${otherId}`
      if (seen.has(key)) continue
      seen.add(key)
      targets.push({ accountId, isRoom: false, targetId: otherId })
    }
  }
  return targets
}

async function connectPerAccount() {
  if (!account.value) {
    isLoading.value = false
    return
  }

  // 1. キャッシュから先に読み込んで即時 render (B-2 hydrate)。これにより
  //    「起動直後/タブ切替直後にチャット履歴が瞬時に出る」体感を実現する。
  if (props.column.accountId) {
    const cached = await loadCachedHistory(props.column.accountId)
    if (cached.length > 0) {
      setChatHistory(cached)
      isLoading.value = false
    }
  }

  // ログアウト中はキャッシュだけで終わり (B-1)。「ログアウト中」バナーは
  // DeckColumn が自動表示する。
  if (!account.value.hasToken) {
    isLoading.value = false
    return
  }

  // 2. 並行で API fetch して reconcile (server is source of truth で完全置換)
  try {
    const adapter = await initAdapter()
    if (!adapter) return

    const userHistory = await adapter.api.getChatHistory()

    let roomHistory: ChatMessage[] = []
    if (props.column.accountId) {
      roomHistory = unwrap(
        await commands.apiGetChatHistory(
          props.column.accountId,
          100,
          true,
          null,
        ),
      ) as unknown as ChatMessage[]
    }

    setChatHistory(
      [...userHistory, ...roomHistory].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    )

    // B-6: 各 thread の messages を裏で prefetch (UI 変更なし)。
    // `chat/history` API は thread あたり最新 1 件しか返さないため、
    // history view を表示しただけでは過去に開いたことのない thread が
    // 最新 1 件しか cache に入らない。これを埋める。
    if (props.column.accountId) {
      void prefetchThreads(
        buildPerAccountPrefetchTargets(
          props.column.accountId,
          account.value.userId,
          [...userHistory, ...roomHistory],
        ),
      )
    }
  } catch (e) {
    // キャッシュで既に hydrate 済みならエラー表示しない (B-1 fallback と同じ判断)。
    // 「オフライン」表示は DeckColumn の offlineBanner に任せる。
    if (chatHistoryIds.value.length === 0) {
      error.value = AppError.from(e)
    }
  } finally {
    isLoading.value = false
  }
}

/**
 * Per-account history を store + IDs に流す (B-5)。`chatMessageStore.put` で
 * 実体を入れ、`chatHistoryIds` に id を持たせて UI には computed `chatHistory`
 * から resolve させる。
 */
function setChatHistory(msgs: ChatMessage[]) {
  chatMessageStore.put(msgs)
  chatHistoryIds.value = msgs.map((m) => m.id)
}

/**
 * Conversation の messages を store + IDs に流す (B-5)。
 */
function setMessages(msgs: ChatMessage[]) {
  chatMessageStore.put(msgs)
  messageIds.value = msgs.map((m) => m.id)
}

function appendMessage(msg: ChatMessage) {
  if (messageIds.value.includes(msg.id)) return
  chatMessageStore.put([msg])
  messageIds.value = [...messageIds.value, msg.id]
}

function prependMessages(older: ChatMessage[]) {
  if (older.length === 0) return
  chatMessageStore.put(older)
  const existing = new Set(messageIds.value)
  const newIds = older
    .slice()
    .reverse()
    .map((m) => m.id)
    .filter((id) => !existing.has(id))
  messageIds.value = [...newIds, ...messageIds.value]
}

function removeMessage(messageId: string) {
  messageIds.value = messageIds.value.filter((id) => id !== messageId)
  chatMessageStore.remove(messageId)
}

async function connectCrossAccount() {
  // ログアウト中のアカウントもキャッシュから履歴を出す (#460)。`hasToken` filter を外す。
  const accounts = accountsStore.accounts
  if (accounts.length === 0) {
    isLoading.value = false
    return
  }

  loadProgress.value = accounts.map((acc) => ({
    host: acc.host,
    done: false,
  }))

  // 1. 全アカウントのキャッシュを並列取得して即時 render (B-2 hydrate)
  const cachedResults = await Promise.all(
    accounts.map(async (acc) => {
      const cached = await loadCachedHistory(acc.id)
      return cached.map((msg) => ({
        msg,
        accountId: acc.id,
        host: acc.host,
      }))
    }),
  )
  const cachedAll = cachedResults.flat()
  if (cachedAll.length > 0) {
    chatMessageStore.put(cachedAll.map((x) => x.msg))
    historyEntries.value = buildCrossAccountHistoryEntries(cachedAll)
    isLoading.value = false
  }

  // 2. 並行で API fetch して reconcile。ログイン中アカウントは fresh、
  //    ログアウト中は引き続き cache (上の hydrate と同じ結果)、API エラー時は cache fallback。
  const results = await Promise.allSettled(
    accounts.map(async (acc, i) => {
      try {
        if (!acc.hasToken) {
          const cached = await loadCachedHistory(acc.id)
          return cached.map((msg) => ({
            msg,
            accountId: acc.id,
            host: acc.host,
          }))
        }

        const adapter = await multiAdapters.getOrCreate(acc.id)
        if (!adapter) return []
        try {
          const userHistory = await adapter.api.getChatHistory()
          let roomHistory: ChatMessage[] = []
          try {
            roomHistory = unwrap(
              await commands.apiGetChatHistory(acc.id, 100, true, null),
            ) as unknown as ChatMessage[]
          } catch {
            // room chat not supported
          }
          return [...userHistory, ...roomHistory].map((msg) => ({
            msg,
            accountId: acc.id,
            host: acc.host,
          }))
        } catch {
          // API エラー → キャッシュ fallback (UI 上の indicator は省略)
          const cached = await loadCachedHistory(acc.id)
          return cached.map((msg) => ({
            msg,
            accountId: acc.id,
            host: acc.host,
          }))
        }
      } finally {
        loadProgress.value = loadProgress.value.map((p, j) =>
          j === i ? { ...p, done: true } : p,
        )
      }
    }),
  )

  const allMessages: { msg: ChatMessage; accountId: string; host: string }[] =
    []
  for (const r of results) {
    if (r.status === 'fulfilled') allMessages.push(...r.value)
  }
  chatMessageStore.put(allMessages.map((x) => x.msg))
  historyEntries.value = buildCrossAccountHistoryEntries(allMessages)
  isLoading.value = false
  loadProgress.value = []

  // B-6: ログイン中アカウントの thread を裏で prefetch (UI 変更なし)。
  const tokenAccountIds = new Set(
    accounts.filter((a) => a.hasToken).map((a) => a.id),
  )
  const prefetchTargets: PrefetchTarget[] = []
  for (const e of historyEntries.value) {
    if (!tokenAccountIds.has(e.accountId)) continue
    const tid = e.isRoom ? e.roomId : e.otherId
    if (!tid) continue
    prefetchTargets.push({
      accountId: e.accountId,
      isRoom: e.isRoom,
      targetId: tid,
    })
  }
  void prefetchThreads(prefetchTargets)
}

// Per-account history entries (legacy)
function getHistoryEntries() {
  const seen = new Set<string>()
  const entries: {
    key: string
    message: ChatMessage
    isRoom: boolean
    name: string
    hasName: boolean
    emojis?: Record<string, string>
    avatarUrl?: string
    avatarDecorations?: AvatarDecoration[]
  }[] = []

  for (const msg of chatHistory.value) {
    if (msg.toRoomId) {
      if (seen.has(`room:${msg.toRoomId}`)) continue
      seen.add(`room:${msg.toRoomId}`)
      entries.push({
        key: `room:${msg.toRoomId}`,
        message: msg,
        isRoom: true,
        name: msg.toRoom?.name || 'Room',
        hasName: !!msg.toRoom?.name,
        emojis: msg.fromUser?.emojis ?? undefined,
        avatarUrl: msg.fromUser?.avatarUrl ?? undefined,
        avatarDecorations: msg.fromUser?.avatarDecorations,
      })
    } else {
      const otherId =
        msg.fromUserId === myUserId.value ? msg.toUserId : msg.fromUserId
      if (!otherId || seen.has(`user:${otherId}`)) continue
      seen.add(`user:${otherId}`)
      const other =
        msg.fromUserId === myUserId.value ? msg.toUser : msg.fromUser
      entries.push({
        key: `user:${otherId}`,
        message: msg,
        isRoom: false,
        name: other?.name || other?.username || otherId,
        hasName: !!other?.name,
        emojis: other?.emojis ?? undefined,
        avatarUrl: other?.avatarUrl ?? undefined,
        avatarDecorations: other?.avatarDecorations,
      })
    }
  }

  return entries
}

async function openConversation(
  entry: HistoryEntry | ReturnType<typeof getHistoryEntries>[0],
) {
  chatSub?.dispose()
  chatSub = null

  conversationTitle.value = entry.name
  conversationOtherAvatarUrl.value = entry.avatarUrl ?? null
  isLoading.value = true
  error.value = null

  // Determine accountId and serverHost
  const entryAccountId =
    'accountId' in entry ? entry.accountId : props.column.accountId
  const entryServerHost =
    'serverHost' in entry ? entry.serverHost : account.value?.host
  conversationAccountId.value = entryAccountId ?? null
  conversationServerHost.value = entryServerHost ?? null

  if (!entryAccountId) {
    isLoading.value = false
    return
  }

  // ログアウト判定 (cross-account では entry のアカウント、per-account では現アカウント)
  const entryAccount = accountsStore.accounts.find(
    (a) => a.id === entryAccountId,
  )
  const isLoggedOut = !entryAccount?.hasToken

  // Get adapter: cross-account uses multiAdapters, per-account uses getAdapter()
  const adapter = isCrossAccount.value
    ? await multiAdapters.getOrCreate(entryAccountId)
    : getAdapter()
  if (!adapter && !isLoggedOut) {
    isLoading.value = false
    return
  }

  // ログアウト中はキャッシュから読むだけ。WS subscription も貼らない。
  // closure capture 後の narrowing が効かないため、ローカルに保持する。
  const accountIdForCache = entryAccountId
  async function loadCachedThread(threadId: string): Promise<ChatMessage[]> {
    try {
      const cached = unwrap(
        await commands.apiGetCachedChatThreadMessages(
          accountIdForCache,
          threadId,
          null,
          50,
        ),
      ) as unknown as ChatMessage[]
      return cached.slice().reverse()
    } catch {
      return []
    }
  }

  try {
    if (entry.isRoom) {
      const roomId =
        'roomId' in entry ? entry.roomId : (entry.message.toRoomId ?? '')
      currentRoomId.value = roomId ?? ''
      currentOtherId.value = null
      const threadId = `r:${currentRoomId.value}`

      // 1. Cache hydrate (B-2): 即時に thread を表示する。
      const cached = await loadCachedThread(threadId)
      if (cached.length > 0) {
        setMessages(cached)
        viewMode.value = 'conversation'
        isLoading.value = false
        scrollToBottom()
      }

      if (isLoggedOut || !adapter) {
        if (cached.length === 0) setMessages([])
      } else {
        // 2. 並行で API fetch して reconcile
        try {
          const msgs = await adapter.api.getChatRoomMessages(
            currentRoomId.value,
          )
          setMessages(msgs.slice().reverse())
        } catch {
          // cache hydrate 済みならそのまま、空ならそのまま空 (error は最終 catch で吸収)
          if (cached.length === 0) setMessages([])
        }
        if (isCrossAccount.value) adapter.stream.connect()
        chatSub = createQuerySubscription({
          open: async () =>
            unwrap(
              await commands.querySubscribeChatRoom(
                entryAccountId,
                currentRoomId.value ?? '',
              ),
            ),
          onInsert: (item) => onNewMessage(item as unknown as ChatMessage),
          onDelete: (id) => onMessageDeleted(id),
        })
      }
    } else {
      const otherId =
        'otherId' in entry && entry.otherId
          ? entry.otherId
          : entry.message.fromUserId === myUserId.value
            ? (entry.message.toUserId ?? '')
            : entry.message.fromUserId
      currentOtherId.value = otherId
      currentRoomId.value = null
      const threadId = `u:${otherId}`

      // 1. Cache hydrate (B-2)
      const cached = await loadCachedThread(threadId)
      if (cached.length > 0) {
        setMessages(cached)
        viewMode.value = 'conversation'
        isLoading.value = false
        scrollToBottom()
      }

      if (isLoggedOut || !adapter) {
        if (cached.length === 0) setMessages([])
      } else {
        // 2. 並行で API fetch して reconcile
        try {
          const msgs = await adapter.api.getChatUserMessages(otherId)
          setMessages(msgs.slice().reverse())
        } catch {
          if (cached.length === 0) setMessages([])
        }
        if (isCrossAccount.value) adapter.stream.connect()
        chatSub = createQuerySubscription({
          open: async () =>
            unwrap(
              await commands.querySubscribeChatUser(entryAccountId, otherId),
            ),
          onInsert: (item) => onNewMessage(item as unknown as ChatMessage),
          onDelete: (id) => onMessageDeleted(id),
        })
      }
    }
    viewMode.value = 'conversation'
    scrollToBottom()
  } catch (e) {
    error.value = AppError.from(e)
  } finally {
    isLoading.value = false
  }
}

function onNewMessage(msg: ChatMessage) {
  if (messageIds.value.includes(msg.id)) return
  appendMessage(msg)
  if (!props.column.soundMuted) chatSound.play()
  scrollToBottom()
}

function onMessageDeleted(messageId: string) {
  removeMessage(messageId)
}

function goBack() {
  chatSub?.dispose()
  chatSub = null
  viewMode.value = 'history'
  messageIds.value = []
  currentOtherId.value = null
  currentRoomId.value = null
  conversationAccountId.value = null
  conversationServerHost.value = null
}

const canSend = computed(() => {
  if (isSending.value) return false
  return messageText.value.trim().length > 0 || attachedFile.value !== null
})

async function sendMessage() {
  if (!canSend.value) return
  const accId = activeAccountId.value
  if (!accId) return
  if (!ensureActiveAccountAuth()) return

  isSending.value = true
  try {
    const params: Record<string, unknown> = {
      text: messageText.value.trim() || undefined,
    }
    if (currentOtherId.value) params.userId = currentOtherId.value
    if (currentRoomId.value) params.roomId = currentRoomId.value
    if (attachedFile.value) params.fileId = attachedFile.value.id

    const sent = unwrap(
      await commands.apiCreateMessagingMessage(accId, params as JsonValue),
    ) as unknown as ChatMessage
    messageText.value = ''
    attachedFile.value = null
    if (!messageIds.value.includes(sent.id)) {
      appendMessage(sent)
      scrollToBottom()
    }
  } catch (e) {
    handleActionError(e)
  } finally {
    isSending.value = false
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

function pickEmoji(reaction: string) {
  const textarea = textareaRef.value
  if (textarea) {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    messageText.value =
      messageText.value.slice(0, start) +
      reaction +
      messageText.value.slice(end)
    nextTick(() => {
      const pos = start + reaction.length
      textarea.setSelectionRange(pos, pos)
      textarea.focus()
    })
  } else {
    messageText.value += reaction
  }
  showEmojiPicker.value = false
}

/**
 * 通常ノートの投稿フォーム ([MkPostForm.vue]) と同じ MkDrivePicker フローに統一する。
 * Drive 上の既存ファイルを選ぶ操作と新規アップロードの両方が picker 内で完結する。
 */
function toggleDrivePicker() {
  if (!ensureActiveAccountAuth()) return
  showDrivePicker.value = !showDrivePicker.value
}

function onDrivePicked(files: NormalizedDriveFile[]) {
  // Misskey の chat/messages/create は fileId を 1 つしか受け付けないので先頭のみ採用する。
  if (files.length > 0 && files[0]) attachedFile.value = files[0]
  showDrivePicker.value = false
}

function removeAttachment() {
  attachedFile.value = null
}

// --- Reactions ---
const reactionTargetId = ref<string | null>(null)
const showReactionPicker = ref(false)

async function handleReact(messageId: string, reaction: string) {
  const accId = activeAccountId.value
  if (!accId) return
  // ピッカーを開く前に auth チェック (#460)。ログアウト中なら早期にトースト誘導。
  if (!ensureActiveAccountAuth()) return

  if (!reaction) {
    // Empty reaction = open picker
    reactionTargetId.value = messageId
    showReactionPicker.value = true
    return
  }

  try {
    unwrap(await commands.apiReactChatMessage(accId, messageId, reaction))
    // Optimistically add reaction to local state
    updateMessageReaction(messageId, reaction, true)
  } catch (e) {
    handleActionError(e)
  }
}

async function handleUnreact(messageId: string, reaction: string) {
  const accId = activeAccountId.value
  if (!accId) return
  if (!ensureActiveAccountAuth()) return

  try {
    unwrap(await commands.apiUnreactChatMessage(accId, messageId, reaction))
    updateMessageReaction(messageId, reaction, false)
  } catch (e) {
    handleActionError(e)
  }
}

function pickReaction(reaction: string) {
  if (reactionTargetId.value) {
    handleReact(reactionTargetId.value, reaction)
  }
  closeReactionPicker()
}

function closeReactionPicker() {
  showReactionPicker.value = false
  showEmojiPicker.value = false
  reactionTargetId.value = null
}

/**
 * 楽観的な reaction/unreaction 更新を chatMessageStore.applyUpdate() 経由に
 * 統一する (B-3 + B-5)。WS event と同じ経路で in-place 更新するため、後続で
 * 流れてくる WS `react`/`unreact` event は dedup window で吸収される。
 */
function updateMessageReaction(
  messageId: string,
  reaction: string,
  add: boolean,
) {
  const accId = activeAccountId.value
  const acc = isCrossAccount.value
    ? accountsStore.accounts.find((a) => a.id === accId)
    : account.value
  if (!acc) return

  const reactor: ChatReactionUser = {
    id: acc.userId ?? '',
    username: acc.username ?? '',
    name: acc.displayName ?? null,
    host: acc.host ?? null,
    avatarUrl: acc.avatarUrl ?? null,
  }
  chatMessageStore.applyUpdate(
    add
      ? {
          type: 'reacted',
          messageId,
          userId: reactor.id,
          reaction,
          reactor,
        }
      : {
          type: 'unreacted',
          messageId,
          userId: reactor.id,
          reaction,
          reactor,
        },
  )
}

const chatScroller = ref<NoteScrollerExpose | null>(null)
function scrollToBottom() {
  requestAnimationFrame(() => {
    if (messages.value.length === 0) return
    chatScroller.value?.scrollToIndex(messages.value.length - 1, {
      align: 'end',
      behavior: 'instant',
    })
  })
}

async function loadOlder() {
  if (isLoading.value || messages.value.length === 0) return

  const accId = conversationAccountId.value ?? props.column.accountId
  if (!accId) return
  const conversationAccount = accountsStore.accounts.find((a) => a.id === accId)
  const isLoggedOut = !conversationAccount?.hasToken

  const adapter = isCrossAccount.value
    ? await multiAdapters.getOrCreate(accId)
    : getAdapter()
  if (!adapter && !isLoggedOut) return

  const oldest = messages.value[0]
  if (!oldest) return
  isLoading.value = true

  // ログアウト/エラー時のキャッシュからの過去取得
  const accountIdForCache = accId
  const oldestForCache = oldest
  const threadId = currentRoomId.value
    ? `r:${currentRoomId.value}`
    : currentOtherId.value
      ? `u:${currentOtherId.value}`
      : null
  async function loadCachedOlder(): Promise<ChatMessage[]> {
    if (!threadId) return []
    try {
      const cached = unwrap(
        await commands.apiGetCachedChatThreadMessages(
          accountIdForCache,
          threadId,
          oldestForCache.id,
          50,
        ),
      ) as unknown as ChatMessage[]
      return cached
    } catch {
      return []
    }
  }

  try {
    let older: ChatMessage[]
    if (isLoggedOut || !adapter) {
      older = await loadCachedOlder()
    } else if (currentRoomId.value) {
      try {
        older = await adapter.api.getChatRoomMessages(currentRoomId.value, {
          untilId: oldest.id,
        })
      } catch {
        older = await loadCachedOlder()
      }
    } else if (currentOtherId.value) {
      try {
        older = await adapter.api.getChatUserMessages(currentOtherId.value, {
          untilId: oldest.id,
        })
      } catch {
        older = await loadCachedOlder()
      }
    } else {
      return
    }
    if (older.length > 0) {
      const prevFirstId = messageIds.value[0]
      prependMessages(older)
      // Restore scroll position to the previously first message after prepend
      if (prevFirstId) {
        await nextTick()
        const newIndex = messageIds.value.indexOf(prevFirstId)
        if (newIndex >= 0) {
          chatScroller.value?.scrollToIndex(newIndex, {
            align: 'start',
            behavior: 'instant',
          })
        }
      }
    }
  } catch (e) {
    error.value = AppError.from(e)
  } finally {
    isLoading.value = false
  }
}

let lastScrollCheck = 0

function handleScroll() {
  const now = Date.now()
  if (now - lastScrollCheck < 200) return
  lastScrollCheck = now
  const el = chatScroller.value?.getElement()
  if (!el) return
  if (el.scrollTop < 100) {
    loadOlder()
  }
}

function scrollToTop(smooth = false) {
  chatScroller.value?.scrollToIndex(0, {
    align: 'start',
    behavior: smooth ? 'smooth' : 'instant',
  })
}

// B-5: 表示中の message id を chatMessageStore に登録して eviction から保護する。
// view mode に応じて conversation の messageIds、history view の chatHistoryIds と
// historyEntries 内の message.id を返す。
let unregisterRoot: (() => void) | null = null

// B-3: WS reaction event を `chatMessageStore.applyUpdate()` に流して UI 反映する。
// 楽観的更新と同じ経路なので chatMessageStore の dedup window で重複を吸収する。
const reactionUnlisteners: UnlistenFn[] = []

async function subscribeReactionEvents() {
  const reactedUnlisten = await listen<StreamChatReactionPayload>(
    'stream-chat-message-reacted',
    (event) => {
      const { messageId, reaction, user } = event.payload
      chatMessageStore.applyUpdate({
        type: 'reacted',
        messageId,
        userId: user?.id ?? null,
        reaction,
        reactor: user ?? null,
      })
    },
  )
  reactionUnlisteners.push(reactedUnlisten)

  const unreactedUnlisten = await listen<StreamChatReactionPayload>(
    'stream-chat-message-unreacted',
    (event) => {
      const { messageId, reaction, user } = event.payload
      chatMessageStore.applyUpdate({
        type: 'unreacted',
        messageId,
        userId: user?.id ?? null,
        reaction,
        reactor: user ?? null,
      })
    },
  )
  reactionUnlisteners.push(unreactedUnlisten)
}

onMounted(() => {
  unregisterRoot = chatMessageStore.registerRoot(() => {
    if (viewMode.value === 'conversation') return messageIds.value
    // history view: per-account の chatHistoryIds + cross-account historyEntries
    const ids: string[] = [...chatHistoryIds.value]
    for (const e of historyEntries.value) ids.push(e.message.id)
    return ids
  })
  subscribeReactionEvents()
  connect()
})

onBeforeUnmount(() => {
  chatSub?.dispose()
  chatSub = null
  for (const unlisten of reactionUnlisteners) unlisten()
  reactionUnlisteners.length = 0
  unregisterRoot?.()
  unregisterRoot = null
})
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="viewMode === 'conversation' ? conversationTitle : (column.name || 'チャット')"
    :theme-vars="columnThemeVars"
    require-account
    @header-click="scrollToTop(true)"
  >
    <template #header-icon>
      <i
        v-if="viewMode === 'conversation'"
        :class="[$style.tlHeaderIcon, $style.clickable]"
        class="ti ti-arrow-left"
        @click.stop="goBack"
      />
      <i v-else class="ti ti-messages" :class="$style.tlHeaderIcon" />
    </template>

    <template #header-meta>
      <div v-if="!isCrossAccount && account" :class="$style.headerAccount">
        <img :src="getAccountAvatarUrl(account)" :class="$style.headerAvatar" />
        <img
          :class="$style.headerFavicon"
          :src="serverIconUrl || `https://${account.host}/favicon.ico`"
          :title="account.host"
        />
      </div>
    </template>

    <ColumnEmptyState
      v-if="error && viewMode === 'history'"
      :message="error.message"
      :image-url="serverErrorImageUrl"
      is-error
    />

    <!-- Per-account progress (cross-account) -->
    <div v-if="isCrossAccount && loadProgress.length > 0" :class="$style.chatProgress">
      <span
        v-for="(p, i) in loadProgress"
        :key="i"
        :class="[$style.progressDot, { [$style.done]: p.done }]"
        :title="p.host"
      />
    </div>

    <!-- History View: Cross-account -->
    <div v-if="isCrossAccount && viewMode === 'history'" :class="$style.chatBody">
      <ColumnEmptyState v-if="historyEntries.length === 0 && !isLoading" message="会話はありません" :image-url="serverInfoImageUrl" />

      <div v-else :class="$style.historyList">
        <button
          v-for="entry in historyEntries"
          :key="entry.key"
          :class="$style.historyItem"
          @click="openConversation(entry)"
        >
          <div :class="$style.historyAvatarWrap">
            <MkAvatar
              v-if="entry.avatarUrl"
              :avatar-url="entry.avatarUrl"
              :decorations="entry.avatarDecorations ?? []"
              :size="36"
            />
            <div v-else :class="$style.historyAvatarPlaceholder">
              <i :class="entry.isRoom ? 'ti ti-users' : 'ti ti-user'" />
            </div>
            <img
              v-if="showServerBadge"
              :src="resolveEntryServerIcon(entry.serverHost)"
              :class="$style.historyServerBadge"
              :title="entryBadgeTitle(entry)"
              @error="($event.target as HTMLImageElement).src = '/server-icon-error.svg'"
            />
          </div>
          <div :class="$style.historyInfo">
            <div :class="$style.historyName">
              <MkMfm
                v-if="entry.hasName"
                :text="entry.name"
                :emojis="entry.emojis"
                :server-host="entry.serverHost"
                plain
              />
              <template v-else>{{ entry.name }}</template>
            </div>
            <div :class="$style.historyPreview">{{ entry.message.text || '(ファイル)' }}</div>
          </div>
          <div :class="$style.historyMeta">
            <span :class="$style.historyTime">{{ formatTime(entry.message.createdAt) }}</span>
          </div>
        </button>
      </div>
    </div>

    <!-- History View: Per-account -->
    <div v-else-if="!isCrossAccount && viewMode === 'history'" :class="$style.chatBody">
      <ColumnEmptyState v-if="chatHistory.length === 0 && !isLoading" message="会話はありません" :image-url="serverInfoImageUrl" />

      <div v-else :class="$style.historyList">
        <button
          v-for="entry in getHistoryEntries()"
          :key="entry.key"
          :class="$style.historyItem"
          @click="openConversation(entry)"
        >
          <MkAvatar
            v-if="entry.avatarUrl"
            :avatar-url="entry.avatarUrl"
            :decorations="entry.avatarDecorations ?? []"
            :size="36"
          />
          <div v-else :class="$style.historyAvatarPlaceholder">
            <i :class="entry.isRoom ? 'ti ti-users' : 'ti ti-user'" />
          </div>
          <div :class="$style.historyInfo">
            <div :class="$style.historyName">
              <MkMfm
                v-if="entry.hasName"
                :text="entry.name"
                :emojis="entry.emojis"
                :server-host="account?.host"
                plain
              />
              <template v-else>{{ entry.name }}</template>
            </div>
            <div :class="$style.historyPreview">{{ entry.message.text || '(ファイル)' }}</div>
          </div>
        </button>
      </div>
    </div>

    <!-- Conversation View -->
    <div v-else-if="viewMode === 'conversation'" :class="[$style.chatBody, $style.conversation]" @click="closeReactionPicker">
      <NoteScroller
        ref="chatScroller"
        :items="messages"
        :estimated-height="80"
        :class="$style.messagesContainer"
        @scroll="handleScroll"
      >
        <template #prepend>
          <div v-if="isLoading" :class="$style.loadingMore"><LoadingSpinner /></div>
        </template>
        <template #default="{ item: msg }">
          <div :class="$style.chatMsgGap">
            <MkChatMessage
              :message="msg"
              :my-user-id="myUserId"
              :account-id="activeAccountId ?? undefined"
              :server-host="activeServerHost ?? undefined"
              :other-avatar-url="currentRoomId ? undefined : conversationOtherAvatarUrl ?? undefined"
              @react="handleReact"
              @unreact="handleUnreact"
            />
          </div>
        </template>
      </NoteScroller>

      <div v-if="error" :class="$style.chatError">{{ error.message }}</div>

      <!-- Reaction picker popup -->
      <div v-if="showReactionPicker && activeAccountId && activeServerHost" :class="$style.chatReactionPicker" @click.stop>
        <MkReactionPicker
          :server-host="activeServerHost"
          :account-id="activeAccountId"
          @pick="pickReaction"
        />
      </div>

      <div :class="$style.chatInput">
        <!-- File attachment preview -->
        <div v-if="attachedFile" :class="$style.chatAttachment">
          <img
            v-if="attachedFile.type.startsWith('image/')"
            :src="attachedFile.thumbnailUrl || attachedFile.url"
            :class="$style.chatAttachmentThumb"
          />
          <span v-else :class="$style.chatAttachmentName">{{ attachedFile.name }}</span>
          <button :class="$style.chatAttachmentRemove" @click="removeAttachment">
            <i class="ti ti-x" />
          </button>
        </div>
        <div :class="$style.chatInputRow">
          <div :class="$style.chatInputActions">
            <button
              :class="[$style.chatActionBtn, { [$style.active]: showDrivePicker }]"
              title="ドライブ"
              @click.stop="toggleDrivePicker"
            >
              <i class="ti ti-photo" />
            </button>
            <button :class="$style.chatActionBtn" title="絵文字" @click.stop="showEmojiPicker = !showEmojiPicker">
              <i class="ti ti-mood-happy" />
            </button>
          </div>
          <textarea
            ref="textareaRef"
            v-model="messageText"
            :class="$style.chatTextarea"
            placeholder="メッセージ..."
            rows="1"
            @keydown="handleKeydown"
          />
          <button
            :class="$style.chatSend"
            :disabled="!canSend"
            @click="sendMessage"
          >
            <i class="ti ti-send" />
          </button>
        </div>
        <!-- Emoji picker popup -->
        <div v-if="showEmojiPicker && activeAccountId && activeServerHost" :class="$style.chatEmojiPopup" @click.stop>
          <MkReactionPicker
            :server-host="activeServerHost"
            :account-id="activeAccountId"
            @pick="pickEmoji"
          />
        </div>
        <!-- Drive picker (below input row) -->
        <div v-if="showDrivePicker && activeAccountId" :class="$style.chatDrivePopup" @click.stop>
          <MkDrivePicker
            :account-id="activeAccountId"
            @pick="onDrivePicked"
            @close="showDrivePicker = false"
          />
        </div>
      </div>
    </div>
  </DeckColumn>
</template>

<style lang="scss" module>
@use './column-common.module.scss';

.clickable {
  cursor: pointer;
  opacity: 0.8;

  &:hover {
    opacity: 1;
  }
}

.chatBody {
  composes: tlBody from './column-common.module.scss';
}

.chatProgress {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px;
  flex-shrink: 0;
}

.progressDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--nd-fg);
  opacity: 0.15;
  transition: opacity var(--nd-duration-slower), background var(--nd-duration-slower);

  &.done {
    background: var(--nd-accent);
    opacity: 0.8;
  }
}

.historyList {
  flex: 1;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.historyItem {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: none;
  color: var(--nd-fg);
  text-align: left;
  cursor: pointer;
  contain: layout style paint;
  content-visibility: auto;
  contain-intrinsic-size: auto 65px;
  border-bottom: 1px solid var(--nd-divider, rgba(255, 255, 255, 0.05));

  &:hover {
    background: var(--nd-panelHighlight, rgba(255, 255, 255, 0.03));
  }

  :deep(.mk-avatar) {
    flex-shrink: 0;
  }

  :deep(.mk-avatar:hover) {
    transform: none;
  }
}

.historyAvatarWrap {
  position: relative;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
}

.historyAvatarPlaceholder {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--nd-buttonBg, rgba(255, 255, 255, 0.1));
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.5;
}

.historyServerBadge {
  position: absolute;
  top: -2px;
  right: -4px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  object-fit: contain;
  background: var(--nd-panel);
  box-shadow: 0 0 0 2px var(--nd-panel);
  user-select: none;
  -webkit-user-select: none;
}

.historyInfo {
  flex: 1;
  min-width: 0;
}

.historyName {
  font-size: 0.9em;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.historyPreview {
  font-size: 0.8em;
  opacity: 0.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

.historyMeta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
}

.historyTime {
  font-size: 0.75em;
  opacity: 0.5;
}

.messagesContainer {
  flex: 1;
  overflow-x: clip;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.chatMsgGap {
  padding-bottom: 2px;
}

.chatError {
  padding: 4px 12px;
  font-size: 0.8em;
  color: var(--nd-love);
}

.chatInput {
  display: flex;
  flex-direction: column;
  padding: 6px 8px 8px;
  border-top: 1px solid var(--nd-divider, rgba(255, 255, 255, 0.05));
  background: var(--nd-panel);
  position: relative;
}

.chatAttachment {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  margin-bottom: 4px;
  background: var(--nd-panelHighlight, rgba(255, 255, 255, 0.05));
  border-radius: var(--nd-radius-md);
}

.chatAttachmentThumb {
  width: 48px;
  height: 48px;
  border-radius: var(--nd-radius-sm);
  object-fit: cover;
}

.chatAttachmentName {
  font-size: 0.8em;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.chatAttachmentRemove {
  background: none;
  border: none;
  color: var(--nd-fg);
  opacity: 0.5;
  cursor: pointer;
  padding: 4px;
  font-size: 0.9em;

  &:hover {
    opacity: 1;
  }
}

.chatInputRow {
  display: flex;
  align-items: flex-end;
  gap: 6px;
}

.chatInputActions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.chatActionBtn {
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  color: var(--nd-fg);
  opacity: 0.5;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 1.1em;

  &:hover {
    opacity: 0.8;
    background: var(--nd-panelHighlight, rgba(255, 255, 255, 0.05));
  }

  &.active {
    opacity: 1;
    color: var(--nd-accent);
    background: var(--nd-accentedBg, rgba(134, 179, 0, 0.15));
  }
}

.chatTextarea {
  flex: 1;
  resize: none;
  border: none;
  background: var(--nd-panelHighlight, rgba(255, 255, 255, 0.05));
  color: var(--nd-fg);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 0.9em;
  font-family: inherit;
  line-height: 1.4;
  max-height: 120px;
  outline: none;
  field-sizing: content;

  &::placeholder {
    opacity: 0.4;
  }
}

.chatSend {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent, #fff);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 1em;

  &:disabled {
    opacity: 0.3;
    cursor: default;
  }

  transition: filter var(--nd-duration-base);

  &:not(:disabled):hover {
    filter: brightness(1.1);
  }
}

.chatEmojiPopup {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  max-height: 320px;
  overflow: auto;
  background: var(--nd-popup);
  border-radius: 12px 12px 0 0;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.3);
  z-index: var(--nd-z-menu);
}

.chatDrivePopup {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: var(--nd-popup);
  border-radius: 12px 12px 0 0;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.3);
  z-index: var(--nd-z-menu);
}

.chatReactionPicker {
  flex-shrink: 0;
  max-height: 280px;
  overflow: auto;
  border-top: 1px solid var(--nd-divider, rgba(255, 255, 255, 0.05));
  background: var(--nd-panel);
}

/* Empty placeholder classes for dynamic binding */
.done {}
</style>
