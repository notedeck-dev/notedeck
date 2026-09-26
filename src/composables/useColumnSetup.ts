import { ref, watch } from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import type {
  ChannelSubscription,
  ManagedChannelSubscription,
  NormalizedNote,
  ServerAdapter,
  SubscriptionRuntimeState,
} from '@/adapters/types'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { useNoteSound } from '@/composables/useNoteSound'
import { useScrollDirection } from '@/composables/useScrollDirection'
import { useServerImages } from '@/composables/useServerImages'
import { i18n } from '@/i18n'
import { variantKeyOf } from '@/services/noteKey'
import { useAccountsStore } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import { type DeckColumn, useDeckStore } from '@/stores/deck'
import { useNoteStore } from '@/stores/notes'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { useStreamInspectorStore } from '@/stores/streamInspector'
import { useToast } from '@/stores/toast'
import { useUiStore } from '@/stores/ui'
import { FAVORITES_CACHE_KEY } from '@/utils/columnCacheKey'
import { AppError } from '@/utils/errors'
import { toggleFavorite } from '@/utils/toggleFavorite'
import { toggleReaction } from '@/utils/toggleReaction'
import { votePoll } from '@/utils/votePoll'

export interface ColumnSetupOptions {
  /** Reactive offline flag — when true, write operations are blocked */
  isOffline?: () => boolean
  /**
   * 楽観的更新の差分 (リアクション・投票) の適用先。既定は noteStore への
   * 差し替えだが、ノートを noteStore に置かない面 (照会カラムのローカル
   * deep ref 等) は自分の保持形態に合わせて差し替える。
   * `compute` には自分が持つ最新のノートを渡し、返った差分をそこへマージする
   * (#904)。
   */
  applyNotePatch?: (
    note: NormalizedNote,
    compute: (current: NormalizedNote) => Partial<NormalizedNote>,
  ) => void
}

export function useColumnSetup(
  getColumn: () => DeckColumn,
  options?: ColumnSetupOptions,
) {
  const noteStore = useNoteStore()
  let customMutatedFn: (() => void) | undefined

  function setOnNotesMutated(fn: () => void) {
    customMutatedFn = fn
  }

  const { account, columnThemeVars } = useColumnTheme(getColumn)

  const serverIconUrl = ref<string | undefined>()
  const { serverInfoImageUrl, serverNotFoundImageUrl, serverErrorImageUrl } =
    useServerImages(getColumn)

  const isLoading = ref(false)
  const error = ref<AppError | null>(null)

  let adapter: ServerAdapter | null = null
  let subscription: ChannelSubscription | null = null
  let subscriptionRuntimeState: SubscriptionRuntimeState = 'live'
  // Track stream event handlers registered by this column so we can remove them on disconnect
  const streamHandlers: {
    event: 'connected' | 'disconnected' | 'reconnecting'
    handler: () => void
  }[] = []

  async function initAdapter(opts?: {
    hasToken?: boolean
  }): Promise<ServerAdapter | null> {
    const acc = account.value
    if (!acc) return null
    const result = await initAdapterFor(acc.host, acc.id, {
      hasToken: opts?.hasToken ?? acc.hasToken,
    })
    serverIconUrl.value = result.serverInfo.iconUrl
    adapter = result.adapter
    return adapter
  }

  function getAdapter() {
    return adapter
  }

  /**
   * ノート操作の宛先アカウント。全アカウント面 (column.accountId == null) は
   * カラム adapter を持たないので、variant の取得元 (`_accountId`) で解決する
   * (#1058 §5.6)。未ログイン / ゲスト / 不在なら null を返して toast を出す —
   * 無言 no-op にしない (per-account の凍結カラムも同じ判定で止まる)
   */
  function accountFor(note: NormalizedNote) {
    const acc = useAccountsStore().accountMap.get(note._accountId)
    if (acc?.hasToken) return acc
    console.warn('[column-setup] no token for account', note._accountId)
    toast.show(i18n.ts._useColumnSetup.notLoggedIn, 'error')
    return null
  }

  /**
   * ノート操作に使う adapter。カラム adapter があればそれ、無ければ取得元
   * アカウントの adapter (factory の共有キャッシュ。per-account の initAdapter と
   * 同じく、キャッシュ済みならその adapter がそのまま返る)。hasToken は
   * accountFor が保証するので既定 (認証付き) で作る — ログアウト中に anon
   * adapter をキャッシュへ載せると再ログイン後も残るため、hasToken を渡さない
   */
  async function adapterFor(
    note: NormalizedNote,
  ): Promise<ServerAdapter | null> {
    if (adapter) return adapter
    const acc = accountFor(note)
    if (!acc) return null
    try {
      // サーバー情報の取得を伴うので失敗しうる。ここで受けないと呼び出し側の
      // try の外で reject し、無言で終わる (削除では楽観削除も巻き戻らない)
      const { adapter: resolved } = await initAdapterFor(acc.host, acc.id)
      return resolved
    } catch (e) {
      const err = AppError.from(e)
      console.error('[column-setup] adapter init failed', err.code, err.message)
      toast.show(
        i18n.tsx._useColumnSetup.connectFailed({ code: err.displayCode }),
        'error',
      )
      return null
    }
  }
  function setSubscription(sub: ChannelSubscription) {
    subscription = sub
    const managed = subscription as Partial<ManagedChannelSubscription>
    managed.setRuntimeState?.(subscriptionRuntimeState)
    reportRuntime()
    // subscriptionId は open 解決後に確定するので、確定したら再通知
    managed.whenReady?.().then(reportRuntime)
  }

  /** Stream Inspector dashboard 用に現在の runtime/subscriptionId を通知（debug 観測のみ） */
  function reportRuntime() {
    const col = getColumn()
    const managed = subscription as Partial<ManagedChannelSubscription> | null
    useStreamInspectorStore().reportRuntimeState({
      columnId: col.id,
      accountId: col.accountId ?? null,
      columnType: col.type,
      subscriptionId: managed?.subscriptionId ?? null,
      state: subscriptionRuntimeState,
      ts: Date.now(),
    })
  }

  function disposeSubscription() {
    subscription?.dispose()
    subscription = null
  }

  function setSubscriptionRuntimeState(state: SubscriptionRuntimeState) {
    subscriptionRuntimeState = state
    const managed = subscription as Partial<ManagedChannelSubscription> | null
    managed?.setRuntimeState?.(state)
    reportRuntime()
  }

  /** Register a stream event handler tracked for cleanup on disconnect */
  function onStreamEvent(
    event: 'connected' | 'disconnected' | 'reconnecting',
    handler: () => void,
  ) {
    adapter?.stream.on(event, handler)
    streamHandlers.push({ event, handler })
  }

  function removeStreamHandlers() {
    for (const { event, handler } of streamHandlers) {
      adapter?.stream.off(event, handler)
    }
    streamHandlers.length = 0
  }

  function disconnect() {
    disposeSubscription()
    removeStreamHandlers()
    // adapter is shared across columns (cached by accountId) — do NOT call
    // stream.cleanup() here as it would destroy handlers for other columns.
    adapter = null
  }

  // Re-register stream event listeners on resume (handles Android background suspension)
  const uiStore = useUiStore()
  watch(
    () => uiStore.deckResumeSignal,
    () => adapter?.stream.reconnect(),
  )

  // Post form
  const showPostForm = ref(false)
  /** 投稿先アカウント。全アカウント面では操作したノートの取得元になる */
  const postFormAccountId = ref<string | undefined>()
  const postFormReplyTo = ref<NormalizedNote | undefined>()
  const postFormRenoteId = ref<string | undefined>()
  const postFormEditNote = ref<NormalizedNote | undefined>()
  const postFormInitialText = ref<string | undefined>()
  const postFormInitialCw = ref<string | undefined>()
  const postFormInitialVisibility = ref<string | undefined>()
  const postFormInitialNote = ref<NormalizedNote | undefined>()

  const toast = useToast()
  /** 全アカウント面 (カラムにアカウントが無い) では直近に操作したノートの取得元で鳴らす */
  const actionHost = ref<string | undefined>()
  const actionSound = useNoteSound(
    () => account.value?.host ?? actionHost.value,
    'syuilo/bubble2',
  )

  function checkOffline(): boolean {
    if (useOfflineModeStore().isOfflineMode || options?.isOffline?.()) {
      console.warn('[offline] Write operation blocked')
      return true
    }
    return false
  }

  /** 楽観的更新の差分を面の保持形態に反映する (既定は noteStore への差し替え) */
  function applyPatch(
    note: NormalizedNote,
    compute: (current: NormalizedNote) => Partial<NormalizedNote>,
  ) {
    if (options?.applyNotePatch) {
      options.applyNotePatch(note, compute)
    } else {
      // 手元の note は API を待つ間にストリーミングで差し替わっていることが
      // あるので、常に store の最新から差分を計算する (#904)
      const key = variantKeyOf(note)
      const current = noteStore.get(key) ?? note
      // 新オブジェクトへの差し替えで store に反映する (reactive に届く)
      noteStore.update(key, { ...current, ...compute(current) })
    }
    customMutatedFn?.()
  }

  async function handleReaction(reaction: string, note: NormalizedNote) {
    if (checkOffline()) return
    const api = (await adapterFor(note))?.api
    if (!api) return
    actionHost.value = useAccountsStore().accountMap.get(note._accountId)?.host
    try {
      await toggleReaction(api, note, reaction, (compute) =>
        applyPatch(note, compute),
      )
      if (!getColumn().soundMuted) actionSound.play()
    } catch (e) {
      const err = AppError.from(e)
      console.error('[reaction]', err.code, err.message)
      toast.show(
        i18n.tsx._useColumnSetup.reactionFailed({ code: err.displayCode }),
        'error',
      )
    }
  }

  async function handlePollVote(choice: number, note: NormalizedNote) {
    if (checkOffline()) return
    const api = (await adapterFor(note))?.api
    if (!api) return
    try {
      await votePoll(api, note, choice, (compute) => applyPatch(note, compute))
    } catch (e) {
      const err = AppError.from(e)
      console.error('[vote]', err.code, err.message)
      toast.show(
        i18n.tsx._useColumnSetup.voteFailed({ code: err.displayCode }),
        'error',
      )
    }
  }

  async function handleRenote(note: NormalizedNote) {
    if (checkOffline()) return
    const api = (await adapterFor(note))?.api
    if (!api) return
    // 常に store の最新から差分を取る (#904)。受け取り時点の note で上書きすると
    // API 待ちの間に届いたライブ更新を巻き戻す
    applyPatch(note, (cur) => ({ renoteCount: (cur.renoteCount ?? 0) + 1 }))
    try {
      await api.createNote({ renoteId: note.id })
    } catch (e) {
      applyPatch(note, (cur) => ({
        renoteCount: Math.max(0, (cur.renoteCount ?? 1) - 1),
      }))
      const err = AppError.from(e)
      console.error('[renote]', err.code, err.message)
      toast.show(
        i18n.tsx._useColumnSetup.renoteFailed({ code: err.displayCode }),
        'error',
      )
    }
  }

  function handleReply(note: NormalizedNote) {
    if (checkOffline() || !accountFor(note)) return
    postFormAccountId.value = note._accountId
    postFormReplyTo.value = note
    postFormRenoteId.value = undefined
    postFormInitialNote.value = undefined
    showPostForm.value = true
  }

  function handleQuote(note: NormalizedNote) {
    if (checkOffline() || !accountFor(note)) return
    postFormAccountId.value = note._accountId
    postFormReplyTo.value = undefined
    postFormRenoteId.value = note.id
    postFormInitialNote.value = undefined
    showPostForm.value = true
  }

  async function handleDelete(note: NormalizedNote): Promise<boolean> {
    if (checkOffline()) return false
    const api = (await adapterFor(note))?.api
    if (!api) return false
    try {
      await api.deleteNote(note.id)
      noteStore.markDeleted(note)
      return true
    } catch (e) {
      const err = AppError.from(e)
      console.error('[delete]', err.code, err.message)
      toast.show(
        i18n.tsx._useColumnSetup.deleteFailed({ code: err.displayCode }),
        'error',
      )
      return false
    }
  }

  function handleEdit(note: NormalizedNote) {
    if (checkOffline() || !accountFor(note)) return
    postFormAccountId.value = note._accountId
    postFormReplyTo.value = undefined
    postFormRenoteId.value = undefined
    postFormEditNote.value = note
    postFormInitialNote.value = undefined
    postFormInitialText.value = undefined
    postFormInitialCw.value = undefined
    postFormInitialVisibility.value = undefined
    showPostForm.value = true
  }

  /** 削除して編集。削除に成功してフォームを開いたら true (ローカル保持の面が行を外す合図) */
  async function handleDeleteAndEdit(note: NormalizedNote): Promise<boolean> {
    if (checkOffline()) return false
    const api = (await adapterFor(note))?.api
    if (!api) return false
    try {
      await api.deleteNote(note.id)
      noteStore.markDeleted(note)
      postFormAccountId.value = note._accountId
      postFormReplyTo.value = note.replyId
        ? await api.getNote(note.replyId).catch(() => undefined)
        : undefined
      // 引用・添付・アンケート等を引き継ぐ (#944)。本家も削除して編集では
      // renote / reply / channel と initialNote を引き渡している
      postFormRenoteId.value = note.renoteId ?? undefined
      postFormEditNote.value = undefined
      postFormInitialNote.value = note
      postFormInitialText.value = undefined
      postFormInitialCw.value = undefined
      postFormInitialVisibility.value = undefined
      showPostForm.value = true
      return true
    } catch (e) {
      const err = AppError.from(e)
      console.error('[deleteAndEdit]', err.code, err.message)
      toast.show(
        i18n.tsx._useColumnSetup.deleteFailed({ code: err.displayCode }),
        'error',
      )
      return false
    }
  }

  async function handleBookmark(note: NormalizedNote) {
    if (checkOffline()) return
    const api = (await adapterFor(note))?.api
    if (!api) return
    // toggleFavorite は note を直接書き換えるので、その値だけを store に写す
    const syncFavorited = () =>
      applyPatch(note, () => ({ isFavorited: note.isFavorited }))
    try {
      await toggleFavorite(api, note, syncFavorited)
      useDeckStore().invalidateColumnByKey(FAVORITES_CACHE_KEY)
    } catch (e) {
      const err = AppError.from(e)
      if (err.displayCode === 'ALREADY_FAVORITED') {
        const { confirm } = useConfirm()
        const ok = await confirm({
          title: i18n.ts._useColumnSetup.unfavoriteTitle,
          message: i18n.ts._useColumnSetup.confirmUnfavorite,
          type: 'danger',
          okLabel: i18n.ts._common.remove,
        })
        if (ok) {
          try {
            note.isFavorited = true
            syncFavorited()
            await api.deleteFavorite(note.id)
            note.isFavorited = false
            syncFavorited()
            useDeckStore().invalidateColumnByKey(FAVORITES_CACHE_KEY)
          } catch (e2) {
            const err2 = AppError.from(e2)
            console.error('[bookmark:unfavorite]', err2.code, err2.message)
            toast.show(
              i18n.tsx._useColumnSetup.unfavoriteFailed({
                code: err2.displayCode,
              }),
              'error',
            )
          }
        } else {
          // Sync local state: server says it's favorited
          note.isFavorited = true
          syncFavorited()
        }
      } else {
        console.error('[bookmark]', err.code, err.message)
        toast.show(
          i18n.tsx._useColumnSetup.favoriteFailed({ code: err.displayCode }),
          'error',
        )
      }
    }
  }

  function closePostForm() {
    showPostForm.value = false
    postFormAccountId.value = undefined
    postFormReplyTo.value = undefined
    postFormRenoteId.value = undefined
    postFormEditNote.value = undefined
    postFormInitialNote.value = undefined
    postFormInitialText.value = undefined
    postFormInitialCw.value = undefined
    postFormInitialVisibility.value = undefined
  }

  // Scroll
  const scroller = ref<HTMLElement | null>(null)
  const { reportScroll } = useScrollDirection()

  let lastScrollCheck = 0

  /** Scroll handler with load-more detection (for non-NoteScroller columns) */
  function onScroll(loadMore: () => void) {
    const el = scroller.value ?? undefined
    if (!el) return

    reportScroll(el.scrollTop)

    const now = Date.now()
    if (now - lastScrollCheck < 200) return
    lastScrollCheck = now
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
      loadMore()
    }
  }

  /** Scroll handler without load-more (for NoteScroller columns that use @near-end) */
  function onScrollReport() {
    const el = scroller.value ?? undefined
    if (el) reportScroll(el.scrollTop)
  }

  return {
    // State
    account,
    columnThemeVars,
    serverIconUrl,
    serverInfoImageUrl,
    serverNotFoundImageUrl,
    serverErrorImageUrl,
    isLoading,
    error,
    // Adapter lifecycle
    initAdapter,
    getAdapter,
    setSubscription,
    disposeSubscription,
    setSubscriptionRuntimeState,
    disconnect,
    onStreamEvent,
    setOnNotesMutated,
    // Post form
    postForm: {
      show: showPostForm,
      accountId: postFormAccountId,
      replyTo: postFormReplyTo,
      renoteId: postFormRenoteId,
      editNote: postFormEditNote,
      initialNote: postFormInitialNote,
      initialText: postFormInitialText,
      initialCw: postFormInitialCw,
      initialVisibility: postFormInitialVisibility,
      close: closePostForm,
    },
    // Note action handlers
    handlers: {
      reaction: handleReaction,
      renote: handleRenote,
      reply: handleReply,
      quote: handleQuote,
      delete: handleDelete,
      edit: handleEdit,
      bookmark: handleBookmark,
      deleteAndEdit: handleDeleteAndEdit,
      vote: handlePollVote,
    },
    // Virtual scroller
    scroller,
    onScroll,
    onScrollReport,
  }
}
