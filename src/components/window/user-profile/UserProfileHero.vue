<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import type { NormalizedUserDetail, ServerAdapter } from '@/adapters/types'
import MkAvatar from '@/components/common/MkAvatar.vue'
import MkFollowButton from '@/components/common/MkFollowButton.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import { useToast } from '@/stores/toast'
import { useWindowsStore } from '@/stores/windows'
import { AppError } from '@/utils/errors'
import type { FollowState } from '@/utils/followAction'
import {
  displayUrl,
  formatBirthday,
  formatCount,
  formatDate,
} from '@/utils/format'
import { proxyUrl } from '@/utils/imageProxy'
import { openSafeUrl, safeCssUrl } from '@/utils/url'

// プロフィール overview の hero 面 (#707): バナー / アバター / フォロー操作 /
// メモ (#458) / ロール / フィールド / 統計。メモ保存とフォローは adapter を
// 受けて自律実行し、メニュー・QR の開閉 (親が portal で所有) は emit で返す。
const props = defineProps<{
  user: NormalizedUserDetail
  adapter: ServerAdapter | null
  accountId: string
  accountHost?: string
  isOwnProfile: boolean
  canEditMemo: boolean
}>()

const emit = defineEmits<{
  openMenu: [event: MouseEvent]
  openQr: []
  /** メモ保存成功。親が user.memo を更新する (prop の直接変異を避ける) */
  memoSaved: [memo: string]
  error: [error: AppError]
}>()

const toast = useToast()
const windowsStore = useWindowsStore()

// フォローボタンは MkFollowButton (#752 で共通化)。成功時の遷移後状態を
// props.user へ反映する (followersCount の楽観調整もここ)
function onFollowUpdate(next: FollowState) {
  const u = props.user
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

const canSeeFollowing = computed(() => {
  if (props.isOwnProfile) return true
  const v = props.user.followingVisibility ?? 'public'
  if (v === 'public') return true
  if (v === 'followers' && props.user.isFollowed) return true
  return false
})
const canSeeFollowers = computed(() => {
  if (props.isOwnProfile) return true
  const v = props.user.followersVisibility ?? 'public'
  if (v === 'public') return true
  if (v === 'followers' && props.user.isFollowed) return true
  return false
})

function openFollowList(type: 'following' | 'followers') {
  windowsStore.open('follow-list', {
    accountId: props.accountId,
    userId: props.user.id,
    username: props.user.username,
    userHost: props.user.host,
    initialTab: type,
  })
}

// User memo (#458): 他ユーザーへの自分用メモ。プロフィール上に常時表示の
// スティッキーエリアとして置き、その場編集 → blur で自動保存する。
// メニューや「追加」ボタンといった別導線は設けない (本家の二重導線を統合)。
const memoDraft = ref('')
const memoTextareaEl = useTemplateRef<HTMLTextAreaElement>('memoTextareaEl')

function adjustMemoTextarea() {
  const el = memoTextareaEl.value
  if (!el) return
  el.style.height = '0px'
  el.style.height = `${el.scrollHeight}px`
}

async function saveMemo() {
  if (!props.adapter) return
  const next = memoDraft.value
  if ((props.user.memo ?? '') === next) return // 変更なし
  try {
    await props.adapter.api.updateUserMemo(props.user.id, next)
    emit('memoSaved', next)
  } catch (e) {
    const err = AppError.from(e)
    console.error('[user:memo]', err.code, err.message)
    toast.show(`メモの保存に失敗しました（${err.displayCode}）`, 'error')
    memoDraft.value = props.user.memo ?? '' // 失敗時は元に戻す
  }
}

// user 読み込み・切替時に draft を同期し、textarea 高さを合わせる。
// mount 時点で user は読込済みなので immediate で初期化する。
watch(
  () => props.user.memo,
  (memo) => {
    memoDraft.value = memo ?? ''
    nextTick(adjustMemoTextarea)
  },
  { immediate: true },
)

onMounted(() => {
  adjustMemoTextarea()
})
</script>

<template>
  <div>
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
          <MkMfm v-if="user.name" :text="user.name" :emojis="user.emojis" :server-host="accountHost" plain />
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
          @click="emit('openMenu', $event)"
        >
          <i class="ti ti-dots" />
        </button>
        <MkFollowButton
          v-if="!isOwnProfile"
          :class="$style.bannerFollowBtn"
          :user-id="user.id"
          :username="user.username"
          :is-following="user.isFollowing"
          :has-pending-request="user.hasPendingFollowRequestFromYou === true"
          :is-followed="user.isFollowed"
          :is-locked="user.isLocked ?? false"
          :api="adapter?.api ?? null"
          size="md"
          @update="onFollowUpdate"
        />
        <button class="_button" :class="$style.bannerActionBtn" title="QRコード" @click="emit('openQr')">
          <i class="ti ti-qrcode" />
        </button>
      </div>
    </div>

    <!-- Mobile title (shown below avatar on narrow screens) -->
    <div :class="$style.mobileTitle">
      <div :class="$style.mobileName">
        <MkMfm v-if="user.name" :text="user.name" :emojis="user.emojis" :server-host="accountHost" plain />
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
            <MkMfm :text="user.followedMessage" :emojis="user.emojis" :server-host="accountHost" plain />
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
        @click="openSafeUrl(`https://${user.host || accountHost}/roles/${role.id}`)"
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
      <MkMfm :text="user.description" :emojis="user.emojis" :server-host="accountHost" />
    </div>

    <!-- Custom fields -->
    <div v-if="user.fields?.length" :class="$style.profileFields">
      <div v-for="(field, i) in user.fields" :key="i" :class="$style.profileField">
        <div :class="$style.profileFieldName">{{ field.name }}</div>
        <div :class="$style.profileFieldValue">
          <MkMfm :text="field.value" :emojis="user.emojis" :server-host="accountHost" />
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
    <div class="user-stats" :class="$style.stats" :data-own="isOwnProfile">
      <div :class="$style.stat">
        <b class="user-stat-count">{{ formatCount(user.notesCount) }}</b>
        <span>ノート</span>
      </div>
      <button v-if="canSeeFollowing" :class="[$style.stat, $style.statLink]" class="_button" @click="openFollowList('following')">
        <b class="user-stat-count">{{ formatCount(user.followingCount) }}</b>
        <span>フォロー</span>
      </button>
      <button v-if="canSeeFollowers" :class="[$style.stat, $style.statLink]" class="_button" @click="openFollowList('followers')">
        <b class="user-stat-count">{{ formatCount(user.followersCount) }}</b>
        <span>フォロワー</span>
      </button>
    </div>
  </div>
</template>

<style lang="scss" module>
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

/* 見た目は MkFollowButton (#752) が持つ。ここは配置のみ */
.bannerFollowBtn {
  margin-left: 4px;
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

.roleIcon {
  width: 1.3em;
  height: 1.3em;
  object-fit: contain;
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

.mobileName {}
.mobileUsername {}
.mobileBadges {}

// 親 (UserProfileContent) の .profileContainer が container-type: inline-size を
// 持つため、この module の @container はコンポーネント境界を越えて反応する。
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
}

/* Empty placeholder classes for dynamic binding */
.following {}
</style>
