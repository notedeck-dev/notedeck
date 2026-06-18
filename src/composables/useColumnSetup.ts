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
import { useConfirm } from '@/stores/confirm'
import { type DeckColumn, useDeckStore } from '@/stores/deck'
import { useNoteStore } from '@/stores/notes'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { useStreamInspectorStore } from '@/stores/streamInspector'
import { useToast } from '@/stores/toast'
import { useUiStore } from '@/stores/ui'
import { AppError } from '@/utils/errors'
import { toggleFavorite } from '@/utils/toggleFavorite'
import { toggleReaction } from '@/utils/toggleReaction'
import { votePoll } from '@/utils/votePoll'

export interface ColumnSetupOptions {
  /** Reactive offline flag — when true, write operations are blocked */
  isOffline?: () => boolean
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

  /** Create a callback that replaces the note reference in the store (triggers Vue reactivity) */
  function notifyMutationFor(note: NormalizedNote) {
    return () => {
      noteStore.update(note.id, { ...note })
      customMutatedFn?.()
    }
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
  const postFormReplyTo = ref<NormalizedNote | undefined>()
  const postFormRenoteId = ref<string | undefined>()
  const postFormEditNote = ref<NormalizedNote | undefined>()
  const postFormInitialText = ref<string | undefined>()
  const postFormInitialCw = ref<string | undefined>()
  const postFormInitialVisibility = ref<string | undefined>()

  const toast = useToast()
  const actionSound = useNoteSound(() => account.value?.host, 'syuilo/bubble2')

  function checkOffline(): boolean {
    if (useOfflineModeStore().isOfflineMode || options?.isOffline?.()) {
      console.warn('[offline] Write operation blocked')
      return true
    }
    return false
  }

  async function handleReaction(reaction: string, note: NormalizedNote) {
    if (!adapter || checkOffline()) return
    try {
      await toggleReaction(adapter.api, note, reaction, notifyMutationFor(note))
      if (!getColumn().soundMuted) actionSound.play()
    } catch (e) {
      const err = AppError.from(e)
      console.error('[reaction]', err.code, err.message)
      toast.show(`リアクションに失敗しました（${err.displayCode}）`, 'error')
    }
  }

  async function handlePollVote(choice: number, note: NormalizedNote) {
    if (!adapter || checkOffline()) return
    try {
      await votePoll(adapter.api, note, choice, notifyMutationFor(note))
    } catch (e) {
      const err = AppError.from(e)
      console.error('[vote]', err.code, err.message)
      toast.show(`投票に失敗しました（${err.displayCode}）`, 'error')
    }
  }

  async function handleRenote(note: NormalizedNote) {
    if (!adapter || checkOffline()) return
    const notify = notifyMutationFor(note)
    note.renoteCount = (note.renoteCount ?? 0) + 1
    notify()
    try {
      await adapter.api.createNote({ renoteId: note.id })
    } catch (e) {
      note.renoteCount = Math.max(0, (note.renoteCount ?? 1) - 1)
      notify()
      const err = AppError.from(e)
      console.error('[renote]', err.code, err.message)
      toast.show(`リノートに失敗しました（${err.displayCode}）`, 'error')
    }
  }

  function handleReply(note: NormalizedNote) {
    if (checkOffline()) return
    postFormReplyTo.value = note
    postFormRenoteId.value = undefined
    showPostForm.value = true
  }

  function handleQuote(note: NormalizedNote) {
    if (checkOffline()) return
    postFormReplyTo.value = undefined
    postFormRenoteId.value = note.id
    showPostForm.value = true
  }

  async function handleDelete(note: NormalizedNote): Promise<boolean> {
    if (!adapter || checkOffline()) return false
    try {
      await adapter.api.deleteNote(note.id)
      return true
    } catch (e) {
      const err = AppError.from(e)
      console.error('[delete]', err.code, err.message)
      toast.show(`削除に失敗しました（${err.displayCode}）`, 'error')
      return false
    }
  }

  function handleEdit(note: NormalizedNote) {
    if (checkOffline()) return
    postFormReplyTo.value = undefined
    postFormRenoteId.value = undefined
    postFormEditNote.value = note
    postFormInitialText.value = undefined
    postFormInitialCw.value = undefined
    postFormInitialVisibility.value = undefined
    showPostForm.value = true
  }

  async function handleDeleteAndEdit(note: NormalizedNote) {
    if (!adapter || checkOffline()) return
    try {
      await adapter.api.deleteNote(note.id)
      postFormReplyTo.value = note.replyId
        ? await adapter.api.getNote(note.replyId).catch(() => undefined)
        : undefined
      postFormRenoteId.value = undefined
      postFormEditNote.value = undefined
      postFormInitialText.value = note.text ?? undefined
      postFormInitialCw.value = note.cw ?? undefined
      postFormInitialVisibility.value = note.visibility
      showPostForm.value = true
    } catch (e) {
      const err = AppError.from(e)
      console.error('[deleteAndEdit]', err.code, err.message)
      toast.show(`削除に失敗しました（${err.displayCode}）`, 'error')
    }
  }

  async function handleBookmark(note: NormalizedNote) {
    if (!adapter || checkOffline()) return
    try {
      await toggleFavorite(adapter.api, note, notifyMutationFor(note))
      useDeckStore().invalidateColumnByKey('favorites')
    } catch (e) {
      const err = AppError.from(e)
      if (err.displayCode === 'ALREADY_FAVORITED') {
        const { confirm } = useConfirm()
        const ok = await confirm({
          title: 'お気に入り解除',
          message:
            'このノートは既にお気に入りに追加されています。お気に入りを解除しますか？',
          type: 'danger',
          okLabel: '解除',
        })
        if (ok) {
          try {
            note.isFavorited = true
            notifyMutationFor(note)()
            await adapter.api.deleteFavorite(note.id)
            note.isFavorited = false
            notifyMutationFor(note)()
            useDeckStore().invalidateColumnByKey('favorites')
          } catch (e2) {
            const err2 = AppError.from(e2)
            console.error('[bookmark:unfavorite]', err2.code, err2.message)
            toast.show(
              `お気に入り解除に失敗しました（${err2.displayCode}）`,
              'error',
            )
          }
        } else {
          // Sync local state: server says it's favorited
          note.isFavorited = true
          notifyMutationFor(note)()
        }
      } else {
        console.error('[bookmark]', err.code, err.message)
        toast.show(`ブックマークに失敗しました（${err.displayCode}）`, 'error')
      }
    }
  }

  function closePostForm() {
    showPostForm.value = false
    postFormReplyTo.value = undefined
    postFormRenoteId.value = undefined
    postFormEditNote.value = undefined
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
      replyTo: postFormReplyTo,
      renoteId: postFormRenoteId,
      editNote: postFormEditNote,
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
