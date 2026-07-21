<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import type {
  FollowRelation,
  NormalizedUser,
  ServerAdapter,
  UserRelation,
} from '@/adapters/types'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkFollowButton from '@/components/common/MkFollowButton.vue'
import MkUserListItem from '@/components/common/MkUserListItem.vue'
import { usePaginatedList } from '@/composables/usePaginatedList'
import { useWindowExternalLink } from '@/composables/useWindowExternalLink'
import { isGuestAccount, useAccountsStore } from '@/stores/accounts'
import { useToast } from '@/stores/toast'
import { AppError } from '@/utils/errors'
import type { FollowApi, FollowState } from '@/utils/followAction'
import { webUiUrl } from '@/utils/url'

const props = defineProps<{
  accountId: string
  userId: string
  /** WebUI の /@acct/(following|followers) を開くヘッダーボタン用。deep link 経由では未指定 */
  username?: string
  userHost?: string | null
  initialTab?: 'following' | 'followers'
}>()

const accountsStore = useAccountsStore()
const toast = useToast()

type TabType = 'following' | 'followers'
const activeTab = ref<TabType>(props.initialTab ?? 'following')
const followingIds = ref<Set<string>>(new Set())
const pendingIds = ref<Set<string>>(new Set())
/** relation バッジ (フォローされています/ブロック中/ミュート中 #752) 用 */
const relations = ref<Map<string, UserRelation>>(new Map())

const account = accountsStore.accounts.find((a) => a.id === props.accountId)
const isOwnProfile = computed(() => account?.userId === props.userId)

// ヘッダー「Web UIで開く」— 表示中タブに対応する WebUI ページを開く
useWindowExternalLink(() => {
  if (!account || !props.username) return null
  const acct = `@${props.username}${props.userHost ? `@${props.userHost}` : ''}`
  return { url: webUiUrl(account.host, `/${acct}/${activeTab.value}`) }
})
const isGuest = account ? isGuestAccount(account) : false
let adapter: ServerAdapter | null = null

const {
  items: users,
  isLoading,
  load: loadUsers,
  loadMore: loadMoreUsers,
  reset: resetUsers,
} = usePaginatedList<NormalizedUser>({
  fetch: async (untilId) => {
    if (!adapter) return []
    const fetchFn =
      activeTab.value === 'following'
        ? adapter.api.getFollowing.bind(adapter.api)
        : adapter.api.getFollowers.bind(adapter.api)
    const result = await fetchFn(props.userId, { limit: 30, untilId })
    const fetched = result
      .map((r: FollowRelation) =>
        activeTab.value === 'following' ? r.followee : r.follower,
      )
      .filter((u): u is NormalizedUser => u != null)
    if (fetched.length > 0) {
      if (isOwnProfile.value && activeTab.value === 'following') {
        // Own following list: all are followed by me
        followingIds.value = new Set([
          ...followingIds.value,
          ...fetched.map((u) => u.id),
        ])
      } else {
        fetchRelations(fetched)
      }
    }
    return fetched
  },
  onError: (e) => {
    const err = AppError.from(e)
    console.error('[follow:load]', err.code, err.message)
    toast.show(`取得に失敗しました（${err.displayCode}）`, 'error')
  },
})

onMounted(async () => {
  if (!account) return
  try {
    const result = await initAdapterFor(account.host, account.id, {
      pinnedReactions: false,
      hasToken: account.hasToken,
    })
    adapter = result.adapter
    await loadUsers()
  } catch (e) {
    const err = AppError.from(e)
    console.error('[follow:init]', err.code, err.message)
    toast.show(`読み込みに失敗しました（${err.displayCode}）`, 'error')
  }
})

watch(activeTab, () => {
  resetUsers()
  followingIds.value = new Set()
  pendingIds.value = new Set()
  relations.value = new Map()
  loadUsers()
})

async function fetchRelations(batch: NormalizedUser[]) {
  if (!adapter) return
  try {
    const ids = batch.map((u) => u.id)
    const fetched = await adapter.api.getUserRelations(ids)
    const newFollowing = new Set(followingIds.value)
    const newPending = new Set(pendingIds.value)
    const newRelations = new Map(relations.value)
    for (const r of fetched) {
      if (r.isFollowing) newFollowing.add(r.id)
      if (r.hasPendingFollowRequestFromYou) newPending.add(r.id)
      newRelations.set(r.id, r)
    }
    followingIds.value = newFollowing
    pendingIds.value = newPending
    relations.value = newRelations
  } catch {
    // Non-critical
  }
}

function onScroll(e: Event) {
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
    loadMoreUsers()
  }
}

// フォロー操作は MkFollowButton (#752 で共通化)。成功時の遷移後状態を
// Set へ反映する
function onFollowUpdate(userId: string, next: FollowState) {
  const nf = new Set(followingIds.value)
  if (next.isFollowing) nf.add(userId)
  else nf.delete(userId)
  followingIds.value = nf
  const np = new Set(pendingIds.value)
  if (next.hasPendingFollowRequestFromYou) np.add(userId)
  else np.delete(userId)
  pendingIds.value = np
}

// adapter は非リアクティブな let のため template から直接参照できない
// (TS が null に狭める)。行が描画されるのは load 後 = adapter 初期化後
function followApiFor(): FollowApi | null {
  return account?.hasToken ? (adapter?.api ?? null) : null
}

// 一覧は NormalizedUser のみで isLocked が不明なため、follow 後に relation で
// 承認待ちかを確定する
function resolvePendingFor(userId: string) {
  return async () => {
    if (!adapter) return false
    const [rel] = await adapter.api.getUserRelations([userId])
    return rel?.hasPendingFollowRequestFromYou === true
  }
}
</script>

<template>
  <div :class="$style.followListContent">
    <div :class="$style.tabs">
      <button
        class="_button"
        :class="[$style.tab, { [$style.tabActive]: activeTab === 'following' }]"
        @click="activeTab = 'following'"
      >
        フォロー
      </button>
      <button
        class="_button"
        :class="[$style.tab, { [$style.tabActive]: activeTab === 'followers' }]"
        @click="activeTab = 'followers'"
      >
        フォロワー
      </button>
    </div>

    <div :class="$style.listBody" @scroll.passive="onScroll">
      <MkUserListItem
        v-for="u in users"
        :key="u.id"
        :user="u"
        :account-id="accountId"
        :avatar-size="48"
        :server-host="account?.host"
        :relation="relations.get(u.id) ?? null"
      >
        <template #badges>
          <span v-if="u.isBot" :class="$style.cardBadge">Bot</span>
        </template>
        <template #actions>
          <MkFollowButton
            v-if="account?.userId !== u.id"
            data-mk-uli-action
            :user-id="u.id"
            :username="u.username"
            :is-following="followingIds.has(u.id)"
            :has-pending-request="pendingIds.has(u.id)"
            :api="followApiFor()"
            :resolve-pending="resolvePendingFor(u.id)"
            :disabled="isGuest"
            @update="onFollowUpdate(u.id, $event)"
          />
        </template>
      </MkUserListItem>

      <div v-if="isLoading" :class="$style.stateMsg"><LoadingSpinner /></div>
      <div v-else-if="users.length === 0" :class="$style.stateMsg">
        {{ activeTab === 'following' ? 'フォローしているユーザーはいません' : 'フォロワーはいません' }}
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
.followListContent {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--nd-bg);
}

.tabs {
  display: flex;
  border-bottom: 1px solid var(--nd-divider);
  flex-shrink: 0;
}

.tab {
  flex: 1;
  padding: 10px;
  font-size: 0.85em;
  font-weight: bold;
  color: var(--nd-fg);
  opacity: 0.6;
  border-bottom: 2px solid transparent;
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 1;
  }
}

.tabActive {
  opacity: 1;
  color: var(--nd-accent);
  border-bottom-color: var(--nd-accent);
}

.listBody {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
}

.cardBadge {
  flex-shrink: 0;
  font-size: 0.65em;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  opacity: 0.7;
}

.stateMsg {
  padding: 24px 16px;
  text-align: center;
  font-size: 0.85em;
  opacity: 0.5;
  color: var(--nd-fg);
}

</style>
