<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import type {
  Antenna,
  NormalizedNote,
  NormalizedUserDetail,
  ServerAdapter,
  UserList,
  UserRelation,
} from '@/adapters/types'
import type { Clip, Flash, GalleryPost, JsonValue, Page } from '@/bindings'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import EditorTabs from '@/components/common/EditorTabs.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkAchievementsGrid from '@/components/common/MkAchievementsGrid.vue'
import MkAvatar from '@/components/common/MkAvatar.vue'
import MkEmoji from '@/components/common/MkEmoji.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import MkNote from '@/components/common/MkNote.vue'
import PopupMenu from '@/components/common/PopupMenu.vue'
import RawJsonView from '@/components/common/RawJsonView.vue'
import UserProfileFileGrid from '@/components/window/UserProfileFileGrid.vue'

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

import { safeUrl } from '@/composables/useDriveFolder'
import { useEditorTabs } from '@/composables/useEditorTabs'
import { useEmojiResolver } from '@/composables/useEmojiResolver'
import { useNavigation } from '@/composables/useNavigation'
import { usePortal } from '@/composables/usePortal'
import { useSensitiveMask } from '@/composables/useSensitiveMask'
import { useWindowExternalLink } from '@/composables/useWindowExternalLink'
import { useAccountsStore } from '@/stores/accounts'
import { useDeckStore } from '@/stores/deck'
import { useServersStore } from '@/stores/servers'
import { useToast } from '@/stores/toast'
import { useWindowsStore } from '@/stores/windows'
import type { Achievement } from '@/utils/achievements'
import { generateUserEmbedCode } from '@/utils/embedCode'
import { AppError } from '@/utils/errors'
import {
  displayUrl,
  formatBirthday,
  formatCount,
  formatDate,
} from '@/utils/format'
import { proxyUrl } from '@/utils/imageProxy'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { toggleFollow } from '@/utils/toggleFollow'
import { toggleReaction } from '@/utils/toggleReaction'
import { openSafeUrl, safeCssUrl } from '@/utils/url'

const props = defineProps<{
  accountId: string
  userId: string
}>()

const { navigateToUser: navToUser } = useNavigation()
const portalRef = useTemplateRef<HTMLElement>('portalRef')
usePortal(portalRef)
const accountsStore = useAccountsStore()
const serversStore = useServersStore()
const deckStore = useDeckStore()
const toast = useToast()

// Declared up-front because `topTabs` (below) reads `isOwnProfile` inside its
// computed getter, and `useEditorTabs` triggers an immediate getter call via
// its internal watch when wiring up tabIndex — accessing the const before its
// declaration would throw a TDZ ReferenceError at mount time.
const account = computed(() =>
  accountsStore.accounts.find((a) => a.id === props.accountId),
)
const isOwnProfile = computed(() => account.value?.userId === props.userId)

type ProfileTab = 'highlight' | 'notes' | 'all' | 'files'
const PROFILE_TABS: { key: ProfileTab; label: string; icon: string }[] = [
  { key: 'highlight', label: 'ハイライト', icon: 'ti ti-bolt' },
  { key: 'notes', label: 'ノート', icon: 'ti ti-pencil' },
  { key: 'all', label: '全て', icon: 'ti ti-notebook' },
  { key: 'files', label: 'ファイル付き', icon: 'ti ti-photo' },
]

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
const userRelation = ref<UserRelation | null>(null)

// User memo (#458): 他ユーザーへの自分用メモ。プロフィール上に常時表示の
// スティッキーエリアとして置き、その場編集 → blur で自動保存する。
// メニューや「追加」ボタンといった別導線は設けない (本家の二重導線を統合)。
const memoDraft = ref('')
const memoTextareaEl = useTemplateRef<HTMLTextAreaElement>('memoTextareaEl')
const canEditMemo = computed(
  () => !isOwnProfile.value && (account.value?.hasToken ?? false),
)

function adjustMemoTextarea() {
  const el = memoTextareaEl.value
  if (!el) return
  el.style.height = '0px'
  el.style.height = `${el.scrollHeight}px`
}

async function saveMemo() {
  if (!adapter || !user.value) return
  const next = memoDraft.value
  if ((user.value.memo ?? '') === next) return // 変更なし
  try {
    await adapter.api.updateUserMemo(user.value.id, next)
    user.value.memo = next
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:memo]', err.code, err.message)
    toast.show(`メモの保存に失敗しました（${err.displayCode}）`, 'error')
    memoDraft.value = user.value.memo ?? '' // 失敗時は元に戻す
  }
}

// user 読み込み・切替時に draft を同期し、textarea 高さを合わせる。
watch(
  () => user.value?.memo,
  (memo) => {
    memoDraft.value = memo ?? ''
    nextTick(adjustMemoTextarea)
  },
)

// ヘッダー「Web UIで開く」ボタンの登録 — 自プロフィールは編集画面、他は公開ページ
useWindowExternalLink(() => {
  const u = user.value
  const host = account.value?.host
  if (!u || !host) return null
  if (isOwnProfile.value) {
    return {
      url: `https://${host}/settings/profile`,
      title: 'プロフィールを編集',
      icon: 'pencil',
    }
  }
  const suffix = u.host ? `@${u.host}` : ''
  return {
    url: `https://${host}/@${u.username}${suffix}`,
    title: 'Web UIで開く',
    icon: 'world',
  }
})

const canSeeFollowing = computed(() => {
  if (isOwnProfile.value) return true
  const v = user.value?.followingVisibility ?? 'public'
  if (v === 'public') return true
  if (v === 'followers' && user.value?.isFollowed) return true
  return false
})
const canSeeFollowers = computed(() => {
  if (isOwnProfile.value) return true
  const v = user.value?.followersVisibility ?? 'public'
  if (v === 'public') return true
  if (v === 'followers' && user.value?.isFollowed) return true
  return false
})
const MAX_PROFILE_NOTES = 500
const activeTab = ref<ProfileTab>('highlight')
const notes = shallowRef<NormalizedNote[]>([])
const pinnedNotes = shallowRef<NormalizedNote[]>([])
const pinnedNoteIds = ref<string[]>([])
const isLoading = ref(true)
const isLoadingNotes = ref(false)
const hasMoreNotes = ref(true)
const error = ref<AppError | null>(null)

// Files top-tab (image/video grid). 内タブの activeTab='files' とは別物。
const filesNotes = shallowRef<NormalizedNote[]>([])
const isLoadingFiles = ref(false)
const hasMoreFiles = ref(true)
const filesLoaded = ref(false)

// Achievements top-tab
const achievements = ref<Achievement[]>([])
const isLoadingAchievements = ref(false)
const achievementsError = ref<string | null>(null)
const achievementsLoaded = ref(false)

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
const reactionEntries = shallowRef<UserReactionEntry[]>([])
const isLoadingReactions = ref(false)
const hasMoreReactions = ref(true)
const reactionsLoaded = ref(false)
const reactionsError = ref<string | null>(null)
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

// Pages / Play / Gallery top-tabs. プロフィール内ではユーザー情報（アバター/名前）
// は冗長なため省略し、タイトル + サマリー + サムネイルのみを表示する。
const PROFILE_ITEMS_PAGE_SIZE = 20

const userPages = shallowRef<Page[]>([])
const isLoadingPages = ref(false)
const hasMorePages = ref(true)
const pagesLoaded = ref(false)
const pagesError = ref<string | null>(null)

const userFlashes = shallowRef<Flash[]>([])
const isLoadingFlashes = ref(false)
const hasMoreFlashes = ref(true)
const flashesLoaded = ref(false)
const flashesError = ref<string | null>(null)

const userGalleryPosts = shallowRef<GalleryPost[]>([])
const isLoadingGalleryPosts = ref(false)
const hasMoreGalleryPosts = ref(true)
const galleryPostsLoaded = ref(false)
const galleryPostsError = ref<string | null>(null)

// Lists / Clips top-tabs.
// リストは users/lists/list をページングなしで一括取得。userId 指定時は
// Misskey 側で isPublic=true にフィルタされるため、自プロフィール時のみ
// userId を省略して非公開リストも含めて表示する。
// クリップも同様。自プロフィールは clips/list（全クリップ、ページング不可）、
// 他プロフィールは users/clips（公開のみ、limit/untilId ページング）。
const profileLists = shallowRef<UserList[]>([])
const isLoadingLists = ref(false)
const listsLoaded = ref(false)
const listsError = ref<string | null>(null)

const profileClips = shallowRef<Clip[]>([])
const isLoadingClips = ref(false)
const hasMoreClips = ref(true)
const clipsLoaded = ref(false)
const clipsError = ref<string | null>(null)

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

let adapter: ServerAdapter | null = null

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
    adapter = result.adapter
    const userDetail = await adapter.api.getUserDetail(props.userId)
    user.value = userDetail

    // Prefetch banner image so it appears instantly when DOM renders
    if (userDetail.bannerUrl) {
      new Image().src = userDetail.bannerUrl
    }

    // Relation (mute/block/follow) も認証必須 — 自分自身は対象外
    if (account.hasToken && !isOwnProfile.value) {
      void refreshUserRelation()
    }

    // Pinned notes require auth — skip for logged-out/guest accounts
    if (account.hasToken) {
      const userPinnedNoteIds = await adapter.api.getUserPinnedNoteIds(
        props.userId,
      )
      pinnedNoteIds.value = userPinnedNoteIds
      if (userPinnedNoteIds.length > 0) {
        const pinned = await Promise.all(
          userPinnedNoteIds.map((id) => adapter?.api.getNote(id)),
        )
        pinnedNotes.value = pinned.filter((n): n is NormalizedNote => n != null)
      }
    }
    await loadTabNotes()
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

async function fetchNotes(untilId?: string): Promise<NormalizedNote[]> {
  if (!adapter) return []
  const tab = activeTab.value
  if (tab === 'highlight') {
    return adapter.api.getUserFeaturedNotes(props.userId, {
      limit: 30,
      untilId,
    })
  }
  if (tab === 'all') {
    return adapter.api.getUserNotes(props.userId, {
      limit: 20,
      untilId,
      withReplies: true,
      withChannelNotes: true,
    })
  }
  if (tab === 'files') {
    return adapter.api.getUserNotes(props.userId, {
      limit: 20,
      untilId,
      withFiles: true,
    })
  }
  return adapter.api.getUserNotes(props.userId, { limit: 20, untilId })
}

async function loadTabNotes() {
  isLoadingNotes.value = true
  hasMoreNotes.value = true
  notes.value = []
  try {
    const fetched = await fetchNotes()
    notes.value = fetched
    if (fetched.length === 0 || activeTab.value === 'highlight') {
      hasMoreNotes.value = false
    }
  } catch (e) {
    error.value = AppError.from(e)
  } finally {
    isLoadingNotes.value = false
  }
}

async function loadMoreNotes() {
  if (!adapter || isLoadingNotes.value || !hasMoreNotes.value) return
  if (notes.value.length >= MAX_PROFILE_NOTES) return
  const last = notes.value.at(-1)
  if (!last) return
  isLoadingNotes.value = true
  try {
    const older = await fetchNotes(last.id)
    if (older.length === 0) {
      hasMoreNotes.value = false
    } else {
      notes.value = [...notes.value, ...older]
    }
  } catch (e) {
    error.value = AppError.from(e)
  } finally {
    isLoadingNotes.value = false
  }
}

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
  if (!adapter) return []
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
      const normalized = await adapter.api.getNote(item.note.id)
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

async function loadReactionsTab() {
  if (reactionsLoaded.value) return
  reactionsLoaded.value = true
  isLoadingReactions.value = true
  reactionsError.value = null
  try {
    const fetched = await fetchUserReactions()
    reactionEntries.value = fetched
    hasMoreReactions.value = fetched.length > 0
  } catch (e) {
    reactionsError.value = AppError.from(e).message
    reactionsLoaded.value = false
  } finally {
    isLoadingReactions.value = false
  }
}

async function loadMoreReactions() {
  if (isLoadingReactions.value || !hasMoreReactions.value) return
  const last = reactionEntries.value.at(-1)
  if (!last) return
  isLoadingReactions.value = true
  try {
    const older = await fetchUserReactions(last.id)
    if (older.length === 0) {
      hasMoreReactions.value = false
    } else {
      reactionEntries.value = [...reactionEntries.value, ...older]
    }
  } catch (e) {
    reactionsError.value = AppError.from(e).message
  } finally {
    isLoadingReactions.value = false
  }
}

async function fetchUserPages(untilId?: string): Promise<Page[]> {
  const params: Record<string, JsonValue> = {
    userId: props.userId,
    limit: PROFILE_ITEMS_PAGE_SIZE,
  }
  if (untilId) params.untilId = untilId
  return unwrap(await commands.apiGetUserPagesBy(props.accountId, params))
}

async function loadPagesTab() {
  if (pagesLoaded.value) return
  pagesLoaded.value = true
  isLoadingPages.value = true
  pagesError.value = null
  try {
    const fetched = await fetchUserPages()
    userPages.value = fetched
    hasMorePages.value = fetched.length >= PROFILE_ITEMS_PAGE_SIZE
  } catch (e) {
    pagesError.value = AppError.from(e).message
    pagesLoaded.value = false
  } finally {
    isLoadingPages.value = false
  }
}

async function loadMorePages() {
  if (isLoadingPages.value || !hasMorePages.value) return
  const last = userPages.value.at(-1)
  if (!last) return
  isLoadingPages.value = true
  try {
    const older = await fetchUserPages(last.id)
    if (older.length < PROFILE_ITEMS_PAGE_SIZE) hasMorePages.value = false
    if (older.length > 0) {
      userPages.value = [...userPages.value, ...older]
    }
  } catch (e) {
    pagesError.value = AppError.from(e).message
  } finally {
    isLoadingPages.value = false
  }
}

async function fetchUserFlashes(untilId?: string): Promise<Flash[]> {
  const params: Record<string, JsonValue> = {
    userId: props.userId,
    limit: PROFILE_ITEMS_PAGE_SIZE,
  }
  if (untilId) params.untilId = untilId
  // Misskey API のエンドポイント名は "users/flashs"（本家のスペルミス）。
  // "users/flashes" だと 404 を返す。
  return unwrap(await commands.apiGetUserFlashs(props.accountId, params))
}

async function loadFlashesTab() {
  if (flashesLoaded.value) return
  flashesLoaded.value = true
  isLoadingFlashes.value = true
  flashesError.value = null
  try {
    const fetched = await fetchUserFlashes()
    userFlashes.value = fetched
    hasMoreFlashes.value = fetched.length >= PROFILE_ITEMS_PAGE_SIZE
  } catch (e) {
    flashesError.value = AppError.from(e).message
    flashesLoaded.value = false
  } finally {
    isLoadingFlashes.value = false
  }
}

async function loadMoreFlashes() {
  if (isLoadingFlashes.value || !hasMoreFlashes.value) return
  const last = userFlashes.value.at(-1)
  if (!last) return
  isLoadingFlashes.value = true
  try {
    const older = await fetchUserFlashes(last.id)
    if (older.length < PROFILE_ITEMS_PAGE_SIZE) hasMoreFlashes.value = false
    if (older.length > 0) {
      userFlashes.value = [...userFlashes.value, ...older]
    }
  } catch (e) {
    flashesError.value = AppError.from(e).message
  } finally {
    isLoadingFlashes.value = false
  }
}

async function fetchUserGalleryPosts(untilId?: string): Promise<GalleryPost[]> {
  const params: Record<string, JsonValue> = {
    userId: props.userId,
    limit: PROFILE_ITEMS_PAGE_SIZE,
  }
  if (untilId) params.untilId = untilId
  return unwrap(await commands.apiGetUserGalleryBy(props.accountId, params))
}

async function loadGalleryPostsTab() {
  if (galleryPostsLoaded.value) return
  galleryPostsLoaded.value = true
  isLoadingGalleryPosts.value = true
  galleryPostsError.value = null
  try {
    const fetched = await fetchUserGalleryPosts()
    userGalleryPosts.value = fetched
    hasMoreGalleryPosts.value = fetched.length >= PROFILE_ITEMS_PAGE_SIZE
  } catch (e) {
    galleryPostsError.value = AppError.from(e).message
    galleryPostsLoaded.value = false
  } finally {
    isLoadingGalleryPosts.value = false
  }
}

async function loadMoreGalleryPosts() {
  if (isLoadingGalleryPosts.value || !hasMoreGalleryPosts.value) return
  const last = userGalleryPosts.value.at(-1)
  if (!last) return
  isLoadingGalleryPosts.value = true
  try {
    const older = await fetchUserGalleryPosts(last.id)
    if (older.length < PROFILE_ITEMS_PAGE_SIZE)
      hasMoreGalleryPosts.value = false
    if (older.length > 0) {
      userGalleryPosts.value = [...userGalleryPosts.value, ...older]
    }
  } catch (e) {
    galleryPostsError.value = AppError.from(e).message
  } finally {
    isLoadingGalleryPosts.value = false
  }
}

async function loadListsTab() {
  if (listsLoaded.value) return
  listsLoaded.value = true
  isLoadingLists.value = true
  listsError.value = null
  try {
    // 自分のプロフィールでは全リスト（非公開含む）が欲しいので userId を
    // 省略する。他ユーザーのプロフィールでは userId を渡して公開リストのみ
    // 取得する（Misskey 側で isPublic フィルタが入る）。
    const params: Record<string, JsonValue> = {}
    if (!isOwnProfile.value) {
      params.userId = props.userId
    }
    profileLists.value = unwrap(
      await commands.apiGetUserListsBy(props.accountId, params),
    )
  } catch (e) {
    listsError.value = AppError.from(e).message
    listsLoaded.value = false
  } finally {
    isLoadingLists.value = false
  }
}

async function fetchProfileClips(untilId?: string): Promise<Clip[]> {
  if (isOwnProfile.value) {
    // clips/list は非公開含む全クリップを返すがページング非対応。
    // loadMore からの呼び出し (untilId あり) では常に空を返して打ち切る。
    if (untilId) return []
    return unwrap(await commands.apiGetClips(props.accountId))
  }
  const params: Record<string, JsonValue> = {
    userId: props.userId,
    limit: PROFILE_ITEMS_PAGE_SIZE,
  }
  if (untilId) params.untilId = untilId
  return unwrap(await commands.apiGetUserClips(props.accountId, params))
}

async function loadClipsTab() {
  if (clipsLoaded.value) return
  clipsLoaded.value = true
  isLoadingClips.value = true
  clipsError.value = null
  try {
    const fetched = await fetchProfileClips()
    profileClips.value = fetched
    hasMoreClips.value =
      !isOwnProfile.value && fetched.length >= PROFILE_ITEMS_PAGE_SIZE
  } catch (e) {
    clipsError.value = AppError.from(e).message
    clipsLoaded.value = false
  } finally {
    isLoadingClips.value = false
  }
}

async function loadMoreClips() {
  if (isLoadingClips.value || !hasMoreClips.value) return
  const last = profileClips.value.at(-1)
  if (!last) return
  isLoadingClips.value = true
  try {
    const older = await fetchProfileClips(last.id)
    if (older.length < PROFILE_ITEMS_PAGE_SIZE) hasMoreClips.value = false
    if (older.length > 0) {
      profileClips.value = [...profileClips.value, ...older]
    }
  } catch (e) {
    clipsError.value = AppError.from(e).message
  } finally {
    isLoadingClips.value = false
  }
}

function onProfileListClick(list: UserList) {
  windowsStore.open('list-detail', {
    accountId: props.accountId,
    listId: list.id,
    ownerUserId: props.userId,
  })
}

function onProfileClipClick(clip: Clip) {
  windowsStore.open('clip-detail', {
    accountId: props.accountId,
    clipId: clip.id,
  })
}

function openUserPage(pageId: string) {
  windowsStore.open('page-detail', {
    accountId: props.accountId,
    pageId,
  })
}

function openUserPlay(flashId: string) {
  windowsStore.open('play-detail', {
    accountId: props.accountId,
    flashId,
  })
}

function openUserGallery(post: GalleryPost) {
  windowsStore.open('gallery-detail', {
    accountId: props.accountId,
    postId: post.id,
    post,
  })
}

async function loadAchievements() {
  if (achievementsLoaded.value) return
  achievementsLoaded.value = true
  isLoadingAchievements.value = true
  achievementsError.value = null
  try {
    achievements.value = unwrap(
      await commands.apiGetUserAchievements(props.accountId, props.userId),
    ) as unknown as Achievement[]
  } catch (e) {
    achievementsError.value = AppError.from(e).message
    achievementsLoaded.value = false
  } finally {
    isLoadingAchievements.value = false
  }
}

async function loadFilesTab() {
  if (!adapter || filesLoaded.value) return
  filesLoaded.value = true
  isLoadingFiles.value = true
  try {
    const fetched = await adapter.api.getUserNotes(props.userId, {
      limit: 20,
      withFiles: true,
    })
    filesNotes.value = fetched
    hasMoreFiles.value = fetched.length > 0
  } catch (e) {
    error.value = AppError.from(e)
  } finally {
    isLoadingFiles.value = false
  }
}

async function loadMoreFilesTab() {
  if (!adapter || isLoadingFiles.value || !hasMoreFiles.value) return
  if (filesNotes.value.length >= MAX_PROFILE_NOTES) return
  const last = filesNotes.value.at(-1)
  if (!last) return
  isLoadingFiles.value = true
  try {
    const older = await adapter.api.getUserNotes(props.userId, {
      limit: 20,
      untilId: last.id,
      withFiles: true,
    })
    if (older.length === 0) {
      hasMoreFiles.value = false
    } else {
      filesNotes.value = [...filesNotes.value, ...older]
    }
  } catch (e) {
    error.value = AppError.from(e)
  } finally {
    isLoadingFiles.value = false
  }
}

watch(activeTab, () => {
  loadTabNotes()
})

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
  } else if (tab === 'pages') {
    loadPagesTab()
    showSensitive.value = false
  } else if (tab === 'play') {
    loadFlashesTab()
    showSensitive.value = false
  } else if (tab === 'gallery') {
    loadGalleryPostsTab()
    showSensitive.value = false
  } else if (tab === 'lists') {
    loadListsTab()
    showSensitive.value = false
  } else if (tab === 'clips') {
    loadClipsTab()
    showSensitive.value = false
  } else if (tab === 'achievements') {
    loadAchievements()
    showSensitive.value = false
  } else {
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
      loadMorePages()
    } else if (topTab.value === 'play') {
      loadMoreFlashes()
    } else if (topTab.value === 'gallery') {
      loadMoreGalleryPosts()
    } else if (topTab.value === 'clips') {
      loadMoreClips()
    } else if (topTab.value === 'overview' || topTab.value === 'notes') {
      loadMoreNotes()
    }
  }
}

// Post form state
const showPostForm = ref(false)
const postFormReplyTo = ref<NormalizedNote | undefined>()
const postFormRenoteId = ref<string | undefined>()
const postFormEditNote = ref<NormalizedNote | undefined>()
const postFormInitialText = ref<string | undefined>()

const isFollowLoading = ref(false)
const showQrCode = ref(false)
const qrCodeContainerEl = ref<HTMLDivElement | null>(null)

async function fetchImageAsDataUrl(url: string): Promise<string | undefined> {
  try {
    return unwrap(await commands.fetchImageBase64(url)) ?? undefined
  } catch {
    return undefined
  }
}

async function openQrCode() {
  if (!user.value || !account.value) return
  showQrCode.value = true
  await nextTick()

  const container = qrCodeContainerEl.value
  if (!container) return
  container.replaceChildren()

  const profileUrl = `https://${account.value.host}/users/${user.value.id}`

  const serverInfo = await serversStore.getServerInfo(account.value.host)

  const { colord } = await import('colord')
  const baseColor = colord(serverInfo.themeColor || '#86b300')
  const hsl = baseColor.toHsl()

  const imageDataUrl = serverInfo.iconUrl
    ? await fetchImageAsDataUrl(serverInfo.iconUrl)
    : undefined

  const { default: QRCodeStyling } = await import('qr-code-styling')
  const qr = new QRCodeStyling({
    width: 600,
    height: 600,
    margin: 42,
    type: 'canvas',
    data: profileUrl,
    image: imageDataUrl,
    qrOptions: {
      typeNumber: 0,
      mode: 'Byte',
      errorCorrectionLevel: 'H',
    },
    imageOptions: {
      hideBackgroundDots: true,
      imageSize: 0.3,
      margin: 16,
    },
    dotsOptions: {
      type: 'dots',
      color: colord({ h: hsl.h, s: 100, l: 18 }).toRgbString(),
    },
    cornersDotOptions: {
      type: 'dot',
    },
    cornersSquareOptions: {
      type: 'extra-rounded',
    },
    backgroundOptions: {
      color: colord({ h: hsl.h, s: 100, l: 97 }).toRgbString(),
    },
  })

  qr.append(container)

  const canvas = container.querySelector('canvas')
  if (canvas) {
    Object.assign(canvas.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
    })
  }
}

async function handleToggleFollow() {
  if (!adapter || !user.value || isOwnProfile.value) return
  isFollowLoading.value = true
  try {
    await toggleFollow(adapter.api, user.value)
  } catch (e) {
    error.value = AppError.from(e)
  } finally {
    isFollowLoading.value = false
  }
}

// User action menu state
const userMenuRef = ref<InstanceType<typeof PopupMenu>>()
const showMuteConfirm = ref(false)
const showBlockConfirm = ref(false)
const showInvalidateFollowerConfirm = ref(false)
const showReportForm = ref(false)
const showListPicker = ref(false)
const showAntennaPicker = ref(false)
const reportComment = ref('')
const userLists = ref<UserList[]>([])
const userAntennas = ref<Antenna[]>([])
const antennaBusy = ref(false)

type UserMenuView =
  | 'main'
  | 'muteConfirm'
  | 'blockConfirm'
  | 'invalidateFollowerConfirm'
  | 'reportForm'
  | 'listPicker'
  | 'antennaPicker'
const userMenuView = computed<UserMenuView>(() => {
  if (showMuteConfirm.value) return 'muteConfirm'
  if (showBlockConfirm.value) return 'blockConfirm'
  if (showInvalidateFollowerConfirm.value) return 'invalidateFollowerConfirm'
  if (showReportForm.value) return 'reportForm'
  if (showListPicker.value) return 'listPicker'
  if (showAntennaPicker.value) return 'antennaPicker'
  return 'main'
})

function closeUserMenu() {
  userMenuRef.value?.close()
}

function userMenuBack() {
  showMuteConfirm.value = false
  showBlockConfirm.value = false
  showInvalidateFollowerConfirm.value = false
  showReportForm.value = false
  showListPicker.value = false
  showAntennaPicker.value = false
  reportComment.value = ''
}

async function refreshUserRelation() {
  if (!adapter || !user.value) return
  try {
    const [relation] = await adapter.api.getUserRelations([user.value.id])
    userRelation.value = relation ?? null
  } catch (e) {
    console.error('[user:relation]', AppError.from(e).message)
  }
}

async function handleMuteUser() {
  if (!adapter || !user.value) return
  try {
    await adapter.api.muteUser(user.value.id)
    toast.show('ミュートしました')
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:mute]', err.code, err.message)
    toast.show(`ミュートに失敗しました（${err.displayCode}）`, 'error')
  }
}

async function handleUnmuteUser() {
  if (!adapter || !user.value) return
  try {
    await adapter.api.unmuteUser(user.value.id)
    toast.show('ミュートを解除しました')
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:unmute]', err.code, err.message)
    toast.show(`ミュート解除に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function handleBlockUser() {
  if (!adapter || !user.value) return
  try {
    await adapter.api.blockUser(user.value.id)
    toast.show('ブロックしました')
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:block]', err.code, err.message)
    toast.show(`ブロックに失敗しました（${err.displayCode}）`, 'error')
  }
}

async function handleUnblockUser() {
  if (!adapter || !user.value) return
  try {
    await adapter.api.unblockUser(user.value.id)
    toast.show('ブロックを解除しました')
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:unblock]', err.code, err.message)
    toast.show(`ブロック解除に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function handleRenoteMuteUser() {
  if (!adapter || !user.value) return
  try {
    await adapter.api.renoteMuteUser(user.value.id)
    toast.show('リノートをミュートしました')
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:renote-mute]', err.code, err.message)
    toast.show(`リノートミュートに失敗しました（${err.displayCode}）`, 'error')
  }
}

async function handleUnrenoteMuteUser() {
  if (!adapter || !user.value) return
  try {
    await adapter.api.unrenoteMuteUser(user.value.id)
    toast.show('リノートのミュートを解除しました')
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:renote-unmute]', err.code, err.message)
    toast.show(
      `リノートミュート解除に失敗しました（${err.displayCode}）`,
      'error',
    )
  }
}

async function handleInvalidateFollower() {
  if (!adapter || !user.value) return
  try {
    await adapter.api.invalidateFollower(user.value.id)
    toast.show('フォロワーを解除しました')
    void refreshUserRelation()
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:invalidate-follower]', err.code, err.message)
    toast.show(`フォロワー解除に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function handleReportUser() {
  if (!adapter || !user.value || !reportComment.value.trim()) return
  try {
    await adapter.api.reportUser(user.value.id, reportComment.value)
    toast.show('通報しました')
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:report]', err.code, err.message)
    toast.show(`通報に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function copyText(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.show(successMessage)
  } catch (e) {
    console.error('[user:copy]', e)
    toast.show('コピーに失敗しました', 'error')
  } finally {
    closeUserMenu()
  }
}

function handleCopyUsername() {
  if (!user.value) return
  const host = user.value.host ?? account.value?.host
  if (!host) return
  copyText(`@${user.value.username}@${host}`, 'ユーザー名をコピーしました')
}

function handleCopyProfileUrl() {
  if (!user.value || !account.value) return
  const canonical = user.value.host
    ? `@${user.value.username}@${user.value.host}`
    : `@${user.value.username}`
  copyText(
    `https://${account.value.host}/${canonical}`,
    'プロフィール URL をコピーしました',
  )
}

function handleCopyRss() {
  if (!user.value) return
  const host = user.value.host ?? account.value?.host
  if (!host) return
  copyText(
    `${host}/@${user.value.username}.atom`,
    'RSS の URL をコピーしました',
  )
}

function handleCopyEmbedCode() {
  if (!user.value || !account.value) return
  // リモートユーザーはホストサーバーで埋め込みを取得できないので除外 (Misskey 本家踏襲)
  if (user.value.host) return
  const code = generateUserEmbedCode(account.value.host, user.value.id)
  copyText(code, '埋め込みコードをコピーしました')
}

async function openListPicker() {
  if (!adapter) return
  try {
    userLists.value = await adapter.api.getUserLists()
    showListPicker.value = true
  } catch (e) {
    const err = AppError.from(e)
    console.error('[list:fetch]', err.code, err.message)
    toast.show(`リストの取得に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function addToList(listId: string) {
  if (!adapter || !user.value) return
  try {
    await adapter.api.addUserToList(listId, user.value.id)
    toast.show('リストに追加しました')
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[list:add]', err.code, err.message)
    toast.show(`リストへの追加に失敗しました（${err.displayCode}）`, 'error')
  }
}

// リモートユーザーは `@user@host`、ローカルユーザーは `@user`。
// メンション投稿・アンテナの users 配列いずれもこの形式を受け付ける。
const userAcct = computed(() => {
  const u = user.value
  if (!u) return null
  return u.host ? `@${u.username}@${u.host}` : `@${u.username}`
})

function composeNoteToUser() {
  const acct = userAcct.value
  if (!acct) return
  postFormReplyTo.value = undefined
  postFormRenoteId.value = undefined
  postFormEditNote.value = undefined
  postFormInitialText.value = `${acct} `
  showPostForm.value = true
  closeUserMenu()
}

function searchUserNotes() {
  if (!user.value) return
  deckStore.addColumn({
    type: 'search',
    accountId: props.accountId,
    userId: user.value.id,
    name: `${userAcct.value ?? user.value.username} の検索`,
    width: 360,
  })
  closeUserMenu()
}

function openDirectMessage() {
  if (!user.value) return
  deckStore.openChatWith({
    accountId: props.accountId,
    userId: user.value.id,
    name: user.value.name || user.value.username,
    avatarUrl: user.value.avatarUrl ?? null,
    serverHost: account.value?.host ?? null,
  })
  closeUserMenu()
}

async function toggleWithReplies() {
  if (!adapter || !user.value) return
  const next = !user.value.withReplies
  try {
    await adapter.api.updateFollowing(user.value.id, { withReplies: next })
    user.value.withReplies = next
    toast.show(next ? 'TLに返信を含めます' : 'TLに返信を含めません')
  } catch (e) {
    const err = AppError.from(e)
    console.error('[following:withReplies]', err.code, err.message)
    toast.show(`設定の更新に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function toggleNotify() {
  if (!adapter || !user.value) return
  const next = user.value.notify === 'normal' ? 'none' : 'normal'
  try {
    await adapter.api.updateFollowing(user.value.id, { notify: next })
    user.value.notify = next
    toast.show(next === 'normal' ? '投稿を通知します' : '投稿を通知しません')
  } catch (e) {
    const err = AppError.from(e)
    console.error('[following:notify]', err.code, err.message)
    toast.show(`設定の更新に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function openAntennaPicker() {
  if (!adapter) return
  try {
    const all = await adapter.api.getAntennas()
    // ユーザーソースのアンテナのみ追加対象 (keyword 系には個別ユーザーを足せない)。
    userAntennas.value = all.filter((a) => a.src === 'users')
    showAntennaPicker.value = true
  } catch (e) {
    const err = AppError.from(e)
    console.error('[antenna:fetch]', err.code, err.message)
    toast.show(`アンテナの取得に失敗しました（${err.displayCode}）`, 'error')
  }
}

async function addToAntenna(antenna: Antenna) {
  if (!adapter || antennaBusy.value) return
  const acct = userAcct.value
  if (!acct) return
  antennaBusy.value = true
  try {
    // 最新の設定を取得してから users を append (他フィールドを保持して往復する)。
    const current = await adapter.api.getAntenna(antenna.id)
    const existing = current.users ?? []
    if (existing.some((u) => u.toLowerCase() === acct.toLowerCase())) {
      toast.show('すでに追加されています')
      closeUserMenu()
      return
    }
    await adapter.api.updateAntenna({
      ...current,
      users: [...existing, acct],
    })
    toast.show(`${antenna.name} に追加しました`)
    closeUserMenu()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[antenna:add]', err.code, err.message)
    toast.show(`アンテナへの追加に失敗しました（${err.displayCode}）`, 'error')
  } finally {
    antennaBusy.value = false
  }
}

const windowsStore = useWindowsStore()

function openFollowList(type: 'following' | 'followers') {
  if (!user.value) return
  windowsStore.open('follow-list', {
    accountId: props.accountId,
    userId: user.value.id,
    username: user.value.username,
    initialTab: type,
  })
}

async function handleReaction(reaction: string, note: NormalizedNote) {
  if (!adapter) return
  try {
    await toggleReaction(adapter.api, note, reaction)
  } catch (e) {
    error.value = AppError.from(e)
  }
}

async function handleVote(choice: number, target: NormalizedNote) {
  if (!adapter) return
  const { votePoll } = await import('@/utils/votePoll')
  try {
    await votePoll(adapter.api, target, choice)
  } catch (e) {
    error.value = AppError.from(e)
  }
}

async function handleRenote(target: NormalizedNote) {
  if (!adapter) return
  try {
    await adapter.api.createNote({ renoteId: target.id })
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
  if (!adapter) return
  try {
    const isPinned = pinnedNoteIds.value.includes(target.id)
    if (isPinned) {
      await adapter.api.unpinNote(target.id)
      pinnedNoteIds.value = pinnedNoteIds.value.filter((id) => id !== target.id)
      pinnedNotes.value = pinnedNotes.value.filter((n) => n.id !== target.id)
    } else {
      await adapter.api.pinNote(target.id)
      pinnedNoteIds.value = [...pinnedNoteIds.value, target.id]
      pinnedNotes.value = [...pinnedNotes.value, target]
    }
  } catch (e) {
    error.value = AppError.from(e)
  }
}

async function handleDelete(target: NormalizedNote) {
  if (!adapter) return
  try {
    await adapter.api.deleteNote(target.id)
    const id = target.id
    notes.value = notes.value.filter((n) => n.id !== id && n.renoteId !== id)
  } catch (e) {
    error.value = AppError.from(e)
  }
}

async function handleDeleteAndEdit(target: NormalizedNote) {
  if (!adapter) return
  try {
    await adapter.api.deleteNote(target.id)
    const id = target.id
    notes.value = notes.value.filter((n) => n.id !== id && n.renoteId !== id)
    postFormReplyTo.value = target.replyId
      ? await adapter.api.getNote(target.replyId).catch(() => undefined)
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
  if (editedNoteId && adapter) {
    try {
      const updated = await adapter.api.getNote(editedNoteId)
      notes.value = notes.value.map((n) =>
        n.id === editedNoteId
          ? updated
          : n.renoteId === editedNoteId
            ? { ...n, renote: updated }
            : n,
      )
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
        <!-- Profile details (overview only) -->
        <div v-show="topTab === 'overview'">
        <!-- Banner area -->
        <div :class="$style.bannerArea">
          <div
            v-if="user.bannerUrl"
            :class="$style.banner"
            :style="{ backgroundImage: safeCssUrl(proxyUrl(user.bannerUrl)) }"
          />
          <div v-else :class="[$style.banner, $style.bannerEmpty]" />

          <!-- Gradient fade -->
          <div :class="$style.bannerFade" />

          <!-- "Follows you" badge on banner -->
          <div v-if="user.isFollowed" :class="$style.followedBadge">フォローされています</div>

          <!-- Name overlay on banner (desktop) -->
          <div :class="$style.bannerTitle">
            <div :class="$style.bannerName">
              <MkMfm v-if="user.name" :text="user.name" :emojis="user.emojis" :server-host="account?.host" plain />
              <template v-else>{{ user.username }}</template>
            </div>
            <div :class="$style.bannerBottom">
              <span :class="$style.bannerUsername">@{{ user.username }}{{ user.host ? `@${user.host}` : '' }}</span>
              <span v-if="user.isBot" :class="$style.bannerBadge">Bot</span>
              <span v-if="user.isCat" :class="$style.bannerBadge">Cat</span>
            </div>
          </div>

          <!-- Avatar -->
          <MkAvatar
            :avatar-url="user.avatarUrl"
            :decorations="user.avatarDecorations"
            :size="120"
            indicator
            :is-cat="user.isCat"
            :online-status="user.onlineStatus"
            :class="$style.userAvatar"
          />

          <!-- Banner actions -->
          <div :class="$style.bannerActions">
            <button
              v-if="!isOwnProfile"
              class="_button"
              :class="$style.bannerActionBtn"
              title="その他"
              @click="userMenuRef?.open($event)"
            >
              <i class="ti ti-dots" />
            </button>
            <button
              v-if="!isOwnProfile"
              class="_button"
              :class="[$style.bannerFollowBtn, { [$style.following]: user.isFollowing }]"
              :disabled="isFollowLoading"
              @click="handleToggleFollow"
            >
              {{ user.isFollowing ? 'フォロー中' : 'フォロー' }}
            </button>
            <button class="_button" :class="$style.bannerActionBtn" title="QRコード" @click="openQrCode">
              <i class="ti ti-qrcode" />
            </button>
          </div>
        </div>

        <!-- Mobile title (shown below avatar on narrow screens) -->
        <div :class="$style.mobileTitle">
          <div :class="$style.mobileName">
            <MkMfm v-if="user.name" :text="user.name" :emojis="user.emojis" :server-host="account?.host" plain />
            <template v-else>{{ user.username }}</template>
          </div>
          <div :class="$style.mobileUsername">@{{ user.username }}{{ user.host ? `@${user.host}` : '' }}</div>
          <div v-if="user.isBot || user.isCat" :class="$style.mobileBadges">
            <span v-if="user.isBot" :class="$style.badge">Bot</span>
            <span v-if="user.isCat" :class="[$style.badge, $style.badgeCat]">Cat</span>
          </div>
        </div>

        <!-- Followed message (フォロー中ユーザーまたは本人にのみ API が返す。アバターから出る吹き出し風) -->
        <div v-if="user.followedMessage" :class="$style.followedMessage">
          <div :class="[$style.fukidashi, $style.fukidashiLeft]">
            <div :class="$style.fukidashiBg">
              <svg :class="$style.fukidashiTail" version="1.1" viewBox="0 0 14.597 14.58" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <g transform="translate(-173.71 -87.184)">
                  <path d="m188.19 87.657c-1.469 2.3218-3.9315 3.8312-6.667 4.0865-2.2309-1.7379-4.9781-2.6816-7.8061-2.6815h-5.1e-4v12.702h12.702v-5.1e-4c2e-5 -1.9998-0.47213-3.9713-1.378-5.754 2.0709-1.6834 3.2732-4.2102 3.273-6.8791-6e-5 -0.49375-0.0413-0.98662-0.1235-1.4735z" />
                </g>
              </svg>
              <div :class="$style.fukidashiContent">
                <div :class="$style.fukidashiHeader">フォロワーへのメッセージ</div>
                <MkMfm :text="user.followedMessage" :emojis="user.emojis" :server-host="account?.host" plain />
              </div>
            </div>
          </div>
        </div>

        <!-- Roles -->
        <div v-if="user.roles?.length" :class="$style.roles">
          <span
            v-for="role in user.roles"
            :key="role.id"
            :class="$style.role"
            :style="role.color ? { borderColor: role.color } : {}"
            :title="role.description || role.name"
            @click="openSafeUrl(`https://${user.host || account?.host}/roles/${role.id}`)"
          >
            <img v-if="role.iconUrl" :src="role.iconUrl" :class="$style.roleIcon" />
            {{ role.name }}
          </span>
        </div>

        <!-- User memo (self-only sticky note about this user, #458) -->
        <div v-if="canEditMemo" :class="$style.memo">
          <div :class="$style.memoHeading">メモ（自分のみ）</div>
          <textarea
            ref="memoTextareaEl"
            v-model="memoDraft"
            :class="$style.memoTextarea"
            rows="1"
            placeholder="このユーザーへのメモを追加..."
            @blur="saveMemo"
            @input="adjustMemoTextarea"
          />
        </div>

        <!-- Description -->
        <div v-if="user.description" :class="$style.description">
          <MkMfm :text="user.description" :emojis="user.emojis" :server-host="account?.host" />
        </div>

        <!-- Custom fields -->
        <div v-if="user.fields?.length" :class="$style.profileFields">
          <div v-for="(field, i) in user.fields" :key="i" :class="$style.profileField">
            <div :class="$style.profileFieldName">{{ field.name }}</div>
            <div :class="$style.profileFieldValue">
              <MkMfm :text="field.value" :emojis="user.emojis" :server-host="account?.host" />
            </div>
          </div>
        </div>

        <!-- Profile info (birthday, location, url, registration date) -->
        <div v-if="user.birthday || user.location || user.url || user.createdAt" :class="$style.profileInfo">
          <div v-if="user.birthday" :class="$style.profileInfoItem">
            <i class="ti ti-cake" />
            <span>{{ formatBirthday(user.birthday) }}</span>
          </div>
          <div v-if="user.location" :class="$style.profileInfoItem">
            <i class="ti ti-map-pin" />
            <span>{{ user.location }}</span>
          </div>
          <div v-if="user.url" :class="$style.profileInfoItem">
            <i class="ti ti-link" />
            <span>{{ displayUrl(user.url!) }}</span>
          </div>
          <div v-if="user.createdAt" :class="$style.profileInfoItem">
            <i class="ti ti-calendar" />
            <span>{{ formatDate(user.createdAt) }}</span>
          </div>
        </div>

        <!-- Stats -->
        <div :class="$style.stats">
          <div :class="$style.stat">
            <b>{{ formatCount(user.notesCount) }}</b>
            <span>ノート</span>
          </div>
          <button v-if="canSeeFollowing" :class="[$style.stat, $style.statLink]" class="_button" @click="openFollowList('following')">
            <b>{{ formatCount(user.followingCount) }}</b>
            <span>フォロー</span>
          </button>
          <button v-if="canSeeFollowers" :class="[$style.stat, $style.statLink]" class="_button" @click="openFollowList('followers')">
            <b>{{ formatCount(user.followersCount) }}</b>
            <span>フォロワー</span>
          </button>
        </div>
        </div>

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

        <!-- Notes tabs -->
        <div :class="$style.notesSection">
          <div :class="$style.notesTabs">
            <button
              v-for="tab in PROFILE_TABS"
              :key="tab.key"
              class="_button"
              :class="[$style.notesTabItem, { [$style.active]: activeTab === tab.key }]"
              @click="activeTab = tab.key"
            >
              <i :class="tab.icon" />
              {{ tab.label }}
            </button>
          </div>

          <MkNote
            v-for="note in notes"
            :key="note.id"
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

          <div v-if="isLoadingNotes" :class="$style.stateMessage">
            <LoadingSpinner />
          </div>

          <div v-if="!isLoadingNotes && notes.length === 0" :class="$style.stateMessage">
            ノートはありません
          </div>
        </div>
      </div>
        </div>

        <div v-show="topTab === 'files'" :class="$style.filesPane">
          <UserProfileFileGrid :account-id="accountId" :notes="filesNotes" />
          <div v-if="isLoadingFiles" :class="$style.stateMessage">
            <LoadingSpinner />
          </div>
          <div v-if="!isLoadingFiles && filesNotes.length === 0" :class="$style.stateMessage">
            ファイルはありません
          </div>
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
          <div
            v-else-if="reactionsError"
            :class="[$style.stateMessage, $style.stateError]"
          >
            {{ reactionsError }}
          </div>
          <div
            v-else-if="reactionEntries.length === 0"
            :class="$style.stateMessage"
          >
            リアクションはありません
          </div>
        </div>

        <div v-show="topTab === 'pages'" :class="$style.pagesPane">
          <button
            v-for="item in userPages"
            :key="item.id"
            class="_button"
            :class="$style.pageCard"
            @click="openUserPage(item.id)"
          >
            <div :class="$style.pageCardTitle">{{ item.title }}</div>
            <div v-if="item.summary" :class="$style.pageCardSummary">{{ item.summary }}</div>
          </button>

          <div v-if="isLoadingPages" :class="$style.stateMessage">
            <LoadingSpinner />
          </div>
          <ColumnEmptyState
            v-else-if="pagesError"
            :message="pagesError"
            is-error
            :image-url="serverErrorImageUrl"
          />
          <ColumnEmptyState
            v-else-if="userPages.length === 0"
            message="ページがありません"
            :image-url="serverInfoImageUrl"
          />
        </div>

        <div v-show="topTab === 'play'" :class="$style.playPane">
          <button
            v-for="item in userFlashes"
            :key="item.id"
            class="_button"
            :class="$style.playCard"
            @click="openUserPlay(item.id)"
          >
            <div :class="$style.playCardTitle">{{ item.title }}</div>
            <div v-if="item.summary" :class="$style.playCardSummary">{{ item.summary }}</div>
          </button>

          <div v-if="isLoadingFlashes" :class="$style.stateMessage">
            <LoadingSpinner />
          </div>
          <ColumnEmptyState
            v-else-if="flashesError"
            :message="flashesError"
            is-error
            :image-url="serverErrorImageUrl"
          />
          <ColumnEmptyState
            v-else-if="userFlashes.length === 0"
            message="Playがありません"
            :image-url="serverInfoImageUrl"
          />
        </div>

        <div v-show="topTab === 'gallery'" :class="$style.galleryPane">
          <div v-if="userGalleryPosts.length > 0" :class="$style.galleryGrid">
            <button
              v-for="post in userGalleryPosts"
              :key="post.id"
              class="_button"
              :class="$style.galleryGridCell"
              @click="openUserGallery(post)"
            >
              <div :class="$style.galleryGridThumb">
                <img
                  v-if="post.files.length > 0 && post.files[0]!.type.startsWith('image/') && !post.isSensitive"
                  :src="safeUrl(post.files[0]!.thumbnailUrl) || safeUrl(post.files[0]!.url)"
                  :alt="post.title"
                  :class="$style.galleryGridImg"
                  loading="lazy"
                />
                <div v-else-if="post.isSensitive" :class="$style.galleryGridPlaceholder">
                  <i class="ti ti-eye-off" />
                </div>
                <div v-else :class="$style.galleryGridPlaceholder">
                  <i class="ti ti-photo" />
                </div>
                <div v-if="post.files.length > 1" :class="$style.galleryGridBadge">
                  <i class="ti ti-stack-2" />
                  {{ post.files.length }}
                </div>
              </div>
              <div :class="$style.galleryGridInfo">
                <div :class="$style.galleryGridTitle">{{ post.title }}</div>
                <div v-if="(post.likedCount ?? 0) > 0" :class="$style.galleryGridLikes">
                  <i class="ti ti-heart" /> {{ post.likedCount }}
                </div>
              </div>
            </button>
          </div>

          <div v-if="isLoadingGalleryPosts" :class="$style.stateMessage">
            <LoadingSpinner />
          </div>
          <ColumnEmptyState
            v-else-if="galleryPostsError"
            :message="galleryPostsError"
            is-error
            :image-url="serverErrorImageUrl"
          />
          <ColumnEmptyState
            v-else-if="userGalleryPosts.length === 0"
            message="ギャラリー投稿がありません"
            :image-url="serverInfoImageUrl"
          />
        </div>

        <div v-show="topTab === 'lists'" :class="$style.pagesPane">
          <button
            v-for="item in profileLists"
            :key="item.id"
            class="_button"
            :class="$style.pageCard"
            @click="onProfileListClick(item)"
          >
            <div :class="$style.pageCardTitle">{{ item.name }}</div>
          </button>

          <div v-if="isLoadingLists" :class="$style.stateMessage">
            <LoadingSpinner />
          </div>
          <ColumnEmptyState
            v-else-if="listsError"
            :message="listsError"
            is-error
            :image-url="serverErrorImageUrl"
          />
          <ColumnEmptyState
            v-else-if="profileLists.length === 0"
            message="リストがありません"
            :image-url="serverInfoImageUrl"
          />
        </div>

        <div v-show="topTab === 'clips'" :class="$style.pagesPane">
          <button
            v-for="item in profileClips"
            :key="item.id"
            class="_button"
            :class="$style.pageCard"
            @click="onProfileClipClick(item)"
          >
            <div :class="$style.pageCardTitle">{{ item.name }}</div>
            <div v-if="item.description" :class="$style.pageCardSummary">{{ item.description }}</div>
          </button>

          <div v-if="isLoadingClips" :class="$style.stateMessage">
            <LoadingSpinner />
          </div>
          <ColumnEmptyState
            v-else-if="clipsError"
            :message="clipsError"
            is-error
            :image-url="serverErrorImageUrl"
          />
          <ColumnEmptyState
            v-else-if="profileClips.length === 0"
            message="クリップがありません"
            :image-url="serverInfoImageUrl"
          />
        </div>

        <div v-show="topTab === 'achievements'" :class="$style.achievementsPane">
          <div v-if="isLoadingAchievements" :class="$style.stateMessage">
            <LoadingSpinner />
          </div>
          <div
            v-else-if="achievementsError"
            :class="[$style.stateMessage, $style.stateError]"
          >
            {{ achievementsError }}
          </div>
          <div v-else-if="achievements.length === 0" :class="$style.stateMessage">
            実績がありません
          </div>
          <MkAchievementsGrid v-else :achievements="achievements" />
        </div>

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

      <!-- User action menu -->
      <PopupMenu ref="userMenuRef" @close="userMenuBack">
        <!-- Main -->
        <template v-if="userMenuView === 'main'">
          <button class="_popupItem" @click="composeNoteToUser">
            <i class="ti ti-pencil" />
            ユーザー指定ノートを作成
          </button>
          <button class="_popupItem" @click="searchUserNotes">
            <i class="ti ti-search" />
            ユーザーのノートを検索
          </button>
          <button class="_popupItem" @click="openDirectMessage">
            <i class="ti ti-message" />
            ダイレクトメッセージ
          </button>
          <div class="_popupDivider" />
          <button class="_popupItem" @click="handleCopyUsername">
            <i class="ti ti-at" />
            ユーザー名をコピー
          </button>
          <button class="_popupItem" @click="handleCopyProfileUrl">
            <i class="ti ti-share" />
            プロフィール URL をコピー
          </button>
          <button class="_popupItem" @click="handleCopyRss">
            <i class="ti ti-rss" />
            RSS をコピー
          </button>
          <button
            v-if="!user?.host"
            class="_popupItem"
            @click="handleCopyEmbedCode"
          >
            <i class="ti ti-code" />
            埋め込み
          </button>
          <div class="_popupDivider" />
          <button class="_popupItem" @click="openListPicker">
            <i class="ti ti-list" />
            リストに追加
          </button>
          <button class="_popupItem" @click="openAntennaPicker">
            <i class="ti ti-antenna" />
            アンテナに追加
          </button>
          <template v-if="user?.isFollowing">
            <div class="_popupDivider" />
            <button class="_popupItem" @click="toggleWithReplies">
              <i
                :class="
                  user?.withReplies ? 'ti ti-checkbox' : 'ti ti-square'
                "
              />
              TLに他の人への返信を含める
            </button>
            <button class="_popupItem" @click="toggleNotify">
              <i
                :class="
                  user?.notify === 'normal' ? 'ti ti-bell-ringing' : 'ti ti-bell'
                "
              />
              投稿を通知
            </button>
          </template>
          <div class="_popupDivider" />
          <button
            class="_popupItem"
            @click="
              userRelation?.isMuted ? handleUnmuteUser() : (showMuteConfirm = true)
            "
          >
            <i :class="userRelation?.isMuted ? 'ti ti-eye' : 'ti ti-eye-off'" />
            {{ userRelation?.isMuted ? 'ミュート解除' : 'ミュート' }}
          </button>
          <button
            class="_popupItem"
            @click="
              userRelation?.isRenoteMuted
                ? handleUnrenoteMuteUser()
                : handleRenoteMuteUser()
            "
          >
            <i
              :class="
                userRelation?.isRenoteMuted ? 'ti ti-repeat' : 'ti ti-repeat-off'
              "
            />
            {{ userRelation?.isRenoteMuted ? 'リノートミュート解除' : 'リノートをミュート' }}
          </button>
          <button
            class="_popupItem _popupItemDanger"
            @click="
              userRelation?.isBlocking
                ? handleUnblockUser()
                : (showBlockConfirm = true)
            "
          >
            <i class="ti ti-ban" />
            {{ userRelation?.isBlocking ? 'ブロック解除' : 'ブロック' }}
          </button>
          <button
            v-if="userRelation?.isFollowed"
            class="_popupItem _popupItemDanger"
            @click="showInvalidateFollowerConfirm = true"
          >
            <i class="ti ti-link-off" />
            フォロワーを解除
          </button>
          <div class="_popupDivider" />
          <button class="_popupItem _popupItemDanger" @click="showReportForm = true">
            <i class="ti ti-alert-triangle" />
            通報
          </button>
        </template>
        <!-- Mute confirm -->
        <template v-else-if="userMenuView === 'muteConfirm'">
          <div class="_popupConfirmText">@{{ user?.username }} をミュートしますか？</div>
          <button class="_popupItem _popupItemDanger" @click="handleMuteUser">
            <i class="ti ti-eye-off" />
            ミュート
          </button>
          <button class="_popupItem" @click="userMenuBack">
            <i class="ti ti-x" />
            キャンセル
          </button>
        </template>
        <!-- Block confirm -->
        <template v-else-if="userMenuView === 'blockConfirm'">
          <div class="_popupConfirmText">@{{ user?.username }} をブロックしますか？</div>
          <button class="_popupItem _popupItemDanger" @click="handleBlockUser">
            <i class="ti ti-ban" />
            ブロック
          </button>
          <button class="_popupItem" @click="userMenuBack">
            <i class="ti ti-x" />
            キャンセル
          </button>
        </template>
        <!-- Invalidate follower confirm -->
        <template v-else-if="userMenuView === 'invalidateFollowerConfirm'">
          <div class="_popupConfirmText">
            @{{ user?.username }} のフォロワーを解除しますか？
          </div>
          <button
            class="_popupItem _popupItemDanger"
            @click="handleInvalidateFollower"
          >
            <i class="ti ti-link-off" />
            解除
          </button>
          <button class="_popupItem" @click="userMenuBack">
            <i class="ti ti-x" />
            キャンセル
          </button>
        </template>
        <!-- Report form -->
        <template v-else-if="userMenuView === 'reportForm'">
          <div class="_popupConfirmText">@{{ user?.username }} を通報</div>
          <div class="_popupReportInputWrap">
            <textarea
              v-model="reportComment"
              class="_popupReportInput"
              placeholder="通報理由を入力..."
              rows="3"
            />
          </div>
          <button
            class="_popupItem _popupItemDanger"
            :disabled="!reportComment.trim()"
            @click="handleReportUser"
          >
            <i class="ti ti-alert-triangle" />
            送信
          </button>
          <button class="_popupItem" @click="userMenuBack">
            <i class="ti ti-x" />
            キャンセル
          </button>
        </template>
        <!-- List picker -->
        <template v-else-if="userMenuView === 'listPicker'">
          <button class="_popupItem" @click="userMenuBack">
            <i class="ti ti-arrow-left" />
            戻る
          </button>
          <div class="_popupDivider" />
          <template v-if="userLists.length > 0">
            <button
              v-for="list in userLists"
              :key="list.id"
              class="_popupItem"
              @click="addToList(list.id)"
            >
              <i class="ti ti-list" />
              {{ list.name }}
            </button>
          </template>
          <div v-else class="_popupConfirmText">リストがありません</div>
        </template>
        <!-- Antenna picker -->
        <template v-else-if="userMenuView === 'antennaPicker'">
          <button class="_popupItem" @click="userMenuBack">
            <i class="ti ti-arrow-left" />
            戻る
          </button>
          <div class="_popupDivider" />
          <template v-if="userAntennas.length > 0">
            <button
              v-for="antenna in userAntennas"
              :key="antenna.id"
              class="_popupItem"
              :disabled="antennaBusy"
              @click="addToAntenna(antenna)"
            >
              <i class="ti ti-antenna" />
              {{ antenna.name }}
            </button>
          </template>
          <div v-else class="_popupConfirmText">
            ユーザーソースのアンテナがありません
          </div>
        </template>
      </PopupMenu>

      <div v-if="showQrCode" :class="$style.qrOverlay" @click="showQrCode = false">
        <div :class="$style.qrModal" @click.stop>
          <button class="_button" :class="$style.qrCloseBtn" @click="showQrCode = false">
            <i class="ti ti-x" />
          </button>
          <div ref="qrCodeContainerEl" :class="$style.qrCanvas" />
          <div :class="$style.qrUser">
            <img v-if="user?.avatarUrl" :src="proxyUrl(user.avatarUrl)" :class="$style.qrAvatar" />
            <div :class="$style.qrUserInfo">
              <div :class="$style.qrName">
                <MkMfm v-if="user?.name" :text="user.name" :emojis="user?.emojis" :server-host="account?.host" plain />
                <template v-else>{{ user?.username }}</template>
              </div>
              <div :class="$style.qrAcct">@{{ user?.username }}@{{ account?.host }}</div>
            </div>
          </div>
          <img :class="$style.qrLogo" src="/misskey-logo.svg" alt="Misskey" />
        </div>
      </div>
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

.bannerArea {
  position: relative;
  --bannerHeight: 250px;
}

.banner {
  width: 100%;
  height: var(--bannerHeight);
  background-color: #4c5e6d;
  background-size: cover;
  background-position: center 50%;
}

.bannerEmpty {
  background: linear-gradient(135deg, color-mix(in srgb, var(--nd-accent) 40%, var(--nd-panel)), color-mix(in srgb, var(--nd-accent) 20%, var(--nd-panel)));
}

.bannerFade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 78px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
  pointer-events: none;
}

.followedBadge {
  position: absolute;
  top: 12px;
  left: 12px;
  padding: 4px 12px;
  border-radius: var(--nd-radius-full);
  font-size: 0.75em;
  font-weight: bold;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
}

.bannerTitle {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  padding: 0 0 8px 154px;
  color: #fff;
  pointer-events: none;
}

.bannerName {
  line-height: 32px;
  font-weight: bold;
  font-size: 1.8em;
  filter: drop-shadow(0 0 4px #000);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bannerBottom {
  line-height: 20px;
  opacity: 0.8;
  filter: drop-shadow(0 0 4px #000);
}

.bannerUsername {
  font-weight: bold;
  margin-right: 16px;
}

.bannerBadge {
  display: inline-block;
  margin-right: 8px;
  padding: 1px 8px;
  border-radius: var(--nd-radius-full);
  font-size: 0.8em;
  background: rgba(255, 255, 255, 0.2);
}

.bannerActions {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(0, 0, 0, 0.45);
  padding: 8px;
  border-radius: 24px;
  z-index: 3;
}

.bannerActionBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 31px;
  height: 31px;
  color: #fff;
  text-shadow: 0 0 8px #000;
  font-size: 16px;
}

.bannerFollowBtn {
  padding: 0 8px 0 12px;
  height: 31px;
  border-radius: 32px;
  font-size: 14px;
  font-weight: bold;
  color: #fff;
  background: var(--nd-accent);
  margin-left: 4px;

  &:hover {
    opacity: 0.85;
  }

  &:disabled {
    opacity: 0.5;
  }

  &.following {
    background: var(--nd-accent);
    color: #fff;
  }
}

.userAvatar {
  position: absolute;
  top: 170px;
  left: 16px;
  z-index: 2;
}

.mobileTitle {
  display: none;
}

.followedMessage {
  padding: 24px 24px 0 154px;
}

.fukidashi {
  --fukidashi-radius: 16px;
  --fukidashi-bg: color-mix(in srgb, var(--nd-accent), var(--nd-panel) 85%);
  position: relative;
  display: block;
  width: 100%;
  box-sizing: border-box;
  min-height: calc(var(--fukidashi-radius) * 2);
  padding-top: calc(var(--fukidashi-radius) * 0.13);
  font-size: 0.9em;
  line-height: 1.55;
}

.fukidashiLeft {
  padding-left: calc(var(--fukidashi-radius) * 0.13);
  margin-left: calc(var(--fukidashi-radius) * 0.13 * -1);
}

.fukidashiBg {
  width: 100%;
  height: 100%;
  background: var(--fukidashi-bg);
  border-radius: var(--fukidashi-radius);
}

.fukidashiTail {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  width: calc(var(--fukidashi-radius) * 1.13);
  height: auto;
  fill: var(--fukidashi-bg);
  transform: rotateY(180deg);
}

.fukidashiContent {
  position: relative;
  padding: 10px 14px;
  box-sizing: border-box;
  word-break: break-word;
}

.fukidashiHeader {
  margin-bottom: 2px;
  font-size: 0.85em;
  opacity: 0.7;
}

.description {
  padding: 24px 24px 0 154px;
  margin: 0;
  font-size: 0.95em;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.memo {
  margin: 12px 24px 0 154px;
  padding: 8px 10px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius);
  background: var(--nd-buttonBg);
}

.memoHeading {
  font-size: 0.78em;
  font-weight: bold;
  opacity: 0.55;
  margin-bottom: 2px;
}

.memoTextarea {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  outline: none;
  resize: none;
  overflow: hidden;
  min-height: 0;
  line-height: 1.5;
  font-size: 0.9em;
  font-family: inherit;
  color: var(--nd-fg);
  background: transparent;
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

.roles {
  padding: 12px 24px 0 154px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 0.85em;
}

.role {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: solid 1px var(--nd-divider);
  border-radius: var(--nd-radius-full);
  cursor: pointer;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.stats {
  display: flex;
  padding: 24px;
  border-top: solid 0.5px var(--nd-divider);
  margin-top: 16px;
}

.stat {
  flex: 1;
  text-align: center;

  > b {
    display: block;
    line-height: 16px;
    font-size: 1.1em;
    color: var(--nd-fgHighlighted);
  }

  > span {
    font-size: 70%;
    opacity: 0.6;
  }
}

.statLink {
  cursor: pointer;
  border-radius: var(--nd-radius-sm);
  padding: 4px;

  &:hover {
    background: var(--nd-panelHighlight, rgba(255, 255, 255, 0.03));
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

.notesSection {
  border-top: solid 0.5px var(--nd-divider);
}

.notesTabs {
  display: flex;
  border-bottom: solid 0.5px var(--nd-divider);
  position: sticky;
  top: 0;
  background: var(--nd-bg);
  z-index: 5;
}

.notesTabItem {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 14px 8px;
  font-size: 0.85em;
  font-weight: bold;
  color: var(--nd-fg);
  opacity: 0.6;
  border-bottom: 2px solid transparent;
  transition: opacity var(--nd-duration-base), border-color var(--nd-duration-base);

  &:hover {
    opacity: 0.8;
  }

  &.active {
    color: var(--nd-accent);
    opacity: 1;
    border-bottom-color: var(--nd-accent);
  }

  i {
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

.achievementsPane {
  padding: 4px;
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

.pagesPane,
.playPane {
  max-width: 1100px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.pageCard,
.playCard {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 12px 14px;
  text-align: left;
  border-bottom: 1px solid var(--nd-divider);
  transition: background var(--nd-duration-base);
  contain: layout style paint;
  content-visibility: auto;
  contain-intrinsic-size: auto 60px;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.pageCardTitle,
.playCardTitle {
  font-size: 0.9em;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
}

.pageCardSummary,
.playCardSummary {
  font-size: 0.8em;
  opacity: 0.7;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.galleryPane {
  max-width: 1100px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.galleryGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 2px;
  padding: 2px;
}

.galleryGridCell {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  text-align: left;
  transition: opacity var(--nd-duration-base);
  contain: layout style paint;
  content-visibility: auto;
  contain-intrinsic-size: auto 180px;

  &:hover {
    opacity: 0.8;
  }
}

.galleryGridThumb {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  background: var(--nd-bg);
}

.galleryGridImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.galleryGridPlaceholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  opacity: 0.3;
}

.galleryGridBadge {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  border-radius: 10px;
  background: var(--nd-overlayDark);
  color: #fff;
  font-size: 11px;
}

.galleryGridInfo {
  padding: 6px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.galleryGridTitle {
  font-size: 0.75em;
  font-weight: 600;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.galleryGridLikes {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 0.65em;
  color: var(--nd-love);
  flex-shrink: 0;
}


.badge {
  font-size: 0.75em;
  padding: 2px 8px;
  border-radius: var(--nd-radius-full);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
}

.badgeCat {
  background: var(--nd-accentedBg);
  color: var(--nd-accent);
}

.roleIcon {
  width: 1.3em;
  height: 1.3em;
  object-fit: contain;
}

.profileFields {
  padding: 16px 24px 0 154px;
}

.profileField {
  display: flex;
  border-bottom: solid 0.5px var(--nd-divider);
  padding: 10px 0;

  &:last-child {
    border-bottom: none;
  }
}

.profileFieldName {
  flex: 0 0 120px;
  font-size: 0.85em;
  font-weight: bold;
  color: var(--nd-fgHighlighted);
  word-break: break-word;
}

.profileFieldValue {
  flex: 1;
  font-size: 0.85em;
  word-break: break-word;
  min-width: 0;
}

.profileInfo {
  padding: 8px 24px 0 154px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}

.profileInfoItem {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8em;
  opacity: 0.6;

  i {
    font-size: 1em;
  }
}

.qrOverlay {
  position: fixed;
  inset: 0;
  z-index: var(--nd-z-popup);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--nd-overlayDark);
}

.qrModal {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.qrCloseBtn {
  position: absolute;
  top: -40px;
  right: -40px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: #fff;
  background: rgba(255, 255, 255, 0.15);
  font-size: 16px;

  &:hover {
    background: rgba(255, 255, 255, 0.3);
  }
}

.qrCanvas {
  position: relative;
  width: min(230px, 80vw);
  border-radius: 12px;
  overflow: clip;
  aspect-ratio: 1;
}

.qrUser {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin-top: 28px;
  color: #fff;
  max-width: 230px;
}

.qrAvatar {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  object-fit: cover;
  margin-bottom: 16px;
}

.qrUserInfo {
  overflow: hidden;
  max-width: 100%;
}

.qrName {
  font-weight: bold;
  font-size: 1.1em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qrAcct {
  font-size: 0.9em;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qrLogo {
  width: 100px;
  margin-top: 28px;
  filter: drop-shadow(0 0 6px rgb(0 0 0 / 43%));
}

.mobileName {}
.mobileUsername {}
.mobileBadges {}

@container (max-width: 500px) {
  .bannerArea {
    --bannerHeight: 140px;
  }

  .bannerFade {
    display: none;
  }

  .bannerTitle {
    display: none;
  }

  .userAvatar {
    top: 90px;
    left: 0;
    right: 0;
    width: 92px !important;
    height: 92px !important;
    margin: auto;
  }

  .mobileTitle {
    display: block;
    text-align: center;
    padding: 50px 8px 16px 8px;
    border-bottom: solid 0.5px var(--nd-divider);
  }

  .mobileName {
    font-weight: bold;
    font-size: 1.3em;
    color: var(--nd-fgHighlighted);
  }

  .mobileUsername {
    font-size: 0.85em;
    opacity: 0.6;
    margin-top: 2px;
  }

  .mobileBadges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    justify-content: center;
    margin-top: 8px;
  }

  .roles {
    padding: 12px 16px 0;
    justify-content: center;
  }

  .bannerActions {
    top: 8px;
    right: 8px;
    padding: 6px;
  }

  .followedMessage {
    padding: 16px 16px 0;
  }

  .fukidashi {
    display: block;
  }

  .fukidashiLeft {
    padding-left: 0;
    margin-left: 0;
  }

  .fukidashiTail {
    display: none;
  }

  .description {
    padding: 16px;
    text-align: center;
  }

  .memo {
    margin: 12px 16px 0;
  }

  .profileFields {
    padding: 16px;
  }

  .profileField {
    flex-direction: column;
    gap: 2px;
  }

  .profileFieldName {
    flex: none;
  }

  .profileInfo {
    padding: 8px 16px 0;
    justify-content: center;
  }

  .stats {
    padding: 16px;
  }

  .notesTabItem {
    min-height: 44px;
  }
}

/* Empty placeholder classes for dynamic binding */
.active {}
.following {}
</style>
