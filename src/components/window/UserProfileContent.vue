<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import type {
  NormalizedNote,
  NormalizedUserDetail,
  ServerAdapter,
} from '@/adapters/types'
import type { JsonValue } from '@/bindings'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import EditorTabs from '@/components/common/EditorTabs.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkAvatar from '@/components/common/MkAvatar.vue'
import MkEmoji from '@/components/common/MkEmoji.vue'
import MkNote from '@/components/common/MkNote.vue'
import RawJsonView from '@/components/common/RawJsonView.vue'
import UserProfileFileGrid from '@/components/window/UserProfileFileGrid.vue'
import UserProfileAchievementsPane from '@/components/window/user-profile/UserProfileAchievementsPane.vue'
import UserProfileClipsPane from '@/components/window/user-profile/UserProfileClipsPane.vue'
import UserProfileGalleryPane from '@/components/window/user-profile/UserProfileGalleryPane.vue'
import UserProfileHero from '@/components/window/user-profile/UserProfileHero.vue'
import UserProfileListsPane from '@/components/window/user-profile/UserProfileListsPane.vue'
import UserProfileMenu from '@/components/window/user-profile/UserProfileMenu.vue'
import UserProfileNotesList from '@/components/window/user-profile/UserProfileNotesList.vue'
import UserProfilePagesPane from '@/components/window/user-profile/UserProfilePagesPane.vue'
import UserProfilePlayPane from '@/components/window/user-profile/UserProfilePlayPane.vue'
import UserProfileQrCode from '@/components/window/user-profile/UserProfileQrCode.vue'

const MkPostForm = defineAsyncComponent(
  () => import('@/components/common/MkPostForm.vue'),
)

// Activity tab は chart.js + matrix + date-fns で ~100KB の bundle を伴うため
// 他タブと違い v-if による遅延 mount とする。タブ未選択時は chunk を取得しない。
const UserActivityHeatmap = defineAsyncComponent(
  () => import('@/components/window/UserActivityHeatmap.vue'),
)
const UserActivityNotesChart = defineAsyncComponent(
  () => import('@/components/window/UserActivityNotesChart.vue'),
)
const UserActivityFollowingChart = defineAsyncComponent(
  () => import('@/components/window/UserActivityFollowingChart.vue'),
)
const UserActivityPvChart = defineAsyncComponent(
  () => import('@/components/window/UserActivityPvChart.vue'),
)

import { useEditorTabs } from '@/composables/useEditorTabs'
import { useEmojiResolver } from '@/composables/useEmojiResolver'
import { useNavigation } from '@/composables/useNavigation'
import { usePaginatedList } from '@/composables/usePaginatedList'
import { usePortal } from '@/composables/usePortal'
import { useSensitiveMask } from '@/composables/useSensitiveMask'
import { useWindowExternalLink } from '@/composables/useWindowExternalLink'
import { useAccountsStore } from '@/stores/accounts'
import { useServersStore } from '@/stores/servers'
import { AppError } from '@/utils/errors'
import { formatDate } from '@/utils/format'
import { proxyUrl } from '@/utils/imageProxy'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { toggleReaction } from '@/utils/toggleReaction'
import { openSafeUrl, webUiUrl } from '@/utils/url'

const props = defineProps<{
  accountId: string
  userId: string
}>()

const { navigateToUser: navToUser } = useNavigation()
const portalRef = useTemplateRef<HTMLElement>('portalRef')
usePortal(portalRef)
const accountsStore = useAccountsStore()
const serversStore = useServersStore()

// Declared up-front because `topTabs` (below) reads `isOwnProfile` inside its
// computed getter, and `useEditorTabs` triggers an immediate getter call via
// its internal watch when wiring up tabIndex — accessing the const before its
// declaration would throw a TDZ ReferenceError at mount time.
const account = computed(() =>
  accountsStore.accounts.find((a) => a.id === props.accountId),
)
const isOwnProfile = computed(() => account.value?.userId === props.userId)

// Top-level editor-style tabs (overview / notes / files grid / reactions /
// achievements / raw JSON). `reactions` is only surfaced when the user has
// opted-in via Misskey's publicReactions privacy setting (own profile always
// exposes it regardless).
type TopTab =
  | 'overview'
  | 'notes'
  | 'files'
  | 'activity'
  | 'reactions'
  | 'pages'
  | 'play'
  | 'gallery'
  | 'lists'
  | 'clips'
  | 'achievements'
  | 'raw'
interface TopTabDef {
  value: TopTab
  icon: string
  label: string
}
// Driven by users/show `publicReactions`; populated after the raw profile
// fetch completes. Defaults to false so the tab stays hidden until we know.
const publicReactions = ref(false)
const topTabDefs = computed<TopTabDef[]>(() => {
  const defs: TopTabDef[] = [
    { value: 'overview', icon: 'home', label: '概要' },
    { value: 'notes', icon: 'pencil', label: 'ノート' },
    { value: 'files', icon: 'photo', label: 'ファイル' },
    { value: 'activity', icon: 'chart-line', label: 'アクティビティ' },
  ]
  if (publicReactions.value || isOwnProfile.value) {
    defs.push({
      value: 'reactions',
      icon: 'mood-smile',
      label: 'リアクション',
    })
  }
  defs.push({ value: 'pages', icon: 'note', label: 'ページ' })
  defs.push({ value: 'play', icon: 'player-play', label: 'Play' })
  defs.push({ value: 'gallery', icon: 'icons', label: 'ギャラリー' })
  defs.push({ value: 'lists', icon: 'list', label: 'リスト' })
  defs.push({ value: 'clips', icon: 'paperclip', label: 'クリップ' })
  defs.push({ value: 'achievements', icon: 'medal', label: '実績' })
  defs.push({ value: 'raw', icon: 'code', label: 'Raw' })
  return defs
})
const topTabs = computed<readonly TopTab[]>(() =>
  topTabDefs.value.map((t) => t.value),
)
const { tab: topTab, containerRef: profileRef } = useEditorTabs<TopTab>(
  topTabs,
  'overview',
)

const user = ref<NormalizedUserDetail | null>(null)

// User memo (#458) の編集 UI は UserProfileHero が所有する。ここでは表示可否と
// 保存成功時の user への反映 (prop 直接変異を避ける) のみ持つ。
const canEditMemo = computed(
  () => !isOwnProfile.value && (account.value?.hasToken ?? false),
)

function handleMemoSaved(memo: string) {
  if (user.value) user.value.memo = memo
}

// ヘッダー「Web UIで開く」ボタンの登録 — 自プロフィールは編集画面、他は公開ページ
useWindowExternalLink(() => {
  const u = user.value
  const host = account.value?.host
  if (!u || !host) return null
  if (isOwnProfile.value) {
    return {
      url: webUiUrl(host, '/settings/profile'),
      title: 'プロフィールを編集',
      icon: 'pencil',
    }
  }
  const suffix = u.host ? `@${u.host}` : ''
  return { url: webUiUrl(host, `/@${u.username}${suffix}`) }
})

const MAX_PROFILE_NOTES = 500
const pinnedNotes = shallowRef<NormalizedNote[]>([])
const pinnedNoteIds = ref<string[]>([])
const isLoading = ref(true)
const error = ref<AppError | null>(null)

// notes / files タブはウィンドウ全体のエラー表示 (error ref) に集約する
function raiseWindowError(e: unknown) {
  error.value = AppError.from(e)
}

// Files top-tab (image/video grid). 内タブの activeTab='files' とは別物。
const {
  items: filesNotes,
  isLoading: isLoadingFiles,
  load: loadFilesTab,
  loadMore: loadMoreFilesTab,
} = usePaginatedList<NormalizedNote>({
  fetch: (untilId) =>
    adapter.value
      ? adapter.value.api.getUserNotes(props.userId, {
          limit: 20,
          untilId,
          withFiles: true,
        })
      : Promise.resolve([]),
  maxItems: MAX_PROFILE_NOTES,
  onError: raiseWindowError,
})
// ゲスト時は withFiles フィルタが無視されて全ノートが返るため、
// filesNotes.length === 0 ではなく実際のファイル有無で判定する
const hasFilesContent = computed(() =>
  filesNotes.value.some((n) => n.files.length > 0),
)

// Reactions top-tab. Each entry pairs a reaction type with the note it was
// attached to. Loaded on first tab activation and paginated via scroll.
// note は adapter 経由で正規化済みの NormalizedNote を持つので bindings の
// UserReaction (notecli の生レスポンス用) とは別の型として扱う。
interface UserReactionEntry {
  id: string
  createdAt: string
  type: string
  note: NormalizedNote
}
// users/reactions は削除済みノートをスキップするため件数でページ末尾を
// 判定できない — pageSize なし (空ページが返るまで続ける)
const {
  items: reactionEntries,
  isLoading: isLoadingReactions,
  error: reactionsError,
  load: loadReactionsTab,
  loadMore: loadMoreReactions,
} = usePaginatedList<UserReactionEntry>({
  fetch: (untilId) => fetchUserReactions(untilId),
})
const REACTIONS_PAGE_SIZE = 20
const { reactionUrl: reactionUrlRaw } = useEmojiResolver()

function getReactionEntryUrl(entry: UserReactionEntry): string | null {
  return reactionUrlRaw(
    entry.type,
    entry.note.emojis,
    entry.note.reactionEmojis,
    entry.note._serverHost,
  )
}

// 空状態・エラー状態で表示する Misskey サーバーのブランディング画像。
// ensureServer 経由でキャッシュされた後はリアクティブに反映される。
const serverInfo = computed(() =>
  account.value?.host ? serversStore.getServer(account.value.host) : undefined,
)
const serverInfoImageUrl = computed(() => serverInfo.value?.infoImageUrl)
const serverErrorImageUrl = computed(
  () => serverInfo.value?.serverErrorImageUrl,
)

// Raw tab: unmodified users/show API response.
// When viewing own profile, Misskey returns MeDetailed schema which includes
// sensitive fields (email, mutedWords, 2FA status, etc.). Mask them by default
// and expose a reveal toggle so copy/screenshots stay safe unless opted in.
const SENSITIVE_RAW_KEYS = new Set<string>([
  // Account / security
  'email',
  'emailVerified',
  'twoFactorEnabled',
  'twoFactorBackupCodesStock',
  'securityKeys',
  'securityKeysList',
  'usePasswordLessLogin',
  // Mute / block preferences
  'mutedWords',
  'hardMutedWords',
  'mutedInstances',
  'mutingNotificationTypes',
  // Notification / email preferences
  'emailNotificationTypes',
  'receiveAnnouncementEmail',
  // Role / policies
  'policies',
  // Unread counters (behavior inference)
  'hasUnreadAnnouncement',
  'hasUnreadAntenna',
  'hasUnreadChannel',
  'hasUnreadMentions',
  'hasUnreadNotification',
  'hasUnreadSpecifiedNotes',
  'unreadAnnouncements',
  'unreadNotificationsCount',
  // Personal content preferences
  'alwaysMarkNsfw',
  'autoSensitive',
  'noCrawle',
  'preventAiLearning',
  'injectFeaturedNote',
  'loggedInDays',
  'hasPendingReceivedFollowRequest',
  'achievements',
])

const { showSensitive, formatJson: formatRawJson } =
  useSensitiveMask(SENSITIVE_RAW_KEYS)

const rawUserObj = shallowRef<unknown>(null)
const isLoadingRaw = ref(false)
const rawError = ref<string | null>(null)

const displayedRawJson = computed(() => {
  if (rawUserObj.value == null) return ''
  // Only mask when viewing own profile
  if (!isOwnProfile.value) return JSON.stringify(rawUserObj.value, null, 2)
  return formatRawJson(rawUserObj.value)
})
const remoteProfileUrl = computed(() => {
  if (!user.value?.host) return null
  return user.value.url || `https://${user.value.host}/@${user.value.username}`
})

function openRemoteProfile() {
  openSafeUrl(remoteProfileUrl.value)
}

// メニュー子コンポーネントにも渡すため reactive に持つ (代入は onMounted の 1 回のみ)
const adapter = shallowRef<ServerAdapter | null>(null)

onMounted(async () => {
  const account = accountsStore.accounts.find((a) => a.id === props.accountId)
  if (!account) {
    error.value = new AppError(
      'ACCOUNT_NOT_FOUND',
      'アカウントが見つかりません',
    )
    isLoading.value = false
    return
  }

  try {
    const result = await initAdapterFor(account.host, account.id, {
      pinnedReactions: false,
      hasToken: account.hasToken,
    })
    const a = result.adapter
    adapter.value = a
    const userDetail = await a.api.getUserDetail(props.userId)
    user.value = userDetail

    // Prefetch banner image so it appears instantly when DOM renders
    if (userDetail.bannerUrl) {
      new Image().src = userDetail.bannerUrl
    }

    // ピン留めは users/show 応答に同梱されたものを notecli が normalize して
    // 返す (#632)。従来の users/show 二度打ち + notes/show × 件数の追加往復は
    // 不要になり、プロフィール全体が 1 リクエストで確定する。
    pinnedNoteIds.value = userDetail.pinnedNoteIds ?? []
    pinnedNotes.value = userDetail.pinnedNotes ?? []
    // 内タブのノート一覧は UserProfileNotesList が mount 時に自律ロードする
    // Kick off users/show in the background to discover the publicReactions
    // privacy flag (and prime the Raw tab cache). Skip for own profile since
    // we always expose the tab there and the fetch will happen lazily if the
    // user opens Raw.
    if (!isOwnProfile.value) {
      loadRawUserJson()
    }
  } catch (e) {
    error.value = AppError.from(e)
  } finally {
    isLoading.value = false
  }
})

async function loadRawUserJson() {
  if (rawUserObj.value != null) return
  isLoadingRaw.value = true
  rawError.value = null
  try {
    const raw = unwrap(
      await commands.apiGetUserRaw(props.accountId, {
        userId: props.userId,
      } as never),
    )
    rawUserObj.value = raw
    // Mirror the privacy flag so the reactions tab can appear without a
    // second users/show round-trip.
    if (raw && typeof raw === 'object' && 'publicReactions' in raw) {
      publicReactions.value =
        (raw as { publicReactions?: unknown }).publicReactions === true
    }
  } catch (e) {
    rawError.value = AppError.from(e).message
  } finally {
    isLoadingRaw.value = false
  }
}

async function fetchUserReactions(
  untilId?: string,
): Promise<UserReactionEntry[]> {
  const a = adapter.value
  if (!a) return []
  const params: Record<string, JsonValue> = {
    userId: props.userId,
    limit: REACTIONS_PAGE_SIZE,
  }
  if (untilId) params.untilId = untilId
  const raw = unwrap(
    await commands.apiGetUserReactions(props.accountId, params),
  )

  // users/reactions returns NoteReaction-with-note objects; normalize each
  // note via the adapter so MkNote can render them like any other feed item.
  const entries: UserReactionEntry[] = []
  for (const item of raw) {
    try {
      const normalized = await a.api.getNote(item.note.id)
      entries.push({
        id: item.id,
        createdAt: item.createdAt,
        type: item.type,
        note: normalized,
      })
    } catch {
      // Note may have been deleted — skip silently so the list keeps flowing.
    }
  }
  return entries
}

// Auto-reset the sensitive-reveal flag when leaving the Raw tab so a casual
// screen share / screenshot later can't accidentally leak secrets.
watch(topTab, (tab) => {
  if (tab === 'raw') {
    loadRawUserJson()
  } else if (tab === 'files') {
    loadFilesTab()
  } else if (tab === 'reactions') {
    loadReactionsTab()
    showSensitive.value = false
  } else {
    // pages/play/gallery/lists/clips/achievements は各ペインが active prop で
    // 自律ロードする (UserProfile*Pane.vue)
    showSensitive.value = false
  }
})

// If the visible tab set shrinks (e.g. publicReactions resolved to false
// after the user was lingering on the speculative 'reactions' tab) drop back
// to overview so we never render a hidden-tab state.
watch(topTabs, (tabs) => {
  if (!tabs.includes(topTab.value)) {
    topTab.value = 'overview'
  }
})

// スクロール連動の loadMore 用ペイン参照 (スクロールコンテナは親が持つ)
const notesListRef = ref<InstanceType<typeof UserProfileNotesList>>()
const pagesPaneRef = ref<InstanceType<typeof UserProfilePagesPane>>()
const playPaneRef = ref<InstanceType<typeof UserProfilePlayPane>>()
const galleryPaneRef = ref<InstanceType<typeof UserProfileGalleryPane>>()
const clipsPaneRef = ref<InstanceType<typeof UserProfileClipsPane>>()

let lastScrollCheck = 0
function onScroll(e: Event) {
  const now = Date.now()
  if (now - lastScrollCheck < 200) return
  lastScrollCheck = now
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
    if (topTab.value === 'files') {
      loadMoreFilesTab()
    } else if (topTab.value === 'reactions') {
      loadMoreReactions()
    } else if (topTab.value === 'pages') {
      pagesPaneRef.value?.loadMore()
    } else if (topTab.value === 'play') {
      playPaneRef.value?.loadMore()
    } else if (topTab.value === 'gallery') {
      galleryPaneRef.value?.loadMore()
    } else if (topTab.value === 'clips') {
      clipsPaneRef.value?.loadMore()
    } else if (topTab.value === 'overview' || topTab.value === 'notes') {
      notesListRef.value?.loadMore()
    }
  }
}

// Post form state
const showPostForm = ref(false)
const postFormReplyTo = ref<NormalizedNote | undefined>()
const postFormRenoteId = ref<string | undefined>()
const postFormEditNote = ref<NormalizedNote | undefined>()
const postFormInitialText = ref<string | undefined>()

// User action menu (mute/block/report/list/antenna 等) は
// UserProfileMenu.vue に分離した。ここでは開閉の ref と compose 連携のみ持つ。
const userMenuRef = ref<InstanceType<typeof UserProfileMenu>>()
const qrCodeRef = ref<InstanceType<typeof UserProfileQrCode>>()

/** メニューの「ユーザー指定ノートを作成」— 投稿フォームは親が所有する */
function handleComposeToUser(acct: string) {
  postFormReplyTo.value = undefined
  postFormRenoteId.value = undefined
  postFormEditNote.value = undefined
  postFormInitialText.value = `${acct} `
  showPostForm.value = true
}

async function handleReaction(reaction: string, note: NormalizedNote) {
  if (!adapter.value) return
  try {
    await toggleReaction(adapter.value.api, note, reaction)
  } catch (e) {
    error.value = AppError.from(e)
  }
}

async function handleVote(choice: number, target: NormalizedNote) {
  if (!adapter.value) return
  const { votePoll } = await import('@/utils/votePoll')
  try {
    await votePoll(adapter.value.api, target, choice)
  } catch (e) {
    error.value = AppError.from(e)
  }
}

async function handleRenote(target: NormalizedNote) {
  if (!adapter.value) return
  try {
    await adapter.value.api.createNote({ renoteId: target.id })
  } catch (e) {
    error.value = AppError.from(e)
  }
}

function handleReply(target: NormalizedNote) {
  postFormReplyTo.value = target
  postFormRenoteId.value = undefined
  postFormInitialText.value = undefined
  showPostForm.value = true
}

function handleQuote(target: NormalizedNote) {
  postFormReplyTo.value = undefined
  postFormRenoteId.value = target.id
  postFormInitialText.value = undefined
  showPostForm.value = true
}

function handleEdit(target: NormalizedNote) {
  postFormReplyTo.value = undefined
  postFormRenoteId.value = undefined
  postFormEditNote.value = target
  postFormInitialText.value = undefined
  showPostForm.value = true
}

async function handlePin(target: NormalizedNote) {
  if (!adapter.value) return
  try {
    const isPinned = pinnedNoteIds.value.includes(target.id)
    if (isPinned) {
      await adapter.value.api.unpinNote(target.id)
      pinnedNoteIds.value = pinnedNoteIds.value.filter((id) => id !== target.id)
      pinnedNotes.value = pinnedNotes.value.filter((n) => n.id !== target.id)
    } else {
      await adapter.value.api.pinNote(target.id)
      pinnedNoteIds.value = [...pinnedNoteIds.value, target.id]
      pinnedNotes.value = [...pinnedNotes.value, target]
    }
  } catch (e) {
    error.value = AppError.from(e)
  }
}

async function handleDelete(target: NormalizedNote) {
  if (!adapter.value) return
  try {
    await adapter.value.api.deleteNote(target.id)
    notesListRef.value?.removeNote(target.id)
  } catch (e) {
    error.value = AppError.from(e)
  }
}

async function handleDeleteAndEdit(target: NormalizedNote) {
  if (!adapter.value) return
  try {
    await adapter.value.api.deleteNote(target.id)
    notesListRef.value?.removeNote(target.id)
    postFormReplyTo.value = target.replyId
      ? await adapter.value.api.getNote(target.replyId).catch(() => undefined)
      : undefined
    postFormRenoteId.value = undefined
    postFormEditNote.value = undefined
    postFormInitialText.value = undefined
    showPostForm.value = true
  } catch (e) {
    error.value = AppError.from(e)
  }
}

function closePostForm() {
  showPostForm.value = false
  postFormReplyTo.value = undefined
  postFormRenoteId.value = undefined
  postFormEditNote.value = undefined
}

async function handlePosted(editedNoteId?: string) {
  closePostForm()
  if (editedNoteId && adapter.value) {
    try {
      const updated = await adapter.value.api.getNote(editedNoteId)
      notesListRef.value?.replaceNote(editedNoteId, updated)
    } catch {
      // note may have been deleted
    }
  }
}
</script>

<template>
  <div :class="$style.userProfileContent">
    <div v-if="isLoading" :class="$style.stateMessage"><LoadingSpinner /></div>

    <div v-else-if="error" :class="[$style.stateMessage, $style.stateError]">
      <p>{{ error.message }}</p>
    </div>

    <template v-else-if="user">
      <EditorTabs v-model="topTab" :tabs="topTabDefs" />

      <div ref="profileRef" :class="$style.tabContent" @scroll.passive="onScroll">
        <div v-show="topTab === 'overview' || topTab === 'notes'">
      <!-- Remote user caution -->
      <div v-if="user.host && topTab === 'overview'" :class="$style.remoteCaution">
        <i class="ti ti-alert-triangle" style="margin-right: 8px;" />
        リモートユーザーのため、情報が不完全です。
        <a v-if="remoteProfileUrl" :class="$style.remoteCautionLink" href="#" @click.prevent="openRemoteProfile">
          リモートで表示
        </a>
      </div>

      <div :class="$style.profileContainer">
        <!-- Profile details (overview only) — hero 面は UserProfileHero が所有 -->
        <UserProfileHero
          v-show="topTab === 'overview'"
          :user="user"
          :adapter="adapter"
          :account-id="accountId"
          :account-host="account?.host"
          :is-own-profile="isOwnProfile"
          :can-edit-memo="canEditMemo"
          @open-menu="userMenuRef?.open($event)"
          @open-qr="qrCodeRef?.open()"
          @memo-saved="handleMemoSaved"
          @error="(e) => (error = e)"
        />

        <!-- Pinned notes (overview only) -->
        <div v-if="pinnedNotes.length > 0 && topTab === 'overview'" :class="$style.pinnedSection">
          <div :class="$style.pinnedHeader">
            <i class="ti ti-pin" />
            ピン留め
          </div>
          <MkNote
            v-for="note in pinnedNotes"
            :key="'pinned-' + note.id"
            :note="note"
            :pinned-note-ids="pinnedNoteIds"
            @react="handleReaction"
            @reply="handleReply"
            @renote="handleRenote"
            @quote="handleQuote"
            @delete="handleDelete"
            @edit="handleEdit"
            @delete-and-edit="handleDeleteAndEdit"
            @pin="handlePin"
            @vote="handleVote"
          />
        </div>

        <!-- Notes (内タブ + ページングは UserProfileNotesList が所有) -->
        <UserProfileNotesList
          ref="notesListRef"
          :adapter="adapter"
          :user-id="userId"
          :pinned-note-ids="pinnedNoteIds"
          @react="handleReaction"
          @reply="handleReply"
          @renote="handleRenote"
          @quote="handleQuote"
          @delete="handleDelete"
          @edit="handleEdit"
          @delete-and-edit="handleDeleteAndEdit"
          @pin="handlePin"
          @vote="handleVote"
          @error="raiseWindowError"
        />
      </div>
        </div>

        <div v-show="topTab === 'files'" :class="$style.filesPane">
          <UserProfileFileGrid :account-id="accountId" :notes="filesNotes" />
          <div v-if="isLoadingFiles" :class="$style.stateMessage">
            <LoadingSpinner />
          </div>
          <ColumnEmptyState
            v-else-if="!hasFilesContent"
            message="ファイルはありません"
            :image-url="serverInfoImageUrl"
          />
        </div>

        <!--
          Activity タブは chart.js バンドルが大きいため v-if で遅延 mount。
          タブ未選択時は async chunk 自体を取得しない。
        -->
        <div v-if="topTab === 'activity'" :class="$style.activityPane">
          <UserActivityHeatmap :account-id="accountId" :user-id="userId" />
          <UserActivityNotesChart :account-id="accountId" :user-id="userId" />
          <UserActivityFollowingChart :account-id="accountId" :user-id="userId" />
          <UserActivityPvChart :account-id="accountId" :user-id="userId" />
        </div>

        <div v-show="topTab === 'reactions'" :class="$style.reactionsPane">
          <div
            v-for="entry in reactionEntries"
            :key="entry.id"
            :class="$style.reactionItem"
          >
            <div :class="$style.reactionItemHeader">
              <MkAvatar
                :avatar-url="user.avatarUrl"
                :size="24"
                :is-cat="user.isCat"
                :class="$style.reactionItemAvatar"
              />
              <span :class="$style.reactionItemEmoji">
                <img
                  v-if="getReactionEntryUrl(entry)"
                  :src="proxyUrl(getReactionEntryUrl(entry)!)"
                  :alt="entry.type"
                  :title="entry.type"
                  decoding="async"
                  loading="lazy"
                />
                <MkEmoji v-else :emoji="entry.type" />
              </span>
              <span :class="$style.reactionItemTime">
                {{ formatDate(entry.createdAt) }}
              </span>
            </div>
            <MkNote
              :note="entry.note"
              :pinned-note-ids="pinnedNoteIds"
              @react="handleReaction"
              @reply="handleReply"
              @renote="handleRenote"
              @quote="handleQuote"
              @delete="handleDelete"
              @edit="handleEdit"
              @delete-and-edit="handleDeleteAndEdit"
              @pin="handlePin"
              @vote="handleVote"
            />
          </div>

          <div v-if="isLoadingReactions" :class="$style.stateMessage">
            <LoadingSpinner />
          </div>
          <ColumnEmptyState
            v-else-if="reactionsError"
            :message="reactionsError"
            is-error
            :image-url="serverErrorImageUrl"
          />
          <ColumnEmptyState
            v-else-if="reactionEntries.length === 0"
            message="リアクションはありません"
            :image-url="serverInfoImageUrl"
          />
        </div>

        <UserProfilePagesPane
          ref="pagesPaneRef"
          :account-id="accountId"
          :user-id="userId"
          :active="topTab === 'pages'"
          :info-image-url="serverInfoImageUrl"
          :error-image-url="serverErrorImageUrl"
        />

        <UserProfilePlayPane
          ref="playPaneRef"
          :account-id="accountId"
          :user-id="userId"
          :active="topTab === 'play'"
          :info-image-url="serverInfoImageUrl"
          :error-image-url="serverErrorImageUrl"
        />

        <UserProfileGalleryPane
          ref="galleryPaneRef"
          :account-id="accountId"
          :user-id="userId"
          :active="topTab === 'gallery'"
          :info-image-url="serverInfoImageUrl"
          :error-image-url="serverErrorImageUrl"
        />

        <UserProfileListsPane
          :account-id="accountId"
          :user-id="userId"
          :is-own-profile="isOwnProfile"
          :active="topTab === 'lists'"
          :info-image-url="serverInfoImageUrl"
          :error-image-url="serverErrorImageUrl"
        />

        <UserProfileClipsPane
          ref="clipsPaneRef"
          :account-id="accountId"
          :user-id="userId"
          :is-own-profile="isOwnProfile"
          :active="topTab === 'clips'"
          :info-image-url="serverInfoImageUrl"
          :error-image-url="serverErrorImageUrl"
        />

        <UserProfileAchievementsPane
          :account-id="accountId"
          :user-id="userId"
          :active="topTab === 'achievements'"
        />

        <div v-show="topTab === 'raw'" :class="$style.rawPane">
          <RawJsonView
            v-model:show-sensitive="showSensitive"
            :json="displayedRawJson"
            :loading="isLoadingRaw"
            :error="rawError"
            :can-reveal="isOwnProfile"
          />
        </div>
      </div>
    </template>

    <div ref="portalRef">
      <MkPostForm
        v-if="showPostForm"
        :account-id="accountId"
        :reply-to="postFormReplyTo"
        :renote-id="postFormRenoteId"
        :edit-note="postFormEditNote"
        :initial-text="postFormInitialText"
        @close="closePostForm"
        @posted="handlePosted"
      />

      <!-- User action menu (mute/block/report 等は UserProfileMenu が所有) -->
      <UserProfileMenu
        ref="userMenuRef"
        :adapter="adapter"
        :account-id="accountId"
        :user="user"
        :account-host="account?.host"
        :has-token="account?.hasToken ?? false"
        :is-own-profile="isOwnProfile"
        @compose="handleComposeToUser"
      />

      <UserProfileQrCode ref="qrCodeRef" :user="user" :account-host="account?.host" />
    </div>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;
.userProfileContent {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--nd-bg);
}

.tabContent {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.profileContainer {
  max-width: 800px;
  margin: 0 auto;
  container-type: inline-size;
}

.remoteCaution {
  font-size: 0.8em;
  padding: 16px;
  background: var(--nd-infoWarnBg);
  color: var(--nd-infoWarnFg);
  border-radius: var(--nd-radius);
  overflow: clip;
}

.remoteCautionLink {
  margin-left: 4px;
  color: var(--nd-accent);

  &:hover {
    text-decoration: underline;
  }
}

.pinnedSection {
  border-top: solid 0.5px var(--nd-divider);
}

.pinnedHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 24px;
  font-size: 0.85em;
  font-weight: bold;
  color: var(--nd-fg);
  opacity: 0.7;

  .ti {
    font-size: 1em;
  }
}

.stateMessage {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: var(--nd-fg);
  opacity: 0.6;
  font-size: 0.9em;
}

.stateError {
  color: var(--nd-love);
  opacity: 1;
}

.rawPane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}


.reactionsPane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

.reactionItem {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 12px;
  border-bottom: solid 0.5px var(--nd-divider);

  &:last-child {
    border-bottom: none;
  }
}

.reactionItemHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
}

.reactionItemAvatar {
  flex-shrink: 0;
}

.reactionItemEmoji {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font-size: 24px;
  line-height: 1;

  img {
    width: 28px;
    height: 28px;
    object-fit: contain;
  }

  :deep(.twemoji) {
    width: 24px;
    height: 24px;
  }
}

.reactionItemTime {
  margin-left: auto;
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.6;
}

.filesPane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  max-width: 1100px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

.activityPane {
  max-width: 1100px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
}



</style>
