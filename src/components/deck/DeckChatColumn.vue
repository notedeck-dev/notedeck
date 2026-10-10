<script setup lang="ts">
import type { UnlistenFn } from '@tauri-apps/api/event'
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import {
  createQuerySubscription,
  queryItemAsChatMessage,
} from '@/adapters/misskey/query'
import type { ChatMessage, NormalizedDriveFile } from '@/adapters/types'
import { type ChatReactionUser, events } from '@/bindings'
import AppTime from '@/components/common/AppTime.vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkAvatar from '@/components/common/MkAvatar.vue'
import MkChatMessage from '@/components/common/MkChatMessage.vue'
import MkDrivePicker from '@/components/common/MkDrivePicker.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import NoteScroller from '@/components/common/NoteScroller.vue'
import {
  type ChatThreadTarget,
  useChatThread,
} from '@/composables/useChatThread'
import {
  type PrefetchTarget,
  useChatThreadPrefetch,
} from '@/composables/useChatThreadPrefetch'
import { useChatVisibility } from '@/composables/useChatVisibility'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { showLoginPrompt } from '@/composables/useLoginPrompt'
import { useMultiAccountAdapters } from '@/composables/useMultiAccountAdapters'
import { useNewChatMessages } from '@/composables/useNewChatMessages'
import type { NoteScrollerExpose } from '@/composables/useNoteScrollerRef'
import { useNoteSound } from '@/composables/useNoteSound'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { i18n } from '@/i18n'
import { chatDateSeparators } from '@/services/chatDateSeparators'
import {
  buildCrossAccountHistoryEntries,
  buildPerAccountHistoryEntries,
  buildPerAccountPrefetchTargets,
  chatMessageMatchesSearch,
  type CrossAccountChatHistoryEntry as HistoryEntry,
  isChatHistoryUnread,
  isChatMessageInThread,
  matchesChatSearch,
  newChatMessageForHistory,
  type PerAccountChatHistoryEntry as PerAccountHistoryEntry,
  withLatestChatMessage,
  withLatestCrossAccountMessage,
} from '@/services/chatHistoryEntries'
import { getAccountAvatarUrl, useAccountsStore } from '@/stores/accounts'
import { useChatMessageStore } from '@/stores/chatMessageStore'
import { type DeckColumn as DeckColumnType, useDeckStore } from '@/stores/deck'
import { useServersStore } from '@/stores/servers'
import { AppError } from '@/utils/errors'
import { isImeComposing } from '@/utils/ime'
import { proxyThumbUrl } from '@/utils/mediaProxy'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DeckColumn from './DeckColumn.vue'

const MkReactionPicker = defineAsyncComponent(
  () => import('@/components/common/MkReactionPicker.vue'),
)

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
const deckStore = useDeckStore()
const multiAdapters = useMultiAccountAdapters()
const chatMessageStore = useChatMessageStore()
const serversStore = useServersStore()
const { prefetch: prefetchThreads } = useChatThreadPrefetch()

/** cross-account history entry のサーバー favicon URL を解決する。 */
function resolveEntryServerIcon(host: string): string {
  const url =
    serversStore.servers.get(host)?.iconUrl || `https://${host}/favicon.ico`
  return proxyThumbUrl(url, 28) ?? url
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

// ミュートユーザーのチャットを「存在ごと」隠す（#575、本家にない独自仕様）
const { isPartnerMuted, isMessageHidden } = useChatVisibility()

const viewMode = ref<'history' | 'conversation'>('history')

// 会話 thread の状態機械 (#707): cache hydrate → API reconcile → ライブ購読の
// ladder (#460 B-1/B-2) と message id 管理 (B-5) は useChatThread に抽出済み。
// ここは port (Tauri commands / adapter 解決 / WS 購読) を束ねるだけ。
const thread = useChatThread({
  store: chatMessageStore,
  getCached: async (accountId, threadId, untilId, limit) =>
    unwrap(
      await commands.apiGetCachedChatThreadMessages(
        accountId,
        threadId,
        untilId,
        limit,
      ),
    ) as unknown as ChatMessage[],
  resolveApi: async (accountId) => {
    // cross-account は multiAdapters、per-account はカラムの adapter
    const adapter = isCrossAccount.value
      ? await multiAdapters.getOrCreate(accountId)
      : getAdapter()
    if (!adapter) return null
    return {
      fetch: (target, opts) =>
        target.kind === 'room'
          ? adapter.api.getChatRoomMessages(target.roomId, opts)
          : adapter.api.getChatUserMessages(target.otherId, opts),
    }
  },
  subscribe: async (accountId, target, handlers) => {
    // cross-account は共有 adapter の WS を明示的に張る
    // (per-account はカラムの adapter が接続済み)
    if (isCrossAccount.value) {
      const adapter = await multiAdapters.getOrCreate(accountId)
      adapter?.stream.connect()
    }
    return createQuerySubscription({
      open: async () =>
        unwrap(
          target.kind === 'room'
            ? await commands.querySubscribeChatRoom(accountId, target.roomId)
            : await commands.querySubscribeChatUser(accountId, target.otherId),
        ),
      onInsert: (item) => {
        const msg = queryItemAsChatMessage(item)
        if (msg) handlers.onInsert(msg)
      },
      onDelete: (id) => handlers.onDelete(id),
    })
  },
  onIncoming: (msg) => onNewMessage(msg),
})

const { messages, messageIds } = thread
const currentRoomId = computed(() =>
  thread.target.value?.kind === 'room' ? thread.target.value.roomId : null,
)
const currentOtherId = computed(() =>
  thread.target.value?.kind === 'user' ? thread.target.value.otherId : null,
)
const conversationTitle = ref('')
const conversationOtherAvatarUrl = ref<string | null>(null)
const conversationAccountId = ref<string | null>(null)
const conversationServerHost = ref<string | null>(null)
const messageText = ref('')
const isSending = ref(false)
const showEmojiPicker = ref(false)
const showDrivePicker = ref(false)
// ピッカーの退場は _popup.scss の panelLeave (--nd-duration-base) と同じ時間
const PICKER_LEAVE_MS = 150
const emojiPickerT = useVaporTransition(showEmojiPicker, {
  leaveDuration: PICKER_LEAVE_MS,
})
const drivePickerT = useVaporTransition(showDrivePicker, {
  leaveDuration: PICKER_LEAVE_MS,
})
const attachedFile = ref<NormalizedDriveFile | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

// --- Cross-account history ---
// entry 構築ロジックは utils/chatHistoryEntries.ts に抽出済み (#707)
const historyEntries = shallowRef<HistoryEntry[]>([])

/** entry 構築時にアカウント id から自分の userId を引く (自分発信の DM 判定用)。 */
function getUserIdForAccount(accountId: string): string | undefined {
  return accountsStore.accounts.find((a) => a.id === accountId)?.userId
}

// 履歴 view (#483) の絞り込み。AI カラム ([DeckAiColumn.vue]) と同じ
// header-extra 入力 + 大文字小文字無視の substring match パターン。
// 検索対象は thread 名 (`entry.name`) + 直近メッセージのプレビュー本文
// (`entry.message.text`)。
const searchQuery = ref('')

const filteredHistoryEntries = computed<HistoryEntry[]>(() =>
  historyEntries.value.filter(
    (e) =>
      !(!e.isRoom && isPartnerMuted(e.accountId, e.otherId)) &&
      matchesChatSearch(searchQuery.value, e.name, e.message.text),
  ),
)

// 会話 view 内検索 (#483 v1)。トグル式で、有効時は messages を本文 + 送信者名で
// 大文字小文字無視 substring filter する。loadOlder と scrollToBottom は
// searchQuery 非空時に抑止して、検索中の自動スクロール / 履歴継ぎ足しを止める。
const showConvSearch = ref(false)
const convSearchQuery = ref('')
const convSearchInputRef = ref<HTMLInputElement | null>(null)
// ヘッダーのボタンから下りてくるので、メニューと同じ登場 / 退場にする
// (退場は _popup.scss の menuLeave = --nd-duration-base)
const convSearchT = useVaporTransition(showConvSearch, {
  leaveDuration: PICKER_LEAVE_MS,
})

function toggleConvSearch() {
  showConvSearch.value = !showConvSearch.value
  if (showConvSearch.value) {
    nextTick(() => convSearchInputRef.value?.focus())
  } else {
    convSearchQuery.value = ''
  }
}

function closeConvSearch() {
  showConvSearch.value = false
  convSearchQuery.value = ''
}

const filteredMessages = computed(() => {
  // ミュート送信者の発言は常に隠す（room 内個別発言にも適用）。検索の前段。
  const acc = activeAccountId.value
  const visible = messages.value.filter((m) => !isMessageHidden(acc, m))
  const q = convSearchQuery.value
  if (!q.trim()) return visible
  return visible.filter((m) => chatMessageMatchesSearch(q, m))
})

// 日付が変わる所に区切りを出す (#1207)。表示している並びで判定する
const dateSeparators = computed(() =>
  chatDateSeparators(filteredMessages.value),
)

const hasNoConvSearchHits = computed(
  () =>
    convSearchQuery.value.trim() !== '' && filteredMessages.value.length === 0,
)

const isConvSearching = computed(() => convSearchQuery.value.trim() !== '')

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

// 1on1 リアクションの reactor 逆算 (本家準拠) 用の自分のアバター。
const myAvatarUrl = computed(() => {
  const acc = isCrossAccount.value
    ? accountsStore.accounts.find((a) => a.id === conversationAccountId.value)
    : account.value
  return acc?.avatarUrl ?? null
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

  if (props.column.accountId) newChatMessages.watch([props.column.accountId])

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

async function connectCrossAccount() {
  // ログアウト中のアカウントもキャッシュから履歴を出す (#460)。`hasToken` filter を外す。
  const accounts = accountsStore.accounts
  if (accounts.length === 0) {
    isLoading.value = false
    return
  }

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
    historyEntries.value = buildCrossAccountHistoryEntries(
      cachedAll,
      getUserIdForAccount,
    )
    isLoading.value = false
  }

  newChatMessages.watch(accounts.filter((a) => a.hasToken).map((a) => a.id))

  // 2. 並行で API fetch して reconcile。ログイン中アカウントは fresh、
  //    ログアウト中は引き続き cache (上の hydrate と同じ結果)、API エラー時は cache fallback。
  const results = await Promise.allSettled(
    accounts.map(async (acc) => {
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
        // API エラー → キャッシュ fallback
        const cached = await loadCachedHistory(acc.id)
        return cached.map((msg) => ({
          msg,
          accountId: acc.id,
          host: acc.host,
        }))
      }
    }),
  )

  const allMessages: { msg: ChatMessage; accountId: string; host: string }[] =
    []
  for (const r of results) {
    if (r.status === 'fulfilled') allMessages.push(...r.value)
  }
  chatMessageStore.put(allMessages.map((x) => x.msg))
  historyEntries.value = buildCrossAccountHistoryEntries(
    allMessages,
    getUserIdForAccount,
  )
  isLoading.value = false

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

/**
 * 履歴を経由せず直接ユーザー会話を開くための軽量ターゲット
 * (プロフィールからの DM 起動など)。`message` を持たないため
 * `openConversation` 内の `entry.message` 参照は `'message' in entry` でガードする。
 */
interface ConversationTarget {
  isRoom: false
  name: string
  avatarUrl?: string
  accountId: string
  serverHost: string | null
  otherId: string
}

const perAccountHistoryEntries = computed<PerAccountHistoryEntry[]>(() =>
  buildPerAccountHistoryEntries(chatHistory.value, myUserId.value),
)

const filteredPerAccountEntries = computed<PerAccountHistoryEntry[]>(() =>
  perAccountHistoryEntries.value.filter(
    (e) =>
      !(!e.isRoom && isPartnerMuted(props.column.accountId, e.otherId)) &&
      matchesChatSearch(searchQuery.value, e.name, e.message.text),
  ),
)

// 開いた会話の未読の点は、履歴を取り直すまで手元で消しておく
// (会話を開くと本家側で既読になるが、履歴の entry は取り直さないと変わらない)
const openedMessageIds = ref(new Set<string>())

/** 履歴の未読の点 (#1207)。判定は isChatHistoryUnread */
function isUnread(
  message: ChatMessage,
  accountId: string | null,
  myId: string | undefined,
): boolean {
  const acc = accountsStore.accounts.find((a) => a.id === accountId)
  return isChatHistoryUnread(message, myId, {
    loggedOut: !acc?.hasToken,
    openedIds: openedMessageIds.value,
  })
}

const hasNoSearchHits = computed(() => {
  if (!searchQuery.value.trim()) return false
  return isCrossAccount.value
    ? filteredHistoryEntries.value.length === 0 &&
        historyEntries.value.length > 0
    : filteredPerAccountEntries.value.length === 0 &&
        perAccountHistoryEntries.value.length > 0
})

async function openConversation(
  entry: HistoryEntry | PerAccountHistoryEntry | ConversationTarget,
) {
  // 検索 state は thread をまたいで持ち越さない。
  showConvSearch.value = false
  convSearchQuery.value = ''

  if ('message' in entry) {
    openedMessageIds.value = new Set(openedMessageIds.value).add(
      entry.message.id,
    )
  }
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

  const target: ChatThreadTarget = entry.isRoom
    ? {
        kind: 'room',
        roomId:
          ('roomId' in entry ? entry.roomId : undefined) ??
          ('message' in entry ? (entry.message.toRoomId ?? '') : ''),
      }
    : {
        kind: 'user',
        otherId:
          'otherId' in entry && entry.otherId
            ? entry.otherId
            : 'message' in entry
              ? entry.message.fromUserId === myUserId.value
                ? (entry.message.toUserId ?? '')
                : entry.message.fromUserId
              : '',
      }

  try {
    const outcome = await thread.open(entryAccountId, target, {
      loggedOut: isLoggedOut,
      // cache hydrate できた時点で即表示する (B-2)
      onHydrated: () => {
        viewMode.value = 'conversation'
        isLoading.value = false
        scrollToBottom()
      },
    })
    if (outcome === 'aborted') return
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
  // ミュート送信者の着信は存在ごと無視（append もサウンドもしない）
  if (isMessageHidden(activeAccountId.value, msg)) return
  // append で DOM が伸びる前に「最下部付近にいたか」を測る
  const wasNearBottom = isNearBottom()
  thread.append(msg)
  if (!props.column.soundMuted) chatSound.play()
  // 検索中・過去ログ閲覧中は表示位置を維持する (強制スクロールで読書位置を失わない)。
  if (!isConvSearching.value && wasNearBottom) scrollToBottom()
}

function goBack() {
  reflectLatestIntoHistory()
  thread.close()
  viewMode.value = 'history'
  conversationAccountId.value = null
  conversationServerHost.value = null
  // 検索 state は view ごとに独立。view 切替時に持ち越さない。
  searchQuery.value = ''
  showConvSearch.value = false
  convSearchQuery.value = ''
}

/**
 * 会話で見た最新メッセージ (受信・送信) を履歴の並びとプレビューに反映する
 * (#1216)。履歴は購読していないので、取り直すまで古いままになっていた。
 * 見た会話なので未読の点も出さない
 */
function reflectLatestIntoHistory() {
  const latest = messages.value.at(-1)
  if (!latest) return
  openedMessageIds.value = new Set(openedMessageIds.value).add(latest.id)
  if (isCrossAccount.value) {
    const accountId = conversationAccountId.value
    const host =
      conversationServerHost.value ??
      accountsStore.accounts.find((a) => a.id === accountId)?.host
    if (!accountId || !host) return
    chatMessageStore.put([latest])
    historyEntries.value = withLatestCrossAccountMessage(
      historyEntries.value,
      { msg: latest, accountId, host },
      getUserIdForAccount,
    )
  } else {
    setChatHistory(withLatestChatMessage(chatHistory.value, latest))
  }
}

// 別の会話に来た新着を履歴の並び・プレビュー・未読の点に反映する。会話を
// 開いている間も履歴は裏で直しておき、戻ったときに古い並びを見せない
const newChatMessages = useNewChatMessages((accountId, received) => {
  if (isCrossAccount.value) {
    if (!accountsStore.accounts.some((a) => a.id === accountId)) return
  } else if (accountId !== props.column.accountId) {
    return
  }
  const msg = newChatMessageForHistory(received)
  const myId = getUserIdForAccount(accountId)
  // 開いている会話の分も来る (会話のチャンネルで既読を送っていないため)。
  // 会話にはもう出ていて、履歴へは戻るときに reflectLatestIntoHistory が足す。
  // ここで store に入れると、届くまでの 3 秒に付いたリアクションを古い本文で潰す
  if (
    viewMode.value === 'conversation' &&
    activeAccountId.value === accountId &&
    isChatMessageInThread(msg, thread.target.value, myId)
  ) {
    return
  }
  if (isCrossAccount.value) {
    const host = accountsStore.accounts.find((a) => a.id === accountId)?.host
    if (!host) return
    chatMessageStore.put([msg])
    historyEntries.value = withLatestCrossAccountMessage(
      historyEntries.value,
      { msg, accountId, host },
      getUserIdForAccount,
    )
  } else {
    setChatHistory(withLatestChatMessage(chatHistory.value, msg))
  }
})

const canSend = computed(() => {
  if (isSending.value) return false
  return messageText.value.trim().length > 0 || attachedFile.value !== null
})

async function sendMessage() {
  if (!canSend.value) return
  const accId = activeAccountId.value
  if (!accId) return
  if (!ensureActiveAccountAuth()) return

  // Misskey v2025 で legacy `messaging/messages/create` (`apiCreateMessagingMessage`) は
  // 削除済みなので、新 Chat API #15686 の `chat/messages/create-to-{user,room}`
  // (`apiCreateChatMessage`) に統一する。text / fileId のいずれか一方でも送信可能。
  isSending.value = true
  try {
    const text = messageText.value.trim() || null
    const fileId = attachedFile.value?.id ?? null
    const sent = unwrap(
      await commands.apiCreateChatMessage(
        accId,
        currentOtherId.value,
        currentRoomId.value,
        text,
        fileId,
      ),
    ) as unknown as ChatMessage
    messageText.value = ''
    attachedFile.value = null
    if (!messageIds.value.includes(sent.id)) {
      thread.append(sent)
      scrollToBottom()
    }
  } catch (e) {
    handleActionError(e)
  } finally {
    isSending.value = false
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (isImeComposing(e)) return
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
const reactionPickerT = useVaporTransition(showReactionPicker, {
  leaveDuration: PICKER_LEAVE_MS,
})

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

/**
 * チャットメッセージを Misskey 側から削除する (#468)。
 * 削除成功後 WS `chat:deleted` event が配信され、QuerySubscription の
 * `onDelete` 経由で UI から自動的に消える。先回りで `removeMessage()`
 * しても dedup window で吸収されるが、楽観更新は不要なのでここでは行わない。
 */
async function handleDelete(messageId: string) {
  const accId = activeAccountId.value
  if (!accId) return
  if (!ensureActiveAccountAuth()) return

  try {
    unwrap(await commands.apiDeleteChatMessage(accId, messageId))
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

  // 1on1 の WS react/unreact は本家仕様で reactor を含まない (ChatService の
  // publishChatUserStream 分岐。room 側だけ pack(userId) を載せる)。ここで自分を
  // reactor に入れると dedup sig (type × userId × reaction) が WS 側と食い違い、
  // 同じリアクションが二重に載る。1on1 は reactor を伏せて sig を揃える
  // (表示は MkChatMessage がメッセージ送信者から逆算する)。
  const reactor: ChatReactionUser | null =
    currentRoomId.value === null
      ? null
      : {
          id: acc.userId ?? '',
          username: acc.username ?? '',
          name: acc.displayName ?? null,
          host: acc.host ?? null,
          avatarUrl: acc.avatarUrl ?? null,
        }
  const userId = reactor?.id ?? null
  chatMessageStore.applyUpdate(
    add
      ? {
          type: 'reacted',
          messageId,
          userId,
          reaction,
          reactor,
        }
      : {
          type: 'unreacted',
          messageId,
          userId,
          reaction,
          reactor,
        },
  )
}

const chatScroller = ref<NoteScrollerExpose | null>(null)

/** 最下部から 120px 以内なら「追従してよい」とみなす */
function isNearBottom(): boolean {
  const el = chatScroller.value?.getElement?.()
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120
}

// 位置は NoteScroller に渡している filteredMessages の添字で指す。ミュートした
// 相手の発言を含む messages の添字で指すと、隠した件数だけずれる (#1216)
function scrollToBottom() {
  requestAnimationFrame(() => {
    const count = filteredMessages.value.length
    if (count === 0) return
    chatScroller.value?.scrollToIndex(count - 1, {
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

  isLoading.value = true
  try {
    const prevFirstId = filteredMessages.value[0]?.id
    const added = await thread.loadOlder(accId, { loggedOut: isLoggedOut })
    // Restore scroll position to the previously first message after prepend
    if (added && prevFirstId) {
      await nextTick()
      const newIndex = filteredMessages.value.findIndex(
        (m) => m.id === prevFirstId,
      )
      if (newIndex >= 0) {
        chatScroller.value?.scrollToIndex(newIndex, {
          align: 'start',
          behavior: 'instant',
        })
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
  // 検索中はフィルタ後配列の上端で fetch すると、検索対象を後方に拡張する意味と
  // 検索結果に新規挿入する意味が混ざって UX が予測不能になるので抑止する。
  if (isConvSearching.value) return
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
  // #781 Phase 2: specta 契約済みの typed イベントを購読する。message id
  // スコープの applyUpdate なので account フィルタは不要 (cross-account
  // カラムでも既存メッセージにだけ作用する)。
  const reactedUnlisten = await events.streamChatMessageReacted.listen(
    ({ payload: { messageId, reaction, user } }) => {
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

  const unreactedUnlisten = await events.streamChatMessageUnreacted.listen(
    ({ payload: { messageId, reaction, user } }) => {
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

// プロフィール等から DM 起動の合図が来たら会話を開く。sidebar チャットカラムのみ
// が consume する (singleton)。immediate で「合図 → カラム生成」順にも対応する。
watch(
  () => deckStore.pendingChatTarget,
  (t) => {
    if (!t || !props.column.sidebar) return
    const target = deckStore.consumePendingChatTarget()
    if (!target) return
    void openConversation({
      isRoom: false,
      name: target.name,
      avatarUrl: target.avatarUrl ?? undefined,
      accountId: target.accountId,
      serverHost: target.serverHost,
      otherId: target.userId,
    })
  },
  { immediate: true },
)

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
  thread.close()
  for (const unlisten of reactionUnlisteners) unlisten()
  reactionUnlisteners.length = 0
  unregisterRoot?.()
  unregisterRoot = null
})
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="viewMode === 'conversation' ? conversationTitle : (column.name || i18n.ts._columns.chat)"
    :theme-vars="columnThemeVars"
    sound-enabled
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
      <!-- Conversation view: 検索トグル (#483 v2) はタイトル行に置く -->
      <button
        v-if="viewMode === 'conversation'"
        :class="[$style.headerActionBtn, { [$style.active]: showConvSearch }]"
        :title="showConvSearch ? i18n.ts._deckChatColumn.closeSearch : i18n.ts._deckChatColumn.searchMessages"
        @click.stop="toggleConvSearch"
      >
        <i :class="showConvSearch ? 'ti ti-x' : 'ti ti-search'" />
      </button>

    </template>

    <!-- History view: 常設検索バー (#483 v1) はサブヘッダーに置く -->
    <template v-if="viewMode === 'history'" #header-extra>
      <div :class="$style.searchBar">
        <i :class="$style.searchIcon" class="ti ti-search" />
        <input
          v-model="searchQuery"
          :class="$style.searchInput"
          type="text"
          :placeholder="i18n.ts._deckChatColumn.searchChatsPlaceholder"
        />
      </div>
    </template>

    <ColumnEmptyState
      v-if="error && viewMode === 'history'"
      :message="error.message"
      :image-url="serverErrorImageUrl"
      is-error
    />

    <!-- History View: Cross-account -->
    <!-- 履歴 ⇄ 会話の切替は差し替わった側をフェードで出す (AI カラムと同じ) -->
    <div v-if="isCrossAccount && viewMode === 'history'" :class="[$style.chatBody, 'nd-fade-appear']">
      <ColumnEmptyState
        v-if="historyEntries.length === 0 && !isLoading"
        :message="i18n.ts._deckChatColumn.noConversations"
        :image-url="serverInfoImageUrl"
      />
      <ColumnEmptyState
        v-else-if="hasNoSearchHits"
        :message="i18n.ts._deckChatColumn.noMatchingChats"
        :image-url="serverInfoImageUrl"
      />

      <div v-else :class="$style.historyList">
        <button
          v-for="entry in filteredHistoryEntries"
          :key="entry.key"
          :class="$style.historyItem"
          @click="openConversation(entry)"
        >
          <span
            v-if="isUnread(entry.message, entry.accountId, getUserIdForAccount(entry.accountId))"
            :class="$style.historyUnreadDot"
            :title="i18n.ts._deckChatColumn.unread"
            :aria-label="i18n.ts._deckChatColumn.unread"
          />
          <div :class="$style.historyAvatarWrap">
            <MkAvatar
              v-if="entry.avatarUrl"
              :avatar-url="entry.avatarUrl"
              :decorations="entry.avatarDecorations ?? []"
              :size="50"
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
            <div :class="$style.historyPreview">{{ entry.message.text || i18n.ts._deckChatColumn.fileOnly }}</div>
          </div>
          <div :class="$style.historyMeta">
            <AppTime :class="$style.historyTime" :at="entry.message.createdAt" />
          </div>
        </button>
      </div>
    </div>

    <!-- History View: Per-account -->
    <div v-else-if="!isCrossAccount && viewMode === 'history'" :class="[$style.chatBody, 'nd-fade-appear']">
      <ColumnEmptyState
        v-if="chatHistory.length === 0 && !isLoading"
        :message="i18n.ts._deckChatColumn.noConversations"
        :image-url="serverInfoImageUrl"
      />
      <ColumnEmptyState
        v-else-if="hasNoSearchHits"
        :message="i18n.ts._deckChatColumn.noMatchingChats"
        :image-url="serverInfoImageUrl"
      />

      <div v-else :class="$style.historyList">
        <button
          v-for="entry in filteredPerAccountEntries"
          :key="entry.key"
          :class="$style.historyItem"
          @click="openConversation(entry)"
        >
          <span
            v-if="isUnread(entry.message, column.accountId, myUserId)"
            :class="$style.historyUnreadDot"
            :title="i18n.ts._deckChatColumn.unread"
            :aria-label="i18n.ts._deckChatColumn.unread"
          />
          <MkAvatar
            v-if="entry.avatarUrl"
            :avatar-url="entry.avatarUrl"
            :decorations="entry.avatarDecorations ?? []"
            :size="50"
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
            <div :class="$style.historyPreview">{{ entry.message.text || i18n.ts._deckChatColumn.fileOnly }}</div>
          </div>
        </button>
      </div>
    </div>

    <!-- Conversation View -->
    <div v-else-if="viewMode === 'conversation'" :class="[$style.chatBody, $style.conversation, 'nd-fade-appear']" @click="closeReactionPicker">
      <!-- メッセージ検索バー (#483 v2: showConvSearch toggle) -->
      <div
        v-if="convSearchT.visible.value"
        :class="[$style.searchBar, convSearchT.leaving.value ? $style.menuLeave : $style.menuEnter]"
      >
        <i :class="$style.searchIcon" class="ti ti-search" />
        <input
          ref="convSearchInputRef"
          v-model="convSearchQuery"
          :class="$style.searchInput"
          type="text"
          :placeholder="i18n.ts._deckChatColumn.searchMessagesPlaceholder"
          @keydown.escape="closeConvSearch"
        />
      </div>

      <ColumnEmptyState
        v-if="hasNoConvSearchHits"
        :message="i18n.ts._deckChatColumn.noMatchingMessages"
        :image-url="serverInfoImageUrl"
      />

      <NoteScroller
        v-else
        ref="chatScroller"
        :items="filteredMessages"
        :estimated-height="96"
        :class="$style.messagesContainer"
        @scroll="handleScroll"
      >
        <template #prepend>
          <div v-if="isLoading" :class="$style.loadingMore"><LoadingSpinner /></div>
        </template>
        <template #default="{ item: msg }">
          <div :class="$style.chatMsgGap">
            <div v-if="dateSeparators.get(msg.id)" :class="$style.dateDivider">
              <span><i class="ti ti-chevron-up" /> {{ dateSeparators.get(msg.id)!.prevText }}</span>
              <span :class="$style.dateDividerBar" />
              <span>{{ dateSeparators.get(msg.id)!.nextText }} <i class="ti ti-chevron-down" /></span>
            </div>
            <MkChatMessage
              :message="msg"
              :my-user-id="myUserId"
              :account-id="activeAccountId ?? undefined"
              :server-host="activeServerHost ?? undefined"
              :my-avatar-url="currentRoomId ? undefined : myAvatarUrl ?? undefined"
              :other-avatar-url="currentRoomId ? undefined : conversationOtherAvatarUrl ?? undefined"
              :show-sender-name="!!currentRoomId"
              @react="handleReact"
              @unreact="handleUnreact"
              @delete="handleDelete"
            />
          </div>
        </template>
      </NoteScroller>

      <div v-if="error" :class="$style.chatError">{{ error.message }}</div>

      <!-- Reaction picker popup -->
      <div
        v-if="reactionPickerT.visible.value && activeAccountId && activeServerHost"
        :class="[$style.chatReactionPicker, reactionPickerT.leaving.value ? $style.panelLeave : $style.panelEnter]"
        @click.stop
      >
        <MkReactionPicker
          :server-host="activeServerHost"
          :account-id="activeAccountId"
          full-width
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
          <button :aria-label="i18n.ts._common.delete" :class="$style.chatAttachmentRemove" @click="removeAttachment">
            <i class="ti ti-x" />
          </button>
        </div>
        <div :class="$style.chatInputRow">
          <div :class="$style.chatInputActions">
            <button
              :class="[$style.chatActionBtn, { [$style.active]: showDrivePicker }]"
              :title="i18n.ts._columns.drive"
              @click.stop="toggleDrivePicker"
            >
              <i class="ti ti-photo" />
            </button>
            <button :class="$style.chatActionBtn" :title="i18n.ts._common.emoji" @click.stop="showEmojiPicker = !showEmojiPicker">
              <i class="ti ti-mood-happy" />
            </button>
          </div>
          <textarea
            ref="textareaRef"
            v-model="messageText"
            :class="$style.chatTextarea"
            :placeholder="i18n.ts._deckChatColumn.messagePlaceholder"
            rows="1"
            @keydown="handleKeydown"
          />
          <button
            :aria-label="i18n.ts._common.send"
            :class="$style.chatSend"
            :disabled="!canSend"
            @click="sendMessage"
          >
            <i class="ti ti-send" />
          </button>
        </div>
        <!-- Emoji picker popup -->
        <div
          v-if="emojiPickerT.visible.value && activeAccountId && activeServerHost"
          :class="[$style.chatEmojiPopup, emojiPickerT.leaving.value ? $style.panelLeave : $style.panelEnter]"
          @click.stop
        >
          <MkReactionPicker
            :server-host="activeServerHost"
            :account-id="activeAccountId"
            full-width
            @pick="pickEmoji"
          />
        </div>
        <!-- Drive picker (below input row) -->
        <div
          v-if="drivePickerT.visible.value && activeAccountId"
          :class="[$style.chatDrivePopup, drivePickerT.leaving.value ? $style.panelLeave : $style.panelEnter]"
          @click.stop
        >
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
@use '@/styles/popup';

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

.searchBar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--nd-divider);
  background: var(--nd-bg);
  flex-shrink: 0;
}

.headerActionBtn {
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  color: var(--nd-fg);
  opacity: 0.6;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 1em;

  &:hover {
    opacity: 1;
    background: var(--nd-panelHighlight);
  }

  &.active {
    opacity: 1;
    color: var(--nd-accentText);
  }
}

.searchIcon {
  flex-shrink: 0;
  opacity: 0.4;
}

.searchInput {
  flex: 1;
  min-width: 0;
  background: var(--nd-buttonBg);
  border: none;
  border-radius: var(--nd-radius-sm);
  padding: 6px 10px;
  font-size: var(--nd-font-md);
  color: var(--nd-fg);
  outline: none;

  &:focus {
    box-shadow: 0 0 0 2px var(--nd-accent);
  }

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.4;
  }
}

.historyList {
  --chat-history-avatar: 50px;
  flex: 1;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.historyItem {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  border: none;
  background: none;
  color: var(--nd-fg);
  text-align: left;
  cursor: pointer;
  contain: layout style paint;
  content-visibility: auto;
  contain-intrinsic-size: auto 75px;
  border-bottom: 1px solid var(--nd-divider);

  &:hover {
    background: var(--nd-panelHighlight);
  }

  :global(.mk-avatar) {
    flex-shrink: 0;
    width: var(--chat-history-avatar);
    height: var(--chat-history-avatar);
  }

  :global(.mk-avatar:hover) {
    transform: none;
  }
}

.historyAvatarWrap {
  position: relative;
  flex-shrink: 0;
  width: var(--chat-history-avatar);
  height: var(--chat-history-avatar);
}

.historyAvatarPlaceholder {
  flex-shrink: 0;
  width: var(--chat-history-avatar);
  height: var(--chat-history-avatar);
  border-radius: 50%;
  background: var(--nd-buttonBg);
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
  font-size: 1em;
  font-weight: var(--nd-weight-bold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.historyPreview {
  font-size: 1em;
  opacity: 0.6;
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
  font-size: var(--nd-font-xs);
  opacity: 0.5;
}

.historyUnreadDot {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--nd-accent);
}

// 本家 MkChatHistories と同じく、カラム幅で 2 段にする (#1207)
@container (max-width: 450px) {
  .historyList {
    --chat-history-avatar: 40px;
  }

  .historyItem {
    gap: 10px;
    padding: 10px 12px;
  }

  .historyPreview {
    font-size: var(--nd-font-body);
  }
}

.messagesContainer {
  flex: 1;
  overflow-x: clip;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.chatMsgGap {
  // メッセージ間は本家と同じく広い段 16px / 狭い段 12px (#1207)
  padding: 8px 0;
}

// 本家 room.vue の dateDivider と同じ中央のピル
.dateDivider {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5em;
  width: fit-content;
  margin: 0 auto 16px;
  padding: 4px 12px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-full);
  font-size: var(--nd-font-md);
  opacity: 0.75;
}

.dateDividerBar {
  width: 1px;
  height: 1em;
  background: var(--nd-divider);
}

@container (max-width: 450px) {
  .chatMsgGap {
    padding: 6px 0;
  }

  .dateDivider {
    margin-bottom: 12px;
  }
}

.chatError {
  padding: 4px 12px;
  font-size: var(--nd-font-sm);
  color: var(--nd-love);
}

.chatInput {
  display: flex;
  flex-direction: column;
  padding: 6px 8px 8px;
  border-top: 1px solid var(--nd-divider);
  background: var(--nd-panel);
  position: relative;
}

.chatAttachment {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  margin-bottom: 4px;
  background: var(--nd-panelHighlight);
  border-radius: var(--nd-radius-md);
}

.chatAttachmentThumb {
  width: 48px;
  height: 48px;
  border-radius: var(--nd-radius-sm);
  object-fit: cover;
}

.chatAttachmentName {
  font-size: var(--nd-font-sm);
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
  font-size: var(--nd-font-body);

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
  width: 36px;
  height: 36px;
  border: none;
  background: none;
  color: var(--nd-fg);
  opacity: 0.5;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: var(--nd-font-lg);

  &:hover {
    opacity: 0.8;
    background: var(--nd-panelHighlight);
  }

  &.active {
    opacity: 1;
    color: var(--nd-accentText);
    background: var(--nd-accentedBg);
  }
}

.chatTextarea {
  flex: 1;
  resize: none;
  border: none;
  background: var(--nd-panelHighlight);
  color: var(--nd-fg);
  border-radius: var(--nd-radius-lg);
  // 本文と同じ 14px で打てるようにし、1 行でも押しやすい高さを取る (#1207)
  padding: 10px 12px;
  font-size: 1em;
  font-family: inherit;
  line-height: 1.4;
  min-height: 40px;
  max-height: 160px;
  outline: none;
  field-sizing: content;

  &::placeholder {
    opacity: 0.4;
  }
}

.chatSend {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: var(--nd-font-lg);

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
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow: hidden;
  background: var(--nd-popup);
  border-radius: var(--nd-radius) var(--nd-radius) 0 0;
  box-shadow: var(--nd-shadow-sheet);
  z-index: var(--nd-z-menu);
}

.chatDrivePopup {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  background: var(--nd-popup);
  border-radius: var(--nd-radius) var(--nd-radius) 0 0;
  box-shadow: var(--nd-shadow-sheet);
  z-index: var(--nd-z-menu);
}

.chatReactionPicker {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  max-height: 280px;
  overflow: hidden;
  border-top: 1px solid var(--nd-divider);
  background: var(--nd-panel);
}

/* Empty placeholder classes for dynamic binding */
.done {}
</style>
