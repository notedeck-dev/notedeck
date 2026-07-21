<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  ref,
  watch,
} from 'vue'
import type { NormalizedDriveFile, NormalizedNote } from '@/adapters/types'
import {
  getPluginHandlers,
  type PluginHandler,
  setPluginAccountContext,
} from '@/aiscript/plugin-api'
import { useAutocomplete } from '@/composables/useAutocomplete'
import type { StoredDraft } from '@/composables/useDrafts'
import { showLoginPrompt } from '@/composables/useLoginPrompt'
import type { StoredMemo } from '@/composables/useMemos'
import { useMfmInsert } from '@/composables/useMfmInsert'
import { usePopupControl } from '@/composables/usePopupControl'
import { usePostFormState } from '@/composables/usePostFormState'
import { useScheduleDialog } from '@/composables/useScheduleDialog'
import {
  getAccountAvatarUrl,
  getAccountLabel,
  isGuestAccount,
} from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import { useEmojisStore } from '@/stores/emojis'
import { usePostFormStore } from '@/stores/postForm'
import { useSettingsStore } from '@/stores/settings'
import { useIsCompactLayout } from '@/stores/ui'
import { useWindowsStore } from '@/stores/windows'
import { buildPreviewNote } from '@/utils/buildPreviewNote'
import { buildReplyMentions } from '@/utils/replyMentions'
import {
  formatScheduleAbsolute,
  formatScheduleRelative,
} from '@/utils/scheduleFormat'
import MkAutocompletePopup from './MkAutocompletePopup.vue'
import MkDraftsPicker from './MkDraftsPicker.vue'
import MkDrivePicker from './MkDrivePicker.vue'
import MkMfm from './MkMfm.vue'
import MkNote from './MkNote.vue'
import MkPostFormButtonsPicker from './MkPostFormButtonsPicker.vue'
import PostFormFilePreviews from './post-form/PostFormFilePreviews.vue'
import PostFormPollEditor from './post-form/PostFormPollEditor.vue'

const MkReactionPicker = defineAsyncComponent(
  () => import('./MkReactionPicker.vue'),
)

const props = defineProps<{
  accountId: string
  replyTo?: NormalizedNote
  renoteId?: string
  editNote?: NormalizedNote
  channelId?: string
  inline?: boolean
  initialText?: string
  initialCw?: string
  initialVisibility?: string
  initialLocalOnly?: boolean
  initialFilePaths?: string[]
  /**
   * 起動時にフォームへロードするスロット (draft または memo)。
   * restoreSlot でフィールドを展開し、sessionSlotKey に initialSlotKey を継承する。
   */
  initialSlot?: StoredDraft | StoredMemo | null
  initialSlotKey?: string | null
  /**
   * true にするとメモモード: post は memo に保存、auto-save も memo 側。
   * メモカラムの埋め込みフォーム専用。
   */
  memoMode?: boolean
}>()

const emit = defineEmits<{
  close: []
  posted: [editedNoteId?: string]
}>()

const isCompact = useIsCompactLayout()
const settingsStore = useSettingsStore()
const postFormStore = usePostFormStore()
const windowsStore = useWindowsStore()
const emojisStore = useEmojisStore()
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const showPreview = computed<boolean>({
  get: () => settingsStore.get('postForm.preview') ?? false,
  set: (v) => {
    settingsStore.set('postForm.preview', v)
  },
})

const {
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
  accounts,
  account,
  formThemeVars,
  currentVisibility,
  remainingChars,
  maxTextLength,
  canPost,
  visibilityOptions,
  quoteNote,
  showPoll,
  pollChoices,
  pollMultiple,
  pollExpiresAt,
  pollExpiredAfter,
  scheduledAt,
  supportsScheduledNotes,
  sessionSlotKey,
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
  restoreSlot,
  saveCurrentSlot,
  hasAnyContent,
} = usePostFormState(
  props,
  {
    onPosted: (id) => {
      emit('posted', id)
      if (props.inline) {
        // Reset form for next post instead of closing
        resetForm()
      }
    },
  },
  { memoMode: props.memoMode },
)

// --- Auto-save toggle (persisted in settings, like preview).
// 非 memoMode は drafts に自動保存、memoMode は memos に自動保存。
const autoSaveKey = computed(() =>
  props.memoMode ? 'postForm.autoSaveMemo' : 'postForm.autoSaveDraft',
)
const autoSaveEnabled = computed<boolean>({
  get: () => settingsStore.get(autoSaveKey.value) ?? false,
  set: (v) => {
    settingsStore.set(autoSaveKey.value, v)
  },
})
const autoSaveLabel = computed(() =>
  props.memoMode ? 'メモを自動保存' : '下書きを自動保存',
)

const rememberVisibilityEnabled = computed<boolean>({
  get: () => settingsStore.get('postForm.rememberVisibility') ?? false,
  set: (v) => {
    settingsStore.set('postForm.rememberVisibility', v)
  },
})

// --- Popup exclusive control ---
// ピッカー系 (emoji / drive / memo) はシングルトン: 同時に1つだけ開く
const popups = usePopupControl()
const showEmojiPopup = popups.register()
const showMoreMenu = popups.register()
const showDraftsPicker = popups.register()
const showDrivePicker = popups.register()
const showPostFormButtonsPicker = popups.register()

function togglePostFormButtonsPicker() {
  popups.toggle(showPostFormButtonsPicker)
}

// --- Drafts picker (inline, opens below the form) ---
function toggleDraftsPicker() {
  popups.toggle(showDraftsPicker)
}
function onDraftPicked(key: string, draft: StoredDraft) {
  restoreSlot(draft, key)
  showDraftsPicker.value = false
}

const {
  showScheduleDialog,
  scheduleDialogRef,
  pendingScheduleDate,
  pendingScheduleTime,
  canConfirmSchedule,
  scheduleNow,
  openScheduleDialog,
  confirmSchedule,
  clearSchedule,
  minScheduleDate,
} = useScheduleDialog(scheduledAt)

// --- Preview ---
const previewNote = computed<NormalizedNote | null>(() => {
  if (!showPreview.value) return null
  const acc = account.value
  if (!acc) return null
  const emojiDict = emojisStore.cache.get(acc.host) ?? {}
  return buildPreviewNote({
    account: acc,
    id: `preview-${acc.id}`,
    createdAt: new Date().toISOString(),
    text: text.value || null,
    cw: showCw.value && cw.value ? cw.value : null,
    visibility: visibility.value,
    localOnly: localOnly.value,
    replyId: props.replyTo?.id ?? null,
    renoteId: props.renoteId ?? null,
    channelId: props.channelId ?? null,
    poll: {
      choices: pollChoices.value,
      multiple: pollMultiple.value,
      expiresAt:
        pollExpiresAt.value != null
          ? new Date(pollExpiresAt.value).toISOString()
          : pollExpiredAfter.value != null
            ? new Date(Date.now() + pollExpiredAfter.value).toISOString()
            : null,
      show: showPoll.value,
    },
    emojis: emojiDict,
    reactionEmojis: emojiDict,
  })
})

// memoMode 時はプレビュー内の MkNote のナビゲーションを抑制し、
// 現在編集中メモを memoEditor ウィンドウで開く。
// (previewNote の id は `preview-*` の合成IDで 404 になるため)
function onPreviewClick(ev: Event) {
  if (!props.memoMode) return
  ev.preventDefault()
  ev.stopPropagation()
  const acc = account.value
  const key = sessionSlotKey.value
  if (!acc || !key) return
  windowsStore.open('memoEditor', {
    accountId: acc.id,
    memoKey: key,
  })
}

// --- Mention ---
// 専用の検索ポップアップは廃止 (#753): '@' を挿入してインライン補完
// (useAutocomplete) に一本化。ハッシュタグボタンと同型
function insertMention() {
  insertAtCursor(textareaRef.value, '@')
}

// --- Emoji popup ---
function toggleEmojiPopup() {
  popups.toggle(showEmojiPopup)
}

function pickEmoji(reaction: string) {
  insertAtCursor(textareaRef.value, reaction)
  showEmojiPopup.value = false
}

// --- Hashtag ---
function insertHashtag() {
  insertAtCursor(textareaRef.value, '#')
}

// --- Plugin post_form_action (#731) ---
const showPluginActionsMenu = popups.register()

const postFormActions = computed(() =>
  getPluginHandlers('post_form_action', activeAccountId.value),
)

function togglePluginActionsMenu() {
  popups.toggle(showPluginActionsMenu)
}

function runPostFormAction(action: PluginHandler) {
  showPluginActionsMenu.value = false
  if (activeAccountId.value) {
    setPluginAccountContext(action.pluginInstallId, activeAccountId.value)
  }
  // handler は (form, update) の 2 引数 (plugin-api.ts の register_post_form_action)。
  // update は 'text' / 'cw' キーに対応し、cw: null は CW 解除。
  action.handler(
    { text: text.value, cw: showCw.value ? cw.value : null },
    (key: unknown, value: unknown) => {
      if (key === 'text' && typeof value === 'string') {
        text.value = value
      } else if (key === 'cw') {
        if (value == null) {
          showCw.value = false
          cw.value = ''
        } else if (typeof value === 'string') {
          showCw.value = true
          cw.value = value
        }
      }
    },
  )
}

// --- MFM menu ---
const {
  showMfmMenu,
  mfmFunctions,
  toggleMfmMenu: rawToggleMfm,
  pickMfm,
} = useMfmInsert(textareaRef, text)
popups.track(showMfmMenu)

function toggleMfmMenu() {
  rawToggleMfm()
  popups.closeOthers(showMfmMenu)
}

// --- Autocomplete ---
const serverHost = computed(() => account.value?.host ?? '')
const {
  autocompleteState,
  candidates: acCandidates,
  isSearching: acSearching,
  popupPosition: acPopupPosition,
  onTextInput: acOnTextInput,
  onCompositionStart: acOnCompositionStart,
  onCompositionEnd: acOnCompositionEnd,
  handleKeydown: acHandleKeydown,
  confirmSelection: acConfirmSelection,
  dismiss: acDismiss,
} = useAutocomplete(text, textareaRef, activeAccountId, serverHost)

// --- File attach (drive picker) ---
function toggleDrivePicker() {
  popups.toggle(showDrivePicker)
}

function onDriveFilesPicked(driveFiles: NormalizedDriveFile[]) {
  attachDriveFiles(driveFiles)
  showDrivePicker.value = false
}

// --- Close popups on form click ---
function toggleMoreMenu() {
  popups.toggle(showMoreMenu)
}

function closePopups() {
  popups.closeAll()
  acDismiss()
}

onMounted(async () => {
  await initAdapter()
  if (props.editNote) {
    text.value = props.editNote.text ?? ''
    if (props.editNote.cw) {
      cw.value = props.editNote.cw
      showCw.value = true
    }
    visibility.value = props.editNote.visibility
  } else if (props.replyTo) {
    visibility.value = props.replyTo.visibility
    // リプライ先 + 本文中の会話参加者へのメンションを prefill (#707 で抽出)
    const mentions = buildReplyMentions(props.replyTo, account.value ?? null)
    if (mentions.length > 0) {
      text.value = `${mentions.join(' ')} `
    }
  }
  if (props.initialText) text.value = props.initialText
  if (props.initialCw) {
    cw.value = props.initialCw
    showCw.value = true
  }
  if (props.initialVisibility)
    visibility.value = props.initialVisibility as typeof visibility.value
  if (props.initialLocalOnly) localOnly.value = true
  if (props.initialFilePaths?.length) {
    uploadFilesFromPaths(props.initialFilePaths)
  }
  if (props.initialSlot)
    restoreSlot(props.initialSlot, props.initialSlotKey ?? undefined)
  await nextTick()
  if (!props.inline) textareaRef.value?.focus()
})

// Watch for additional file drops while the form is open
watch(
  () => props.initialFilePaths,
  (paths) => {
    if (paths?.length) uploadFilesFromPaths(paths)
  },
)

let overlayPointerDown = false

function onOverlayPointerDown(e: PointerEvent) {
  overlayPointerDown = e.target === e.currentTarget
}

function onOverlayClick(e: MouseEvent) {
  if (overlayPointerDown && e.target === e.currentTarget) {
    requestClose()
  }
  overlayPointerDown = false
}

const { confirmWithAction } = useConfirm()
let closing = false

/** ×・オーバーレイ・Esc の閉じ経路を集約。自動保存 OFF で書きかけが
 *  あるときだけ「保存して閉じる / 破棄 / キャンセル」を確認する */
async function requestClose() {
  if (closing) return
  if (posted.value || autoSaveEnabled.value || !hasAnyContent()) {
    emit('close')
    return
  }
  closing = true
  try {
    const choice = await confirmWithAction({
      title: props.memoMode
        ? '書きかけのメモがあります'
        : '書きかけの投稿があります',
      message: props.memoMode
        ? '閉じる前にメモとして保存しますか？'
        : '閉じる前に下書きとして保存しますか？',
      icon: 'question',
      actions: [
        { value: 'save', label: '保存して閉じる', primary: true },
        { value: 'discard', label: '破棄' },
        { value: 'cancel', label: 'キャンセル', cancel: true },
      ],
    })
    if (choice === 'save') {
      await saveCurrentSlot()
      emit('close')
    } else if (choice === 'discard') {
      emit('close')
    }
  } finally {
    closing = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (acHandleKeydown(e)) return
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (!isPosting.value) post()
  }
  if (e.key === 'Escape' && !props.inline) {
    requestClose()
  }
}

// クリップボードの画像等をそのまま添付 (#753)。ファイルが無い通常の
// テキストペーストはデフォルト動作に任せる
function onPaste(e: ClipboardEvent) {
  const files = Array.from(e.clipboardData?.files ?? [])
  if (files.length === 0) return
  e.preventDefault()
  void uploadBrowserFiles(files)
}
</script>

<template>
  <div :class="[inline ? $style.postInlineWrapper : $style.postOverlay, { [$style.mobile]: isCompact }]" @pointerdown="!inline && onOverlayPointerDown($event)" @click="!inline && onOverlayClick($event)">
    <div data-post-form :class="[$style.postForm, { [$style.postFormInline]: inline }]" :style="formThemeVars" @click.stop="closePopups">
      <!-- Header -->
      <header :class="$style.header">
        <div v-if="!inline" :class="$style.headerLeft">
          <button class="_button" :class="$style.headerBtn" title="閉じる" @click="requestClose">
            <i class="ti ti-x" />
          </button>
          <div v-if="account" :class="$style.accountWrapper">
            <button
              class="_button"
              :class="$style.accountBtn"
              :title="getAccountLabel(account)"
              @click="showAccountMenu = !showAccountMenu"
            >
              <img
                :src="getAccountAvatarUrl(account)"
                :class="$style.accountAvatar"
              />
            </button>
            <div v-if="showAccountMenu && accounts.length > 1" :class="$style.accountMenu">
              <button
                v-for="acc in accounts"
                :key="acc.id"
                class="_button"
                :class="[$style.accountOption, { [$style.active]: acc.id === activeAccountId, [$style.accountDisabled]: isGuestAccount(acc) }]"
                :disabled="isGuestAccount(acc)"
                @click="acc.hasToken ? switchAccount(acc.id) : showLoginPrompt()"
              >
                <img
                  :src="getAccountAvatarUrl(acc)"
                  :class="$style.accountOptionAvatar"
                  width="24"
                  height="24"
                />
                <div :class="$style.accountOptionInfo">
                  <span :class="$style.accountOptionName">{{ isGuestAccount(acc) ? (acc.displayName || 'ゲスト') : acc.username }}</span>
                  <span :class="$style.accountOptionHost">@{{ acc.host }}</span>
                </div>
              </button>
            </div>
          </div>
        </div>
        <div v-else :class="$style.headerLeft" />
        <div :class="$style.headerRight">
          <!-- Note mode flags -->
          <button
            v-for="(val, key) in noteModeFlags"
            :key="key"
            class="_button"
            :class="[$style.headerBtn, $style.noteModeBtn, { [$style.active]: val }]"
            :title="noteModeLabel(key as string)"
            @click="noteModeFlags[key as string] = !noteModeFlags[key as string]"
          >
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path
                :d="noteModeIcon(key as string)"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              />
            </svg>
          </button>

          <!-- Visibility (hidden in inline channel mode: always public) -->
          <div v-if="!inline" :class="$style.visibilityWrapper">
            <button
              class="_button"
              :class="$style.headerBtn"
              :title="currentVisibility.label"
              @click="showVisibilityMenu = !showVisibilityMenu"
            >
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  :d="currentVisibility.icon"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  fill="none"
                />
              </svg>
              <span :class="$style.headerBtnText">{{ currentVisibility.label }}</span>
            </button>
            <div v-if="showVisibilityMenu" :class="$style.visibilityMenu">
              <button
                v-for="opt in visibilityOptions"
                :key="opt.value"
                class="_button"
                :class="[$style.visibilityOption, { [$style.active]: visibility === opt.value }]"
                :disabled="disabledVisibilities.has(opt.value)"
                @click="selectVisibility(opt.value)"
              >
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path
                    :d="opt.icon"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    fill="none"
                  />
                </svg>
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- Local only (hidden in inline channel mode: always local-only) -->
          <button
            v-if="!inline && visibility !== 'specified'"
            class="_button"
            :class="[$style.headerBtn, $style.localOnlyBtn, { [$style.active]: localOnly }]"
            :title="localOnly ? 'ローカルのみ (連合なし)' : '連合あり'"
            @click="localOnly = !localOnly"
          >
            <i :class="localOnly ? 'ti ti-rocket-off' : 'ti ti-rocket'" />
          </button>

          <!-- More menu (preview, memo, schedule) -->
          <div :class="$style.moreMenuWrapper">
            <button
              class="_button"
              :class="$style.headerBtn"
              title="その他"
              @click.stop="toggleMoreMenu"
            >
              <i class="ti ti-dots" />
            </button>
            <div v-if="showMoreMenu" :class="$style.moreMenu" @click.stop>
              <!-- Preview toggle -->
              <div
                :class="$style.moreMenuItem"
                role="switch"
                :aria-checked="showPreview"
                @click="showPreview = !showPreview"
              >
                <i class="ti ti-eye" />
                プレビュー
                <span
                  class="nd-toggle-switch"
                  :class="{ on: showPreview }"
                  :style="{ marginLeft: 'auto' }"
                  aria-hidden="true"
                >
                  <span class="nd-toggle-switch-knob" />
                </span>
              </div>
              <!-- Auto-save toggle (memoMode: memos, else: drafts) -->
              <div
                :class="$style.moreMenuItem"
                role="switch"
                :aria-checked="autoSaveEnabled"
                @click="autoSaveEnabled = !autoSaveEnabled"
              >
                <i class="ti ti-device-floppy" />
                {{ autoSaveLabel }}
                <span
                  class="nd-toggle-switch"
                  :class="{ on: autoSaveEnabled }"
                  :style="{ marginLeft: 'auto' }"
                  aria-hidden="true"
                >
                  <span class="nd-toggle-switch-knob" />
                </span>
              </div>
              <!-- Remember visibility toggle -->
              <div
                :class="$style.moreMenuItem"
                role="switch"
                :aria-checked="rememberVisibilityEnabled"
                @click="rememberVisibilityEnabled = !rememberVisibilityEnabled"
              >
                <i class="ti ti-bookmark" />
                公開範囲を記憶
                <span
                  class="nd-toggle-switch"
                  :class="{ on: rememberVisibilityEnabled }"
                  :style="{ marginLeft: 'auto' }"
                  aria-hidden="true"
                >
                  <span class="nd-toggle-switch-knob" />
                </span>
              </div>
              <!-- Schedule (only if server supports it). ボタンでダイアログを開く。
                   Misskey 本家と同様 native datetime-local をダイアログ内に表示 -->
              <template v-if="supportsScheduledNotes && !editNote">
                <div :class="$style.moreMenuDivider" />
                <button
                  class="_button"
                  :class="[$style.moreMenuItem, { [$style.active]: !!scheduledAt }]"
                  @click.stop="openScheduleDialog(); showMoreMenu = false"
                >
                  <i class="ti ti-clock" />
                  予約投稿
                  <span v-if="scheduledAt" :class="$style.moreMenuScheduleBadge">
                    {{ formatScheduleAbsolute(scheduledAt, scheduleNow) }}
                  </span>
                </button>
              </template>
            </div>
          </div>

          <!-- Submit -->
          <button
            :class="[$style.submitBtn, { [$style.posted]: posted }]"
            :disabled="!canPost"
            @click="post"
          >
            <template v-if="posted">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none" />
              </svg>
            </template>
            <template v-else-if="isPosting">
              <span :class="$style.postingDots">...</span>
            </template>
            <template v-else>
              {{ editNote ? '編集' : replyTo ? '返信' : renoteId ? '引用' : scheduledAt ? '予約' : 'ノート' }}
              <svg viewBox="0 0 24 24" width="16" height="16" :class="$style.submitIcon">
                <template v-if="editNote">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                </template>
                <template v-else-if="replyTo">
                  <path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                </template>
                <template v-else-if="renoteId">
                  <path d="M10 11h6m-3-3v6M3 8V6a2 2 0 012-2h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                </template>
                <template v-else>
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                </template>
              </svg>
            </template>
          </button>
        </div>
      </header>

      <!-- Reply preview -->
      <div v-if="replyTo" :class="$style.replyPreview">
        <img
          v-if="replyTo.user.avatarUrl"
          :src="replyTo.user.avatarUrl"
          :class="$style.replyAvatar"
        />
        <div :class="$style.replyContent">
          <span :class="$style.replyUser">
            <MkMfm v-if="replyTo.user.name" :text="replyTo.user.name" :emojis="replyTo.user.emojis" :server-host="replyTo._serverHost" plain />
            <template v-else>{{ replyTo.user.username }}</template>
          </span>
          <span :class="$style.replyHandle">@{{ replyTo.user.username }}</span>
          <p :class="$style.replyText">{{ replyTo.text }}</p>
        </div>
      </div>

      <!-- Quote preview (#753)。取得前・取得失敗時はインジケータのみ -->
      <div v-if="quoteNote && !replyTo" :class="[$style.replyPreview, $style.quotePreview]">
        <img
          v-if="quoteNote.user.avatarUrl"
          :src="quoteNote.user.avatarUrl"
          :class="$style.replyAvatar"
        />
        <div :class="$style.replyContent">
          <span :class="$style.replyUser">
            <MkMfm v-if="quoteNote.user.name" :text="quoteNote.user.name" :emojis="quoteNote.user.emojis" :server-host="quoteNote._serverHost" plain />
            <template v-else>{{ quoteNote.user.username }}</template>
          </span>
          <span :class="$style.replyHandle">@{{ quoteNote.user.username }}</span>
          <p :class="$style.replyText">{{ quoteNote.cw ?? quoteNote.text }}</p>
        </div>
      </div>
      <div v-else-if="renoteId && !replyTo" :class="$style.quoteIndicator">
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path d="M10 11h6m-3-3v6M3 8V6a2 2 0 012-2h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
        </svg>
        引用付き
      </div>

      <!-- CW input -->
      <div v-if="showCw" :class="$style.cwOuter">
        <input
          v-model="cw"
          :class="$style.cwInput"
          placeholder="閲覧注意"
          autocomplete="off"
        />
      </div>

      <!-- Textarea -->
      <div :class="[$style.textOuter, { [$style.withCw]: showCw }]">
        <textarea
          ref="textareaRef"
          v-model="text"
          :class="$style.textArea"
          :maxlength="maxTextLength"
          :placeholder="replyTo ? '返信...' : renoteId ? '引用...' : '今どんな気分？'"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="sentences"
          spellcheck="false"
          @keydown="onKeydown"
          @input="acOnTextInput"
          @paste="onPaste"
          @compositionstart="acOnCompositionStart"
          @compositionend="acOnCompositionEnd"
          @click.stop
        />
        <MkAutocompletePopup
          v-if="autocompleteState && acCandidates.length > 0"
          :type="autocompleteState.type"
          :candidates="acCandidates"
          :selected-index="autocompleteState.selectedIndex"
          :is-searching="acSearching"
          :position="acPopupPosition"
          @select="acConfirmSelection"
        />
        <span
          class="_acrylic"
          :class="[
            $style.textCount,
            { [$style.near]: remainingChars <= 100, [$style.over]: remainingChars < 0 },
          ]"
        >{{ remainingChars }}</span>
        <span
          v-if="scheduledAt"
          :class="$style.scheduleIndicator"
          :title="formatScheduleAbsolute(scheduledAt, scheduleNow)"
        >
          <i class="ti ti-clock" />
          <span :class="$style.scheduleIndicatorRel">
            {{ formatScheduleRelative(scheduledAt, scheduleNow) }}
          </span>
          <span :class="$style.scheduleIndicatorAbs">
            {{ formatScheduleAbsolute(scheduledAt, scheduleNow) }}
          </span>
          <button
            class="_button"
            :class="$style.scheduleClear"
            :title="'予約を解除'"
            @click="scheduledAt = null"
          >
            <i class="ti ti-x" />
          </button>
        </span>
      </div>

      <!-- Preview -->
      <div v-if="showPreview" :class="$style.previewSection">
        <div
          v-if="previewNote"
          @click.capture="onPreviewClick"
        >
          <MkNote :note="previewNote" embedded />
        </div>
        <div v-else :class="$style.previewEmpty">アカウントが選択されていません</div>
      </div>

      <!-- Poll editor -->
      <PostFormPollEditor
        v-if="showPoll"
        v-model:multiple="pollMultiple"
        v-model:expires-at="pollExpiresAt"
        v-model:expired-after="pollExpiredAfter"
        :choices="pollChoices"
        @add="addPollChoice"
        @remove="removePollChoice"
      />

      <!-- File previews -->
      <PostFormFilePreviews
        v-if="attachedFiles.length > 0 || pendingUploads.length > 0"
        :files="attachedFiles"
        :pending="pendingUploads"
        :account-id="activeAccountId"
        @remove="removeFile"
        @retry="retryUpload"
        @dismiss="dismissUpload"
        @reorder="reorderFiles"
        @update-meta="updateAttachedFileMeta"
      />

      <!-- Error -->
      <div v-if="error" :class="$style.postError">{{ error }}</div>

      <!-- Footer -->
      <footer :class="$style.footer">
        <div :class="$style.footerLeft">
          <template v-for="btnId in postFormStore.buttons" :key="btnId">
            <!-- Emoji -->
            <button
              v-if="btnId === 'emoji'"
              class="_button"
              :class="[$style.footerBtn, { [$style.active]: showEmojiPopup }]"
              title="絵文字"
              @click.stop="toggleEmojiPopup"
            >
              <i class="ti ti-mood-happy" />
            </button>

            <!-- Attach file (drive picker) -->
            <button
              v-else-if="btnId === 'attach'"
              class="_button"
              :class="[$style.footerBtn, { [$style.active]: showDrivePicker }]"
              title="ファイルを添付"
              :disabled="isUploading"
              @click.stop="toggleDrivePicker"
            >
              <i class="ti ti-photo-plus" />
            </button>

            <!-- Poll -->
            <button
              v-else-if="btnId === 'poll'"
              class="_button"
              :class="[$style.footerBtn, { [$style.active]: showPoll }]"
              title="投票"
              @click="showPoll = !showPoll"
            >
              <i class="ti ti-chart-arrows" />
            </button>

            <!-- CW -->
            <button
              v-else-if="btnId === 'cw'"
              class="_button"
              :class="[$style.footerBtn, { [$style.active]: showCw }]"
              title="閲覧注意"
              @click="showCw = !showCw"
            >
              <i class="ti ti-eye-off" />
            </button>

            <!-- Hashtag -->
            <button
              v-else-if="btnId === 'hashtag'"
              class="_button"
              :class="$style.footerBtn"
              title="ハッシュタグ"
              @click="insertHashtag"
            >
              <i class="ti ti-hash" />
            </button>

            <!-- Mention -->
            <button
              v-else-if="btnId === 'mention'"
              class="_button"
              :class="$style.footerBtn"
              title="メンション"
              @click="insertMention"
            >
              <i class="ti ti-at" />
            </button>

            <!-- MFM -->
            <div v-else-if="btnId === 'mfm'" :class="$style.footerPopupWrapper">
              <button class="_button" :class="$style.footerBtn" title="MFM" @click.stop="toggleMfmMenu">
                <i class="ti ti-palette" />
              </button>
              <div v-if="showMfmMenu" :class="[$style.footerPopup, $style.mfmMenu]" @click.stop>
                <button
                  v-for="fn in mfmFunctions"
                  :key="fn.label"
                  class="_button"
                  :class="$style.mfmMenuItem"
                  @click="pickMfm(fn)"
                >
                  {{ fn.label }}
                </button>
              </div>
            </div>

            <!-- Drafts picker toggle (hidden in memo mode) -->
            <button
              v-else-if="btnId === 'draft' && !memoMode"
              class="_button"
              :class="[$style.footerBtn, { [$style.active]: showDraftsPicker }]"
              title="下書き一覧"
              @click.stop="toggleDraftsPicker"
            >
              <i class="ti ti-notes" />
            </button>

            <!-- Clear -->
            <button
              v-else-if="btnId === 'clear'"
              class="_button"
              :class="$style.footerBtn"
              title="クリア"
              @click="resetForm"
            >
              <i class="ti ti-trash" />
            </button>
          </template>

          <!-- Plugin post_form_action (#731) — 登録があるときだけ表示 -->
          <div v-if="postFormActions.length > 0" :class="$style.footerPopupWrapper">
            <button class="_button" :class="$style.footerBtn" title="プラグイン" @click.stop="togglePluginActionsMenu">
              <i class="ti ti-plug" />
            </button>
            <div v-if="showPluginActionsMenu" :class="[$style.footerPopup, $style.mfmMenu]" @click.stop>
              <button
                v-for="action in postFormActions"
                :key="action.pluginInstallId + action.title"
                class="_button"
                :class="$style.mfmMenuItem"
                @click="runPostFormAction(action)"
              >
                {{ action.title }}
              </button>
            </div>
          </div>
        </div>
        <div v-if="!props.inline" :class="$style.footerRight">
          <!-- Post form editor -->
          <button
            class="_button"
            :class="[$style.footerBtn, { [$style.active]: showPostFormButtonsPicker }]"
            title="ボタン並び替え"
            @click.stop="togglePostFormButtonsPicker"
          >
            <i class="ti ti-settings" />
          </button>
        </div>
      </footer>

    </div>

    <!-- Drafts picker (below post form, mock server-side drafts API) -->
    <MkDraftsPicker
      v-if="showDraftsPicker"
      :account-id="activeAccountId!"
      :supports-scheduled-notes="supportsScheduledNotes"
      @pick="onDraftPicked"
      @close="showDraftsPicker = false"
    />

    <!-- Drive picker (below post form) -->
    <MkDrivePicker
      v-if="showDrivePicker"
      :account-id="activeAccountId!"
      @pick="onDriveFilesPicked"
      @close="showDrivePicker = false"
    />

    <!-- Post form buttons picker (below post form) -->
    <MkPostFormButtonsPicker
      v-if="showPostFormButtonsPicker"
      @close="showPostFormButtonsPicker = false"
    />

    <!-- Emoji picker (below post form) -->
    <div v-if="showEmojiPopup && account" :class="$style.emojiPickerPanel" :style="formThemeVars" @click.stop>
      <div :class="$style.emojiPickerHeader">
        <span :class="$style.emojiPickerTitle">
          <i class="ti ti-mood-happy" />
          絵文字
        </span>
        <button class="_button" :class="$style.emojiPickerCloseBtn" title="閉じる" @click="showEmojiPopup = false">
          <i class="ti ti-x" />
        </button>
      </div>
      <div :class="$style.emojiPickerBody">
        <MkReactionPicker
          :server-host="account.host"
          :account-id="activeAccountId"
          full-width
          @pick="pickEmoji"
        />
      </div>
    </div>

    <!-- Schedule dialog: 既存ダイアログ (AppPrompt/AppConfirm) と同じ構造 -->
    <dialog
      v-if="showScheduleDialog"
      ref="scheduleDialogRef"
      class="_nativeDialog"
    >
      <form
        class="_dialog nd-popup-content"
        @submit.prevent="confirmSchedule"
      >
        <div :class="$style.scheduleHeader">
          <div :class="$style.scheduleTitle">予約投稿</div>
        </div>
        <div :class="$style.scheduleBody">
          <div :class="$style.scheduleRow">
            <input
              v-model="pendingScheduleDate"
              type="date"
              :class="$style.scheduleInput"
              :min="minScheduleDate()"
            />
            <input
              v-model="pendingScheduleTime"
              type="time"
              :class="$style.scheduleInput"
            />
          </div>
        </div>
        <div :class="$style.scheduleActions">
          <button
            v-if="scheduledAt"
            type="button"
            class="_button"
            :class="$style.scheduleBtnClear"
            @click="clearSchedule"
          >
            予約を解除
          </button>
          <button
            type="button"
            class="_button"
            :class="$style.scheduleBtnCancel"
            @click="showScheduleDialog = false"
          >
            キャンセル
          </button>
          <button
            type="submit"
            class="_button"
            :class="$style.scheduleBtnOk"
            :disabled="!canConfirmSchedule"
          >
            OK
          </button>
        </div>
      </form>
    </dialog>

  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;

.postOverlay {
  position: fixed;
  inset: 0;
  /* モーダルオーバーレイ tier。navbar (2000) だとモバイルの全画面ウィンドウ
     (navbar + 1) より下になり投稿フォームを操作できなくなる (#669)。
     他のモーダル系オーバーレイと揃えて popup tier に置く。 */
  z-index: var(--nd-z-popup);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: calc(var(--nd-app-inset-top, 0px) + 12px);
  background: var(--nd-modalBg);
  overflow-y: auto;
}

.postInlineWrapper {
  display: contents;
}

.postForm {
  background: var(--nd-popup);
  border-radius: 16px;
  box-shadow: 0 8px 32px var(--nd-shadow);
  width: 100%;
  max-width: 520px;
  margin: 16px;
  overflow: visible;
  display: flex;
  flex-direction: column;
  container-type: inline-size;

  /* ── Inline mode ── */
  &.postFormInline {
    background: transparent;
    border-radius: 0;
    box-shadow: none;
    max-width: none;
    margin: 0;
    flex-shrink: 0;
    border-bottom: 1px solid var(--nd-divider);

    .header {
      min-height: 36px;
    }

    .headerRight {
      min-height: 36px;
      font-size: 0.85em;
    }

    .headerBtn {
      padding: 5px;
    }

    .headerBtnText {
      display: none;
    }

    .textArea {
      min-height: 42px;
      padding: 0 12px;
      font-size: 0.95em;
      field-sizing: content;

      &::placeholder {
        font-size: 1em;
      }
    }

    .cwInput {
      padding: 6px 12px;
      font-size: 0.95em;

      &::placeholder {
        font-size: 1em;
      }
    }

    .footer {
      padding: 0 4px 4px;
      font-size: 0.9em;
    }

    .footerLeft {
      grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
      grid-auto-rows: 44px;
    }

    .footerRight {
      grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
      grid-auto-rows: 44px;
    }

    .submitBtn {
      margin: 6px 6px 6px 4px;
      padding: 0 10px;
      line-height: 30px;
      font-size: 0.85em;
      min-width: 70px;
    }

    .filePreviewArea {
      padding: 6px 12px;
    }

    .filePreview {
      width: 60px;
      height: 60px;
    }

    .pollEditor {
      padding: 6px 12px;
    }

    .replyPreview {
      padding: 8px 12px;
      font-size: 0.85em;
    }

    .postError {
      padding: 4px 12px;
      font-size: 0.8em;
    }
  }
}

/* ── Header ── */
.header {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  min-height: 50px;
  gap: 4px;
}

.headerLeft {
  display: flex;
  flex: 1;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  padding-left: 12px;
}

.headerRight {
  display: flex;
  min-height: 48px;
  font-size: 0.9em;
  flex-wrap: nowrap;
  align-items: center;
  margin-left: auto;
  gap: 4px;
  padding-left: 4px;
}

.headerBtn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  min-height: 44px;
  min-width: 44px;
  margin: 0;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  transition: background var(--nd-duration-base);

  &:hover {
    background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
  }
}

.headerBtnText {
  padding-left: 6px;
  overflow: clip;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 210px;
}

.accountWrapper {
  position: relative;
}

.accountBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  border-radius: var(--nd-radius-sm);
  transition: background var(--nd-duration-base);

  &:hover {
    background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
  }
}

.accountAvatar {
  width: 28px;
  height: 28px;
  border-radius: 100%;
  object-fit: cover;
}

/* Account menu */
.accountMenu {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 10;
  padding: 4px;
  margin-top: 4px;
  background: color-mix(in srgb, var(--nd-popup) 96%, transparent);
  border-radius: 12px;
  box-shadow: var(--nd-shadow-m);
}

.accountOption {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  transition: background var(--nd-duration-base);

  &:hover {
    background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
  }

  &.active {
    color: var(--nd-accent);
  }
}

.accountDisabled {
  opacity: 0.4;
  pointer-events: none;
}

.accountOptionAvatar {
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  border-radius: 100%;
  object-fit: cover;
}

.accountOptionInfo {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
}

.accountOptionName {
  font-size: 0.85em;
  font-weight: bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.accountOptionHost {
  font-size: 0.75em;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Submit button (Misskey gradient style) */
.submitBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 12px 12px 12px 6px;
  padding: 0 12px;
  line-height: 34px;
  font-weight: bold;
  font-family: inherit;
  border: none;
  border-radius: var(--nd-radius-sm);
  min-width: 90px;
  color: var(--nd-fgOnAccent);
  background: linear-gradient(90deg, var(--nd-buttonGradateA, var(--nd-accent)), var(--nd-buttonGradateB, var(--nd-accent)));
  cursor: pointer;
  transition: opacity var(--nd-duration-base), box-shadow var(--nd-duration-slow) ease;

  &:hover:not(:disabled) {
    opacity: 0.85;
    box-shadow: 0 4px 12px color-mix(in srgb, var(--nd-accent) 40%, transparent);
  }

  &:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  &.posted {
    background: var(--nd-success);
  }
}

.postingDots {
  letter-spacing: 2px;
}

.submitIcon {
  flex-shrink: 0;
}

/* ── Visibility menu ── */
.visibilityWrapper {
  position: relative;
}

.visibilityMenu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 10;
  min-width: 160px;
  padding: 4px;
  margin-top: 4px;
  background: color-mix(in srgb, var(--nd-popup) 96%, transparent);
  border-radius: 12px;
  box-shadow: var(--nd-shadow-m);
}

.visibilityOption {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  font-size: 0.85em;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  transition: background var(--nd-duration-base);

  &:hover {
    background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
  }

  &.active {
    color: var(--nd-accent);
    font-weight: bold;
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
}

/* ── Local only button ── */
.localOnlyBtn {
  &.active {
    color: var(--nd-error);
  }
}

/* ── More menu ── */
.moreMenuWrapper {
  position: relative;
}

.moreMenu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 10;
  min-width: 200px;
  padding: 4px;
  margin-top: 4px;
  background: color-mix(in srgb, var(--nd-popup) 96%, transparent);
  border-radius: 12px;
  box-shadow: var(--nd-shadow-m);
}

.moreMenuItem {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  font-size: 0.85em;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  cursor: pointer;
  user-select: none;
  transition: background var(--nd-duration-base);

  &:hover {
    background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
  }

  &.active {
    color: var(--nd-accent);
  }
}

.moreMenuDivider {
  height: 1px;
  margin: 2px 8px;
  background: var(--nd-divider);
}

.moreMenuScheduleBadge {
  margin-left: auto;
  font-size: 0.75em;
  opacity: 0.7;
}

/* 予約投稿ダイアログ (AppPrompt/AppConfirm と同パターン) */
.scheduleHeader {
  padding: 16px 20px 4px;
  text-align: center;
}

.scheduleTitle {
  font-size: 1em;
  font-weight: bold;
  color: var(--nd-fg);
}

.scheduleBody {
  padding: 4px 20px 12px;
}

.scheduleRow {
  display: flex;
  gap: 8px;
}

.scheduleInput {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.95em;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;

  &:focus {
    border-color: var(--nd-accent);
  }
}

.scheduleActions {
  display: flex;
  gap: 6px;
  padding: 0 16px 16px;
  justify-content: center;
}

.scheduleBtnOk { @include btn-primary; }
.scheduleBtnCancel { @include btn-secondary; }
.scheduleBtnClear {
  @include btn-secondary;
  margin-right: auto;
  color: var(--nd-danger, #e64c4c);
}

/* ── Note mode button ── */
.noteModeBtn {
  &.active {
    color: var(--nd-accent);
  }
}

/* ── Reply preview ── */
.replyPreview {
  display: flex;
  padding: 12px 20px 16px;
  font-size: 0.95em;
  gap: 10px;
}

// 引用は Misskey 慣例のアクセント左ボーダーで返信と見分ける
.quotePreview {
  margin: 8px 20px 12px;
  padding: 8px 12px;
  border-left: 3px solid var(--nd-accent);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
}

.replyAvatar {
  width: 36px;
  height: 36px;
  border-radius: 100%;
  object-fit: cover;
  flex-shrink: 0;
}

.replyContent {
  min-width: 0;
  max-height: 100px;
  overflow-y: auto;
}

.replyUser {
  font-weight: bold;
  font-size: 0.9em;
  color: var(--nd-fgHighlighted);
}

.replyHandle {
  font-size: 0.8em;
  opacity: 0.5;
  margin-left: 4px;
}

.replyText {
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.4;
  color: var(--nd-fg);
  opacity: 0.8;
}

/* ── Quote indicator ── */
.quoteIndicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 24px;
  font-size: 0.85em;
  color: var(--nd-accent);
}

/* ── CW input ── */
.cwOuter {
  width: 100%;
}

.cwInput {
  display: block;
  box-sizing: border-box;
  width: 100%;
  padding: 8px 24px;
  padding-bottom: 8px;
  font-size: 110%;
  font-family: inherit;
  color: var(--nd-fg);
  background: transparent;
  border: none;
  border-bottom: 0.5px solid var(--nd-divider);
  outline: none;
}

/* ── Textarea ── */
.textOuter {
  width: 100%;
  position: relative;

  &.withCw {
    padding-top: 8px;
  }
}

.textArea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  padding: 0 24px;
  margin: 0;
  min-height: 90px;
  max-height: 500px;
  font-size: 110%;
  font-family: inherit;
  color: var(--nd-fg);
  background: transparent;
  border: none;
  border-radius: 0;
  outline: none;
  resize: vertical;
  line-height: 1.5;
  field-sizing: content;
}

.textArea::placeholder,
.cwInput::placeholder {
  color: var(--nd-fg);
  opacity: 0.35;
}

/* ── Preview ── */
.previewSection {
  border-top: 1px solid color-mix(in srgb, var(--nd-fg) 12%, transparent);
  max-height: 360px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.previewEmpty {
  padding: 16px 0;
  text-align: center;
  color: var(--nd-fg);
  opacity: 0.35;
  font-size: 0.9em;
}

/* ── Error ── */
.postError {
  padding: 8px 24px;
  color: var(--nd-error);
  font-size: 0.85em;
}

/* ── Text count (overlaid on textarea) ── */
.textCount {
  position: absolute;
  top: 0;
  right: 2px;
  padding: 4px 6px;
  font-size: 0.9em;
  color: var(--nd-fg);
  opacity: 0.4;
  border-radius: var(--nd-radius-sm);
  min-width: 1.6em;
  text-align: center;

  &.near {
    color: var(--nd-warn, #ecb637);
    opacity: 1;
  }

  &.over {
    color: var(--nd-error);
  }
}

/* ── Poll editor ── */
/* ── Footer ── */
.footer {
  position: relative;
  display: flex;
  padding: 0 4px 4px;
  font-size: 1em;
}

.footerLeft {
  flex: 1;
  display: grid;
  grid-auto-flow: row;
  grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
  grid-auto-rows: 44px;
}

.footerRight {
  flex: 0;
  margin-left: auto;
  display: grid;
  grid-auto-flow: row;
  grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
  grid-auto-rows: 44px;
  direction: rtl;
}

.footerPopupWrapper {
  /* no positioning — popups anchor to .footer so they stay within form bounds */
}

.footerBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  font-size: 1.15em;
  width: 100%;
  height: 100%;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  transition: background var(--nd-duration-base), color var(--nd-duration-base);

  &:hover {
    background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
  }

  &.active {
    color: var(--nd-accent);
  }
}

/* ── Footer popups (shared) ── */
.footerPopup {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  margin-top: 8px;
  background: color-mix(in srgb, var(--nd-popup) 96%, transparent);
  border-radius: 12px;
  box-shadow: var(--nd-shadow-m);
}

/* ── Emoji popup ── */

/* ── MFM menu ── */
.mfmMenu {
  width: 160px;
  max-height: 320px;
  overflow-y: auto;
  padding: 4px;
  scrollbar-width: none;
}

.mfmMenuItem {
  display: block;
  width: 100%;
  padding: 6px 10px;
  font-size: 0.82em;
  text-align: left;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  transition: background var(--nd-duration-base);

  &:hover {
    background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
  }
}

/* ── File preview ── */
/* ── Schedule indicator (textarea 右下にフローティング) ── */
.scheduleIndicator {
  position: absolute;
  right: 12px;
  bottom: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px 3px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--nd-accent) 15%, transparent);
  color: var(--nd-accent);
  font-size: 0.82em;
  font-variant-numeric: tabular-nums;
  backdrop-filter: blur(8px);
}

.scheduleIndicatorRel {
  font-weight: 700;
}

.scheduleIndicatorAbs {
  opacity: 0.7;

  &::before {
    content: '·';
    margin-right: 4px;
    opacity: 0.7;
  }
}

.scheduleClear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.5;
  margin-left: 2px;

  &:hover {
    opacity: 1;
    background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
  }
}


/* ── Responsive ── */
@container (max-width: 500px) {
  .headerBtnText {
    display: none;
  }

  .submitBtn {
    margin: 8px 8px 8px 4px;
    min-height: 44px;
  }

  .cwInput,
  .textArea {
    padding-left: 16px;
    padding-right: 16px;
  }

  .textArea {
    min-height: 80px;
  }

  .footerLeft,
  .footerRight {
    grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
    grid-auto-rows: 44px;
  }

  .pollEditor {
    padding: 8px 16px;
  }
}

@container (max-width: 350px) {
  .footer {
    font-size: 0.9em;
  }

  .footerLeft {
    grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
  }

  .headerRight {
    gap: 0;
  }
}

/* ── Emoji picker (below post form, matches form width) ── */
.emojiPickerPanel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 520px;
  max-height: min(60vh, 520px);
  margin: 0 16px 16px;
  background: var(--nd-panelBg, var(--nd-popup));
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 32px var(--nd-shadow);
}

.emojiPickerHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--nd-divider);
}

.emojiPickerTitle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: bold;
  font-size: 0.9em;
  flex: 1;
}

.emojiPickerCloseBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: var(--nd-fg);
  opacity: 0.7;

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }
}

.emojiPickerBody {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
}

/* Mobile: デスクトップと同じ枠付きモーダル（背景は透過して背後のカラムが透ける） */
.mobile {
  &.postOverlay {
    padding-top: var(--nd-safe-area-top, env(safe-area-inset-top));
    /* ソフトキーボード表示中は footer (絵文字/添付等) が覆われないよう底上げ */
    padding-bottom: max(
      var(--nd-safe-area-bottom, env(safe-area-inset-bottom)),
      var(--nd-keyboard-inset, 0px)
    );
  }

  .emojiPopup {
    position: fixed;
    top: auto;
    bottom: var(--nd-keyboard-inset, 0px);
    left: 0;
    right: 0;
    width: 100%;
    max-width: 100%;
    max-height: 50vh;
    border-radius: 16px 16px 0 0;
    margin: 0;
    z-index: 100;
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.3);
    padding-bottom: var(--nd-safe-area-bottom, env(safe-area-inset-bottom));
  }
}
</style>
