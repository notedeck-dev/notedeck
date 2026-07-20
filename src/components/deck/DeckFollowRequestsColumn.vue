<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { NormalizedUser } from '@/adapters/types'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import MkAvatar from '@/components/common/MkAvatar.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import { useColumnPullScroller } from '@/composables/useColumnPullScroller'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { useNavigation } from '@/composables/useNavigation'
import { useServerImages } from '@/composables/useServerImages'
import { useTabSlide } from '@/composables/useTabSlide'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useServersStore } from '@/stores/servers'
import { useToast } from '@/stores/toast'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import type { ColumnTabDef } from './ColumnTabs.vue'
import ColumnTabs from './ColumnTabs.vue'
import DeckColumn from './DeckColumn.vue'
import DeckHeaderAccount from './DeckHeaderAccount.vue'

interface FollowRequest {
  id: string
  follower: NormalizedUser
  followee: NormalizedUser
  /** Account this request belongs to (set in cross-account mode) */
  _accountId?: string
}

type TabValue = 'received' | 'sent'

const props = defineProps<{
  column: DeckColumnType
}>()

const isCrossAccount = computed(() => props.column.accountId == null)
const accountsStore = useAccountsStore()

const { navigateToUser: navToUser } = useNavigation()
const serversStore = useServersStore()

const { account, columnThemeVars } = useColumnTheme(() => props.column)
const { serverInfoImageUrl, serverNotFoundImageUrl, serverErrorImageUrl } =
  useServerImages(() => props.column)
const isLoggedOut = computed(() => account.value?.hasToken === false)
const toast = useToast()

const serverIconUrl = ref<string | undefined>()
const isLoading = ref(false)
const error = ref<AppError | null>(null)
const requests = ref<FollowRequest[]>([])
const actionStates = ref<Record<string, 'accepted' | 'rejected' | 'canceled'>>(
  {},
)
const scrollContainer = ref<HTMLElement | null>(null)
useColumnPullScroller(scrollContainer)
/** スワイプ対象は空表示でも常に存在する body 側 (scroller は条件付き描画) */
const bodyRef = ref<HTMLElement | null>(null)

const activeTab = ref<TabValue>('received')
const tabDefs: ColumnTabDef[] = [
  { value: 'received', label: '受け取った申請', icon: 'download' },
  { value: 'sent', label: '送った申請', icon: 'upload' },
]
const frTabIndex = computed(() =>
  tabDefs.findIndex((t) => t.value === activeTab.value),
)
useTabSlide(frTabIndex, bodyRef)

/** 受信タブは相手=follower、送信タブは相手=followee */
function requestUser(req: FollowRequest): NormalizedUser {
  return activeTab.value === 'sent' ? req.followee : req.follower
}

const emptyMessage = computed(() =>
  activeTab.value === 'sent'
    ? '送信中のフォローリクエストはありません'
    : 'フォローリクエストはありません',
)

function scrollToTop() {
  scrollContainer.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function fetchForAccount(accountId: string, tab: TabValue) {
  return tab === 'sent'
    ? commands.apiGetSentFollowRequests(accountId, 30)
    : commands.apiGetFollowRequests(accountId, 30)
}

async function fetchRequests() {
  if (isCrossAccount.value) {
    await fetchRequestsCrossAccount()
  } else {
    await fetchRequestsPerAccount()
  }
}

async function fetchRequestsPerAccount() {
  const acc = account.value
  if (!acc) return

  const tab = activeTab.value
  isLoading.value = true
  error.value = null

  try {
    const info = await serversStore.getServerInfo(acc.host)
    serverIconUrl.value = info.iconUrl

    const reqs = unwrap(
      await fetchForAccount(acc.id, tab),
    ) as unknown as FollowRequest[]
    if (activeTab.value !== tab) return
    requests.value = reqs
  } catch (e) {
    if (activeTab.value !== tab) return
    error.value = AppError.from(e)
  } finally {
    // タブ切替で新しい fetch が走っている場合はそちらの isLoading を保つ
    if (activeTab.value === tab) isLoading.value = false
  }
}

async function fetchRequestsCrossAccount() {
  const tab = activeTab.value
  isLoading.value = true
  error.value = null
  const accounts = accountsStore.accounts.filter((a) => a.hasToken)

  try {
    const results = await Promise.allSettled(
      accounts.map(async (acc) => {
        const reqs = unwrap(
          await fetchForAccount(acc.id, tab),
        ) as unknown as FollowRequest[]
        return reqs.map((r) => ({ ...r, _accountId: acc.id }))
      }),
    )
    if (activeTab.value !== tab) return

    const allRequests: FollowRequest[] = []
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        allRequests.push(...r.value)
      }
    }

    requests.value = allRequests
  } catch (e) {
    if (activeTab.value !== tab) return
    error.value = AppError.from(e)
  } finally {
    if (activeTab.value === tab) isLoading.value = false
  }
}

async function handleAction(
  req: FollowRequest,
  action: 'accepted' | 'rejected' | 'canceled',
) {
  const accountId = isCrossAccount.value ? req._accountId : account.value?.id
  if (!accountId) return

  try {
    if (action === 'accepted') {
      unwrap(await commands.apiAcceptFollowRequest(accountId, req.follower.id))
    } else if (action === 'rejected') {
      unwrap(await commands.apiRejectFollowRequest(accountId, req.follower.id))
    } else {
      unwrap(await commands.apiCancelFollowRequest(accountId, req.followee.id))
    }
    actionStates.value = { ...actionStates.value, [req.id]: action }
  } catch (e) {
    const appErr = AppError.from(e)
    if (
      appErr.message.includes('NO_SUCH_FOLLOW_REQUEST') ||
      appErr.message.includes('FOLLOW_REQUEST_NOT_FOUND')
    ) {
      actionStates.value = { ...actionStates.value, [req.id]: action }
    } else {
      toast.show(appErr.message, 'error')
    }
  }
}

function getRequestAccountId(req: FollowRequest): string | undefined {
  return isCrossAccount.value
    ? req._accountId
    : (props.column.accountId ?? undefined)
}

/** Resolve the account that owns a request (for cross-account support) */
function resolveReqAccount(req: FollowRequest) {
  if (!isCrossAccount.value) return account.value
  return accountsStore.accounts.find((a) => a.id === req._accountId)
}

function getRequestServerHost(req: FollowRequest): string | undefined {
  return resolveReqAccount(req)?.host
}

/** Get the server favicon URL for a request's account */
function resolveReqServerIcon(req: FollowRequest): string | null {
  const acc = resolveReqAccount(req)
  if (!acc) return null
  const info = serversStore.servers.get(acc.host)
  return info?.iconUrl || `https://${acc.host}/favicon.ico`
}

/** Whether to show the server badge on a request (cross-account columns with 2+ accounts) */
function shouldShowServerBadge(req: FollowRequest): boolean {
  if (!isCrossAccount.value) return false
  if (accountsStore.accounts.length < 2) return false
  return resolveReqAccount(req) != null
}

/** Tooltip shown on the server badge: `@username@host` */
function reqBadgeTitle(req: FollowRequest): string | undefined {
  const acc = resolveReqAccount(req)
  if (!acc) return undefined
  return `@${acc.username}@${acc.host}`
}

function displayName(user: NormalizedUser): string {
  if (user.host) return `@${user.username}@${user.host}`
  return `@${user.username}`
}

watch(activeTab, () => {
  requests.value = []
  fetchRequests()
})

onMounted(() => {
  fetchRequests()
})
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name || 'フォローリクエスト'"
    :theme-vars="columnThemeVars"
    require-account
    @header-click="scrollToTop"
    :pull-refresh="fetchRequests"
    @refresh="fetchRequests"
  >
    <template #header-icon>
      <i class="ti ti-user-plus" :class="$style.tlHeaderIcon" />
    </template>

    <template #header-meta>
      <DeckHeaderAccount v-if="!isCrossAccount" :account="account" :server-icon-url="serverIconUrl" />
    </template>

    <template #header-extra>
      <ColumnTabs
        v-model="activeTab"
        :tabs="tabDefs"
        :swipe-target="bodyRef"
      />
    </template>

    <ColumnEmptyState
      v-if="error && !isLoggedOut"
      :error="error"
      :account-id="column.accountId"
      is-error
      :image-url="serverErrorImageUrl"
      cta-label="再試行"
      cta-icon="ti-refresh"
      @cta="fetchRequests"
    />

    <div v-else ref="bodyRef" :class="$style.frBody">
      <ColumnEmptyState
        v-if="requests.length === 0 && !isLoading"
        :message="emptyMessage"
        :image-url="serverInfoImageUrl"
      />

      <div v-else ref="scrollContainer" :class="$style.frScroller">
        <div
          v-for="req in requests"
          :key="req.id"
          :class="$style.frItem"
        >
          <div :class="$style.frUser" role="button" tabindex="0" @click="getRequestAccountId(req) && navToUser(getRequestAccountId(req)!, requestUser(req).id)" @keydown.enter="getRequestAccountId(req) && navToUser(getRequestAccountId(req)!, requestUser(req).id)">
            <div :class="$style.frAvatarWrap">
              <MkAvatar
                :avatar-url="requestUser(req).avatarUrl"
                :decorations="requestUser(req).avatarDecorations"
                :size="42"
                :is-cat="requestUser(req).isCat"
              />
              <img
                v-if="shouldShowServerBadge(req) && resolveReqServerIcon(req)"
                :src="resolveReqServerIcon(req)!"
                :class="$style.frServerBadge"
                :title="reqBadgeTitle(req)"
              />
            </div>
            <div :class="$style.frUserInfo">
              <span :class="$style.frDisplayName">
                <MkMfm
                  v-if="requestUser(req).name"
                  :text="requestUser(req).name!"
                  :server-host="getRequestServerHost(req)"
                  :emojis="requestUser(req).emojis"
                  plain
                />
                <template v-else>{{ requestUser(req).username }}</template>
              </span>
              <span :class="$style.frAcct">{{ displayName(requestUser(req)) }}</span>
            </div>
          </div>

          <div :class="$style.frActions">
            <template v-if="actionStates[req.id]">
              <span :class="$style.frDone">
                {{ actionStates[req.id] === 'accepted' ? '承認済み' : actionStates[req.id] === 'rejected' ? '拒否済み' : '取り消し済み' }}
              </span>
            </template>
            <template v-else-if="activeTab === 'sent'">
              <button :class="[$style.frBtn, $style.cancelBtn]" @click="handleAction(req, 'canceled')">
                <i class="ti ti-x" /> 取り消し
              </button>
            </template>
            <template v-else>
              <button :class="[$style.frBtn, $style.acceptBtn]" @click="handleAction(req, 'accepted')">
                <i class="ti ti-check" /> 承認
              </button>
              <button :class="[$style.frBtn, $style.rejectBtn]" @click="handleAction(req, 'rejected')">
                <i class="ti ti-x" /> 拒否
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </DeckColumn>
</template>

<style lang="scss" module>
@use './column-common.module.scss';

.frBody {
  composes: tlBody from './column-common.module.scss';
}

.frScroller {
  composes: columnScroller from './column-common.module.scss';
}

.frItem {
  padding: 14px 16px;
  border-bottom: 1px solid var(--nd-divider);
  contain: layout style paint;
  content-visibility: auto;
  contain-intrinsic-size: auto 100px;
}

.frUser {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;

  &:hover .frDisplayName {
    text-decoration: underline;
  }
}

.frUserInfo {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.frDisplayName {
  font-weight: bold;
  font-size: 0.9em;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.frAcct {
  font-size: 0.8em;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.frAvatarWrap {
  position: relative;
  flex-shrink: 0;
  width: 42px;
  height: 42px;
}

.frServerBadge {
  position: absolute;
  top: -2px;
  right: -4px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: contain;
  background: var(--nd-panel);
  box-shadow: 0 0 0 3px var(--nd-panel);
  user-select: none;
  -webkit-user-select: none;
}

.frActions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  padding-left: 52px;
  /* ボタン部は通知カラムの followRequestActions と同じ 300px 幅。単独
     ボタン (送信タブの取り消し) がカラム全幅へ間延びするのを防ぐ。 */
  max-width: 352px; /* 300px + padding-left 52px */
}

.frBtn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 100px;
  padding: 7px 14px;
  font-weight: bold;
  font-size: 0.85em;
  border: none;
  border-radius: var(--nd-radius-full);
  cursor: pointer;
  transition:
    filter var(--nd-duration-base),
    background var(--nd-duration-base);
}

.acceptBtn {
  background: var(--nd-link);
  color: #fff;

  &:hover {
    filter: brightness(1.1);
  }
}

.rejectBtn {
  background: transparent;
  color: var(--nd-love);

  &:hover {
    background: var(--nd-love-subtle);
  }
}

/* 本家 MkButton rounded danger 相当: buttonBg 地 + error 色の太字 */
.cancelBtn {
  background: var(--nd-buttonBg);
  color: var(--nd-error);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.frDone {
  font-size: 0.85em;
  opacity: 0.6;
  font-style: italic;
}
</style>
