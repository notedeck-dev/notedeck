import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import type {
  NormalizedNote,
  NoteVisibility,
  ServerAdapter,
} from '@/adapters/types'
import { applyNotePostInterruptors } from '@/aiscript/plugin-api'
import {
  DEFAULT_MODE_ICON,
  defaultVisibility,
  MAX_TEXT_LENGTH,
  type VisibilityOption,
  visibilityOptions,
} from '@/composables/postFormConstants'
import {
  type DraftContext,
  deleteDraft,
  type StoredDraft,
  saveDraft,
} from '@/composables/useDrafts'
import { useFileAttachment } from '@/composables/useFileAttachment'
import { showLoginPrompt } from '@/composables/useLoginPrompt'
import {
  deleteMemo,
  ensureMemosLoaded,
  generateMemoKey,
  type StoredMemo,
  saveMemo,
} from '@/composables/useMemos'
import { useAccountsStore } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import { useSettingsStore } from '@/stores/settings'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import {
  CUSTOM_TL_ICONS,
  detectAvailableTimelines,
} from '@/utils/customTimelines'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'

function isAnnoying(text: string): boolean {
  return (
    text.includes('$[x2') ||
    text.includes('$[x3') ||
    text.includes('$[x4') ||
    text.includes('$[scale') ||
    text.includes('$[position')
  )
}

export function usePostFormState(
  props: {
    accountId: string
    replyTo?: NormalizedNote
    renoteId?: string
    editNote?: NormalizedNote
    channelId?: string
  },
  callbacks: {
    onPosted: (editedNoteId?: string) => void
  },
  options: {
    /** true → post/auto-save は memo に保存 (メモカラムの埋め込みフォーム用) */
    memoMode?: boolean
  } = {},
) {
  const memoMode = options.memoMode === true
  const accountsStore = useAccountsStore()
  const settingsStore = useSettingsStore()
  const themeStore = useThemeStore()

  const text = ref('')
  const cw = ref('')
  const showCw = ref(false)
  const visibility = ref<NoteVisibility>('public')
  const localOnly = ref(!!props.channelId)
  const showVisibilityMenu = ref(false)
  const showAccountMenu = ref(false)
  const isPosting = ref(false)
  const posted = ref(false)
  const error = ref<string | null>(null)
  let adapter: ServerAdapter | null = null
  const {
    attachedFiles,
    pendingUploads,
    isUploading,
    uploadFilesFromPaths,
    uploadBrowserFiles,
    retryUpload,
    dismissUpload,
    attachDriveFiles,
    removeFile,
    reorderFiles,
    applyFileMeta,
  } = useFileAttachment(() => adapter, error)

  /**
   * 添付ファイルの alt / センシティブ / 名前を更新 (#753)。楽観的にローカル
   * 反映し、サーバー更新 (drive/files/update) が失敗したらロールバックする。
   */
  async function updateAttachedFileMeta(
    fileId: string,
    patch: { comment?: string | null; isSensitive?: boolean; name?: string },
  ) {
    const prev = attachedFiles.value.find((f) => f.id === fileId)
    if (!prev) return
    applyFileMeta(fileId, patch)
    try {
      unwrap(
        await commands.apiUpdateDriveFile(
          activeAccountId.value,
          fileId,
          patch.name ?? null,
          // Rust 側の契約: null = 変更なし、空文字 = alt クリア
          patch.comment === undefined ? null : (patch.comment ?? ''),
          patch.isSensitive ?? null,
        ),
      )
    } catch (e) {
      applyFileMeta(fileId, {
        comment: prev.comment,
        isSensitive: prev.isSensitive,
        name: prev.name,
      })
      useToast().show(AppError.from(e).message, 'error')
    }
  }
  const noteModeFlags = ref<Record<string, boolean>>({})
  const disabledVisibilities = shallowRef(new Set<string>())
  // 引用元ノート (#753)。呼び出し元からは renoteId しか渡らないため、
  // adapter 初期化後にここで取得してプレビュー表示に使う。取得失敗
  // (別サーバーの ID・削除済み等) は null のままインジケータ表示に落ちる。
  const quoteNote = shallowRef<NormalizedNote | null>(null)
  const showPoll = ref(false)
  const pollChoices = ref<string[]>(['', ''])
  const pollMultiple = ref(false)
  const pollExpiresAt = ref<number | null>(null)
  // 期間指定 (ms)。API の poll は expiresAt (絶対時刻) しか受けないため、
  // ドリフトを避けて post() 時点で now + duration に変換する
  const pollExpiredAfter = ref<number | null>(null)
  const scheduledAt = ref<string | null>(null)
  const supportsScheduledNotes = ref(false)

  const activeAccountId = ref(props.accountId)
  const accounts = computed(() => accountsStore.accounts)
  const account = computed(() =>
    accountsStore.accounts.find((a) => a.id === activeAccountId.value),
  )

  /**
   * このセッションが auto-save に使う slot key。
   * - memo モード: ローカル生成の memoKey (非 null)。
   * - draft モード: サーバー発行の draftId。初回 create までは null で、
   *   create 完了後にサーバー ID がセットされる。picker から復元した場合は
   *   その draftId を引き継いで以後の update を同じエントリに集約する。
   */
  const sessionSlotKey = ref<string | null>(memoMode ? generateMemoKey() : null)
  // 初回 create 実行中の in-flight guard。連続入力で debounce 後に複数回
  // auto-save が飛んで重複 create されるのを防ぐ。
  let draftCreateInFlight: Promise<string> | null = null

  const formThemeVars = computed(() =>
    themeStore.getStyleVarsForAccount(activeAccountId.value),
  )

  const currentVisibility = computed(
    (): VisibilityOption =>
      visibilityOptions.find((o) => o.value === visibility.value) ??
      defaultVisibility,
  )

  // サーバー meta の maxNoteTextLength に initAdapter で同期する (取得失敗や
  // memo モードではデフォルトの MAX_TEXT_LENGTH のまま)
  const maxTextLength = ref(MAX_TEXT_LENGTH)

  const remainingChars = computed(() => maxTextLength.value - text.value.length)

  const canPost = computed(() => {
    if (isPosting.value || isUploading.value) return false
    if (remainingChars.value < 0) return false
    if (props.renoteId) return true
    if (attachedFiles.value.length > 0) return true
    if (showPoll.value && pollChoices.value.filter((c) => c.trim()).length >= 2)
      return true
    return text.value.trim().length > 0
  })

  async function initAdapter() {
    const acc = account.value
    if (!acc) return
    adapter = null
    // Memo mode: purely local, so skip every server call. Works for guest
    // accounts that have no token. Policies / default visibility / scheduled
    // notes are server-side concepts and don't apply to memos.
    if (memoMode) {
      await ensureMemosLoaded()
      return
    }
    try {
      const result = await initAdapterFor(acc.host, acc.id)
      adapter = result.adapter
      supportsScheduledNotes.value =
        result.serverInfo.features.scheduledNotes === true
    } catch (e) {
      error.value = AppError.from(e).message
      supportsScheduledNotes.value = false
    }

    // Fetch modes, policies, and user settings in parallel (all independent after adapter init)
    const [
      availabilityResult,
      policiesResult,
      userInfoResult,
      metaResult,
      quoteResult,
    ] = await Promise.allSettled([
      detectAvailableTimelines(acc.id),
      commands.apiGetUserPolicies(acc.id).then(unwrap),
      commands.apiGetSelf(acc.id).then(unwrap) as Promise<{
        defaultNoteVisibility?: string
        defaultNoteLocalOnly?: boolean
      }>,
      commands.apiGetMetaDetail(acc.id).then(unwrap) as Promise<{
        maxNoteTextLength?: unknown
      }>,
      props.renoteId && adapter
        ? adapter.api.getNote(props.renoteId)
        : Promise.resolve(null),
    ])

    quoteNote.value =
      quoteResult.status === 'fulfilled' ? quoteResult.value : null

    // 文字数上限をサーバー設定に同期 (#753)
    maxTextLength.value =
      metaResult.status === 'fulfilled' &&
      typeof metaResult.value?.maxNoteTextLength === 'number' &&
      metaResult.value.maxNoteTextLength > 0
        ? metaResult.value.maxNoteTextLength
        : MAX_TEXT_LENGTH

    // Apply mode flags
    if (availabilityResult.status === 'fulfilled') {
      const flags: Record<string, boolean> = {}
      for (const [key, value] of Object.entries(
        availabilityResult.value.modes,
      )) {
        if (value) {
          flags[key.replace(/^isIn/, 'isNoteIn')] = true
        }
      }
      noteModeFlags.value = flags
    } else {
      noteModeFlags.value = {}
    }

    // Apply visibility restrictions from role policies
    const disabled = new Set<string>()
    if (policiesResult.status === 'fulfilled') {
      const policies = policiesResult.value
      if (policies.canPublicNote === false) disabled.add('public')
      for (const [key, value] of Object.entries(policies)) {
        if (value !== false) continue
        const match = key.match(/^can(.+)Note$/)
        if (!match || key === 'canPublicNote') continue
        const name =
          (match[1]?.charAt(0).toLowerCase() ?? '') + (match[1]?.slice(1) ?? '')
        disabled.add(name)
      }
      // Filter mode flags by can*Note policies
      const filtered: Record<string, boolean> = {}
      for (const [flagKey, flagValue] of Object.entries(noteModeFlags.value)) {
        const m = flagKey.match(/^isNoteIn(.+)Mode$/)
        if (m) {
          const policyKey = `can${m[1]}Note`
          if (policies[policyKey] === false) continue
        }
        filtered[flagKey] = flagValue
      }
      noteModeFlags.value = filtered
    }
    if (props.replyTo?.visibility === 'specified') {
      disabled.add('public')
      disabled.add('home')
    }
    disabledVisibilities.value = disabled

    // Apply default note settings
    if (userInfoResult.status === 'fulfilled') {
      const userInfo = userInfoResult.value
      const v = userInfo.defaultNoteVisibility
      if (v && visibilityOptions.some((o) => o.value === v)) {
        visibility.value = v as NoteVisibility
      }
      if (!props.channelId) {
        localOnly.value = userInfo.defaultNoteLocalOnly === true
      }
    }

    // rememberVisibility: 最後に使った値で上書き。
    // 返信・編集・メモ・チャネルは visibility が文脈で決まるため対象外。
    // 記憶値はアカウントごとに保持。
    const isContextual =
      props.replyTo || props.editNote || memoMode || props.channelId
    if (!isContextual && settingsStore.get('postForm.rememberVisibility')) {
      const lastMap = settingsStore.get('postForm.lastUsedVisibilityByAccount')
      const last = lastMap?.[activeAccountId.value]
      if (last && visibilityOptions.some((o) => o.value === last)) {
        visibility.value = last as NoteVisibility
      }
      const lastLocalMap = settingsStore.get(
        'postForm.lastUsedLocalOnlyByAccount',
      )
      const lastLocal = lastLocalMap?.[activeAccountId.value]
      if (typeof lastLocal === 'boolean') {
        localOnly.value = lastLocal
      }
    }

    // Auto-correct if current visibility is disabled
    if (disabled.has(visibility.value)) {
      const first = visibilityOptions.find((o) => !disabled.has(o.value))
      if (first) visibility.value = first.value
    }
  }

  async function switchAccount(id: string) {
    activeAccountId.value = id
    showAccountMenu.value = false
    error.value = null
    await initAdapter()
  }

  async function post() {
    // Memo mode: no server call, just save + reset for next unique entry
    // (Obsidian's "Create Unique New Note" style workflow for Zettelkasten).
    if (memoMode) {
      const acc = account.value
      if (!acc || !canPost.value) return
      const key = sessionSlotKey.value ?? generateMemoKey()
      saveMemo(acc.id, key, buildSlotData())
      resetForm()
      sessionSlotKey.value = generateMemoKey()
      posted.value = true
      callbacks.onPosted()
      return
    }

    if (!adapter || !canPost.value) return

    // ログアウト済み (トークン無し) アカウントは API 到達前に止める (#693)。
    // 素通しすると生の "No token found" エラーが出た上、救済のサーバー
    // 下書き保存もトークン必須で必ず失敗する。入力は消さずフォームに残す。
    if (account.value?.hasToken === false) {
      showLoginPrompt()
      return
    }

    // 迷惑投稿チェック: public かつ MFM 拡大/位置指定を含む場合に警告
    if (!props.editNote && visibility.value === 'public') {
      const textToCheck =
        showCw.value && cw.value?.trim() ? cw.value : (text.value ?? '')
      if (isAnnoying(textToCheck)) {
        const { confirmWithAction } = useConfirm()
        const result = await confirmWithAction({
          title: 'この投稿は迷惑になる可能性があります',
          message: 'テキストの拡大や位置指定の MFM が含まれています。',
          type: 'warning',
          actions: [
            { value: 'home', label: 'ホームに投稿', primary: true },
            { value: 'cancel', label: 'やめる', cancel: true },
            { value: 'ignore', label: 'このまま投稿' },
          ],
        })
        if (!result) return
        if (result === 'home') visibility.value = 'home'
        // result === 'ignore' → そのまま public で投稿
      }
    }

    isPosting.value = true
    error.value = null

    // Edit mode: wait for API response (cannot be optimistic)
    if (props.editNote) {
      try {
        await adapter.api.updateNote(props.editNote.id, {
          text: text.value || undefined,
          cw: showCw.value && cw.value ? cw.value : undefined,
        })
        posted.value = true
        callbacks.onPosted(props.editNote.id)
      } catch (e) {
        error.value = AppError.from(e).message
      } finally {
        isPosting.value = false
      }
      return
    }

    // Scheduled post (Misskey 2025.10+): persist as an actually-scheduled
    // draft via notes/drafts/*. The server fires the note at `scheduledAt`.
    // On fork servers without the feature flag, fall through to `notes/create`
    // which may still accept `scheduledAt` (e.g. CherryPick).
    if (scheduledAt.value != null && supportsScheduledNotes.value) {
      try {
        await saveDraft(
          activeAccountId.value,
          sessionSlotKey.value,
          buildSlotData(true),
          {
            replyId: props.replyTo?.id ?? null,
            renoteId: props.renoteId ?? null,
            channelId: props.channelId ?? null,
          },
        )
        posted.value = true
        callbacks.onPosted()
      } catch (e) {
        error.value = AppError.from(e).message
      } finally {
        isPosting.value = false
      }
      return
    }

    // New note: optimistic UI — close form immediately, post in background
    const fileIds =
      attachedFiles.value.length > 0
        ? attachedFiles.value.map((f) => f.id)
        : undefined
    const modeFlags =
      Object.keys(noteModeFlags.value).length > 0
        ? noteModeFlags.value
        : undefined
    const pollParam =
      showPoll.value && pollChoices.value.filter((c) => c.trim()).length >= 2
        ? {
            choices: pollChoices.value.filter((c) => c.trim()),
            multiple: pollMultiple.value || undefined,
            expiresAt:
              pollExpiresAt.value ??
              (pollExpiredAfter.value != null
                ? Date.now() + pollExpiredAfter.value
                : undefined),
          }
        : undefined
    const noteParams = applyNotePostInterruptors(
      {
        text: text.value || undefined,
        cw: showCw.value && cw.value ? cw.value : undefined,
        visibility: visibility.value,
        localOnly:
          visibility.value === 'specified'
            ? false
            : localOnly.value || undefined,
        modeFlags,
        replyId: props.replyTo?.id,
        renoteId: props.renoteId,
        channelId: props.channelId,
        fileIds,
        poll: pollParam,
        scheduledAt: scheduledAt.value ?? undefined,
      },
      activeAccountId.value,
    )

    // rememberVisibility ON のときは送信した visibility を記憶 (per-account)
    if (
      !props.replyTo &&
      !props.channelId &&
      settingsStore.get('postForm.rememberVisibility')
    ) {
      const accId = activeAccountId.value
      const prevVis =
        settingsStore.get('postForm.lastUsedVisibilityByAccount') ?? {}
      settingsStore.set('postForm.lastUsedVisibilityByAccount', {
        ...prevVis,
        [accId]: visibility.value,
      })
      const prevLocal =
        settingsStore.get('postForm.lastUsedLocalOnlyByAccount') ?? {}
      settingsStore.set('postForm.lastUsedLocalOnlyByAccount', {
        ...prevLocal,
        [accId]: localOnly.value,
      })
    }

    // Close form optimistically before awaiting API
    posted.value = true
    isPosting.value = false
    callbacks.onPosted()

    // Fire API call in background — on failure, save as draft and notify
    const currentAdapter = adapter
    const currentAccountId = activeAccountId.value
    const retryKey = sessionSlotKey.value
    const retryCtx: DraftContext = {
      replyId: props.replyTo?.id ?? null,
      renoteId: props.renoteId ?? null,
      channelId: props.channelId ?? null,
    }
    currentAdapter.api.createNote(noteParams).catch(async (e) => {
      const { show } = useToast()
      show(AppError.from(e).message, 'error')
      // Auto-save as draft so user can retry
      try {
        await saveDraft(
          currentAccountId,
          retryKey,
          {
            text: noteParams.text ?? '',
            cw: noteParams.cw ?? '',
            showCw: !!noteParams.cw,
            visibility: noteParams.visibility ?? 'public',
            localOnly: noteParams.localOnly ?? false,
            fileIds: noteParams.fileIds ?? [],
            pollChoices: noteParams.poll?.choices ?? [],
            pollMultiple: noteParams.poll?.multiple ?? false,
            showPoll: !!noteParams.poll,
            scheduledAt: noteParams.scheduledAt ?? null,
          },
          retryCtx,
        )
      } catch (saveErr) {
        show(
          `下書き保存にも失敗しました: ${AppError.from(saveErr).message}`,
          'error',
        )
      }
    })
  }

  function selectVisibility(v: NoteVisibility) {
    visibility.value = v
    showVisibilityMenu.value = false
  }

  function noteModeLabel(noteKey: string): string {
    const match = noteKey.match(/^isNoteIn(.+)Mode$/)
    return match?.[1] ?? noteKey
  }

  function noteModeIcon(noteKey: string): string {
    const label = noteModeLabel(noteKey).toLowerCase()
    return CUSTOM_TL_ICONS[label] ?? DEFAULT_MODE_ICON
  }

  function insertAtCursor(
    textarea: HTMLTextAreaElement | null,
    insert: string,
  ) {
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    text.value = text.value.slice(0, start) + insert + text.value.slice(end)
    nextTick(() => {
      const pos = start + insert.length
      textarea.setSelectionRange(pos, pos)
      textarea.focus()
    })
  }

  function addPollChoice() {
    if (pollChoices.value.length < 10) {
      pollChoices.value.push('')
    }
  }

  function removePollChoice(index: number) {
    if (pollChoices.value.length > 2) {
      pollChoices.value.splice(index, 1)
    }
  }

  function resetForm() {
    text.value = ''
    cw.value = ''
    showCw.value = false
    attachedFiles.value = []
    showPoll.value = false
    pollChoices.value = ['', '']
    pollMultiple.value = false
    pollExpiresAt.value = null
    pollExpiredAfter.value = null
    scheduledAt.value = null
    error.value = null
    posted.value = false
  }

  function buildSlotData(isActuallyScheduled = false) {
    return {
      text: text.value,
      cw: cw.value,
      showCw: showCw.value,
      visibility: visibility.value,
      localOnly: localOnly.value,
      fileIds: attachedFiles.value.map((f) => f.id),
      pollChoices: pollChoices.value,
      pollMultiple: pollMultiple.value,
      showPoll: showPoll.value,
      scheduledAt: scheduledAt.value,
      // memo path で MemoData として扱われるため tags を含める。draft 系の
      // saveDraft 呼出側ではこのフィールドは未知扱いで無視される (Misskey
      // 側の notes/drafts/* は extra field を受理してそのまま無視する慣習)。
      tags: [] as string[],
      isActuallyScheduled,
    }
  }

  function buildDraftContext(): DraftContext {
    return {
      replyId: props.replyTo?.id ?? null,
      renoteId: props.renoteId ?? null,
      channelId: props.channelId ?? null,
    }
  }

  /**
   * 現フォーム内容を active slot へ保存する。memo はローカル、draft は
   * サーバー側 `notes/drafts/*` API 経由。初回 draft は create、以後は
   * 返ってきた draftId に対して update する。
   */
  async function saveCurrentSlot() {
    const acc = account.value
    if (!acc) return
    if (memoMode) {
      const key = sessionSlotKey.value
      if (!key) return
      saveMemo(acc.id, key, buildSlotData())
      return
    }
    // create 中なら重複発行を避けるため、既存 promise の完了を待ってから進める
    if (draftCreateInFlight) {
      try {
        sessionSlotKey.value = await draftCreateInFlight
      } catch {
        // 直前の create 失敗時はリセットして次の試行を許可
      }
    }
    try {
      if (sessionSlotKey.value == null) {
        draftCreateInFlight = saveDraft(
          acc.id,
          null,
          buildSlotData(),
          buildDraftContext(),
        ).then((d) => d.id)
        sessionSlotKey.value = await draftCreateInFlight
      } else {
        await saveDraft(
          acc.id,
          sessionSlotKey.value,
          buildSlotData(),
          buildDraftContext(),
        )
      }
    } catch (e) {
      error.value = AppError.from(e).message
    } finally {
      draftCreateInFlight = null
    }
  }

  /**
   * Auto-save: when the mode-specific toggle is on, persist on every change
   * (debounced). Skip empty forms so we never save a no-op entry.
   */
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
  function hasAnyContent(): boolean {
    if (text.value.trim().length > 0) return true
    if (attachedFiles.value.length > 0) return true
    if (showPoll.value && pollChoices.value.some((c) => c.trim())) return true
    return false
  }
  watch(
    [
      text,
      cw,
      showCw,
      visibility,
      localOnly,
      attachedFiles,
      pollChoices,
      pollMultiple,
      showPoll,
      scheduledAt,
    ],
    () => {
      const toggleKey = memoMode
        ? 'postForm.autoSaveMemo'
        : 'postForm.autoSaveDraft'
      if (!settingsStore.get(toggleKey)) return
      if (!hasAnyContent()) return
      if (autoSaveTimer) clearTimeout(autoSaveTimer)
      autoSaveTimer = setTimeout(() => {
        saveCurrentSlot()
        autoSaveTimer = null
      }, 800)
    },
    { deep: true },
  )

  /**
   * Load a stored memo or draft into the form. Adopts its key as the session
   * slot so subsequent auto-saves update the same entry, preserving
   * "continue editing" semantics across restore → type cycles.
   */
  function restoreSlot(stored: StoredMemo | StoredDraft, key?: string) {
    const d = stored.data
    text.value = d.text
    cw.value = d.cw
    showCw.value = d.showCw
    visibility.value = d.visibility
    localOnly.value = d.localOnly
    pollChoices.value = d.pollChoices.length >= 2 ? d.pollChoices : ['', '']
    pollMultiple.value = d.pollMultiple
    showPoll.value = d.showPoll
    scheduledAt.value = d.scheduledAt
    // draft モードではサーバー id、memo モードでは memoKey を受け取る
    if (key) sessionSlotKey.value = key
    else if ('id' in stored) sessionSlotKey.value = stored.id
    // Note: file attachments are not restored (IDs may be expired)
  }

  async function removeCurrentSlot() {
    const acc = account.value
    if (!acc) return
    const key = sessionSlotKey.value
    if (!key) return
    if (memoMode) {
      deleteMemo(acc.id, key)
    } else {
      try {
        await deleteDraft(acc.id, key)
      } catch (e) {
        error.value = AppError.from(e).message
      }
    }
  }

  return {
    // Refs
    text,
    cw,
    showCw,
    visibility,
    localOnly,
    showVisibilityMenu,
    showAccountMenu,
    isPosting,
    posted,
    error,
    attachedFiles,
    pendingUploads,
    isUploading,
    noteModeFlags,
    disabledVisibilities,
    activeAccountId,
    quoteNote,
    showPoll,
    pollChoices,
    pollMultiple,
    pollExpiresAt,
    pollExpiredAfter,
    scheduledAt,
    supportsScheduledNotes,
    sessionSlotKey,
    // Computed
    accounts,
    account,
    formThemeVars,
    currentVisibility,
    remainingChars,
    maxTextLength,
    canPost,
    // Constants
    MAX_TEXT_LENGTH,
    visibilityOptions,
    // Functions
    initAdapter,
    switchAccount,
    post,
    uploadFilesFromPaths,
    uploadBrowserFiles,
    retryUpload,
    dismissUpload,
    attachDriveFiles,
    removeFile,
    reorderFiles,
    updateAttachedFileMeta,
    selectVisibility,
    noteModeLabel,
    noteModeIcon,
    insertAtCursor,
    addPollChoice,
    removePollChoice,
    resetForm,
    saveCurrentSlot,
    restoreSlot,
    removeCurrentSlot,
    hasAnyContent,
  }
}
