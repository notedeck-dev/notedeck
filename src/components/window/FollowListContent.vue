<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import type {
  FollowRelation,
  NormalizedUser,
  ServerAdapter,
} from '@/adapters/types'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkAvatar from '@/components/common/MkAvatar.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import { showLoginPrompt } from '@/composables/useLoginPrompt'
import { useNavigation } from '@/composables/useNavigation'
import { usePaginatedList } from '@/composables/usePaginatedList'
import { isGuestAccount, useAccountsStore } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import { useToast } from '@/stores/toast'
import { AppError } from '@/utils/errors'

const props = defineProps<{
  accountId: string
  userId: string
  initialTab?: 'following' | 'followers'
}>()

const { navigateToUser: navToUser } = useNavigation()
const accountsStore = useAccountsStore()
const toast = useToast()

type TabType = 'following' | 'followers'
const activeTab = ref<TabType>(props.initialTab ?? 'following')
const followingIds = ref<Set<string>>(new Set())
const followedByIds = ref<Set<string>>(new Set())
const pendingIds = ref<Set<string>>(new Set())
const followLoadingIds = ref<Set<string>>(new Set())
/** hover 中の行のフォローボタンだけ「解除」表示に変える */
const hoveredFollowId = ref<string | null>(null)

const account = accountsStore.accounts.find((a) => a.id === props.accountId)
const isOwnProfile = computed(() => account?.userId === props.userId)
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
  followedByIds.value = new Set()
  pendingIds.value = new Set()
  loadUsers()
})

async function fetchRelations(batch: NormalizedUser[]) {
  if (!adapter) return
  try {
    const ids = batch.map((u) => u.id)
    const relations = await adapter.api.getUserRelations(ids)
    const newFollowing = new Set(followingIds.value)
    const newFollowed = new Set(followedByIds.value)
    const newPending = new Set(pendingIds.value)
    for (const r of relations) {
      if (r.isFollowing) newFollowing.add(r.id)
      if (r.isFollowed) newFollowed.add(r.id)
      if (r.hasPendingFollowRequestFromYou) newPending.add(r.id)
    }
    followingIds.value = newFollowing
    followedByIds.value = newFollowed
    pendingIds.value = newPending
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

const { confirm } = useConfirm()

async function toggleFollow(targetUser: NormalizedUser) {
  if (!adapter || followLoadingIds.value.has(targetUser.id)) return
  // フォロー解除だけは誤タップに備えて確認を挟む
  if (
    followingIds.value.has(targetUser.id) &&
    !pendingIds.value.has(targetUser.id)
  ) {
    const ok = await confirm({
      title: 'フォロー解除',
      message: `@${targetUser.username} のフォローを解除しますか？`,
      okLabel: '解除',
      type: 'danger',
    })
    if (!ok) return
  }
  followLoadingIds.value = new Set([...followLoadingIds.value, targetUser.id])
  try {
    if (pendingIds.value.has(targetUser.id)) {
      // 鍵アカウントへの未承認リクエストはキャンセル
      // (following/delete は notFollowing エラーになる)
      await adapter.api.cancelFollowRequest(targetUser.id)
      const next = new Set(pendingIds.value)
      next.delete(targetUser.id)
      pendingIds.value = next
    } else if (followingIds.value.has(targetUser.id)) {
      await adapter.api.unfollowUser(targetUser.id)
      const next = new Set(followingIds.value)
      next.delete(targetUser.id)
      followingIds.value = next
    } else {
      await adapter.api.followUser(targetUser.id)
      // 鍵アカウントは承認待ちになるだけなので、サーバーの relation で状態を確定する
      let pending = false
      try {
        const [rel] = await adapter.api.getUserRelations([targetUser.id])
        pending = rel?.hasPendingFollowRequestFromYou === true
      } catch {
        // relation 取得失敗時は従来どおりフォロー中扱い
      }
      if (pending) {
        pendingIds.value = new Set([...pendingIds.value, targetUser.id])
      } else {
        followingIds.value = new Set([...followingIds.value, targetUser.id])
      }
    }
  } catch (e) {
    const err = AppError.from(e)
    console.error('[follow:toggle]', err.code, err.message)
    toast.show(`操作に失敗しました（${err.displayCode}）`, 'error')
  } finally {
    const next = new Set(followLoadingIds.value)
    next.delete(targetUser.id)
    followLoadingIds.value = next
  }
}

function navigateUser(userId: string) {
  navToUser(props.accountId, userId)
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
      <div
        v-for="u in users"
        :key="u.id"
        :class="$style.userCard"
        @click="navigateUser(u.id)"
      >
        <MkAvatar :avatar-url="u.avatarUrl" :decorations="u.avatarDecorations" :size="48" :is-cat="u.isCat" />
        <div :class="$style.cardInfo">
          <div :class="$style.cardNameRow">
            <span :class="$style.cardName">
              <MkMfm v-if="u.name" :text="u.name" :emojis="u.emojis" :server-host="account?.host" plain />
              <template v-else>{{ u.username }}</template>
            </span>
            <span v-if="u.isBot" :class="$style.cardBadge">Bot</span>
          </div>
          <span :class="$style.cardAcct">@{{ u.username }}{{ u.host ? `@${u.host}` : '' }}</span>
          <span v-if="followedByIds.has(u.id)" :class="$style.followedBadge">フォローされています</span>
        </div>
        <button
          v-if="account?.userId !== u.id"
          class="_button"
          :class="[$style.followBtn, { [$style.followBtnFollowing]: followingIds.has(u.id) || pendingIds.has(u.id), [$style.followBtnDisabled]: !account?.hasToken }]"
          :disabled="followLoadingIds.has(u.id) || isGuest"
          @click.stop="account?.hasToken ? toggleFollow(u) : showLoginPrompt()"
          @mouseenter="hoveredFollowId = u.id"
          @mouseleave="hoveredFollowId = null"
        >
          <template v-if="followLoadingIds.has(u.id)">
            <i class="ti ti-loader-2 nd-spin" />
          </template>
          <template v-else-if="pendingIds.has(u.id)">
            {{ hoveredFollowId === u.id ? 'リクエスト取消' : 'フォロー許可待ち' }}
          </template>
          <template v-else-if="followingIds.has(u.id)">
            {{ hoveredFollowId === u.id ? 'フォロー解除' : 'フォロー中' }}
          </template>
          <template v-else>
            フォロー
          </template>
        </button>
      </div>

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

.userCard {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--nd-divider);
  cursor: pointer;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  &:last-child {
    border-bottom: none;
  }
}

.cardInfo {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.cardNameRow {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cardName {
  font-size: 0.9em;
  font-weight: bold;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.cardAcct {
  display: block;
  font-size: 0.75em;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.followedBadge {
  display: inline-block;
  font-size: 0.65em;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  opacity: 0.7;
  margin-top: 2px;
}

.followBtn {
  flex-shrink: 0;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.8em;
  font-weight: bold;
  color: var(--nd-fgOnAccent, #fff);
  background: var(--nd-accent);
  transition: opacity var(--nd-duration-base);

  &:hover {
    opacity: 0.85;
  }

  &:disabled {
    opacity: 0.5;
  }
}

.followBtnFollowing {
  color: var(--nd-fg);
  background: var(--nd-buttonBg);

  /* hover 時はラベルが「解除」に変わるのに合わせ danger 色に寄せる */
  &:hover {
    background: color-mix(in srgb, var(--nd-love) 20%, var(--nd-buttonBg));
    color: var(--nd-love);
    opacity: 1;
  }
}

.followBtnDisabled {
  opacity: 0.3;
  pointer-events: none;
}

.stateMsg {
  padding: 24px 16px;
  text-align: center;
  font-size: 0.85em;
  opacity: 0.5;
  color: var(--nd-fg);
}

</style>
