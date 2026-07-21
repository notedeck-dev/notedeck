<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import type { NormalizedUserDetail, ServerAdapter } from '@/adapters/types'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import { useAccountsStore } from '@/stores/accounts'
import { useIsCompactLayout } from '@/stores/ui'
import type { FollowState } from '@/utils/followAction'
import { formatCount } from '@/utils/format'
import { proxyUrl } from '@/utils/imageProxy'
import MkAvatar from './MkAvatar.vue'
import MkFollowButton from './MkFollowButton.vue'
import MkMfm from './MkMfm.vue'

const USER_DETAIL_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const USER_DETAIL_CACHE_MAX = 32
const userDetailCache = new Map<
  string,
  { data: NormalizedUserDetail; at: number }
>()
const pendingUserDetails = new Map<string, Promise<NormalizedUserDetail>>()

const props = defineProps<{
  userId: string
  accountId: string
  x: number
  y: number
  themeVars?: Record<string, string>
}>()

const emit = defineEmits<{
  close: []
}>()

const accountsStore = useAccountsStore()
const isCompact = useIsCompactLayout()

const account = computed(() =>
  accountsStore.accounts.find((a) => a.id === props.accountId),
)
const user = ref<NormalizedUserDetail | null>(null)
const isLoading = ref(true)
// フォローボタン (#752) 用。キャッシュヒット時も factory のキャッシュから解決する
const adapterRef = shallowRef<ServerAdapter | null>(null)

const isOwnUser = computed(() => account.value?.userId === user.value?.id)

// フォローボタンの update: ポップアップ表示中の detail と共有キャッシュの
// エントリは同一オブジェクトなので、ここで反映すれば次回表示にも効く
function onFollowUpdate(next: FollowState) {
  const u = user.value
  if (!u) return
  const wasFollowing = u.isFollowing
  u.isFollowing = next.isFollowing
  u.hasPendingFollowRequestFromYou = next.hasPendingFollowRequestFromYou
  if (wasFollowing !== next.isFollowing) {
    u.followersCount = Math.max(
      0,
      u.followersCount + (next.isFollowing ? 1 : -1),
    )
  }
}

onMounted(async () => {
  const cacheKey = `${props.accountId}:${props.userId}`
  try {
    const acc = accountsStore.accounts.find((a) => a.id === props.accountId)
    if (acc) {
      const { adapter } = await initAdapterFor(acc.host, acc.id, {
        pinnedReactions: false,
        hasToken: acc.hasToken,
      })
      adapterRef.value = adapter
    }

    const cached = userDetailCache.get(cacheKey)
    if (cached && Date.now() - cached.at < USER_DETAIL_CACHE_TTL) {
      user.value = cached.data
      isLoading.value = false
      return
    }

    let promise = pendingUserDetails.get(cacheKey)
    if (!promise) {
      const adapter = adapterRef.value
      if (!adapter) return
      promise = adapter.api.getUserDetail(props.userId)
      pendingUserDetails.set(cacheKey, promise)
    }

    const result = await promise
    if (userDetailCache.size >= USER_DETAIL_CACHE_MAX) {
      const oldest = userDetailCache.keys().next().value
      if (oldest !== undefined) userDetailCache.delete(oldest)
    }
    userDetailCache.set(cacheKey, { data: result, at: Date.now() })
    pendingUserDetails.delete(cacheKey)
    user.value = result
  } catch {
    pendingUserDetails.delete(cacheKey)
    // Silently fail — popup is non-critical
  } finally {
    isLoading.value = false
  }
})

function handleMouseLeave() {
  emit('close')
}

// 画面端で見切れないよう座標をクランプ (内容ロード後にサイズが変わるので再計算)
const rootRef = ref<HTMLElement | null>(null)
const clamped = ref<{ x: number; y: number } | null>(null)

function clampPosition() {
  const el = rootRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const margin = 8
  clamped.value = {
    x: Math.max(
      margin,
      Math.min(props.x, window.innerWidth - rect.width - margin),
    ),
    y: Math.max(
      margin,
      Math.min(props.y, window.innerHeight - rect.height - margin),
    ),
  }
}
onMounted(() => nextTick(clampPosition))
watch(user, () => nextTick(clampPosition))

// Close on Escape
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    ref="rootRef"
    :class="[$style.userPopup, { [$style.mobile]: isCompact }]"
    class="_popup user-hover-popup"
    :style="{ ...themeVars, left: `${clamped?.x ?? x}px`, top: `${clamped?.y ?? y}px` }"
    @mouseleave="handleMouseLeave"
  >
    <div v-if="isLoading" :class="$style.popupLoading"><LoadingSpinner /></div>
    <template v-else-if="user">
      <div :class="$style.popupBanner">
        <div
          v-if="user.bannerUrl"
          :class="$style.popupBannerImg"
          :style="{ backgroundImage: `url(${proxyUrl(user.bannerUrl)})` }"
        />
        <div v-else :class="[$style.popupBannerImg, $style.popupBannerEmpty]" />
      </div>
      <div :class="$style.popupBody">
        <MkAvatar
          :avatar-url="user.avatarUrl"
          :decorations="user.avatarDecorations"
          :size="56"
          indicator
          :is-cat="user.isCat"
          :online-status="user.onlineStatus"
          :class="$style.popupAvatar"
        />

        <div :class="$style.popupNameArea">
          <div :class="$style.popupName">
            <MkMfm v-if="user.name" :text="user.name" :emojis="user.emojis" :server-host="account?.host" plain />
            <template v-else>{{ user.username }}</template>
          </div>
          <div :class="$style.popupUsername">@{{ user.username }}{{ user.host ? `@${user.host}` : '' }}</div>
        </div>

        <div v-if="user.description" :class="$style.popupDesc">
          <MkMfm :text="user.description" :server-host="account?.host" />
        </div>

        <div class="user-stats" :class="$style.popupStats" :data-own="isOwnUser">
          <span><b class="user-stat-count">{{ formatCount(user.notesCount) }}</b> ノート</span>
          <span><b class="user-stat-count">{{ formatCount(user.followingCount) }}</b> フォロー</span>
          <span><b class="user-stat-count">{{ formatCount(user.followersCount) }}</b> フォロワー</span>
        </div>

        <div v-if="user.isFollowed" :class="$style.popupBadge">フォローされています</div>

        <!-- ネイティブ action としてのフォローボタン (#752)。プラグイン action は
             引き続きメニュー面のみ (ポップアップ=プレビューの原則の例外判断) -->
        <MkFollowButton
          v-if="!isOwnUser && account?.hasToken"
          :class="$style.popupFollowBtn"
          :user-id="user.id"
          :username="user.username"
          :is-following="user.isFollowing"
          :has-pending-request="user.hasPendingFollowRequestFromYou === true"
          :is-followed="user.isFollowed"
          :is-locked="user.isLocked ?? false"
          :api="adapterRef?.api ?? null"
          size="sm"
          @update="onFollowUpdate"
        />

        <div v-if="user.host" :class="$style.remoteBadge">
          <i class="ti ti-info-circle" />
          リモートユーザー
        </div>

      </div>
    </template>
  </div>
</template>

<style lang="scss" module>
.userPopup {
  position: fixed;
  z-index: calc(var(--nd-z-popup) + 1);
  width: 300px;
  overflow: hidden;
  pointer-events: auto;
  contain: paint;
  animation: userPopupIn 0.15s var(--nd-ease-spring);
}

@keyframes userPopupIn {
  from { opacity: 0; transform: scale(0.97) translateY(4px); }
}

/* バナー右上に重ねる (プロフィールヒーローと同じ配置感) */
.popupFollowBtn {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1;
}

.popupLoading {
  padding: 24px;
  text-align: center;
  font-size: 0.85em;
  color: var(--nd-fg);
  opacity: 0.5;
}

.popupBannerImg {
  width: 100%;
  height: 80px;
  background-color: #4c5e6d;
  background-size: cover;
  background-position: center;
}

.popupBannerEmpty {
  background: linear-gradient(135deg, color-mix(in srgb, var(--nd-accent) 40%, var(--nd-panel)), color-mix(in srgb, var(--nd-accent) 20%, var(--nd-panel)));
}

.popupBody {
  padding: 0 16px 16px;
  position: relative;
}

.popupAvatar {
  border: 3px solid var(--nd-popup);
  border-radius: 50%;
  margin-top: -28px;
}

.popupNameArea {
  margin-top: 4px;
}

.popupName {
  font-weight: bold;
  font-size: 1em;
  color: var(--nd-fgHighlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.popupUsername {
  font-size: 0.8em;
  opacity: 0.6;
}

.popupDesc {
  margin: 8px 0 0;
  font-size: 0.85em;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.popupStats {
  display: flex;
  gap: 12px;
  margin-top: 10px;
  font-size: 0.8em;
  opacity: 0.7;

  b {
    color: var(--nd-fgHighlighted);
  }
}

.popupBadge {
  display: inline-block;
  margin-top: 8px;
  padding: 2px 10px;
  border-radius: var(--nd-radius-full);
  font-size: 0.7em;
  font-weight: bold;
  background: var(--nd-accentedBg);
  color: var(--nd-accent);
}

.remoteBadge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 0.8em;
  color: var(--nd-infoFg);
  background: var(--nd-infoBg);
  opacity: 0.8;
}

.mobile {
  width: auto;
  max-width: calc(100vw - 32px);
  left: 16px !important;
  right: 16px;
  top: auto !important;
  bottom: calc(60px + var(--nd-safe-area-bottom, env(safe-area-inset-bottom)));
}
</style>
